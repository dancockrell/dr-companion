/**
 * Checks the palette against WCAG AA, and the type scale against a 12px floor.
 *
 *   node tools/contrast-test.mjs
 *
 * Both checks exist for the same reason, recorded in docs/DESIGN.md §1.5: the
 * audience is mid-forties to sixty, presbyopia is near-universal in that band,
 * and they are reading at desk distance beside a game window. Small grey text
 * on near-black is exactly the combination that gets an app closed and never
 * reopened, without the reason ever being said out loud.
 *
 * Contrast is measured rather than eyeballed because eyeballing it is how it
 * got this way.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let fails = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) fails++
}

// --- WCAG relative luminance and contrast -----------------------------------

function srgbToLinear(c) {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  )
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// --- the palette, read from source rather than duplicated -------------------

const css = readFileSync('src/index.css', 'utf8')

check(
  'raw buttons receive a visible keyboard-focus fallback',
  /button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-accent\)[^}]*outline-offset:\s*2px/s.test(css),
  'src/index.css must protect buttons that do not use the shared Button component'
)
check(
  'raw buttons receive the shared 150ms state transition',
  /button\s*\{[^}]*transition-property:[^}]*background-color[^}]*transform[^}]*transition-duration:\s*150ms/s.test(css),
  'raw buttons must not snap while the shared Button component eases'
)
const palette = Object.fromEntries(
  [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [
    m[1],
    m[2],
  ])
)

console.log('-- palette contrast against the surfaces text sits on --')

// AA is 4.5:1 for body text and 3:1 for large text (18.66px bold or 24px).
// Everything in this app is small, so 4.5 is the bar that applies.
const AA = 4.5
const surfaces = ['surface', 'surface-raised', 'surface-overlay']
const inks = ['ink', 'ink-muted', 'ink-faint', 'accent', 'good', 'warn', 'danger', 'info']

for (const ink of inks) {
  if (!palette[ink]) continue
  for (const bg of surfaces) {
    if (!palette[bg]) continue
    const ratio = contrast(palette[ink], palette[bg])
    check(
      `${ink} on ${bg}`,
      ratio >= AA,
      `${ratio.toFixed(2)}:1${ratio >= AA ? '' : ` (needs ${AA})`}`
    )
  }
}

const battleActionBarSource = readFileSync('src/components/room/BattleActionBar.tsx', 'utf8')
check(
  'magic actions use the semantic magic token rather than a raw framework purple',
  battleActionBarSource.includes("magic: 'border-magic/40'") && !battleActionBarSource.includes('border-purple-')
)

console.log('')
console.log('-- scrollbars belong to the warm interface on every engine --')
const scrollbarTokens = ['scrollbar-thumb', 'scrollbar-hover', 'scrollbar-active']
for (const token of scrollbarTokens) {
  const color = palette[token]
  check(`${token} is a named theme color`, Boolean(color))
  if (!color) continue
  for (const bg of [...surfaces, 'map-ground']) {
    const background = bg === 'map-ground'
      ? css.match(/--map-ground:\s*(#[0-9a-fA-F]{6})/)?.[1]
      : palette[bg]
    if (!background) continue
    const ratio = contrast(color, background)
    check(`${token} visible on ${bg}`, ratio >= 3, `${ratio.toFixed(2)}:1${ratio >= 3 ? '' : ' (needs 3)'}`)
  }
}
check(
  'retired blue-grey scrollbar literals are gone',
  !/#2a3142|#3a4255/i.test(css)
)
check(
  'Firefox and WebView receive the same scrollbar tokens',
  css.includes('scrollbar-color: var(--color-scrollbar-thumb) transparent') &&
    css.includes('background: var(--color-scrollbar-thumb)')
)
console.log('-- global chrome follows motion preferences --')
const reducedMotion = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]+)\}\s*$/)?.[1] ?? ''
check('reduced-motion policy exists', Boolean(reducedMotion))
check(
  'reduced motion stops repeated animation',
  /animation-iteration-count:\s*1\s*!important/.test(reducedMotion)
)
check(
  'reduced motion removes transition travel time',
  /transition-duration:\s*0\.01ms\s*!important/.test(reducedMotion)
)
check(
  'reduced motion removes decorative press and hover transforms',
  reducedMotion.includes('[class*="hover:-translate-y"]') &&
    reducedMotion.includes('[class*="active:scale-"]') &&
    /transform:\s*none\s*!important/.test(reducedMotion)
)
const battleActions = readFileSync('src/components/room/BattleActionBar.tsx', 'utf8')
const taskFlow = readFileSync('src/components/dashboard/TaskFlowPanel.tsx', 'utf8')
const panel = readFileSync('src/components/shared/Panel.tsx', 'utf8')
const combatRadar = readFileSync('src/components/shared/CombatRadar.tsx', 'utf8')
const soundControls = readFileSync('src/components/game/SoundControls.tsx', 'utf8')
const portrait = readFileSync('src/components/shared/Portrait.tsx', 'utf8')
check(
  'frequent action decks use subtle, motion-safe press depth',
  battleActions.includes('game-icon-button') &&
    taskFlow.includes('active:scale-[0.98]') &&
    /\.game-icon-button:active:not\(:disabled\)\s*\{[^}]*scale\(0\.97\)/s.test(css) &&
    reducedMotion.includes('.game-icon-button:active') &&
    ![battleActions, taskFlow].some((source) => source.includes('active:scale-95'))
)
check(
  'battle actions and panel headers retain shared focus and typography conventions',
  battleActions.includes('focus-visible:outline-offset-2') &&
    panel.includes('uppercase tracking-wide') &&
    !panel.includes('uppercase tracking-wider')
)
check(
  'transient sound and radar popovers stay below modal dialogs',
  combatRadar.includes('pointer-events-auto fixed z-40') &&
    !combatRadar.includes('pointer-events-auto fixed z-50') &&
    soundControls.includes('absolute bottom-full right-0 z-40') &&
    !soundControls.includes('absolute bottom-full right-0 z-50')
)
check(
  'the portrait chooser uses the shared modal tier',
  portrait.includes('fixed inset-0 z-50') && !portrait.includes('z-[100]')
)

const retiredOnAccent = walk('src').filter((file) =>
  readFileSync(file, 'utf8').includes('text-[#1a1408]')
)
check(
  'accent surfaces use the semantic on-accent text token',
  retiredOnAccent.length === 0,
  retiredOnAccent.length ? `${retiredOnAccent.length} files still hardcode #1a1408` : ''
)

const componentSources = walk('src/components').map((file) => ({
  file,
  text: readFileSync(file, 'utf8'),
}))
const modalScrims = componentSources.filter(({ text }) =>
  text.includes('fixed inset-0 z-50') && text.includes('bg-scrim')
)
const retiredBlackScrims = componentSources.filter(({ text }) =>
  /fixed inset-0 z-50[^"']*bg-black\//.test(text)
)
check(
  'modal backdrops use one semantic scrim token',
  css.includes('--color-scrim: rgb(0 0 0 / 0.5)') && modalScrims.length === 9 && retiredBlackScrims.length === 0,
  `${modalScrims.length} semantic modal scrims; ${retiredBlackScrims.length} raw black scrims`
)

// --- the type floor ---------------------------------------------------------

console.log('')
console.log('-- nothing renders below 12px --')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(full)
  }
  return out
}

const offenders = []
for (const file of walk('src')) {
  const text = readFileSync(file, 'utf8')
  // Tailwind arbitrary sizes: text-[11px]. Anything under 12 fails.
  for (const m of text.matchAll(/text-\[(\d+)px\]/g)) {
    if (Number(m[1]) < 12) offenders.push(`${file}: ${m[0]}`)
  }
  // Named sizes below xs would be the same problem; xs is 12px.
  for (const m of text.matchAll(/\btext-(2xs|3xs)\b/g)) {
    offenders.push(`${file}: ${m[0]}`)
  }
}

check(
  'no type below 12px',
  offenders.length === 0,
  offenders.length ? `${offenders.length} found, e.g. ${offenders[0]}` : ''
)

// These values are exact aliases of Tailwind's spacing scale, not bespoke
// measurements. Keeping the named form makes the shared design language
// visible in source and prevents equivalent one-off spellings from spreading.
const canonicalSizeAliases = new Map([
  ['max-w-[14rem]', 'max-w-56'],
  ['max-w-[11rem]', 'max-w-44'],
  ['max-w-[15rem]', 'max-w-60'],
  ['min-w-[10rem]', 'min-w-40'],
  ['min-w-[13rem]', 'min-w-52'],
  ['min-h-[13rem]', 'min-h-52'],
  ['max-w-[12rem]', 'max-w-48'],
  ['min-h-[2.75rem]', 'min-h-11'],
])
const nonCanonicalSizes = []
for (const file of walk('src')) {
  const text = readFileSync(file, 'utf8')
  for (const [arbitrary, canonical] of canonicalSizeAliases) {
    if (text.includes(arbitrary)) nonCanonicalSizes.push(`${file}: ${arbitrary} -> ${canonical}`)
  }
}
check(
  'exact spacing-scale aliases use their canonical Tailwind classes',
  nonCanonicalSizes.length === 0,
  nonCanonicalSizes.length ? `${nonCanonicalSizes.length} found, e.g. ${nonCanonicalSizes[0]}` : ''
)

// --- the same inks, at the opacities the app actually renders them ----------

/*
 * The block above proves the palette. It does not prove the screen.
 *
 * Tailwind's `/NN` modifier makes a new colour out of a token, and this app
 * uses it freely - `text-ink-faint/50` on the radar's compass labels,
 * `text-ink-faint/80` on the script-library section headings. Those colours
 * are not in the palette, so nothing here ever looked at them, and every one
 * of them is dimmer than the token that was checked and passed.
 *
 * Measured in the running app rather than derived: composite the real
 * background stack onto a 1x1 canvas, paint the computed text colour over it,
 * read the pixel back. On surface-raised:
 *
 *     ink-faint        5.03:1   checked above, passes
 *     ink-faint/80     3.64:1
 *     ink-faint/70     3.08:1
 *     ink-faint/60     2.60:1
 *     ink-faint/50     2.19:1   the compass labels
 *
 * No reduction of ink-faint clears AA, because it only starts with 0.53 of
 * margin to spend. The rule this encodes is not "50 is too low" - it is that
 * a token passing says nothing about a fraction of it.
 */

/** `fg` at `alpha` over `bg`, both #rrggbb, composited in sRGB. */
function blend(fg, bg, alpha) {
  const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16))
  const f = hex(fg)
  const b = hex(bg)
  const to2 = (v) => Math.round(v).toString(16).padStart(2, '0')
  return `#${[0, 1, 2].map((i) => to2(f[i] * alpha + b[i] * (1 - alpha))).join('')}`
}

console.log('')
console.log('-- and at the reduced opacities the source actually uses --')

/** Every `text-<token>/<n>` the codebase renders, found rather than assumed. */
const used = new Map()
for (const file of walk('src')) {
  for (const m of readFileSync(file, 'utf8').matchAll(/\btext-([a-z-]+)\/(\d{1,3})\b/g)) {
    if (!palette[m[1]]) continue
    const key = `${m[1]}/${m[2]}`
    if (!used.has(key)) used.set(key, { ink: m[1], pct: Number(m[2]), where: file })
  }
}

// The denominator, so a regex that quietly stops matching cannot read as a
// clean run - the failure this whole file exists to make impossible.
console.log(`   ${used.size} token/opacity combination(s) found in src`)

for (const { ink, pct, where } of [...used.values()]) {
  for (const bg of surfaces) {
    if (!palette[bg]) continue
    const ratio = contrast(blend(palette[ink], palette[bg], pct / 100), palette[bg])
    check(
      `${ink}/${pct} on ${bg}`,
      ratio >= AA,
      `${ratio.toFixed(2)}:1${ratio >= AA ? '' : ` (needs ${AA}) - ${where}`}`
    )
  }
}

// --- the game pane header must stay able to shrink ---------------------------

console.log('')
console.log('-- the game connection header can shrink, so Attach stays reachable --')

// This bug was found twice, independently, within a day: the header's control
// group - scrollback search, port box, Clear, Attach - left the pane in a
// narrow window and sat inside an ancestor with overflow-x:hidden, so there
// was nothing to scroll to it. Attach is the button you press to connect to
// the game, and the pane beside it read "not attached" while the control that
// would fix that was off-screen.
//
// Being found twice is the argument for a guard. The fix is `min-w-0` on the
// row (so it may shrink below its content) plus `shrink-0` on the control
// group (so the notes give way first, not the buttons). Either half alone
// leaves it broken - measured.
//
// This checks the mechanism, not the property, and that is worth saying. The
// property is "Attach is inside the window at 900px", which only a rendered
// measurement proves; that was done across 1400/1300/1250/1200/1150/1120/
// 1100/1050/1000/900 and is clean. What this catches is the one-word edit
// that quietly reopens it.
const connectionBar = readFileSync('src/components/game/GameConnectionBar.tsx', 'utf8')
const headerRow = connectionBar
  .split('\n')
  .find((l) => l.includes('border-b border-border') && l.includes('items-center') && l.includes('className'))

check(
  'GameConnectionBar.tsx still has a header row to check',
  Boolean(headerRow),
  headerRow ? '' : 'no line matched - this check has stopped looking at anything'
)
if (headerRow) {
  check(
    'the header row can shrink (min-w-0, or it wraps)',
    headerRow.includes('min-w-0') || headerRow.includes('flex-wrap'),
    headerRow.trim().slice(0, 96)
  )
}

console.log('')
console.log('-- loading motion is shared, announced and policy-safe --')
const loadingNotice = readFileSync('src/components/shared/LoadingNotice.tsx', 'utf8')
check('the shared loading notice announces asynchronous work',
  loadingNotice.includes('role="status"') && loadingNotice.includes('aria-live="polite"'))
check('the shared loading spinner respects reduced motion',
  loadingNotice.includes('animate-spin motion-reduce:animate-none'))
const configEditors = [
  'AliasesEditor.tsx',
  'GagsEditor.tsx',
  'HighlightsEditor.tsx',
  'MacrosEditor.tsx',
  'PresetsEditor.tsx',
  'SubstitutesEditor.tsx',
]
for (const file of configEditors) {
  const source = readFileSync(join('src', 'components', 'config', file), 'utf8')
  check(`${file} uses the shared loading notice`, source.includes('<LoadingNotice />'))
}
const radar = readFileSync('src/components/shared/CombatRadar.tsx', 'utf8')
check('CombatRadar has no dormant looping attention pulse',
  !radar.includes('animate-pulse') && !radar.includes('pulse?: boolean'))

console.log('')
console.log(fails === 0 ? 'all passed' : `${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
