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

console.log('')
console.log(fails === 0 ? 'all passed' : `${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
