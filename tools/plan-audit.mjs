/**
 * Audit docs/PLAN_TO_1_0.md against the tree it describes.
 *
 * The plan is worked by several sessions in parallel, and every increment in
 * it names the files it touches and the increments it depends on. Those are
 * claims about the repository, and claims rot: a file gets renamed, an
 * increment gets dropped, a `new:` file quietly appears under another name.
 * This checks the claims so a stale plan fails the build instead of sending
 * somebody to a path that no longer exists.
 *
 *   node tools/plan-audit.mjs             audit; exit 1 on any finding
 *   node tools/plan-audit.mjs --tally     status counts and recorded minutes
 *   node tools/plan-audit.mjs --claims    list .agents/claims by status
 *   node tools/plan-audit.mjs --self-test prove the audit can go red
 *
 * # What a `touches:` entry can be
 *
 *   path/that/exists.ts        must exist now
 *   new:path/to/create.ts      must NOT exist until the increment is [x], then must
 *   C1>path/arriving/later.ts  arrives with increment C1: checked only once C1 is [x]
 *   none | (prose)             skipped
 *
 * The third form is the three-state answer this repo's rules ask for: a path
 * that another increment has not delivered yet is *not checked*, and the
 * summary says how many, rather than folding it into pass or fail.
 *
 * # Floors
 *
 * A plan that parses to three increments is a parser bug, not a short plan.
 * The floors are set well below the real counts so they never need touching
 * and still catch an empty or mangled file.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PLAN = 'docs/PLAN_TO_1_0.md'
const MIN_INCREMENTS = 80
const MIN_PATHS = 60

const ID = /\b([A-L]\d+[a-z]?)\b/g
const CHECKBOX = /^- \[([ ~x!-])\] (.*)$/

export function parsePlan(text) {
  const lines = text.split(/\r?\n/)
  const increments = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = CHECKBOX.exec(line)
    if (m) {
      const ids = [...m[2].matchAll(/\*\*([A-L]\d+[a-z]?)\s/g)].map((x) => x[1])
      if (ids.length === 0) continue // a checkbox that is not an increment
      current = { ids, marker: m[1], line: i + 1, touches: [], dependsOn: [], minutes: null }
      increments.push(current)
      continue
    }
    if (!current) continue
    const t = /^\s+touches:\s*(.*)$/.exec(line)
    if (t) {
      current.touches = t[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && s !== 'none' && !s.startsWith('(') && !/^per finding/.test(s) && !/^\(that directory\)/.test(s))
      continue
    }
    const d = /^\s+depends-on:\s*(.*)$/.exec(line)
    if (d) {
      current.dependsOn = [...d[1].matchAll(ID)].map((x) => x[1])
      continue
    }
    const mins = /^\s+commit:.*minutes:\s*(\d+)/.exec(line)
    if (mins) current.minutes = Number(mins[1])
    if (/^### |^## /.test(line)) current = null
  }
  return increments
}

export function audit(increments, exists) {
  const findings = []
  const byId = new Map()
  for (const inc of increments) {
    for (const id of inc.ids) {
      if (byId.has(id)) findings.push(`duplicate id ${id} (lines ${byId.get(id).line} and ${inc.line})`)
      byId.set(id, inc)
    }
  }
  let checked = 0
  let awaiting = 0
  const perIncrement = []
  for (const inc of increments) {
    const label = inc.ids.join('/')
    const before = findings.length
    let incChecked = 0
    let incAwaiting = 0
    for (const dep of inc.dependsOn) {
      const target = byId.get(dep)
      if (!target) {
        findings.push(`${label} depends on ${dep}, which is not an increment`)
        continue
      }
      if (target.marker === '-') findings.push(`${label} depends on ${dep}, which is dropped`)
      if (inc.marker === 'x' && target.marker !== 'x') findings.push(`${label} is done but depends on ${dep}, which is ${describe(target.marker)}`)
    }
    for (const raw of inc.touches) {
      const arrives = /^([A-L]\d+[a-z]?)>(.+)$/.exec(raw)
      if (arrives) {
        const [, via, p] = arrives
        const src = byId.get(via)
        if (!src) {
          findings.push(`${label} touches ${p} via ${via}, which is not an increment`)
          continue
        }
        if (src.marker !== 'x') {
          awaiting++
          incAwaiting++
          continue
        }
        checked++
        incChecked++
        if (!exists(p)) findings.push(`${label} touches ${p} (arrived with ${via}) but it does not exist`)
        continue
      }
      if (raw.startsWith('new:')) {
        const p = raw.slice(4)
        checked++
        incChecked++
        if (inc.marker === 'x' && !exists(p)) findings.push(`${label} is done but its new file ${p} does not exist`)
        if (inc.marker !== 'x' && exists(p)) findings.push(`${label} says ${p} is new, but it already exists`)
        continue
      }
      checked++
      incChecked++
      if (!exists(raw)) findings.push(`${label} touches ${raw}, which does not exist`)
    }
    perIncrement.push({ label, clean: findings.length === before, checked: incChecked, awaiting: incAwaiting })
  }
  return { findings, checked, awaiting, ids: byId.size, perIncrement }
}

function describe(marker) {
  return { ' ': 'not started', '~': 'in progress', x: 'done', '!': 'blocked', '-': 'dropped' }[marker] ?? marker
}

function tally(increments) {
  const counts = { ' ': 0, '~': 0, x: 0, '!': 0, '-': 0 }
  let minutes = 0
  let timed = 0
  for (const inc of increments) {
    counts[inc.marker] += inc.ids.length
    if (inc.minutes != null) {
      minutes += inc.minutes
      timed++
    }
  }
  for (const [k, v] of Object.entries(counts)) console.log(`[${k}] ${describe(k).padEnd(12)} ${v}`)
  console.log(`recorded minutes: ${minutes} across ${timed} done increments`)
}

function claims() {
  const dir = '.agents/claims'
  if (!existsSync(dir)) {
    console.log('no .agents/claims directory here')
    return
  }
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    const commit = d.completion?.commit ? ` @${d.completion.commit}` : ''
    console.log(`${String(d.status).padEnd(10)} ${String(d.agent).padEnd(14)} ${d.task_id}${commit}`)
    if (d.status !== 'completed') console.log(`           paths: ${(d.paths ?? []).join(' ')}`)
  }
}

function selfTest() {
  // A synthetic plan with one of every defect. The audit must name all of them;
  // an audit that passes this file is not an audit.
  const text = [
    '### Lane A',
    '- [x] **A1  done thing** (≈5)',
    '  touches: new:this/file/does/not/exist.ts, also/missing.ts',
    // L99 is a well-formed id that no increment has. (A first draft used Z9,
    // which the id pattern does not even match, so the planted defect never
    // reached the check it was meant to trip - the self-test caught that.)
    '  depends-on: A2, L99',
    '- [ ] **A2  pending** (≈5)',
    '  touches: new:package.json, A1>tools/plan-audit.mjs, B7>nowhere.ts',
    '  depends-on: none',
    '- [ ] **A2  duplicate** (≈5)',
    '  touches: none',
    '  depends-on: none',
  ].join('\n')
  const r = audit(parsePlan(text), (p) => existsSync(p))
  const expect = [
    /A1 is done but its new file this\/file\/does\/not\/exist.ts/,
    /A1 touches also\/missing.ts, which does not exist/,
    /A1 is done but depends on A2, which is not started/,
    /A1 depends on L99, which is not an increment/,
    /A2 says package.json is new, but it already exists/,
    /A2 touches nowhere.ts via B7, which is not an increment/,
    /duplicate id A2/,
  ]
  let bad = 0
  for (const re of expect) {
    const hit = r.findings.some((f) => re.test(f))
    console.log(`${hit ? 'OK  ' : 'FAIL'} reports: ${re.source}`)
    if (!hit) bad++
  }
  // The positive case: A1>tools/plan-audit.mjs with A1 done must be checked and found.
  const positive = !r.findings.some((f) => /plan-audit.mjs/.test(f))
  console.log(`${positive ? 'OK  ' : 'FAIL'} an arrived path that exists is not reported`)
  if (!positive) bad++
  if (r.findings.length !== expect.length) {
    console.log(`FAIL expected exactly ${expect.length} findings, got ${r.findings.length}:`)
    for (const f of r.findings) console.log(`     ${f}`)
    bad++
  }
  if (bad) {
    console.error('FAILED self-test')
    process.exit(1)
  }
  console.log('self-test passed: the audit reports every planted defect and nothing else')
}

const args = new Set(process.argv.slice(2))
if (args.has('--self-test')) {
  selfTest()
} else if (args.has('--claims')) {
  claims()
} else {
  if (!existsSync(PLAN)) {
    console.error(`FAILED: ${PLAN} is missing`)
    process.exit(1)
  }
  const increments = parsePlan(readFileSync(PLAN, 'utf8'))
  if (args.has('--tally')) {
    tally(increments)
  } else {
    const r = audit(increments, (p) => existsSync(p))
    // One line per increment: the suite runner counts ^OK and ^FAIL lines, and a
    // run that prints only a summary reads as "asserted nothing".
    for (const p of r.perIncrement) {
      if (p.clean) console.log(`OK   ${p.label.padEnd(8)} paths ${p.checked}${p.awaiting ? `, awaiting ${p.awaiting}` : ''}`)
    }
    for (const f of r.findings) console.log(`FAIL ${f}`)
    if (r.ids < MIN_INCREMENTS) {
      console.error(`FAILED: parsed only ${r.ids} increments (floor ${MIN_INCREMENTS}); the parser or the file is broken`)
      process.exit(1)
    }
    if (r.checked < MIN_PATHS) {
      console.error(`FAILED: checked only ${r.checked} paths (floor ${MIN_PATHS}); the parser or the file is broken`)
      process.exit(1)
    }
    if (r.findings.length) {
      console.error(`FAILED: ${r.findings.length} finding(s) in ${PLAN}`)
      process.exit(1)
    }
    console.log(`plan ok: ${r.ids} increments, ${r.checked} paths checked, ${r.awaiting} paths awaiting other increments (not checked)`)
  }
}
