/**
 * Elanthipedia scraper.
 *
 *   node tools/elanthipedia.mjs index       list every title, per namespace
 *   node tools/elanthipedia.mjs full        one-time full pull of properties
 *   node tools/elanthipedia.mjs update      only what changed since last run
 *   node tools/elanthipedia.mjs status      what we have
 *
 * Elanthipedia runs Semantic MediaWiki, so item data comes back structured
 * rather than as prose to be parsed. 500 rows per query, roughly 130 queries
 * for the full set, instead of 65,000 page fetches.
 *
 * elanthipedia.play.net is Simutronics infrastructure, not community-hosted.
 * This runs once, centrally, on a schedule, and clients read the committed
 * result. It never runs from a player machine.
 *
 *   - one request at a time, never parallel
 *   - PAUSE_MS between requests
 *   - maxlag=5, so the server can refuse us while it is behind
 *   - a hard request ceiling per run
 *   - incremental by default; the full pull runs once
 *
 * Contact for anything about this traffic: the GitHub issues page below.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://elanthipedia.play.net/api.php'
const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
)
// Format follows the MediaWiki UA policy: name/version, then how to reach us.
// Read from package.json so it cannot drift out of date.
const UA =
  `dr-companion/${VERSION} ` +
  `(https://github.com/dancockrell/dr-companion; ` +
  `173971169+dancockrell@users.noreply.github.com) ` +
  `Node.js/${process.versions.node}`
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

  // A timeout, because without one a single stalled connection hangs the whole
  // run forever and silently. That is not hypothetical: the first full pull sat
  // for twenty minutes having written nothing, with the process alive and
  // apparently working, because there was nothing to make it give up.
  let res
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    if (attempt >= 5) throw new Error(`network: ${e.message}`)
    console.log(`  ${e.name}, retrying`)
    await sleep(2000 * 2 ** attempt)
    return api(params, attempt + 1)
  }

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
  let requests = 0

  for (;;) {
    // A hard ceiling, checked before the request rather than after.
    //
    // This is here because the first version of this ran away. `ask` keeps
    // returning 500 rows when `offset` walks past the end of the result set
    // rather than returning nothing, so `names.length < PAGE` never fired and
    // the loop reported 28,000 weapons out of a possible 7,377. It made
    // roughly three thousand requests to Simutronics' wiki over twenty
    // minutes before I noticed, which is precisely the thing every comment in
    // this file says must not happen.
    //
    // Two independent guards, because one that can be fooled by the API is not
    // a guard: a request ceiling, and a check below for whether we are still
    // learning anything.
    if (++requests > 200) {
      console.log(`  STOP: ${conditions} exceeded 200 requests, refusing to continue`)
      break
    }
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

    // The guard that actually matters: are we still learning anything?
    //
    // Past the end of the result set the API returns rows we already have, so
    // the honest end condition is "this page taught us nothing new" rather
    // than any claim the API makes about how many rows it sent.
    const before = Object.keys(rows).length
    for (const [title, row] of Object.entries(results)) {
      rows[title] = flatten(row.printouts)
    }
    const learned = Object.keys(rows).length - before

    if (learned === 0) {
      console.log(`  ${conditions} complete at ${before} rows`)
      break
    }

    offset += names.length
    // A plain line, not a carriage return. `\r` progress looks tidy on a
    // terminal and writes nothing at all when the output is piped to a file,
    // which is exactly the case where you most need to know it is alive.
    console.log(`  ${conditions} ${offset} rows`)
    if (names.length < PAGE || offset >= max) break
  }

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
    const clean = vals.map((v) => {
      if (!v || typeof v !== 'object') return v
      if (v.fulltext !== undefined) return v.fulltext
      if (v.item !== undefined) return v.item
      // SMW's `_qty` type (used by "Appraised cost is") comes back as
      // {value, unit} rather than {fulltext|item}, so it fell through to
      // String(v) and every one of these landed in the committed JSON as
      // the literal text "[object Object]" — see issue #29. Checked live
      // against the API rather than guessed: a weapon's cost printout is
      // {"value":50000,"unit":"Kronars"}.
      if (v.value !== undefined) return v.unit ? `${v.value} ${v.unit}` : v.value
      return String(v)
    })
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
/**
 * The namespaces that hold game data, with their ids.
 *
 * This is the unit of work, and getting that wrong was the first design error
 * here. I started by tracking which of the pages we already knew about had
 * changed — a watchlist diff — which cannot see the thing that actually
 * happens: **new items are added**. A page that did not exist last hour is not
 * a change to anything we were watching.
 *
 * So the namespace is what gets watched, and anything in it we do not have is
 * new and gets added. Measured over fourteen days:
 *
 *   Item:     93 edits      Weapon:   13      Armor:  a handful
 *   main:    269            mostly player biographies and tournament logs,
 *                           which are not game data
 *
 * That is roughly one relevant page an hour, which is what makes an hourly
 * cadence reasonable rather than wasteful.
 */
const NAMESPACES = {
  Armor: 110,
  Weapon: 114,
  Item: 118,
}

/**
 * Weapon types, used to partition a query that cannot be paged past ~5,400.
 *
 * SMW's `ask` has an offset ceiling. Beyond roughly 5,400 it stops advancing
 * and wraps to the start of the result set — verified: offset 5400, 5500 and
 * 6000 all return the same first row that offset 0 does. So a single query over
 * 7,377 weapons is not merely slow, it is *incapable* of reaching the end, and
 * the first clean run silently returned 5,499 of them while reporting success.
 *
 * Partitioning is the fix: every subset here is comfortably under the ceiling,
 * and the union is the whole category. Read off the wiki rather than invented.
 */
const WEAPON_TYPES = [
  'Arrow', 'Bolt', 'Composite Bow', 'Dart', 'Elbows', 'Hands',
  'Heavy Blunt', 'Heavy Crossbow', 'Heavy Edged', 'Heavy Thrown',
  'Light Blunt', 'Light Crossbow', 'Light Edged', 'Light Thrown',
  'Long Bow', 'Medium Blunt', 'Medium Edged', 'Parry', 'Polearms',
  'Quarter Staff', 'Rock', 'Short Bow', 'Short Staff', 'Slings',
  'Twohanded Blunt', 'Twohanded Edged',
]

const SETS = {
  weapons: {
    conditions: '[[Category:Weapons]]',
    // Partitioned, per the ceiling above.
    partitionBy: WEAPON_TYPES.map((t) => `[[Is combat type::${t}]]`),
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
    // Not `Category:Creatures`, which does not exist. I guessed that name and
    // the run reported "creatures: 0 saved" as though it were a result rather
    // than a typo. The category is Bestiary, 790 pages.
    conditions: '[[Category:Bestiary]]',
    props: ['Noun is', 'Body type is', 'Body size is', 'Page type is'],
  },
  npcs: {
    conditions: '[[Category:NPCs]]',
    props: ['Noun is', 'Page type is'],
  },
}

/**
 * Everything in a namespace, by title.
 *
 * This is the index, and it took three wrong attempts to get here.
 *
 *   1. Category queries. `[[Category:Armor]]` returns **486** rows for a
 *      category MediaWiki reports as holding **3,910** pages. Categories are
 *      not a reliable index into this wiki's semantic data.
 *   2. Paged `ask`. Cannot reach past an offset of ~5,400 — it wraps to the
 *      start — so it silently returned 5,499 of 7,377 weapons and called it
 *      done.
 *   3. Partitioned `ask`. Better, 6,987 weapons, still short and still
 *      dependent on every page having the property being partitioned on.
 *
 * `allpages` has none of those problems. It is the wiki's own list of what
 * exists, it pages with `apcontinue` rather than a numeric offset so there is
 * no ceiling, and it is exhaustive:
 *
 *   Armor  (110)   4,083 pages in   9 requests
 *   Weapon (114)   7,384 pages in  15 requests
 *   Item   (118)  65,600 pages in 132 requests
 *
 * It also answers the question that actually matters hourly — *what is here
 * that we do not have* — because new items appear as new titles.
 */
async function allPages(namespaceId, label) {
  const titles = []
  let cont
  let requests = 0

  do {
    if (++requests > 300) {
      console.log(`  STOP: ${label} exceeded 300 requests`)
      break
    }
    const json = await api({
      action: 'query',
      list: 'allpages',
      apnamespace: String(namespaceId),
      aplimit: '500',
      apfilterredir: 'nonredirects',
      ...(cont ? { apcontinue: cont } : {}),
    })
    for (const p of json.query?.allpages ?? []) titles.push(p.title)
    cont = json.continue?.apcontinue
    if (requests % 20 === 0) console.log(`  ${label} ${titles.length}`)
  } while (cont)

  console.log(`  ${label} ${titles.length} titles`)
  return titles
}

/** Snapshot every namespace's title list. Cheap, exhaustive, and the basis for
 *  noticing new items later. */
async function index() {
  const out = {}
  for (const [name, id] of Object.entries(NAMESPACES)) {
    out[name] = await allPages(id, name)
  }
  save('index', out)
  const total = Object.values(out).reduce((s, a) => s + a.length, 0)
  console.log(`  ${total} titles indexed`)
  return out
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
    let rows = {}

    if (set.partitionBy) {
      // Each partition is its own query, all merged. Union rather than
      // concatenation, because an item can legitimately match two partitions
      // and should be stored once.
      for (const part of set.partitionBy) {
        const sub = await ask(`${set.conditions}${part}`, set.props)
        Object.assign(rows, sub)
      }
    } else {
      rows = await ask(set.conditions, set.props)
    }

    const n = Object.keys(rows).length

    // An empty set is a bug in this file, not a fact about the wiki. It is how
    // `Category:Creatures` — a category that does not exist — was reported as
    // "0 saved" and read as a result rather than a typo.
    if (n === 0) {
      console.log(`  ${name}: EMPTY — check the category name in SETS`)
      continue
    }

    save(name, rows)
    console.log(`  ${name}: ${n} saved`)
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
/**
 * Incremental: ask each namespace what appeared or changed, and take it.
 *
 * The first version of this asked "which of the pages I already have were
 * edited", which is a watchlist and cannot see the thing that actually happens.
 * Items get **added**. A page that did not exist an hour ago is not an edit to
 * anything on a watchlist, so the interesting case was exactly the one being
 * missed.
 *
 * Watching the namespace catches both, and does not care whether a title is new
 * or merely changed — either way we do not have the current version of it, and
 * either way the answer is to fetch it.
 */
async function update() {
  const state = loadState()
  if (!state.lastRun) {
    console.log('No previous run. Do a full pull first.')
    process.exit(1)
  }

  const since = state.lastRun
  const started = new Date().toISOString()
  console.log(`Since ${since}`)

  const touched = new Set()

  for (const [name, id] of Object.entries(NAMESPACES)) {
    let cont
    let n = 0
    do {
      const json = await api({
        action: 'query',
        list: 'recentchanges',
        rcstart: started,
        rcend: since,
        rcdir: 'older',
        rclimit: '500',
        rcprop: 'title|timestamp|type',
        rcnamespace: String(id),
        // 'new' as well as 'edit'. Leaving it off defaults to both, but saying
        // so is the point of this whole rewrite.
        rctype: 'new|edit',
        ...(cont ? { rccontinue: cont } : {}),
      })
      for (const c of json.query?.recentchanges ?? []) {
        touched.add(c.title)
        n++
      }
      cont = json.continue?.rccontinue
    } while (cont)

    console.log(`  ${name.padEnd(8)} ${n}`)
  }

  if (touched.size === 0) {
    console.log('  nothing new')
    saveState({ ...state, lastRun: started, mode: 'update' })
    return
  }

  // Fetch the touched pages by name rather than re-running the category
  // queries. A handful of titles is a handful of rows; re-pulling 7,000 weapons
  // to catch three edits would be the expensive mistake this whole design is
  // trying to avoid.
  const added = { }
  for (const title of touched) {
    const json = await api({ action: 'browsebysubject', subject: title })
    const props = {}
    for (const row of json.query?.data ?? []) {
      const vals = (row.dataitem ?? []).map((d) => d.item)
      props[row.property.replace(/_/g, ' ')] = vals.length === 1 ? vals[0] : vals
    }
    added[title] = props
    console.log(`  fetched ${Object.keys(added).length}/${touched.size}`)
  }

  // Merge into whichever set the namespace maps to, by the prefix on the title.
  const byPrefix = { Weapon: 'weapons', Armor: 'armor', Item: 'items' }
  const dirty = new Set()

  for (const [title, props] of Object.entries(added)) {
    const prefix = title.split(':')[0]
    const set = byPrefix[prefix] ?? 'items'
    const store = load(set)
    store[title] = props
    save(set, store)
    dirty.add(set)
  }

  console.log(`  merged ${touched.size} into ${[...dirty].join(', ')}`)
  saveState({ ...state, lastRun: started, mode: 'update' })
}

function status() {
  const state = loadState()
  console.log(`last run: ${state.lastRun ?? 'never'} (${state.mode ?? '-'})`)
  for (const name of Object.keys(SETS)) {
    const n = Object.keys(load(name)).length
    console.log(`  ${name.padEnd(12)} ${n.toLocaleString()}`)
  }
}

/**
 * Pull the {{Critter}} infobox and the prose Description for every bestiary
 * page. The structured `ask` query carries neither, and the description is the
 * only source for what a creature looks like.
 *
 * Batched 50 titles per request: 919 creatures cost 19 requests, not 919.
 */
function parseCritter(wikitext) {
  const out = {}
  const start = wikitext.indexOf('{{Critter')
  if (start >= 0) {
    // Walk to the matching close rather than matching with a regex: field
    // values contain templates and links carrying their own braces.
    let depth = 0
    let i = start
    for (; i < wikitext.length; i++) {
      if (wikitext.startsWith('{{', i)) {
        depth++
        i++
      } else if (wikitext.startsWith('}}', i)) {
        depth--
        i++
        if (depth === 0) break
      }
    }
    for (const line of wikitext.slice(start, i).split('\n')) {
      const m = /^\|\s*([^=]+?)\s*=\s*(.*)$/.exec(line)
      if (m && m[2]) out[m[1]] = m[2].trim()
    }
  }

  const d = /==\s*Description\s*==\s*\n([\s\S]*?)(?=\n==|$)/i.exec(wikitext)
  if (d) {
    out.description = d[1]
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
      .replace(/'''?/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return out
}

async function bestiary() {
  const names = Object.keys(load('creatures'))
  if (!names.length) {
    console.log('no creature list yet; run full first')
    return
  }
  const batches = Math.ceil(names.length / 50)
  console.log(`${names.length} creatures, ${batches} requests`)

  const out = {}
  let described = 0
  for (let i = 0; i < names.length; i += 50) {
    const json = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: names.slice(i, i + 50).join('|'),
    })
    for (const page of json.query?.pages ?? []) {
      const text = page.revisions?.[0]?.slots?.main?.content
      if (!text) continue
      const c = parseCritter(text)
      if (Object.keys(c).length) {
        out[page.title] = c
        if (c.description) described++
      }
    }
    console.log(`  ${Object.keys(out).length}/${names.length}, ${described} described`)
  }

  save('bestiary', out)
  console.log(`saved ${Object.keys(out).length}, ${described} with a description`)
}

/**
 * The thirteen playable races, for the art pack.
 *
 * These are not generic fantasy races and rendering them as such is the fastest
 * way to tell a thirty-year player nobody looked. S'Kra Mur are reptilian,
 * Prydaen feline, Rakash lupine shapechangers, Aelotoi winged, Gor'Tog large
 * and green. The descriptions have to come from the wiki, not from instinct.
 *
 * Race pages redirect to the Concept: namespace, so redirects are followed.
 * One request for all thirteen.
 */
const RACES = [
  'Human', 'Elf', 'Half-Elf', 'Dwarf', 'Halfling', 'Gnome', "Gor'Tog",
  "S'Kra Mur", 'Prydaen', 'Rakash', 'Kaldar', 'Elothean', 'Aelotoi',
]

/** Pull one == Section == out of wikitext, stripped of markup. */
function section(wikitext, name) {
  // Escapes are doubled because this is a template literal, where a lone \s
  // collapses to a bare s. The regex silently matched nothing until it did.
  const re = new RegExp(
    `==+\\s*${name}\\s*==+\\s*\\n([\\s\\S]*?)(?=\\n==|$)`,
    'i',
  )
  const m = re.exec(wikitext)
  if (!m) return null
  const text = m[1]
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/^\s*[*#:]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

async function races() {
  const json = await api({
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    titles: RACES.join('|'),
  })

  const byTitle = {}
  for (const p of json.query?.pages ?? []) {
    byTitle[p.title] = p.revisions?.[0]?.slots?.main?.content ?? ''
  }
  // Map Concept:X back to the name we asked for.
  const back = {}
  for (const r of json.query?.redirects ?? []) back[r.to] = r.from

  const out = {}
  for (const [title, text] of Object.entries(byTitle)) {
    if (!text) continue
    const name = back[title] ?? title
    const entry = {
      page: title,
      description: section(text, 'Play\.net Description'),
      appearance: section(text, `${name} Appearance and Behavior`) ?? section(text, 'Appearance'),
      characteristics: section(text, 'Racial Characteristics'),
      creation: section(text, 'Character Creation'),
      height: section(text, 'Height'),
    }
    for (const k of Object.keys(entry)) if (!entry[k]) delete entry[k]
    out[name] = entry
  }

  const missing = RACES.filter((r) => !out[r])
  save('races', out)
  console.log(`saved ${Object.keys(out).length} of ${RACES.length}`)
  if (missing.length) console.log(`  no page for: ${missing.join(', ')}`)
}

/**
 * Player character descriptions, per race.
 *
 * These are the in-game LOOK text that players wrote for their own characters,
 * and they are the only source that shows how a race actually reads in play.
 * The Concept: pages describe a race in the abstract; these show which features
 * the game's own character generator offers and which ones players reach for.
 *
 * Elothean is the example that made this necessary: the Concept page never
 * says they have unusually high foreheads, and the descriptions say it
 * constantly.
 *
 * 1,549 characters across twelve races, 50 titles per content request.
 */
const PC_RACES = [
  'Dwarf', 'Elf', 'Elothean', 'Gnome', "Gor'Tog", 'Gorbesh',
  'Halfling', 'Human', 'Kaldar', 'Prydaen', 'Rakash', "S'Kra Mur",
]

/** The "You see ..." block, stripped to plain sentences. */
function pcDescription(wikitext) {
  const m = /==\s*Description\s*==\s*\n([\s\S]*?)(?=\n==|$)/i.exec(wikitext)
  if (!m) return null
  const text = m[1]
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Anything shorter than this is a stub or an empty infobox, not a look.
  return text.length > 60 ? text : null
}

async function pcs() {
  const out = {}

  for (const race of PC_RACES) {
    const list = await api({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:Player ${race}`,
      cmlimit: '500',
      cmtype: 'page',
    })
    const names = (list.query?.categorymembers ?? []).map((x) => x.title)
    const found = []

    for (let i = 0; i < names.length; i += 50) {
      const json = await api({
        action: 'query',
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        titles: names.slice(i, i + 50).join('|'),
      })
      for (const page of json.query?.pages ?? []) {
        const text = page.revisions?.[0]?.slots?.main?.content
        if (!text) continue
        const d = pcDescription(text)
        if (d) found.push({ name: page.title, look: d })
      }
    }

    out[race] = found
    console.log(`  ${race.padEnd(11)} ${String(found.length).padStart(4)} of ${names.length}`)
  }

  save('pcs', out)
  const total = Object.values(out).reduce((n, a) => n + a.length, 0)
  console.log(`saved ${total} descriptions`)
}

const cmd = process.argv[2] ?? 'status'
if (cmd === 'index') await index()
else if (cmd === 'full') await full()
else if (cmd === 'update') await update()
else if (cmd === 'bestiary') await bestiary()
else if (cmd === 'races') await races()
else if (cmd === 'pcs') await pcs()
else status()
