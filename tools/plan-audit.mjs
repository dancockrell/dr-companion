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
 *   node tools/plan-audit.mjs --plan=X    audit a copy instead (for sabotage)
 *
 * # What a `touches:` entry can be
 *
 *   path/that/exists.ts        must exist now
 *   new:path/to/create.ts      must NOT exist until the increment is [x], then must
 *   gone:path/it/deleted.ts    must exist until the increment is [x], then must NOT
 *   C1>path/arriving/later.ts  arrives with increment C1: checked only once C1 is [x]
 *   none | (prose)             skipped
 *
 * The third form is the three-state answer this repo's rules ask for: a path
 * that another increment has not delivered yet is *not checked*, and the
 * summary says how many, rather than folding it into pass or fail.
 *
 * # `[-]` — superseded
 *
 * Added 9 Sep 2026, when 3D was cancelled (`docs/NO-3D.md`) and PR #517 deleted
 * the subsystem. Increments across lanes B, C, K, L, M and S had genuinely run
 * and genuinely delivered work that is now deleted, and the plan had no marker
 * that could say so. Every alternative on the table was a lie of a different
 * shape: leaving them `[x]` makes the audit red forever and trains a reader to
 * skim it; editing their `touches:` to name surviving files makes the record
 * lie about what the increment did — PR #517 did exactly this to seven rows,
 * pointing them at `docs/NO-3D.md`, a file that did not exist on the day any of
 * them ran, and the audit passed them because the path resolves; deleting the
 * rows destroys the history and the recorded minutes.
 *
 * `[-]` says: **this increment will not be delivered in this form, and every
 * file it would have owned is absent.** That is the checkable proposition, and
 * it holds whether the work was delivered and then removed (K2, K3, K5) or was
 * retired before it could be (K6). Which of the two it was is carried by
 * whether a `commit:` line sits above the `superseded:` line, where a person
 * reads it — the audit does not need to know, and a second marker to encode it
 * would leave two rules where one does the work.
 *
 *   - a `superseded:` line is REQUIRED, and must carry a date;
 *   - `new:` and `gone:` paths must be ABSENT — this is the whole point;
 *   - plain paths must still exist, so a `[-]` row goes on checking survivors
 *     rather than silently becoming an unchecked row;
 *   - an increment that is not itself delivered may not depend on a `[-]` one.
 *
 * The last rule is the one that earns its keep: a `[ ]` increment depending on
 * something superseded is work whose foundation was removed, and it has to be
 * rewritten or superseded in turn rather than picked up by the next session.
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

/**
 * The lane letter is `A-Z`, not `A-L`.
 *
 * It was `A-L` — the lanes that existed when this was written — and that is a
 * silent floor rather than a bound. Lane M was added on 6 Sep 2026 with three
 * increments and a `touches:` list of seven paths, and the audit went on
 * printing `plan ok: 120 increments, 338 paths checked` unchanged: every one of
 * them was invisible, so none of their paths was checked, and a `touches:`
 * naming a file that does not exist would have passed. Nothing in the output
 * could show it, because the count it did not include is the same count it
 * reports.
 *
 * Lane N's session hit the identical defect within the hour and widened it to
 * `A-N`. This is that fix, taken to the end of the alphabet instead of to the
 * next lane, so the lane after N does not have to rediscover it a third time.
 */
const ID = /\b([A-Z]\d+[a-z]?)\b/g
const CHECKBOX = /^- \[([ ~x!-])\] (.*)$/

export function parsePlan(text) {
  const lines = text.split(/\r?\n/)
  const increments = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = CHECKBOX.exec(line)
    if (m) {
      const ids = [...m[2].matchAll(/\*\*([A-Z]\d+[a-z]?)\s/g)].map((x) => x[1])
      if (ids.length === 0) continue // a checkbox that is not an increment
      current = { ids, marker: m[1], line: i + 1, touches: [], dependsOn: [], minutes: null, superseded: null }
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
    const sup = /^\s+superseded:\s*(.*)$/.exec(line)
    if (sup) {
      current.superseded = sup[1]
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
    // `[x]` and `[-]` are both *settled*: one delivered and kept, one delivered
    // and removed (or retired unbuilt). Every path assertion below turns on
    // this rather than on `=== 'x'`, so a superseded row keeps checking the
    // survivors it names while asserting the absence of what went.
    const settled = inc.marker === 'x' || inc.marker === '-'
    if (inc.marker === '-' && !inc.superseded) {
      findings.push(`${label} is [-] superseded but has no \`superseded:\` line saying when and why`)
    }
    if (inc.marker === '-' && inc.superseded && !/\d{4}/.test(inc.superseded)) {
      findings.push(`${label}'s \`superseded:\` line names no year; a supersession with no date cannot be aged`)
    }
    if (inc.marker !== '-' && inc.superseded) {
      findings.push(`${label} has a \`superseded:\` line but is marked [${inc.marker}]; only [-] carries one`)
    }
    for (const dep of inc.dependsOn) {
      const target = byId.get(dep)
      if (!target) {
        findings.push(`${label} depends on ${dep}, which is not an increment`)
        continue
      }
      // A row that is not itself settled cannot rest on one that is superseded:
      // its foundation was removed, so it needs rewriting or superseding in
      // turn rather than picking up by whoever reads the lane next.
      if (target.marker === '-' && !settled) {
        findings.push(`${label} depends on ${dep}, which is superseded; rewrite this increment or supersede it too`)
      }
      if (settled && target.marker !== 'x' && target.marker !== '-') {
        findings.push(`${label} is ${describe(inc.marker)} but depends on ${dep}, which is ${describe(target.marker)}`)
      }
    }
    for (const raw of inc.touches) {
      const arrives = /^([A-Z]\d+[a-z]?)>(.+)$/.exec(raw)
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
      // `gone:` - a path the increment deleted. Asserted in both directions,
      // like `new:`: once the increment is done the path must be absent, and
      // until then it must still be there. Added 6 Sep 2026, when every
      // workflow was deleted and F8's `touches:` named `.github/workflows/
      // ci.yml` - a file that increment genuinely did touch and that no longer
      // exists. Both alternatives were worse. Editing the historical entry to
      // name something else makes the record lie about what the increment did;
      // dropping the path silently reduces what the audit checks while the
      // summary count goes on looking exactly the same, which is the shape of
      // failure this whole file exists to refuse.
      if (raw.startsWith('gone:')) {
        const p = raw.slice(5)
        checked++
        incChecked++
        if (settled && exists(p)) findings.push(`${label} says it deleted ${p}, but it still exists`)
        if (!settled && !exists(p)) findings.push(`${label} has not deleted ${p} yet, but it is already absent`)
        continue
      }
      if (raw.startsWith('new:')) {
        const p = raw.slice(4)
        checked++
        incChecked++
        // The one place `[x]` and `[-]` part company. A done increment's new
        // file must be there; a superseded one's must not, because `[-]` is
        // precisely the claim that it is gone or never arrived.
        if (inc.marker === 'x' && !exists(p)) findings.push(`${label} is done but its new file ${p} does not exist`)
        if (inc.marker === '-' && exists(p)) findings.push(`${label} is superseded but its file ${p} still exists`)
        if (!settled && exists(p)) findings.push(`${label} says ${p} is new, but it already exists`)
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

/**
 * Every `### Lane X` heading in section 6 must have produced at least one
 * increment.
 *
 * This closes a hole measured on 6 Sep 2026 while adding Lane N. The id
 * patterns above stopped at `L`, so every N increment parsed to nothing - and the
 * audit still said `plan ok: 120 increments`, exit 0, with a whole lane
 * invisible. That is the shape this file exists to prevent: a lane the parser
 * cannot see and a lane that is not there produce identical output, and the
 * shorter one looks like success. `MIN_INCREMENTS` cannot catch it, because 120
 * clears a floor of 80 comfortably.
 *
 * The heading is the manifest. Counting what parsed can never reveal what did
 * not, so the check is against what section 6 declares rather than against a
 * number somebody set once - which is also why it needs no maintenance when the
 * next lane is added.
 */
export function checkLaneHeadings(text, increments) {
  const findings = []
  const lanes = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^### Lane ([A-Z])\b/.exec(line)
    if (m && !lanes.includes(m[1])) lanes.push(m[1])
  }
  const seen = new Set(increments.flatMap((inc) => inc.ids).map((id) => id[0]))
  for (const lane of lanes) {
    if (!seen.has(lane)) {
      findings.push(
        `section 6 has a "### Lane ${lane}" heading but no ${lane} increment parsed; the id pattern in tools/plan-audit.mjs does not cover lane ${lane}`
      )
    }
  }
  return { findings, lanes }
}

function describe(marker) {
  return { ' ': 'not started', '~': 'in progress', x: 'done', '!': 'blocked', '-': 'superseded' }[marker] ?? marker
}

/**
 * Gate membership, derived from section 4 of the plan itself.
 *
 * This used to be a hardcoded table beside the prose, on the grounds that the
 * prose states ranges a parser would have to guess the expansion of. Two
 * sources for one fact drift, and they had: the table omitted Gate 7 entirely,
 * and read "J complete" as J1 and J2 when lane J had grown to five increments.
 * So the prose is the source and this parses it.
 *
 * The grammar it accepts, and nothing else:
 *
 *   - **Gate 4 - AI optional:** G0-G10, G12, H1-H8 (G11 only with Dan's yes).
 *     Check: ...
 *
 *   A1-A6      an inclusive range, same lane letter, expanded numerically
 *   G12        one increment
 *   J complete every increment in lane J
 *   (...)      a parenthetical: any ids inside it are EXCLUDED and reported,
 *              which is where "only with Dan's yes" lives
 *   Check:     everything from here on is the gate's own check, not membership
 *
 * Anything in the membership text that is not one of those is ignored, and an
 * id that names no increment is a finding rather than a silent omission - the
 * failure this replaces was a membership claim nobody could check.
 *
 * The dash in the ranges is an en dash (U+2013) in the real file; a plain
 * hyphen and an em dash are accepted too so a typed edit does not vanish.
 */
const GATE_HEADER = /^- \*\*Gate (\d+)\s*[–—-]\s*([^:*]+?)\s*:\*\*\s*(.*)$/
const GATE_RANGE = /\b([A-Z])(\d+)\s*[–—-]\s*([A-Z])(\d+)\b/g
const GATE_LANE = /\b([A-Z]) complete\b/g
const GATE_ID = /\b([A-Z]\d+[a-z]?)\b/g

export function parseGates(text, knownIds = []) {
  const lines = text.split(/\r?\n/)
  const gates = []
  const findings = []
  const byLane = new Map()
  for (const id of knownIds) {
    if (!byLane.has(id[0])) byLane.set(id[0], [])
    byLane.get(id[0]).push(id)
  }
  const known = new Set(knownIds)

  for (let i = 0; i < lines.length; i++) {
    const m = GATE_HEADER.exec(lines[i])
    if (!m) continue
    // The membership can wrap onto indented continuation lines; it ends at the
    // next list item, a blank line, or the gate's own `Check:` clause.
    let body = m[3]
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (!/^\s+\S/.test(next) || /^\s*- /.test(next)) break
      body += ' ' + next.trim()
    }
    const cut = body.search(/\bCheck:/)
    let members = cut === -1 ? body : body.slice(0, cut)

    // Parentheticals are qualifiers, not membership. Pull the ids out of them
    // so the exclusion is printed rather than being invisible in a count.
    const excluded = []
    members = members.replace(/\(([^)]*)\)/g, (_all, inner) => {
      for (const x of inner.matchAll(GATE_ID)) if (!excluded.includes(x[1])) excluded.push(x[1])
      return ' '
    })

    const name = `${m[1]} ${m[2]}`
    const ids = []
    const add = (id) => {
      if (!ids.includes(id)) ids.push(id)
    }

    members = members.replace(GATE_RANGE, (all, l1, n1, l2, n2) => {
      if (l1 !== l2) {
        findings.push(`gate "${name}" states the range ${all.trim()}, which crosses lanes`)
        return ' '
      }
      const from = Number(n1)
      const to = Number(n2)
      if (to < from) {
        findings.push(`gate "${name}" states the range ${all.trim()}, which runs backwards`)
        return ' '
      }
      for (let n = from; n <= to; n++) add(`${l1}${n}`)
      return ' '
    })

    members = members.replace(GATE_LANE, (_all, lane) => {
      const inLane = byLane.get(lane) ?? []
      if (inLane.length === 0) findings.push(`gate "${name}" says "${lane} complete", but lane ${lane} has no increments`)
      for (const id of inLane) add(id)
      return ' '
    })

    for (const x of members.matchAll(GATE_ID)) add(x[1])

    for (const id of ids) {
      if (!known.has(id)) findings.push(`gate "${name}" names ${id}, which is not an increment`)
    }
    for (const id of excluded) {
      if (!known.has(id)) findings.push(`gate "${name}" excludes ${id}, which is not an increment`)
    }
    gates.push({ name, ids, excluded, line: i + 1, number: Number(m[1]) })
  }

  // The floor below catches a gutted section 4. It cannot catch ONE deleted
  // gate line, because eight gates minus one still clears a floor set below
  // eight - measured, by deleting the Gate 6 line and watching the audit pass.
  // The gates are numbered, so the gap is the thing to look for instead, and
  // that works whatever the count grows to.
  //
  // A gap cannot see a gate deleted off the *top*: 0..6 with 7 gone is still
  // consecutive from zero, so this loop is silent and a floor set below the
  // real count is satisfied. Measured, on a copy through `--plan=`: deleting
  // the Gate 7 line left the audit at exit 0, "plan ok ... 7 gates with 101
  // members", and Gate 7 is the one that says what 1.0 means. The floor is
  // what closes it, so `MIN_GATES` is the real count and not one below it -
  // see the note there.
  for (let k = 0; k < gates.length; k++) {
    if (gates[k].number !== k) {
      findings.push(
        `section 4 goes from Gate ${k === 0 ? '(nothing)' : gates[k - 1].number} to Gate ${gates[k].number}: Gate ${k} is missing or out of order`
      )
      break
    }
  }
  return { gates, findings }
}

// Floors. The member floors sit below the real counts on purpose: they catch a
// parser that stopped matching or a section 4 that was gutted, and an
// increment retired from a gate must not fail the build.
//
// `MIN_GATES` is different, and is deliberately the *real* count rather than
// one below it. A floor below the count cannot see the highest gate line
// disappear - the numbering-gap check above is blind to that case by
// construction - and losing the top gate is losing the definition of done.
// Set to the count, this fails on a deleted gate. Adding one is not silently
// fine either: `checkGateFloors` reports a floor that has fallen behind the
// real section 4, so a ninth gate fails the audit until this literal is raised
// in the same commit. Without that the floor decays back into the hole it was
// raised to close, one added gate at a time - and a self-test built from
// `MIN_GATES` itself cannot see that, which was measured: lowering this to 7
// left the self-test green because its fixture shrank with it.
//
// Real counts at the time of writing: 8 gates, 103 members.
const MIN_GATES = 9
const MIN_GATE_MEMBERS = 2
const MIN_GATE_MEMBERS_TOTAL = 80

/**
 * The floors and the denominator, shared by `--tally` and the plain audit so
 * neither can be the lenient one.
 */
export function checkGateFloors(gates) {
  const findings = []
  const total = gates.reduce((n, g) => n + g.ids.length, 0)
  if (gates.length < MIN_GATES) {
    findings.push(`parsed only ${gates.length} gates from section 4 (floor ${MIN_GATES}); the parser or the section is broken`)
  }
  // The floor is the only thing that can see the highest gate line deleted, so
  // it has to keep up with section 4 rather than being a number somebody set
  // once. This is what makes that automatic: a gate added and the floor left
  // behind is a finding, naming the edit to make.
  if (gates.length > MIN_GATES) {
    findings.push(`section 4 now has ${gates.length} gates but MIN_GATES in tools/plan-audit.mjs is ${MIN_GATES}; raise it to ${gates.length}, or deleting the highest gate line will pass this audit`)
  }
  if (total < MIN_GATE_MEMBERS_TOTAL) {
    findings.push(`parsed only ${total} gate members (floor ${MIN_GATE_MEMBERS_TOTAL}); the parser or the section is broken`)
  }
  for (const g of gates) {
    if (g.ids.length < MIN_GATE_MEMBERS) {
      findings.push(`gate "${g.name}" parsed to ${g.ids.length} member(s) (floor ${MIN_GATE_MEMBERS}); its line in section 4 did not parse`)
    }
  }
  return { findings, total }
}

/**
 * A gate may not name a superseded increment.
 *
 * Without this, `[-]` would be the quietest possible way to strand a gate: the
 * member can never become `[x]`, so the gate can never read GREEN, and the
 * tally goes on printing `10/11  1 blocked` forever with nothing saying why the
 * eleventh is unreachable. Gate 3 ("Viewer optional") named L6, whose six
 * acceptance lines were about a 3D Crossing slice that no longer exists — a
 * gate condition that had stopped being a condition and had become a permanent
 * red mark on the project's own status board.
 *
 * So superseding an increment forces the gate line that named it to be
 * rewritten in the same edit. That is the point: a gate is a claim about what
 * "done" means, and deleting the work without touching the claim leaves the
 * claim standing.
 */
export function checkGateSupersessions(gates, markerById) {
  const findings = []
  for (const g of gates) {
    for (const id of g.ids) {
      if (markerById.get(id) === '-') {
        findings.push(
          `gate "${g.name}" names ${id}, which is superseded; a gate cannot wait on an increment that will never be [x] — rewrite the gate line`
        )
      }
    }
  }
  return { findings }
}

function bar(done, total, width = 24) {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '#'.repeat(filled) + '.'.repeat(width - filled)
}

function tally(increments, planText) {
  const counts = { ' ': 0, '~': 0, x: 0, '!': 0, '-': 0 }
  const marker = new Map()
  let minutes = 0
  let timed = 0
  for (const inc of increments) {
    counts[inc.marker] += inc.ids.length
    for (const id of inc.ids) marker.set(id, inc.marker)
    if (inc.minutes != null) {
      minutes += inc.minutes
      timed++
    }
  }
  for (const [k, v] of Object.entries(counts)) console.log(`[${k}] ${describe(k).padEnd(12)} ${v}`)
  console.log(`recorded minutes: ${minutes} across ${timed} done increments`)

  // Per lane: the letter is the lane, so this needs no second table to drift.
  console.log('\nby lane')
  const lanes = new Map()
  for (const [id, m] of marker) {
    const lane = id[0]
    if (!lanes.has(lane)) lanes.set(lane, { done: 0, total: 0, active: 0, blocked: 0, superseded: 0 })
    const l = lanes.get(lane)
    l.total++
    if (m === 'x') l.done++
    if (m === '~') l.active++
    if (m === '!') l.blocked++
    if (m === '-') l.superseded++
  }
  for (const lane of [...lanes.keys()].sort()) {
    const l = lanes.get(lane)
    // Superseded increments leave the denominator. A lane that is 5/6 because
    // one row will never be built again is not 5/6 of anything; it reads as
    // outstanding work and it is not. The count is still printed, because a
    // denominator that shrank silently is the defect the rest of this file
    // exists to prevent.
    const live = l.total - l.superseded
    const extra = [
      l.active ? `${l.active} in progress` : '',
      l.blocked ? `${l.blocked} blocked` : '',
      l.superseded ? `${l.superseded} superseded` : '',
    ]
      .filter(Boolean)
      .join(', ')
    console.log(`  ${lane}  ${bar(l.done, live)}  ${String(l.done).padStart(2)}/${String(live).padEnd(3)}${extra ? '  ' + extra : ''}`)
  }

  console.log('\nby gate (derived from section 4 of the plan)')
  const { gates, findings } = parseGates(planText, [...marker.keys()])
  const floors = checkGateFloors(gates)
  const supersessions = checkGateSupersessions(gates, marker)
  for (const g of gates) {
    const done = g.ids.filter((id) => marker.get(id) === 'x').length
    const blocked = g.ids.filter((id) => marker.get(id) === '!').length
    const state = done === g.ids.length && g.ids.length > 0 ? 'GREEN' : `${blocked ? blocked + ' blocked' : ''}`
    const note = g.excluded.length ? `  (excludes ${g.excluded.join(', ')})` : ''
    console.log(`  ${g.name.padEnd(28)} ${bar(done, g.ids.length)}  ${String(done).padStart(2)}/${String(g.ids.length).padEnd(3)}${state ? '  ' + state : ''}${note}`)
  }
  // The denominator, printed: a section 4 that stopped parsing has to look
  // different from a section 4 with nothing wrong in it.
  console.log(`\n${gates.length} gates parsed from section 4, ${floors.total} members, all naming real increments`)
  const gateFindings = [...findings, ...floors.findings, ...supersessions.findings]
  for (const f of gateFindings) console.log(`  FAIL ${f}`)
  if (gateFindings.length) {
    console.error(`FAILED: ${gateFindings.length} finding(s) in section 4 of ${PLAN}`)
    process.exit(1)
  }
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
  // `[-]` superseded, its own synthetic plan. Both directions of every rule,
  // because a marker that only ever reports and a marker that never reports
  // carry the same amount of information, which is none. The positive controls
  // matter more than usual here: `[-]` is the marker that *suppresses* the
  // findings a `[x]` row would produce, so a bug in it looks exactly like a
  // clean plan.
  const supText = [
    '### Lane S',
    // S1: correct. A deleted new: file and a deleted gone: file, both absent,
    // plus a survivor that must still be checked. No findings.
    '- [-] **S1  delivered, then removed** (≈5)',
    '  commit: abc1234 verified: 2026-09-05 minutes: 30',
    '  superseded: 2026-09-09 — 3D cancelled, PR #517 deleted it',
    '  touches: new:this/is/gone.ts, gone:also/gone.ts, package.json',
    '  depends-on: none',
    // S2: superseded with no `superseded:` line at all.
    '- [-] **S2  no bookkeeping** (≈5)',
    '  touches: none',
    '  depends-on: none',
    // S3: a `superseded:` line with no year in it.
    '- [-] **S3  undated** (≈5)',
    '  superseded: because we changed our minds',
    '  touches: none',
    '  depends-on: none',
    // S4: superseded, but the file it named is still on disk. This is the
    // check that stops `[-]` being used to hide surviving work.
    '- [-] **S4  claims a live file is gone** (≈5)',
    '  superseded: 2026-09-09 — see NO-3D.md',
    '  touches: new:package.json',
    '  depends-on: none',
    // S5: not started, resting on a superseded increment.
    '- [ ] **S5  built on sand** (≈5)',
    '  touches: none',
    '  depends-on: S1',
    // S6: done, resting on a superseded increment. Legitimate: S1 was there
    // when S6 ran. Must produce nothing.
    '- [x] **S6  ran while S1 was alive** (≈5)',
    '  commit: def5678 verified: 2026-09-05 minutes: 10',
    '  touches: none',
    '  depends-on: S1',
    // S7: a `superseded:` line on a row that is not [-].
    '- [x] **S7  wrong marker for the line** (≈5)',
    '  superseded: 2026-09-09 — but this row says [x]',
    '  touches: none',
    '  depends-on: none',
  ].join('\n')
  const sr = audit(parsePlan(supText), (p) => existsSync(p))
  const supExpect = [
    /S2 is \[-\] superseded but has no `superseded:` line/,
    /S3's `superseded:` line names no year/,
    /S4 is superseded but its file package.json still exists/,
    /S5 depends on S1, which is superseded; rewrite this increment or supersede it too/,
    /S7 has a `superseded:` line but is marked \[x\]/,
  ]
  for (const re of supExpect) {
    const hit = sr.findings.some((f) => re.test(f))
    console.log(`${hit ? 'OK  ' : 'FAIL'} superseded: reports: ${re.source}`)
    if (!hit) bad++
  }
  const supPositives = [
    [!sr.findings.some((f) => /^S1\b/.test(f)), 'a well-formed [-] row with absent new:/gone: paths and a live survivor reports nothing'],
    [!sr.findings.some((f) => /^S6\b/.test(f)), 'a [x] increment may depend on a superseded one (it was there when it ran)'],
    [sr.findings.length === supExpect.length, `exactly ${supExpect.length} findings, got ${sr.findings.length}: ${JSON.stringify(sr.findings)}`],
    // The denominator: S1's three paths must actually have been examined. A
    // `[-]` row that quietly stopped checking anything would satisfy every
    // assertion above by producing no findings at all.
    [sr.checked >= 3, `S1's three paths were checked, not skipped (checked ${sr.checked})`],
  ]
  for (const [hit, what] of supPositives) {
    console.log(`${hit ? 'OK  ' : 'FAIL'} superseded: ${what}`)
    if (!hit) bad++
  }
  // The gate rule, both ways: a gate naming a superseded increment must fail,
  // and the same gate naming only live ones must not.
  const supMarkers = new Map([
    ['A1', 'x'],
    ['A2', '-'],
    ['A3', 'x'],
  ])
  const supGates = [{ name: 'Gate 3 – Viewer optional', ids: ['A1', 'A2'], excluded: [] }]
  const liveGates = [{ name: 'Gate 3 – Viewer optional', ids: ['A1', 'A3'], excluded: [] }]
  const gateSupExpect = [
    [
      checkGateSupersessions(supGates, supMarkers).findings.some((f) => /names A2, which is superseded/.test(f)),
      'a gate naming a superseded increment fails, and names it',
    ],
    [checkGateSupersessions(liveGates, supMarkers).findings.length === 0, 'a gate naming only live increments does not'],
  ]
  for (const [hit, what] of gateSupExpect) {
    console.log(`${hit ? 'OK  ' : 'FAIL'} superseded: ${what}`)
    if (!hit) bad++
  }

  // Section 4's gate parser gets the same treatment: a synthetic section with
  // one of every defect, plus the two readings that the hardcoded table it
  // replaced got wrong (a whole gate missing, and "J complete" read as two).
  const gateText = [
    '## 4. Gates',
    '',
    '- **Gate 0 – Stable base:** A1–A3, B1.',
    '  Check: something involving A9, which is not membership.',
    '- **Gate 1 – Wrapped:** A1–A2, B complete (A3 only with a yes — not',
    '  given). Check: nothing.',
    '- **Gate 2 – Bad ids:** A1–A9, C complete, B9–B7, A1–B2.',
  ].join('\n')
  const known = ['A1', 'A2', 'A3', 'B1', 'B2']
  const gr = parseGates(gateText, known)
  const gateExpect = [
    [gr.gates.length === 3, `parses all 3 gate lines, got ${gr.gates.length}`],
    [gr.gates[0]?.ids.join(',') === 'A1,A2,A3,B1', `expands A1–A3 and stops at Check:, got ${gr.gates[0]?.ids.join(',')}`],
    [gr.gates[1]?.ids.join(',') === 'A1,A2,B1,B2', `reads "B complete" as the whole lane, got ${gr.gates[1]?.ids.join(',')}`],
    [gr.gates[1]?.excluded.join(',') === 'A3', `keeps the parenthetical id out of membership and names it, got ${gr.gates[1]?.excluded.join(',')}`],
    [gr.findings.some((f) => /names A4, which is not an increment/.test(f)), 'names an id the plan does not have'],
    [gr.findings.some((f) => /"C complete", but lane C has no increments/.test(f)), 'names an empty lane'],
    [gr.findings.some((f) => /B9.*B7.*runs backwards/.test(f)), 'names a backwards range'],
    [gr.findings.some((f) => /A1.*B2.*crosses lanes/.test(f)), 'names a range that crosses lanes'],
    // The floors: three gates and eleven members must not satisfy them, or
    // they are decoration. This is the "remove a gate line" sabotage in
    // miniature, run every time rather than by hand.
    [checkGateFloors(gr.gates).findings.some((f) => /parsed only 3 gates/.test(f)), 'the gate-count floor can fire'],
    [checkGateFloors(gr.gates).findings.some((f) => /parsed only \d+ gate members/.test(f)), 'the gate-member floor can fire'],
    [checkGateFloors([{ name: 'x', ids: ['A1'], excluded: [] }]).findings.some((f) => /parsed to 1 member/.test(f)), 'the per-gate floor can fire'],
  ]
  for (const [hit, what] of gateExpect) {
    console.log(`${hit ? 'OK  ' : 'FAIL'} gates: ${what}`)
    if (!hit) bad++
  }
  // The positive control: a clean gate line must produce no findings at all,
  // or every red above could be the parser rather than the planted defect.
  const gap = parseGates(['- **Gate 0 – A:** A1–A2.', '- **Gate 2 – C:** B1–B2.'].join('\n'), known)
  const gapHit = gap.findings.some((f) => /goes from Gate 0 to Gate 2: Gate 1 is missing/.test(f))
  console.log(`${gapHit ? 'OK  ' : 'FAIL'} gates: names a gap in the gate numbering (a deleted gate line)`)
  if (!gapHit) bad++

  // The case the gap check cannot see: the *highest* gate line deleted. The
  // remaining numbers are still 0..n-1 with no hole, so `parseGates` is
  // silent by construction and only the count floor can catch it. Both halves
  // are asserted, because a reader who saw only the red would reasonably
  // assume the gap check had found it and would then be free to lower
  // `MIN_GATES` again.
  const eight = Array.from({ length: MIN_GATES }, (_, n) => `- **Gate ${n} – G${n}:** A1–A2.`)
  const truncated = parseGates(eight.slice(0, -1).join('\n'), known)
  const truncatedExpect = [
    [truncated.findings.length === 0, `the numbering gap check is blind to a missing top gate, got ${JSON.stringify(truncated.findings)}`],
    [
      checkGateFloors(truncated.gates).findings.some((f) =>
        new RegExp(`parsed only ${MIN_GATES - 1} gates`).test(f)
      ),
      'the gate-count floor catches the missing top gate',
    ],
    // The positive control on the same pair: the full list must be clean, or
    // the red above could be the synthetic text rather than the deletion.
    [
      parseGates(eight.join('\n'), known).findings.length === 0 &&
        !checkGateFloors(parseGates(eight.join('\n'), known).gates).findings.some((f) =>
          /parsed only \d+ gates/.test(f)
        ),
      `${MIN_GATES} gates with none missing pass the same two checks`,
    ],
  ]
  for (const [hit, what] of truncatedExpect) {
    console.log(`${hit ? 'OK  ' : 'FAIL'} gates: ${what}`)
    if (!hit) bad++
  }

  const clean = parseGates('- **Gate 0 – Fine:** A1–A3, B1. Check: none.', known)
  const cleanOk = clean.findings.length === 0 && clean.gates.length === 1
  console.log(`${cleanOk ? 'OK  ' : 'FAIL'} gates: a clean gate line produces no findings`)
  if (!cleanOk) bad++

  // The lane manifest. The defect it was written for is a lane whose ids the
  // parser does not match: `parsePlan` returns nothing for it, every floor is
  // still satisfied, and the audit passes over an invisible lane. Both
  // directions are asserted here - a heading with no increments must fail, and
  // a heading with increments must not - because a check that always fires
  // carries exactly as little information as one that never does.
  // Lane Z's increment is written `**ZZ1`, not `**Z1`, and that is deliberate.
  // The fixture has to contain an id the parser genuinely cannot match, and
  // when this was written it got one for free: `ID` stopped at `A-N`, so a Z
  // was unmatchable by accident. `ID` covers `A-Z` now — every lane letter
  // parses, which is the point — and a `**Z1` fixture would have quietly
  // stopped demonstrating the defect while still passing, since the check it
  // exercises would simply have nothing to report. `ZZ1` is outside the
  // pattern by construction rather than by where the alphabet happened to be
  // truncated that week.
  const laneText = ['### Lane A', '- [ ] **A1  a thing** (≈5)', '  touches: none', '', '### Lane Z', '- [ ] **ZZ1  invisible** (≈5)', '  touches: none'].join('\n')
  const laneIncrements = parsePlan(laneText)
  const laneResult = checkLaneHeadings(laneText, laneIncrements)
  const laneExpect = [
    [laneResult.lanes.length === 2, `finds both headings, got ${laneResult.lanes.length}`],
    [laneResult.findings.some((f) => /"### Lane Z" heading but no Z increment parsed/.test(f)), 'names the lane whose ids never parsed'],
    [!laneResult.findings.some((f) => /Lane A/.test(f)), 'does not report the lane that did parse'],
  ]
  for (const [hit, what] of laneExpect) {
    console.log(`${hit ? 'OK  ' : 'FAIL'} lanes: ${what}`)
    if (!hit) bad++
  }

  if (bad) {
    console.error('FAILED self-test')
    process.exit(1)
  }
  console.log('self-test passed: the audit reports every planted defect and nothing else')
}

const argv = process.argv.slice(2)
const args = new Set(argv)
// A seam, so the unhappy paths can be run on purpose: point the audit at a
// scratch copy of the plan, damage it, and watch this go red. A branch nobody
// can reach deliberately is a branch nobody can prove they fixed.
const planArg = argv.find((a) => a.startsWith('--plan='))
const PLAN_PATH = planArg ? planArg.slice('--plan='.length) : PLAN
if (args.has('--self-test')) {
  selfTest()
} else if (args.has('--claims')) {
  claims()
} else {
  if (!existsSync(PLAN_PATH)) {
    console.error(`FAILED: ${PLAN_PATH} is missing`)
    process.exit(1)
  }
  const planText = readFileSync(PLAN_PATH, 'utf8')
  const increments = parsePlan(planText)
  if (args.has('--tally')) {
    tally(increments, planText)
  } else {
    // The ledger has to parse before anything reads it. One claim with an
    // unescaped `\R` in a Windows path made `--claims` throw for every session
    // on the machine, and nothing failed - the tool that broke was the one
    // nobody runs in CI. A claim that cannot be parsed is a claim nobody can
    // check, so it fails here with the file named.
    let claimsChecked = 0
    if (existsSync('.agents/claims')) {
      for (const file of readdirSync('.agents/claims').filter((n) => n.endsWith('.json'))) {
        claimsChecked++
        try {
          JSON.parse(readFileSync(join('.agents/claims', file), 'utf8'))
          console.log(`OK   claim ${file} parses`)
        } catch (error) {
          console.log(`FAIL claim ${file} is not valid JSON: ${error.message}`)
          console.error(`FAILED: ${file} cannot be parsed, so every tool that reads the ledger is broken`)
          process.exit(1)
        }
      }
    }

    const r = audit(increments, (p) => existsSync(p))
    // One line per increment: the suite runner counts ^OK and ^FAIL lines, and a
    // run that prints only a summary reads as "asserted nothing".
    for (const p of r.perIncrement) {
      if (p.clean) console.log(`OK   ${p.label.padEnd(8)} paths ${p.checked}${p.awaiting ? `, awaiting ${p.awaiting}` : ''}`)
    }

    // Section 4's gates name increments, and those names are claims about this
    // same file. They are checked here rather than only under `--tally`,
    // because `--tally` is not what CI runs.
    const ids = increments.flatMap((inc) => inc.ids)
    const g = parseGates(planText, ids)
    const floors = checkGateFloors(g.gates)
    const markerById = new Map()
    for (const inc of increments) for (const id of inc.ids) markerById.set(id, inc.marker)
    const supersessions = checkGateSupersessions(g.gates, markerById)
    // Section 6's lane headings are the manifest for the increment parser: a
    // lane it cannot see is otherwise indistinguishable from a lane that does
    // not exist. Printed with its denominator, so a broken heading scan reports
    // itself rather than reporting a clean file.
    const laneCheck = checkLaneHeadings(planText, increments)
    if (laneCheck.findings.length === 0) {
      console.log(`OK   section 6 lanes             ${laneCheck.lanes.length} headings, every one parsed to increments`)
    }
    const gateFindings = [...g.findings, ...floors.findings, ...supersessions.findings, ...laneCheck.findings]
    for (const gate of g.gates) {
      if (!gateFindings.some((f) => f.includes(`"${gate.name}"`))) {
        console.log(`OK   gate ${gate.name.padEnd(26)} ${gate.ids.length} members${gate.excluded.length ? `, excludes ${gate.excluded.join(', ')}` : ''}`)
      }
    }
    for (const f of [...r.findings, ...gateFindings]) console.log(`FAIL ${f}`)
    if (r.ids < MIN_INCREMENTS) {
      console.error(`FAILED: parsed only ${r.ids} increments (floor ${MIN_INCREMENTS}); the parser or the file is broken`)
      process.exit(1)
    }
    if (r.checked < MIN_PATHS) {
      console.error(`FAILED: checked only ${r.checked} paths (floor ${MIN_PATHS}); the parser or the file is broken`)
      process.exit(1)
    }
    if (r.findings.length || gateFindings.length) {
      console.error(`FAILED: ${r.findings.length + gateFindings.length} finding(s) in ${PLAN_PATH}`)
      process.exit(1)
    }
    console.log(`plan ok: ${r.ids} increments, ${r.checked} paths checked, ${r.awaiting} paths awaiting other increments (not checked), ${g.gates.length} gates with ${floors.total} members`)
  }
}
