/**
 * Creature card prompts.
 *
 *   node tools/art-creatures.mjs            write data/art/creature-prompts.json
 *   node tools/art-creatures.mjs review 20  print a sample to read
 *
 * Every creature in DragonRealms has a look, and the wiki usually carries it.
 * 740 of 773 have a Description. That text is the prompt, because it is what
 * players have actually been reading for thirty years, and an invented
 * description that contradicts it is worse than no card.
 *
 * The rest is a quality problem rather than a coverage one. The scraped text
 * carries three kinds of junk:
 *
 *   - surviving section headings, ==In Depth== and friends
 *   - template slots the wiki left empty: "It is wearing some ."
 *   - release notes rather than looks: "Introduced in Tuesday Tidings 66"
 *
 * Anything that does not survive cleaning falls back to the name, which is
 * often enough on its own. "Ambulatory coral reef with labyrinthine grooves"
 * needs no help.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const IN = 'data/elanthipedia/bestiary.json'
const OUT = 'data/art/creature-prompts.json'

/**
 * The style, fixed and never varied.
 *
 * Consistency is a stated reject condition, so this string is the contract.
 * Changing it means regenerating the whole pack, not patching part of it.
 *
 * APPROVED 26 August 2026, against a six-creature sample. Do not edit this
 * string to fix an individual creature: fix that creature's subject text
 * instead. See DESIGN.md S4.
 */
const STYLE =
  'painterly digital illustration, muted naturalistic palette, soft directional ' +
  'light, atmospheric depth, painted texture, full body, plain dark background, ' +
  'no text, no watermark, consistent fantasy realism'

const NEGATIVE =
  'text, watermark, signature, logo, frame, border, multiple views, ' +
  'photorealistic, cartoon, anime, cute, chibi'

/** Text that is about the release rather than the creature. */
const META = /introduced in|tuesday tidings|premium only|this creature was|see also|category:/i

function clean(text) {
  if (!text) return ''
  return (
    text
      // Headings that survived the section grab.
      .replace(/==+[^=]*==+/g, ' ')
      // Empty template slots: "wearing some .", "carrying a , a ."
      .replace(/\b(?:wearing|carrying|holding)\s+(?:some|a|an)?\s*[,.]/gi, ' ')
      .replace(/\b(?:a|an|some)\s*(?=[,.])/gi, ' ')
      .replace(/\s*,\s*(?=[,.])/g, ' ')
      .replace(/\s+([,.])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Keep only sentences that describe rather than annotate. */
function visualSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 24 && !META.test(s))
    .join(' ')
    .trim()
}

/**
 * The name alone, turned into a description.
 *
 * DragonRealms names carry a lot: "Emaciated figure", "Baleful ice adder",
 * "Ambulatory coral reef with labyrinthine grooves". Stripping the article and
 * handing the rest over is usually all that is needed.
 */
function fromName(name) {
  return name
    .replace(/^(a|an|the|some)\s+/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim()
    .toLowerCase()
}

/** Body facts, where the wiki has them. Short, so they do not crowd the look. */
function bodyClause(v) {
  const bits = []
  if (v.BodySize) bits.push(`${v.BodySize.toLowerCase()} in size`)
  if (v.BodyType) bits.push(`${v.BodyType.toLowerCase()} build`)
  return bits.join(', ')
}

/**
 * A seed derived from the name, so the same creature is the same image every
 * time and a regeneration reproduces rather than reinvents.
 */
function seedOf(name) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * An anti-prettiness clause, in the positive prompt where it works.
 *
 * The negative prompt does have an effect at cfg 1.0 (rendering with and
 * without it gives different images, checked rather than assumed), but it is
 * far too weak to fight what the creature's own name summons. Prompted with
 * "kobold" first, FLUX produced a large-eyed furry thing with enormous ears:
 * the generic fantasy prior, not the DragonRealms one, whose text says
 * leathery brown skin, a doglike face, and bug-ugly.
 *
 * Two fixes, both structural rather than per-creature. The lore leads and the
 * name comes after it, so the description dominates the name. And the words
 * the descriptions themselves keep using are stated outright, because these
 * creatures are meant to be unpleasant.
 */
const GRIT =
  'grotesque, unlovely, feral, weathered, grimy, small malicious eyes, ' +
  'leathery or scaled hide rather than soft fur, adult proportions, not cute'

const raw = JSON.parse(readFileSync(IN, 'utf8'))
const out = {}
const counts = { both: 0, nameOnly: 0 }

for (const [name, v] of Object.entries(raw)) {
  const described = visualSentences(clean(v.description))

  // Lore first, name second. The two are combined rather than chosen between:
  // quality varies enormously, from a paragraph of anatomy down to "It's a
  // boar. It doesn't like you.", and both are the only lore there is. The name
  // stays as an anchor either way, so nothing is discarded for being thin.
  const subject = described ? `${described} A ${fromName(name)}.` : `A ${fromName(name)}.`
  if (described) counts.both++
  else counts.nameOnly++

  const body = bodyClause(v)
  out[name] = {
    source: described ? 'wiki+name' : 'name',
    lore: described || null,
    prompt: [subject, body, GRIT, STYLE].filter(Boolean).join(', '),
    negative: NEGATIVE,
    seed: seedOf(name),
    width: 832,
    height: 1216,
  }
}

mkdirSync('data/art', { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log(
  `${Object.keys(out).length} prompts: ${counts.both} carry wiki lore, ${counts.nameOnly} are name only`
)

if (process.argv[2] === 'review') {
  const n = Number(process.argv[3] ?? 10)
  for (const [name, p] of Object.entries(out).slice(0, n)) {
    console.log(`\n### ${name}  [${p.source}, seed ${p.seed}]`)
    console.log(`    ${p.prompt.slice(0, 300)}`)
  }
}
