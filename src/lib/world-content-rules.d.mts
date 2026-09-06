/**
 * Types for `world-content-rules.mjs`.
 *
 * Declared beside the module the way `isometric-board-layout.d.mts` is, and for
 * the same reason: the rules are `.mjs` so `tools/build-world-content.mjs` and
 * the Godot-side builders can import them without a compile step, and the app
 * imports the same file rather than a TypeScript copy of it.
 *
 * Only the exports a TypeScript consumer uses are declared. The rest of the
 * module (the pattern tables, the text matchers) is build-time only.
 */
export const GROUND_KINDS: string[]
export const BLOCK_KINDS: string[]
export const GROUND_LADDER: string[]
export const GROUND_RULES: string[]
export const THRESHOLD_DIRECTIONS: Set<string>
export const COHORT_MAJORITY_NUMERATOR: number
export const COHORT_MAJORITY_DENOMINATOR: number
export const COMPASS_SIDES: string[]
export function ruleStrength(rule: string | null | undefined): number
export function placeCohorts(
  rooms: { id: number; place?: string | null; exits?: { dir: string; to: number }[] }[]
): { place: string; ids: number[] }[]
export function unifyPlaceCohort(
  ids: number[],
  decidedOf: (id: number) => { kind: string; rule: string }
): {
  state: 'agreed' | 'unified' | 'held'
  kind: string | null
  count?: number
  reason?: string
  changed: { id: number; from: string; to: string }[]
}
export function blockKindFor(groundKind: string): string
export function groundKindFromText(text: string | null | undefined): string | null
export function groundKindFromZoneName(name: string | null | undefined): string | null
export function titleSubject(title: string | null | undefined): string
export function titleContext(title: string | null | undefined): string
export function tagsFor(input: {
  groundKind: string
  landmarkKind: string | null
  subject: string
  context: string
}): string[]
export function specialKindsFor(tags: string[]): string[]
export function spatialModeFor(blockKind: string, tags: string[]): string
export function tierFor(specialKinds: string[], tags: string[]): string
export function boundaryEdgesFor(input: {
  exits: { dir: string; to: number }[] | undefined
  expandDirection: (value: unknown) => string | null
  blockKindOf: (id: number) => string | null
  ownBlockKind: string
}): string[]
export function primitivesFor(input: {
  blockKind: string
  tags: string[]
  boundaryEdges: string[]
}): { kind: string; role: string }[]
