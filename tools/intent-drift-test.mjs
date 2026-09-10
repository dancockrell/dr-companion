#!/usr/bin/env node
/**
 * Fails loudly when mockBridge.ts's advertised intent set diverges from
 * reality — either from IntentName (what the UI can even ask for) or from
 * companion_bridge.lic's actual dispatch (what a real bridge implements).
 *
 * Written after mockBridge advertised `run_macro` as implemented when it has
 * no handler anywhere in companion_bridge.lic. Every Task Flow, every quick
 * action, and the Bard PLAY picker route through that intent, so the mock
 * told every session developing against it a plausible, confident lie: full
 * command sequences appeared to work end to end and would have silently done
 * nothing against a live bridge. The #30 disable-mechanism this repo built
 * specifically to catch "the UI offers something the bridge can't do" was
 * defeated by its own fixture claiming a capability the real system lacks —
 * the same shape as a check that cannot fail. This script is the fix: not
 * "be more careful next time," but something that breaks the build the next
 * time these three files disagree.
 *
 * Three sources of truth, none of which may silently drift from the others:
 *   1. IntentName (src/bridge/types.ts)      - what the UI can request at all
 *   2. Intents.handle (companion_bridge.lic) - what a real bridge implements
 *   3. MOCK_UNIMPLEMENTED_INTENTS (mockBridge.ts) - what the mock claims is missing
 *
 * Run: node tools/intent-drift-test.mjs
 * Wired into `npm run build` so a divergence fails the build, not just this
 * script when someone remembers to run it.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readNormalized, declaredIntents, implementedIntents } from './bridge-intent-parsing.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readAt(relPath) {
  const path = join(ROOT, relPath)
  try {
    // Normalised to LF before any regex sees it. types.ts and mockBridge.ts
    // are unpinned in .gitattributes, so on a machine with core.autocrlf=true
    // (the default this repo is developed on) they check out as CRLF while
    // this script's boundary regex hardcodes a bare '\n\n' — found by running
    // a clean `git worktree add` from origin/main and watching declaredIntents
    // throw "could not locate the IntentName union" against an unmodified
    // file. .lic files are pinned `eol=lf` for the opposite reason already
    // documented in .gitattributes, so this is a no-op for companion_bridge.lic.
    return readNormalized(path)
  } catch (e) {
    throw new Error(`intent-drift-test: could not read ${relPath}: ${e.message}`)
  }
}

// declaredIntents/implementedIntents used to live here, hand-rolled. R0
// (docs/PLAN_TO_1_0.md §6b) extracted them into ./bridge-intent-parsing.mjs
// so tools/activity-intent-contract-test.mjs — which needs the exact same
// two facts, "what does IntentName declare" and "what does HANDLERS really
// implement" — doesn't grow a second, independently-drifting copy of the
// same two regexes. Behaviour here is unchanged; only the import moved.

/** What the mock currently claims is unimplemented — parsed, not trusted by name alone. */
function mockClaimedUnimplemented(mockSrc) {
  const m = mockSrc.match(/const MOCK_UNIMPLEMENTED_INTENTS: string\[\] = \[([\s\S]*?)\]/)
  if (!m) throw new Error('intent-drift-test: could not find MOCK_UNIMPLEMENTED_INTENTS in mockBridge.ts — did it get renamed? This script needs updating, not silencing.')
  const names = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
  return new Set(names)
}

const typesSrc = readAt('src/bridge/types.ts')
const bridgeSrc = readAt('lich-scripts/companion_bridge.lic')
const mockSrc = readAt('src/bridge/mockBridge.ts')

const declared = declaredIntents(typesSrc)
const implemented = implementedIntents(bridgeSrc)
const mockClaims = mockClaimedUnimplemented(mockSrc)

// The real truth: declared minus actually-implemented.
const trueUnimplemented = new Set([...declared].filter((i) => !implemented.has(i)))

const missingFromMock = [...trueUnimplemented].filter((i) => !mockClaims.has(i)).sort()
const extraInMock = [...mockClaims].filter((i) => !trueUnimplemented.has(i)).sort()

console.log(`Declared intents (types.ts):        ${declared.size}`)
console.log(`Implemented in bridge (real):        ${implemented.size}`)
console.log(`True unimplemented set:              ${trueUnimplemented.size}`)
console.log(`Mock's claimed-unimplemented set:     ${mockClaims.size}`)

if (missingFromMock.length === 0 && extraInMock.length === 0) {
  console.log('OK — mockBridge.ts matches the real bridge dispatch exactly.')
  process.exit(0)
}

console.error('\nintent-drift-test: FAILED — mockBridge.ts disagrees with reality.\n')
if (missingFromMock.length > 0) {
  console.error(
    `The mock claims these are IMPLEMENTED, but companion_bridge.lic has no handler for them:\n  ${missingFromMock.join(', ')}\n` +
    'This is the run_macro bug\'s exact shape: the mock told the UI something works that does nothing on a real bridge.\n' +
    'Add these to MOCK_UNIMPLEMENTED_INTENTS in src/bridge/mockBridge.ts.\n'
  )
}
if (extraInMock.length > 0) {
  console.error(
    `The mock claims these are UNIMPLEMENTED, but companion_bridge.lic actually has a handler now:\n  ${extraInMock.join(', ')}\n` +
    'Remove these from MOCK_UNIMPLEMENTED_INTENTS in src/bridge/mockBridge.ts — the mock is now disabling a button that works.\n'
  )
}
process.exit(1)
