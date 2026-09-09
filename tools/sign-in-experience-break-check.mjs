#!/usr/bin/env node
/**
 * Proves `tools/sign-in-experience-test.mjs` can fail.
 *
 * Four sabotages, one per property this increment is worth having:
 *
 *   1. a state loses its screen                 -> the enumeration goes red naming it
 *   2. remembering defaults to off              -> the reversal goes red
 *   3. a second path can store a secret         -> the one-path check goes red
 *   4. Enter stops submitting the form          -> the form-semantics check goes red
 *
 * Case 2 is the one worth reading. Until 9 September 2026 this repository's
 * sabotage was the *opposite* one - `tools/credential-store-test.mjs` shipped
 * with "flip the default to `true`, watch it go red". Dan reversed the product
 * decision that day, so the check was turned over rather than deleted, and this
 * is the proof that the turned-over check still bites. A default that flips
 * back with nothing going red is exactly how a decision gets quietly undone by
 * somebody tidying on privacy grounds, which is why the reasoning is dated in
 * `docs/LICH_NATIVE_LOGIN.md` §5.2 as well as guarded here.
 *
 * Each case names the checks it expects to redden, and the run fails if a
 * sabotage reddens a different set than it declares. A sabotage that breaks
 * more than it aimed at means the checks are entangled and the suite is saying
 * less than it looks like it is saying - both of the defects the first draft of
 * this harness found were in the suite rather than in the app.
 *
 * Every file is restored by byte copy and verified by hash, because these edit
 * tracked source in a tree several sessions work in at once, and leaving one in
 * place would be worse than having no negative test at all. A sabotage that
 * changes no bytes is a hard abort and never a pass: this tree checks out CRLF,
 * so a fragment assembled with '\n' matches nothing, the file is rewritten
 * identical, the suite stays green, and the output reads exactly like proof.
 *
 * Run: node tools/sign-in-experience-break-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { watchTree } from './break-check-tree.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const md5 = (buf) => createHash('md5').update(buf).digest('hex')

const CASES = [
  {
    name: 'a state loses its screen',
    file: 'src/lib/signInStates.ts',
    // `gave_up` is the one to take, because it is the state a player is in when
    // the link has stopped trying: the screen that exists only so nobody is
    // stranded (#523). Renaming the arm leaves the state enumerated and
    // unhandled, which is the shape the defect actually takes - nobody deletes
    // a state from a list, they add one and forget the screen.
    find: "    case 'gave_up':",
    replace: "    case 'gave_up_typo':",
    expect: [
      'every enumerated state has a screen',
      'no state offers only a disclosure and no way onward',
      'gave_up is a screen of its own with an action',
    ],
  },
  {
    name: 'remembering defaults to off',
    file: 'src/lib/rememberSignIn.ts',
    find: 'export const REMEMBER_SIGN_IN_DEFAULT = true',
    replace: 'export const REMEMBER_SIGN_IN_DEFAULT = false',
    expect: [
      'the default is on',
      'the next sign-in knows the account, game and character',
      'and that a password is stored, without ever reading it',
    ],
  },
  {
    name: 'a second path can store a secret',
    file: 'src/lib/lichLogin.ts',
    // Planted in the module that already talks to Tauri about signing in,
    // because that is where a plausible second path would actually appear:
    // somebody adding "and remember it" beside the call that just used it,
    // rather than going through the one owner.
    find: "export async function launchCharacter(args: {",
    replace:
      "async function sabotageSecondStore(account: string, password: string) {\n" +
      "  await invokeTauri('credential_store', { account, password })\n" +
      "}\n\n" +
      "export async function launchCharacter(args: {",
    expect: ['exactly one frontend file can store a secret'],
  },
  {
    name: 'Enter stops submitting the form',
    file: 'src/components/shared/SignIn.tsx',
    find: '            type="submit"',
    replace: '            type="button"',
    expect: ['so Enter submits without a keydown handler pretending to be one'],
  },
]

// The "before" reading, taken before anything is damaged: this asserts that the
// run changed nothing, not that the checkout was tidy.
const treeBack = watchTree([...new Set(CASES.map((c) => c.file))])

function runSuite() {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(root, 'tools/sign-in-experience-test.mjs')],
    { encoding: 'utf8' },
  )
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const reds = [...out.matchAll(/^FAIL\s+(.+?)\s{2,}/gm)].map((m) => m[1].trim())
  return { code: r.status, reds, out }
}

let problems = 0

// The gate that goes before any sabotage: an unmodified tree must be green, or
// every red below could be something else entirely.
{
  const base = runSuite()
  if (base.code !== 0) {
    console.log('ABORT the suite is already red before any sabotage:')
    console.log(base.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'))
    process.exit(1)
  }
  console.log('OK   baseline green before sabotage')
}

for (const c of CASES) {
  const path = join(root, c.file)
  const original = readFileSync(path)
  const before = md5(original)
  const text = original.toString('utf8')

  if (!text.includes(c.find)) {
    // Naming the anchor, not merely the file: an anchor that has drifted is
    // repaired by finding where the line went, and "not found" sends nobody
    // looking for it.
    console.log(`ABORT ${c.name}: the anchor is not in ${c.file}, so the sabotage would change nothing.`)
    console.log(`      anchor: ${JSON.stringify(c.find)}`)
    console.log('      find where it went (git log -S) and move the anchor; do not delete the case.')
    process.exit(1)
  }
  writeFileSync(path, text.replace(c.find, c.replace))
  if (md5(readFileSync(path)) === before) {
    console.log(`ABORT ${c.name}: the file is byte-identical after the edit`)
    writeFileSync(path, original)
    process.exit(1)
  }

  const r = runSuite()
  writeFileSync(path, original)
  const after = md5(readFileSync(path))
  if (after !== before) {
    console.log(`ABORT ${c.name}: restore failed, ${c.file} is ${after}, was ${before}`)
    process.exit(1)
  }

  const missing = c.expect.filter((e) => !r.reds.includes(e))
  const extra = r.reds.filter((e) => !c.expect.includes(e))
  const good = r.code !== 0 && missing.length === 0 && extra.length === 0
  if (!good) problems += 1
  console.log(
    `${good ? 'OK  ' : 'FAIL'} ${c.name.padEnd(34)} exit=${r.code} red=${r.reds.length}` +
      (missing.length ? `  MISSING: ${missing.join(' | ')}` : '') +
      (extra.length ? `  UNEXPECTED: ${extra.join(' | ')}` : ''),
  )
  console.log(`     ${c.file} restored, md5 ${after}`)
}

console.log(
  problems === 0
    ? `\nall ${CASES.length} sabotages were caught, all files restored`
    : `\n${problems} case(s) wrong`,
)
process.exit(treeBack(problems === 0 ? 0 : 1))
