/**
 * Client-half tests.
 *
 * The browser half is a classic script bundle whose components are only reachable
 * through the slot registrations it performs, so these tests load the real bundle
 * with a small hooks-capable React stand-in, capture the registrations, and render
 * them the way the shell does.
 *
 * Regression target: the settings card's post-save render. An undeclared `config`
 * reference there throws a ReferenceError only after 保存 is pressed, which unmounts
 * the whole React tree (a blank page) — a bug that no render-before-save test sees.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLIENT_URL = pathToFileURL(fileURLToPath(new URL('../lib/client.js', import.meta.url))).href

const OK_PAYLOAD = {
  ok: true,
  isAvailable: true,
  balances: [{ currency: 'CNY', total: '4.69', granted: '0.00', toppedUp: '4.69' }],
}

/** Minimal function-component runtime: hooks persist across manual re-renders. */
function makeRuntime() {
  const slots = []
  let cursor = 0
  const use = (i) => (slots[i] ??= {})
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const s = use(cursor++)
      if (!('v' in s)) s.v = typeof initial === 'function' ? initial() : initial
      return [s.v, (next) => { s.v = typeof next === 'function' ? next(s.v) : next }]
    },
    useRef(initial) {
      const s = use(cursor++)
      if (!('r' in s)) s.r = { current: initial }
      return s.r
    },
    useCallback(fn, deps) {
      const s = use(cursor++)
      if (changed(s.deps, deps)) { s.deps = deps; s.fn = fn }
      return s.fn
    },
    useEffect(fn, deps) {
      const s = use(cursor++)
      if (changed(s.deps, deps)) { s.deps = deps; s.pending = fn }
    },
  }

  return {
    React,
    /** Render a component element (calls the function, then runs queued effects). */
    render(element) {
      cursor = 0
      assert.equal(typeof element.type, 'function', 'sections register a function component')
      const tree = element.type(element.props)
      const queued = []
      for (const s of slots) if (typeof s.pending === 'function') { queued.push(s.pending); s.pending = undefined }
      for (const fn of queued) fn()
      return tree
    },
  }
}

/** Walk a rendered tree; returns the first element carrying an onClick whose text matches. */
function findClickable(node, label) {
  if (node === null || typeof node !== 'object') return null
  if (typeof node.props?.onClick === 'function' && collectText(node).includes(label)) return node
  for (const child of node.children ?? []) {
    const hit = findClickable(child, label)
    if (hit) return hit
  }
  return null
}

function collectText(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  return (node.children ?? []).map(collectText).join('')
}

/** Load the bundle against a fake shell and return the slot render functions it registers. */
async function loadBundle(payload = OK_PAYLOAD) {
  const registered = {}
  const runtime = makeRuntime()

  const slots = {
    inject(name, fn) { fn(); return () => {} },
    register(options, render) {
      ;(registered[options.name] ??= []).push(render)
      return () => {}
    },
  }

  const store = new Map()
  globalThis.window = {
    __ModuleLoader__: { load(mod) { globalThis.__LOADED__ = mod } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    Event: class Event { constructor(type) { this.type = type } },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn, ms) => {
      // The pill schedules a 60s poll; unref keeps that timer from holding the
      // test process open after the assertions finish.
      const id = globalThis.setTimeout(fn, ms)
      if (typeof id.unref === 'function') id.unref()
      return id
    },
    clearTimeout: (id) => globalThis.clearTimeout(id),
    fetch: () => Promise.resolve({ json: () => Promise.resolve(payload) }),
  }
  globalThis.document = { hidden: false }

  await import(CLIENT_URL)
  const loaded = globalThis.__LOADED__
  assert.equal(loaded.id, 'dsh-composer-balance', 'bundle registers under the package name')

  const exported = loaded.factory((name) => {
    assert.equal(name, 'react', 'only react is required')
    return runtime.React
  })
  exported.apply({ get: () => slots, slots })
  return { registered, runtime, store }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('settings save renders the confirmation row without throwing', async () => {
  const { registered, runtime } = await loadBundle()
  const section = registered['settings.section']?.[0]
  assert.equal(typeof section, 'function', 'settings.section must be registered')

  const element = section()
  const beforeSave = runtime.render(element)
  assert.ok(findClickable(beforeSave, '保存'), '保存 button must render')

  // Press 保存 with the default inputs (60s / ¥10), then re-render as the shell does.
  findClickable(beforeSave, '保存').props.onClick()

  let afterSave
  assert.doesNotThrow(() => { afterSave = runtime.render(element) }, 'post-save re-render must not throw')
  assert.match(collectText(afterSave), /已保存/, 'confirmation row must appear')
})

test('settings save persists the four configuration fields', async () => {
  const { registered, runtime, store } = await loadBundle()
  const section = registered['settings.section'][0]
  const tree = runtime.render(section())
  findClickable(tree, '保存').props.onClick()

  const saved = JSON.parse(store.get('dsh-composer-balance:config'))
  assert.deepEqual(Object.keys(saved).sort(), ['autoRefresh', 'hideCordisBadge', 'intervalMs', 'lowBalanceThreshold'])
  assert.equal(saved.intervalMs, 60000)
  assert.equal(saved.lowBalanceThreshold, 10)
})

test('an out-of-range interval shows the validation error instead of saving', async () => {
  const { registered, runtime, store } = await loadBundle()
  const section = registered['settings.section'][0]
  findClickable(runtime.render(section()), '保存') // render once so hooks exist
  // The interval input is the first number input in the tree; drive its onChange.
  const tree = runtime.render(section())
  const inputs = []
  ;(function walk(node) {
    if (node === null || typeof node !== 'object') return
    if (node.type === 'input' && node.props?.onChange) inputs.push(node)
    for (const child of node.children ?? []) walk(child)
  })(tree)
  inputs[0].props.onChange({ target: { value: '2' } })

  const rerendered = runtime.render(section())
  findClickable(rerendered, '保存').props.onClick()

  assert.equal(store.has('dsh-composer-balance:config'), false, 'an invalid interval must not be written')
  assert.match(collectText(runtime.render(section())), /请输入/, 'validation message must appear')
})

test('the composer pill shows the balance and flags a below-threshold amount', async () => {
  const { registered, runtime } = await loadBundle()
  const pill = registered['conversation.input.left']?.[0]
  assert.equal(typeof pill, 'function', 'conversation.input.left must be registered')

  runtime.render(pill())
  await tick() // the pill's mount effect fetches, then sets state
  const text = collectText(runtime.render(pill()))

  assert.match(text, /¥4\.69/, 'the fetched balance must be rendered')
  assert.match(text, /⚠/, 'a balance under the ¥10 threshold must be flagged')
})

test('the composer pill survives a failing host payload', async () => {
  const { registered, runtime } = await loadBundle({ ok: false, error: 'CURL_FAIL', message: 'curl 退出码 35' })
  const pill = registered['conversation.input.left'][0]

  runtime.render(pill())
  await tick()
  const text = collectText(runtime.render(pill()))
  assert.match(text, /余额/, 'the pill keeps a label when the query fails')
})
