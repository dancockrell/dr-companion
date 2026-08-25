/**
 * Elanthipedia scraper.
 *
 *   node tools/elanthipedia.mjs full        one-time full pull
 *   node tools/elanthipedia.mjs update      only what changed since last run
 *   node tools/elanthipedia.mjs status      what we have
 *
 * Why this exists: every character's gear is different, new items arrive
 * constantly, and the nouns are strange. No table we hand-write stays right.
 * Elanthipedia has 112,323 pages including 65,017 items, and it runs Semantic
 * MediaWiki, so the data is *structured* rather than prose to be parsed.
 * See docs/DESIGN.md §2.4 and §S5.
 *
 * Being a good guest is a hard requirement, not a nicety — and the reason is
 * sharper than politeness. Elanthipedia is community-*written*, which is easy
 * to mistake for community-hosted. It is not: `elanthipedia.play.net` is
 * Simutronics' domain, their infrastructure and their bill.
 *
 * So this is the server belonging to the company this project is meant to be
 * given to. Appearing in their logs as a traffic spike would be the worst
 * possible introduction.
 *
 *   - one request at a time, never parallel
 *   - a deliberate pause between requests
 *   - maxlag, so we back off automatically when their database is struggling
 *   - a User-Agent that says who we are and links to the project
 *   - incremental by default; the full pull is meant to run once
 *
 * If this ever looks like a load problem from their side, it is built wrong.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://elanthipedia.play.net/api.php'
const UA = 'dr-companion/0.1 (https://github.com/dancockrell/dr-companion) node-fetch'
const OUT = 'data/elanthipedia'

/** Between requests. Slower than we could go, on purpose. */
const PAUSE_MS = 350
/** Ask the server to refuse us if its replication lag exceeds this. */
const MAXLAG = 5
/** Rows per structured query. 500 measured at ~1.8s and ~235KB. */
const PAGE = 500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * One API call, with the politeness built in rather than remembered.
 *
 * maxlag returns HTTP 200 with an error body rather than a status code, so it
 * has to be checked for explicitly — the usual mistake is treating it as
 * success and hammering a struggling database harder.
 */
async function api(params, attempt = 0) {
  const url = `${API}?${new URLSearchParams({
    ...params,
    format: 'json',
    formatversion: '2',
    maxlag: String(MAXLAG),
  })}`

  await sleep(PAUSE_MS)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`${res.status} after ${attempt} retries`)
    const wait = 2000 * 2 ** attempt
    console.log(`  ${res.status}, waiting ${wait}ms`)
    await sleep(wait)
    return api(params, attempt + 1)
  }

  const json = await res.json()

  if (json.error?.code === 'maxlag') {
    if (attempt >= 5) throw new Error('maxlag, giving up for now')
    const wait = Math.min(30, Number(json.error.lag) || 5) * 1000
    console.log(`  their database is lagging ${json.error.lag}s, waiting`)
    await sleep(wait)
    return api(params, attempt + 1)
  }
  if (json.error) throw new Error(`${json.error.code}: ${json.error.info}`)

  return json
}

/**
 * A structured query, paged.
 *
 * `ask` is the reason this is tractable: 500 items with their properties in one
 * request, rather than 500 requests. Scraping the HTML of 65,000 pages would be
 * both worse data and an abuse of their bandwidth.
 */
async function ask(conditions, props, { max = Infinity } = {}) {
  const rows = {}
  let offset = 0

  for (;;) {
    const query = [
      conditions,
      ...props.map((p) => `?${p}`),
      `limit=${PAGE}`,
      `offset=${offset}`,
    ].join('|')

    const json = await api({ action: 'ask', query })
    const results = json.query?.results ?? {}
    const names = Object.keys(results)
    if (names.length === 0) break

    for (const [title, row] of Object.entries(results)) {
      rows[title] = flatten(row.printouts)
    }

    offset += names.length
    process.stdout.write(`\r  ${conditions}  ${offset} rows`)
    if (names.length < PAGE || offset >= max) break
  }

  process.stdout.write('\n')
  return rows
}

/**
 * SMW returns every value as an array, and most properties hold exactly one.
 * Collapsing the singletons is what makes the output readable and small; the
 * genuine multi-values keep their array.
 */
function flatten(printouts) {
  const out = {}
  for (const [key, vals] of Object.entries(printouts ?? {})) {
    if (!Array.isArray(vals) || vals.length === 0) continue
    const clean = vals.map((v) =>
      v && typeof v === 'object' ? (v.fulltext ?? v.item ?? String(v)) : v
    )
    out[key] = clean.length === 1 ? clean[0] : clean
  }
  return out
}

/**
 * What we pull, and the properties worth pulling for each.
 *
 * Property names come from the wiki itself — `Noun is` rather than a name we
 * invented — because a name we invented would silently return nothing, which is
 * exactly how the first attempt at this produced 500 rows of empty columns.
 */
const SETS = {
  weapons: {
    conditions: '[[Category:Weapons]]',
    props: [
      'Noun is', 'Item type is', 'Is combat type', 'Appraised cost is',
      'Weight is', 'Puncture damage is number', 'Slice damage is number',
      'Impact damage is number', 'Fire damage is number',
      'Cold damage is number', 'Electric damage is number',
      'Construction is number', 'Is metal',
    ],
  },
  armor: {
    conditions: '[[Category:Armor]]',
    props: [
      'Noun is', 'Item type is', 'Appraised cost is', 'Weight is',
      'Construction is number', 'Is metal', 'Puncture protection is number',
      'Slice protection is number', 'Impact protection is number',
    ],
  },
  materials: {
    conditions: '[[Category:Materials]]',
    props: [
      'Noun is', 'Crafting material type is', 'Crafting hardness is',
      'Crafting density is', 'Crafting durability is', 'Appraised cost is',
    ],
  },
  creatures: {
    conditions: '[[Category:Creatures]]',
    props: ['Noun is', 'Body type is', 'Body size is', 'Page type is'],
  },
  npcs: {
    conditions: '[[Category:NPCs]]',
    props: ['Noun is', 'Page type is'],
  },
}

function outPath(name) {
  return join(OUT, `${name}.json`)
}

function load(name) {
  const p = outPath(name)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}

function save(name, data) {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(outPath(name), JSON.stringify(data, null, 0))
}

function loadState() {
  const p = join(OUT, 'state.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}

function saveState(s) {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'state.json'), JSON.stringify(s, null, 2))
}

async function full() {
  console.log('Full pull. This is meant to run once.')
  const started = new Date().toISOString()

  for (const [name, set] of Object.entries(SETS)) {
    const rows = await ask(set.conditions, set.props)
    save(name, rows)
    console.log(`  ${name}: ${Object.keys(rows).length} saved`)
  }

  // The timestamp is taken *before* the pull, not after. Anything edited while
  // we were reading is then picked up by the next update rather than missed —
  // re-fetching a page is free, missing one is a silent hole.
  saveState({ lastRun: started, mode: 'full' })
  console.log('Done.')
}

/**
 * Incremental: ask what changed, then refetch only those.
 *
 * `recentchanges` is the whole reason an hourly schedule is reasonable. A wiki
 * this size sees a few dozen edits an hour, so an update is a handful of
 * requests rather than 130.
 */
async function update() {
  const state = loadState()
  if (!state.lastRun) {
    console.log('No previous run. Do a full pull first.')
    process.exit(1)
  }

  const since = state.lastRun
  const started = new Date().toISOString()
  console.log(`Changes since ${since}`)

  const changed = new Set()
  let cont

  do {
    const json = await api({
      action: 'query',
      list: 'recentchanges',
      rcstart: started,
      rcend: since,
      rcdir: 'older',
      rclimit: '500',
      rcprop: 'title|timestamp|ids',
      rcnamespace: '0',
      ...(cont ? { rccontinue: cont } : {}),
    })
    for (const c of json.query?.recentchanges ?? []) changed.add(c.title)
    cont = json.continue?.rccontinue
  } while (cont)

  console.log(`  ${changed.size} pages touched`)

  if (changed.size === 0) {
    saveState({ ...state, lastRun: started, mode: 'update' })
    return
  }

  // Refetch by category rather than page by page: one 500-row query that
  // happens to include the changed pages costs less than fifty single-page
  // lookups, and keeps the data internally consistent.
  for (const [name, set] of Object.entries(SETS)) {
    const existing = load(name)
    const touched = Object.keys(existing).filter((t) => changed.has(t))
    const isNew = [...changed].some((t) => !(t in existing))
    if (touched.length === 0 && !isNew) continue

    const rows = await ask(set.conditions, set.props)
    save(name, rows)
    console.log(`  ${name}: refreshed, ${Object.keys(rows).length} rows`)
  }

  saveState({ ...state, lastRun: started, mode: 'update' })
  console.log('Done.')
}

function status() {
  const state = loadState()
  console.log(`last run: ${state.lastRun ?? 'never'} (${state.mode ?? '-'})`)
  for (const name of Object.keys(SETS)) {
    const n = Object.keys(load(name)).length
    console.log(`  ${name.padEnd(12)} ${n.toLocaleString()}`)
  }
}

const cmd = process.argv[2] ?? 'status'
if (cmd === 'full') await full()
else if (cmd === 'update') await update()
else status()
