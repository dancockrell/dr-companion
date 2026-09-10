#!/usr/bin/env node
/**
 * Shared parsing for "what intent does this file say exists" — extracted
 * from tools/intent-drift-test.mjs (R0, docs/PLAN_TO_1_0.md §6b Lane R)
 * so tools/activity-intent-contract-test.mjs does not grow its own second
 * copy of the same three regexes. Two tools answering "is this intent
 * really implemented" from independently-written parsers is exactly the
 * drift this repo's own no-fork rule warns about — one parser, two callers.
 *
 * Exports pure functions over already-read source text; each caller does
 * its own file reading via readNormalized() so relative paths resolve
 * against that caller's own ROOT.
 */
import { readFileSync } from 'node:fs'

/**
 * Read a file and normalise CRLF to LF before any regex sees it.
 *
 * This repo checks out CRLF (core.autocrlf=true) for files not pinned
 * `eol=lf` in .gitattributes — types.ts and mockBridge.ts are among them —
 * so a regex built against a bare '\n' silently matches nothing on a fresh
 * `git worktree add` from origin/main. .lic files are pinned `eol=lf`, so
 * this is a no-op there; still applied uniformly rather than trusting which
 * files are pinned today to stay true tomorrow.
 */
export function readNormalized(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

/** Declared intents — every `| 'xyz'` line inside the IntentName union. */
export function declaredIntents(typesSrc) {
  // IntentName is the last declaration in the file (BridgeConnectionState/
  // BridgeSnapshot, the anchor this used, were dead types deleted in a
  // cleanup pass), so this matches to end-of-file rather than to a named
  // neighbor.
  const m = typesSrc.match(/export type IntentName =([\s\S]*)$/)
  if (!m) throw new Error('bridge-intent-parsing: could not locate the IntentName union in types.ts — did it move or get renamed? Callers need updating, not silencing.')
  const body = m[1]
  const names = [...body.matchAll(/\|\s*'([a-z_]+)'/g)].map((x) => x[1])
  if (names.length === 0) throw new Error('bridge-intent-parsing: found the IntentName union but extracted zero names — the regex is broken, not the file.')
  return new Set(names)
}

/**
 * Real dispatch — HANDLERS.keys when that hash exists (the current shape),
 * falling back to the older case/when body for a bridge checkout that
 * predates the refactor. See tools/intent-drift-test.mjs's original header
 * for why both shapes are accepted rather than the older one being deleted.
 */
export function implementedIntents(bridgeSrc) {
  const handlersStart = bridgeSrc.indexOf('HANDLERS = {')
  if (handlersStart !== -1) {
    const handlersEnd = bridgeSrc.indexOf('}.freeze', handlersStart)
    if (handlersEnd === -1) throw new Error('bridge-intent-parsing: found `HANDLERS = {` but no closing `}.freeze` — the hash extraction is broken, not the file.')
    const body = bridgeSrc.slice(handlersStart, handlersEnd)
    const names = [...body.matchAll(/'([a-z_]+)'\s*=>/g)].map((x) => x[1])
    if (names.length === 0) throw new Error('bridge-intent-parsing: found the HANDLERS hash but extracted zero intents — the regex is broken, not the file.')
    return new Set(names)
  }

  const start = bridgeSrc.indexOf('def dispatch(intent, args, server)')
  const startHandle = start === -1 ? bridgeSrc.indexOf('def handle(intent, args, server)') : -1
  const anchor = start !== -1 ? start : startHandle
  if (anchor === -1) throw new Error("bridge-intent-parsing: could not find 'HANDLERS = {', 'def dispatch(intent, args, server)' or 'def handle(intent, args, server)' in companion_bridge.lic — did Intents' dispatch get renamed or restructured? Callers need updating to match, not silencing.")
  const elseIdx = bridgeSrc.indexOf('\n      else\n', anchor)
  const end = elseIdx === -1 ? bridgeSrc.indexOf('\nend', anchor) : elseIdx
  if (end === -1 || end <= anchor) throw new Error('bridge-intent-parsing: found the dispatch method but could not find its else/end boundary — the method body extraction is broken, not the file.')
  const body = bridgeSrc.slice(anchor, end)

  const names = [
    ...body.matchAll(/when\s+'([a-z_]+)'/g),
    ...body.matchAll(/'([a-z_]+)'\s*=>/g),
  ].map((x) => x[1])

  if (names.length === 0) {
    throw new Error(
      "bridge-intent-parsing: found handle()'s body but extracted zero intents. " +
        'Either the extraction is broken, or the dispatch has legitimately ' +
        "changed shape (this knows `when 'name'` and `'name' => :method`). " +
        'Check which before assuming companion_bridge.lic is damaged.'
    )
  }
  return new Set(names)
}
