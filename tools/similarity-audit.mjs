/**
 * Reproducible similarity audit against the upstream plugin this project derives from.
 *
 * It exists so the provenance claims in PROVENANCE.md are checkable rather than
 * asserted: run it against an upstream checkout and the printed table is what the
 * document reports.
 *
 * Usage:
 *   node tools/similarity-audit.mjs <upstream-dir> [--ours <dir>]
 * Example:
 *   node tools/similarity-audit.mjs D:/code_practice/AI_coding/chats/dsh-balance
 *
 * Read-only: it reads files and prints a report.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OURS_DEFAULT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const argv = process.argv.slice(2)
let oursDir = OURS_DEFAULT
let upstreamArg = null
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ours') {
    oursDir = resolve(argv[++i])
    continue
  }
  if (upstreamArg === null) upstreamArg = argv[i]
}
const upstreamDir = upstreamArg === null ? undefined : resolve(upstreamArg)

if (upstreamDir === undefined) {
  console.error('usage: node tools/similarity-audit.mjs <upstream-dir> [--ours <dir>]')
  process.exit(2)
}

const FILES = ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']

const normalize = (line) => line.replace(/\s+/g, ' ').trim()

function readLines(base, rel) {
  try {
    return readFileSync(resolve(base, rel), 'utf8')
      .split(/\r?\n/)
      .map(normalize)
      .filter((line) => line !== '')
  } catch {
    return null
  }
}

function tokens(text) {
  return new Set(text.match(/[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|\*\*|===|!==|=>|\.\.\.|&&|\|\||[{}\[\]();,.:=+\-*/<>!?&|]/g) || [])
}

function longestBlock(a, b) {
  let best = 0
  let bestStart = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k > best) {
        best = k
        bestStart = i
      }
    }
  }
  return { length: best, start: bestStart }
}

console.log('upstream: ' + upstreamDir)
console.log('ours    : ' + oursDir)
console.log('')
console.log('| file | shared lines | % of ours | % of upstream | substantive | longest block | token Jaccard |')
console.log('| --- | --- | --- | --- | --- | --- | --- |')

for (const rel of FILES) {
  const up = readLines(upstreamDir, rel)
  const ours = readLines(oursDir, rel)
  if (up === null || ours === null) {
    console.log('| ' + rel + ' | (missing on one side) | | | | | |')
    continue
  }
  const upSet = new Set(up)
  const shared = [...new Set(ours)].filter((line) => upSet.has(line))
  const substantive = shared.filter((line) => line.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '').length >= 8)
  const block = longestBlock(up, ours)

  const tu = tokens(up.join('\n'))
  const to = tokens(ours.join('\n'))
  let inter = 0
  for (const t of to) if (tu.has(t)) inter++
  const jaccard = inter / (tu.size + to.size - inter)

  console.log('| `' + rel + '` | ' + shared.length +
    ' | ' + (shared.length / ours.length * 100).toFixed(1) + '%' +
    ' | ' + (shared.length / up.length * 100).toFixed(1) + '%' +
    ' | ' + substantive.length +
    ' | ' + block.length + ' | ' + (jaccard * 100).toFixed(1) + '% |')

  if (block.length >= 2) {
    for (let k = 0; k < Math.min(block.length, 6); k++) {
      console.log('    upstream line ' + (block.start + k + 1) + ': ' + up[block.start + k].slice(0, 140))
    }
  }
}
