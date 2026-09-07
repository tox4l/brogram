#!/usr/bin/env node
// Bundle budget gate. `npm run perf:bundle` — part of the CI job alongside
// `npx vitest run` (spec §5.7, R5.7).
//
// Method (reproduces docs/research/v2/codebase-audit.md §3 exactly, because
// a different method produces numbers that cannot be compared to the v1
// column in perf-budget.json): for every app route, read its
// `.next/server/app/**/page_client-reference-manifest.js`, take that route's
// own `entryJSFiles` entry (the exact list of `<script>` chunks Next ships
// for that page, already inclusive of every ancestor layout), resolve each
// path against the on-disk `.next/static/chunks/*.js` file, and sum
// uncompressed bytes. `entryJSFiles` only ever lists `.js` chunks (CSS is
// tracked separately in `entryCSSFiles`), so this is already "JS payload,
// uncompressed" with nothing extra to filter out.
//
// A route dynamically imported with `next/dynamic({ ssr: false })` (the
// exercise editor, per spec §5.5) never appears in `entryJSFiles` at all —
// it is a separate, on-demand chunk, which is the whole point of deferring
// it out of the initial payload. This script does not need to chase those
// down; the gate is about what a route pays before any interaction.
//
// perf-budget.json is the single source for every number (spec §5.7). It is
// generated from a real measurement and hand-tightened by hand (R5.7), not
// hand-written from the spec's provisional table — see its own header and
// `ledger` for how each number was chosen.

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NEXT_DIR = join(ROOT, '.next')
const BUDGET_FILE = join(ROOT, 'perf-budget.json')

function fail(message) {
  console.error(`perf:bundle: ${message}`)
  process.exit(1)
}

function loadBudget() {
  if (!existsSync(BUDGET_FILE)) fail(`${BUDGET_FILE} is missing`)
  return JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
}

function findManifests(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) findManifests(path, out)
    else if (entry.name === 'page_client-reference-manifest.js') out.push(path)
  }
  return out
}

/** Executes the manifest file (it assigns to `globalThis.__RSC_MANIFEST`)
 *  in an isolated sandbox and returns that object. Never `eval`s into the
 *  running process's own globals. */
function loadManifest(file) {
  const source = readFileSync(file, 'utf8')
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: file })
  return sandbox.__RSC_MANIFEST
}

/** "/(app)/derot/arcade/[kind]/page" -> "/derot/arcade/[kind]". Route
 *  groups (parenthesised segments) and the trailing "page" are display
 *  noise; dynamic segments (`[kind]`) are kept because that is how
 *  perf-budget.json and the spec's own tables name these routes. */
function toDisplayRoute(routeKey) {
  const segments = routeKey.split('/').filter((segment) => segment && segment !== 'page' && !segment.startsWith('('))
  return `/${segments.join('/')}`
}

function measureRoutes() {
  const appDir = join(NEXT_DIR, 'server', 'app')
  if (!existsSync(appDir)) fail(`${appDir} is missing — run "npm run build" first`)
  const measured = new Map()
  for (const file of findManifests(appDir)) {
    const manifest = loadManifest(file)
    for (const routeKey of Object.keys(manifest)) {
      const entryKey = `[project]/src/app${routeKey}`
      const jsFiles = manifest[routeKey]?.entryJSFiles?.[entryKey]
      if (!jsFiles) continue // e.g. _global-error, _not-found: no client JS of their own
      let bytes = 0
      for (const rel of new Set(jsFiles)) {
        const abs = join(NEXT_DIR, rel)
        if (!existsSync(abs)) fail(`${file} references ${rel}, which does not exist on disk`)
        bytes += statSync(abs).size
      }
      measured.set(toDisplayRoute(routeKey), bytes)
    }
  }
  return measured
}

function measurePublicTrackedBytes() {
  const output = execFileSync('git', ['ls-files', '-z', 'public'], { cwd: ROOT, encoding: 'utf8' })
  const files = output.split('\0').filter(Boolean)
  return files.reduce((total, relPath) => total + statSync(join(ROOT, relPath)).size, 0)
}

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function main() {
  const budget = loadBudget()
  const measured = measureRoutes()
  let failed = false

  console.log('\nBundle budget — JS payload per route, uncompressed (perf-budget.json)\n')
  const rows = []
  for (const [route, limits] of Object.entries(budget.routes)) {
    const bytes = measured.get(route)
    if (bytes === undefined) {
      rows.push({ route, status: 'MISSING', detail: 'no manifest found for this route in the current build' })
      failed = true
      continue
    }
    const over = bytes > limits.budgetBytes
    if (over) failed = true
    rows.push({
      route,
      status: over ? 'OVER' : 'ok',
      detail: `${fmtKB(bytes)} / ${fmtKB(limits.budgetBytes)} budget`,
    })
  }
  const routeWidth = Math.max(...rows.map((r) => r.route.length), 'route'.length)
  for (const r of rows) {
    console.log(`  ${r.route.padEnd(routeWidth)}  ${r.status.padEnd(7)}  ${r.detail}`)
  }

  const publicBytes = measurePublicTrackedBytes()
  const publicOver = publicBytes > budget.public.trackedBudgetBytes
  if (publicOver) failed = true
  console.log(
    `\n  ${'public/ (tracked)'.padEnd(routeWidth)}  ${(publicOver ? 'OVER' : 'ok').padEnd(7)}  ${fmtKB(publicBytes)} / ${fmtKB(budget.public.trackedBudgetBytes)} budget`,
  )

  if (budget.ledger?.length) {
    console.log('\nLedger (named overages against the spec\'s §5.6 direction — see perf-budget.json):')
    for (const entry of budget.ledger) {
      console.log(`  - [${entry.status}] ${entry.route}: ${entry.library} (~${fmtKB(entry.bytes)}) — ${entry.note}`)
    }
  }

  console.log()
  if (failed) {
    console.error('perf:bundle: FAILED — a route or public/ exceeds its budget. See the table above.')
    process.exit(1)
  }
  console.log('perf:bundle: OK — every route and public/ is within budget.')
}

main()
