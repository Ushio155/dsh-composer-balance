/**
 * Unit tests for the host half's pure functions.
 *
 * The assertions are deliberately written so each one can fail:
 * they check specific values, and the argv assertion is the regression guard for the
 * credential-leak class this fork exists to close.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  BALANCE_URL,
  buildCurlInvocation,
  formatResult,
  isSameOriginRequest,
  parseBalancePayload,
} from '../lib/index.js'

const FAKE_KEY = 'sk-abcdef0123456789abcdef0123456789'

test('argv never carries the API key; stdin does', () => {
  const invocation = buildCurlInvocation('C:/Windows/System32/curl.exe', FAKE_KEY)
  const joined = invocation.argv.join(' ')
  assert.equal(joined.includes(FAKE_KEY), false, 'the key must never appear in argv')
  assert.equal(joined.includes('sk-'), false, 'no key fragment may appear in argv')
  assert.equal(invocation.stdin, 'Authorization: Bearer ' + FAKE_KEY + '\n')
  assert.equal(invocation.argv.includes('@-'), true, 'header file must be stdin')
  assert.equal(invocation.argv.includes(BALANCE_URL), true)
})

test('argv pins the request to https and a deadline', () => {
  const argv = buildCurlInvocation('curl', FAKE_KEY).argv
  const proto = argv.indexOf('--proto')
  assert.equal(argv[proto + 1], '=https')
  const maxTime = argv.indexOf('--max-time')
  assert.equal(argv[maxTime + 1], '20')
})

test('parseBalancePayload accepts a well-formed body', () => {
  const parsed = parseBalancePayload(JSON.stringify({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '4.69', granted_balance: '0.00', topped_up_balance: '4.69' },
      { currency: 'USD', total_balance: '1.00', granted_balance: '0.00', topped_up_balance: '1.00' },
    ],
  }))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.isAvailable, true)
  assert.equal(parsed.balances.length, 2)
  assert.deepEqual(parsed.balances[0], { currency: 'CNY', total: '4.69', granted: '0.00', toppedUp: '4.69' })
  assert.equal(parsed.balances[1].currency, 'USD')
})

test('parseBalancePayload reports each failure class distinctly', () => {
  assert.equal(parseBalancePayload('not json').error, 'BAD_RESPONSE')
  assert.equal(parseBalancePayload('42').error, 'BAD_RESPONSE')
  assert.equal(parseBalancePayload(JSON.stringify({ error: { message: 'auth failed' } })).error, 'API_ERROR')
  assert.equal(parseBalancePayload(JSON.stringify({ error: { message: 'auth failed' } })).message, 'auth failed')
  assert.equal(parseBalancePayload(JSON.stringify({ is_available: true })).error, 'BAD_RESPONSE')
})

test('parseBalancePayload treats is_available as strictly boolean', () => {
  const parsed = parseBalancePayload(JSON.stringify({ is_available: 'yes', balance_infos: [] }))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.isAvailable, false, 'a truthy string must not become true')
})

test('same-origin policy allows a browser fetch from its own host', () => {
  assert.equal(isSameOriginRequest({ host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }), true)
  assert.equal(isSameOriginRequest({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), true)
  assert.equal(isSameOriginRequest({}), true, 'a non-browser client with no headers is allowed')
})

test('same-origin policy refuses cross-site reads', () => {
  assert.equal(isSameOriginRequest({ 'sec-fetch-site': 'cross-site' }), false)
  assert.equal(isSameOriginRequest({ host: '127.0.0.1:3080', origin: 'http://evil.example' }), false)
  assert.equal(isSameOriginRequest({ origin: 'http://evil.example' }), false, 'no host means no match')
  assert.equal(isSameOriginRequest({ host: '127.0.0.1:3080', origin: 'not a url' }), false)
  assert.equal(isSameOriginRequest({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' }), false)
})

test('formatResult renders balances and failures', () => {
  const ok = formatResult({
    ok: true,
    at: '2026-01-01T00:00:00.000Z',
    isAvailable: true,
    balances: [{ currency: 'CNY', total: '4.69', granted: '0.00', toppedUp: '4.69' }],
  })
  assert.match(ok, /账户可用：是/)
  assert.match(ok, /CNY：总额 4\.69（赠送 0\.00，充值 4\.69）/)

  const bad = formatResult({ ok: false, error: 'MISSING_CREDENTIAL', message: '未配置 DEEPSEEK_API_KEY' })
  assert.match(bad, /\[MISSING_CREDENTIAL\]/)
  assert.match(bad, /未配置 DEEPSEEK_API_KEY/)

  assert.match(formatResult(null), /\[UNKNOWN\]/)
})
