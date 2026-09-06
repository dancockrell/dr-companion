/**
 * The setup wizard has to answer the question it sends people into.
 *
 *   node tools/setup-guidance-test.mjs
 *
 * On a clean Windows 11 VM, 5 Sep 2026, the wizard handed over to Ruby4Lich5's
 * own installer with the words "it asks its own questions" and no guidance on
 * what to answer. One of those questions is "Lich5 Folder Location", and its
 * default is labelled **"preferred for Gemstone IV"** while the non-default is
 * labelled "preferred for DragonRealms". This is a DragonRealms client, so a
 * person clicking Next through the defaults is told by a page we sent them to
 * that they picked the other game's layout.
 *
 * Nothing breaks either way. That run took the Desktop default and detection
 * found Lich there and installed the bridge correctly, which is why the fix is
 * a sentence and not a code path. See docs/verification/first-run-2026-09-05.md,
 * "Defect 2", and issue #380.
 *
 * # What is asserted, and what deliberately is not
 *
 * The property, not the wording: that the note **names both of the installer's
 * options** and says both work. An exact-string test would go red on a comma
 * and green on a sentence that had quietly lost half its meaning, which is the
 * wrong way round.
 *
 * There is no component-test harness in this repository, so the render is not
 * exercised here. What is checked instead is the consuming side: that
 * `ComponentCard` actually reads the constant, because a string nobody renders
 * is the same absence with more steps. The Rust half of this fix (the Lich row
 * saying where Lich was found) is asserted by `cargo test`'s `lich_row_tests`;
 * what this file checks about it is only that the frontend and the docs have
 * not drifted back to the single-location assumption.
 */
import { readFileSync } from 'node:fs'
import { RUBY4LICH5_FOLDER_NOTE } from '../src/lib/setup.ts'

let failed = 0
let checks = 0
const ok = (name, cond, detail = '') => {
  checks++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
}

const note = RUBY4LICH5_FOLDER_NOTE
const lower = note.toLowerCase()

console.log('-- the note names both of the installer\'s two options --')

ok(
  'names the Desktop option, which is the installer default',
  lower.includes('desktop')
)
ok(
  "names the Ruby4Lich5 option, the one that page calls preferred for DragonRealms",
  lower.includes('ruby4lich5')
)
ok(
  'gives the Ruby4Lich5 option as a folder, not just a product name',
  /ruby4lich5[\\/]lich5/i.test(note),
  note.match(/C:[^ ,]*Lich5/i)?.[0] ?? ''
)
ok(
  'says both answers work, so nobody reruns an installer they have finished',
  /both\b.*\bwork/i.test(note)
)
ok(
  'names the game whose label the default carries, which is the confusing part',
  lower.includes('gemstone')
)

console.log('\n-- house style --')

ok('no em dash', !note.includes('\u2014'), note.includes('\u2014') ? note : '')
ok(
  'short enough to be read rather than skipped',
  note.length < 420,
  `${note.length} characters`
)

console.log('\n-- something renders it --')

const card = readFileSync('src/components/first-run/ComponentCard.tsx', 'utf8')
ok(
  'ComponentCard imports the note',
  /RUBY4LICH5_FOLDER_NOTE/.test(card.split('\n').slice(0, 40).join('\n'))
)
ok(
  'ComponentCard renders it inside JSX, not merely imports it',
  /\{\s*RUBY4LICH5_FOLDER_NOTE\s*\}/.test(card)
)
ok(
  'it is rendered on installer options, where the questions get asked',
  /o\.after === 'installer'[\s\S]{0,400}RUBY4LICH5_FOLDER_NOTE/.test(card)
)

console.log('\n-- the Lich row says where, not just that --')

const rs = readFileSync('src-tauri/src/setup.rs', 'utf8')
ok(
  'the row detail is built by lich_detail rather than a bare literal',
  /detail:\s*lich_detail\(/.test(rs)
)
ok(
  'the bare "Found" detail is gone',
  !/=>\s*"Found"\.into\(\)/.test(rs)
)
ok(
  'the found case formats the folder into the sentence',
  /"Found in \{\}"/.test(rs)
)

console.log('\n-- the docs do not claim one location --')

const policy = readFileSync('docs/SETUP-POLICY.md', 'utf8')
ok(
  'SETUP-POLICY says the installer asks where to put Lich and that either works',
  /lich5 folder location/i.test(policy) && /both[\s\S]{0,24}work/i.test(policy)
)

const domainLines = readFileSync('docs/DOMAIN.md', 'utf8').split('\n')
const rbwLine = domainLines.findIndex((l) => /Ruby4Lich5.Lich5.lich\.rbw/i.test(l))
ok(
  'DOMAIN still states the Ruby4Lich5 default path (the anchor this checks around)',
  rbwLine >= 0
)
ok(
  'and no longer presents it as the only place Lich lives',
  rbwLine >= 0 &&
    /desktop/i.test(domainLines.slice(Math.max(0, rbwLine - 4), rbwLine + 14).join('\n')),
  rbwLine >= 0 ? domainLines[rbwLine] : ''
)

console.log(
  failed
    ? `\n${failed} failed of ${checks}`
    : `\nall passed (${checks} checks)`
)
process.exit(failed ? 1 : 0)
