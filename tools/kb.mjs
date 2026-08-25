/**
 * The knowledge base, and the tool for asking it things.
 *
 *   node tools/kb.mjs build            (re)build the index from all sources
 *   node tools/kb.mjs item brigandine  what is this thing
 *   node tools/kb.mjs noun hauberk     what kind of item is this noun
 *   node tools/kb.mjs creature goblin  what is this
 *   node tools/kb.mjs script travel    which script does this, and what is in it
 *   node tools/kb.mjs api getxp        where in Lich does this live
 *   node tools/kb.mjs prop damage      what properties exist about damage
 *   node tools/kb.mjs note add "..."   record something learned the hard way
 *   node tools/kb.mjs note list        what has already been learned
 *   node tools/kb.mjs stats            what is indexed
 *
 * Why this exists, stated plainly because it is a correction of how I have been
 * working. Across this project I have repeatedly asserted something about
 * DragonRealms, been corrected, gone and researched it, and then fixed the code.
 * That loop is expensive and it repeats, because nothing carried the answer
 * forward: the next session starts as ignorant as the last one.
 *
 * So this indexes what is knowable — the wiki's structured data, the Lich API,
 * the community scripts — into one local database that can be queried in a
 * second, and it records corrections so the same mistake is not made twice.
 *
 * The rule that goes with it: **query this before claiming anything about the
 * game.** A guess that takes one command to check is not worth making.
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const DB_DIR = 'data/kb'
const DB_PATH = join(DB_DIR, 'knowledge.db')

/**
 * Where the sources live. Absent ones are skipped rather than fatal, because
 * this has to work on a machine that does not have all of them.
 *
 * The point is coverage. A question like "how does Genie decide a script has
 * stalled" is answerable from Genie's own C# source and from nowhere else, and
 * "what does uber do when a box blows" is answerable only from uber. Indexing
 * the engines as well as the scripts is what turns this from a script search
 * into something that can actually answer questions about the game.
 */
const SOURCES = {
  wiki: { dir: 'data/elanthipedia', kind: 'wiki' },

  // The two engines.
  lich: { dir: 'C:/Ruby4Lich5/Lich5/lib', kind: 'api', label: 'lich', ext: /\.rb$/i },
  genieSrc: {
    dir: 'C:/Users/Admin/AppData/Local/Temp/mine/Genie4-main',
    kind: 'api',
    label: 'genie-source',
    ext: /\.(cs|vb)$/i,
  },

  // The scripts people actually run.
  drScripts: {
    dir: 'C:/Ruby4Lich5/Lich5/scripts',
    kind: 'script',
    label: 'dr-scripts',
    ext: /\.lic$/i,
  },
  uber: {
    dir: 'C:/Users/Admin/AppData/Local/Temp/mine/UBER_FULL_PACKAGE',
    kind: 'script',
    label: 'uber',
    ext: /\.(cmd|inc)$/i,
  },
  mastercraft: {
    dir: 'C:/Users/Admin/AppData/Local/Temp/mine/Mastercraft-master',
    kind: 'script',
    label: 'mastercraft',
    ext: /\.(cmd|inc)$/i,
  },
  looseGenie: {
    dir: 'C:/Users/Admin/Downloads',
    kind: 'script',
    label: 'genie',
    ext: /\.(cmd|inc)$/i,
    shallow: true,
  },
}

function open() {
  mkdirSync(DB_DIR, { recursive: true })
  return new DatabaseSync(DB_PATH)
}

function schema(db) {
  // FTS5 for the prose, plain tables for the structured facts. Full-text is
  // what makes "which script mentions burden" answerable, and the structured
  // side is what makes "what does this weapon do" exact.
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity (
      id        INTEGER PRIMARY KEY,
      kind      TEXT NOT NULL,      -- item | creature | script | api | property
      name      TEXT NOT NULL,
      noun      TEXT,
      source    TEXT NOT NULL,
      props     TEXT                -- JSON blob of everything else
    );
    CREATE INDEX IF NOT EXISTS entity_kind_name ON entity(kind, name);
    CREATE INDEX IF NOT EXISTS entity_noun      ON entity(noun);

    CREATE VIRTUAL TABLE IF NOT EXISTS doc USING fts5(
      name, kind UNINDEXED, source UNINDEXED, body
    );

    CREATE TABLE IF NOT EXISTS note (
      id      INTEGER PRIMARY KEY,
      at      TEXT NOT NULL,
      topic   TEXT,
      wrong   TEXT,
      right   TEXT
    );
  `)
}

// ---------------------------------------------------------------- indexing --

function indexWiki(db) {
  const dir = SOURCES.wiki.dir
  if (!existsSync(dir)) return 0
  let n = 0

  const insert = db.prepare(
    'INSERT INTO entity (kind, name, noun, source, props) VALUES (?, ?, ?, ?, ?)'
  )
  const doc = db.prepare('INSERT INTO doc (name, kind, source, body) VALUES (?, ?, ?, ?)')

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'state.json') continue
    const kind = basename(file, '.json').replace(/s$/, '')
    const rows = JSON.parse(readFileSync(join(dir, file), 'utf8'))

    for (const [title, props] of Object.entries(rows)) {
      // Titles arrive namespaced — "Weapon:a steel hauberk" — and the
      // namespace is noise once `kind` already carries it.
      const name = title.replace(/^[A-Za-z]+:/, '')
      const noun = props['Noun is'] ?? null
      insert.run(kind, name, noun, 'elanthipedia', JSON.stringify(props))
      doc.run(name, kind, 'elanthipedia', `${name} ${Object.entries(props).map(([k, v]) => `${k} ${v}`).join(' ')}`)
      n++
    }
  }
  return n
}

/**
 * Index Ruby sources by their method definitions.
 *
 * Not the whole file: what I actually need to answer is "where does mindstate
 * come from", and the answer is a method name and a path. Full text of 2.75 MB
 * of scripts would bury that.
 */
function indexCode(db, { dir, kind, label, ext, shallow }) {
  if (!existsSync(dir)) return 0
  const source = label
  let n = 0
  const insert = db.prepare(
    'INSERT INTO entity (kind, name, noun, source, props) VALUES (?, ?, ?, ?, ?)'
  )
  const doc = db.prepare('INSERT INTO doc (name, kind, source, body) VALUES (?, ?, ?, ?)')

  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) {
        if (!shallow) walk(full)
        continue
      }
      if (!ext.test(e.name)) continue
      if (statSync(full).size > 8_000_000) continue

      const text = readFileSync(full, 'utf8')

      // The header comment is the file's own description of itself, and for a
      // Lich script it is the single most useful paragraph about it.
      const header = text.match(/^=begin([\s\S]{0,1200}?)^=end/m)?.[1] ?? text.slice(0, 600)

      // Named things, across three languages. Ruby `def`, C# methods, and
      // Genie script labels — which are how a .cmd file is structured and are
      // the closest thing it has to function names.
      const methods = [
        ...[...text.matchAll(/^\s*def (?:self\.)?([a-z_][a-zA-Z0-9_?!]*)/gm)].map((m) => m[1]),
        ...[...text.matchAll(/(?:public|private|internal|protected)\s+[\w<>\[\],\s]+?\s(\w+)\s*\(/g)].map((m) => m[1]),
        ...[...text.matchAll(/^([A-Z][A-Z0-9_]{2,}):/gm)].map((m) => m[1]),
      ]

      const version = text.match(/^\s*#?\s*version:\s*([\w.]+)/mi)?.[1] ?? null

      insert.run(
        kind,
        basename(e.name).replace(/\.[a-z]+$/i, ''),
        null,
        source,
        JSON.stringify({ path: full, version, methods: methods.slice(0, 80), bytes: statSync(full).size })
      )
      // Index the body, not just the header.
      //
      // First version indexed the header comment and method names only, on the
      // reasoning that full text would bury the signal. Then "which script
      // deals with burden" returned nothing, because burden appears in
      // travel.cmd's logic and never in its description. The question I
      // actually need answered is "where in 3 MB of somebody else's code does
      // this idea live", and that requires the code.
      //
      // Capped per file so one 77,000-line script cannot dominate the index.
      doc.run(
        basename(e.name),
        kind,
        source,
        `${e.name} ${header} ${methods.join(' ')} ${text.slice(0, 400_000)}`
      )
      n++
    }
  }
  walk(dir)
  return n
}

function build() {
  if (existsSync(DB_PATH)) {
    // Rebuild from scratch rather than merging: the sources are the truth and
    // a stale row that no longer exists upstream is worse than a slower build.
    const db = open()
    db.exec('DROP TABLE IF EXISTS entity; DROP TABLE IF EXISTS doc; ')
    db.close()
  }
  const db = open()
  schema(db)

  // Every source in the table, so adding one is a table entry rather than a
  // code change — which is the difference between this growing and it not.
  for (const [name, src] of Object.entries(SOURCES)) {
    const n = name === 'wiki' ? indexWiki(db) : indexCode(db, src)
    console.log(`  ${name.padEnd(12)} ${n}`)
  }
  db.close()
}

// ----------------------------------------------------------------- queries --

function show(rows) {
  if (rows.length === 0) {
    console.log('  nothing found')
    return
  }
  for (const r of rows) {
    const props = r.props ? JSON.parse(r.props) : {}
    console.log(`\n  ${r.name}   [${r.kind} · ${r.source}]`)
    for (const [k, v] of Object.entries(props)) {
      if (v === '' || v === null || (Array.isArray(v) && v.length === 0)) continue
      const val = Array.isArray(v) ? v.slice(0, 6).join(', ') : String(v)
      console.log(`      ${k.padEnd(30)} ${val.slice(0, 120)}`)
    }
  }
}

function find(db, kind, term, limit = 6) {
  const like = `%${term}%`
  const sql = kind
    ? 'SELECT * FROM entity WHERE kind = ? AND (name LIKE ? OR noun LIKE ?) LIMIT ?'
    : 'SELECT * FROM entity WHERE name LIKE ? OR noun LIKE ? LIMIT ?'
  const args = kind ? [kind, like, like, limit] : [like, like, limit]
  return db.prepare(sql).all(...args)
}

function search(db, term, limit = 10) {
  // Quoted so a multi-word term is a phrase and punctuation does not become
  // FTS syntax, which is the usual way this blows up on a real question.
  return db
    .prepare('SELECT name, kind, source FROM doc WHERE doc MATCH ? LIMIT ?')
    .all(`"${term.replace(/"/g, '')}"`, limit)
}

const [, , cmd, ...rest] = process.argv
const term = rest.join(' ')

if (cmd === 'build') {
  build()
} else if (!existsSync(DB_PATH)) {
  console.log('No database yet. Run: node tools/kb.mjs build')
  process.exit(1)
} else {
  const db = open()

  switch (cmd) {
    case 'item':
      show(find(db, null, term).filter((r) => ['weapon', 'armor', 'material'].includes(r.kind)))
      break
    case 'noun': {
      const rows = db
        .prepare('SELECT * FROM entity WHERE noun = ? LIMIT 8')
        .all(term)
      show(rows)
      break
    }
    case 'creature':
      show(find(db, 'creature', term).concat(find(db, 'npc', term)))
      break
    case 'script':
      show(find(db, 'script', term))
      break
    case 'api':
      show(find(db, 'api', term))
      break
    case 'search':
      for (const r of search(db, term)) console.log(`  ${r.name.padEnd(40)} ${r.kind} · ${r.source}`)
      break
    case 'prop': {
      // Which property names exist about a subject, which is the question that
      // stops me inventing a property that returns nothing.
      const rows = db.prepare('SELECT props FROM entity WHERE kind IN (?,?,?) LIMIT 400')
        .all('weapon', 'armor', 'material')
      const names = new Set()
      for (const r of rows) {
        for (const k of Object.keys(JSON.parse(r.props ?? '{}'))) {
          if (k.toLowerCase().includes(term.toLowerCase())) names.add(k)
        }
      }
      ;[...names].sort().forEach((n) => console.log(`  ${n}`))
      if (names.size === 0) console.log('  no property matches')
      break
    }
    case 'note': {
      const [sub, ...body] = rest
      if (sub === 'add') {
        const text = body.join(' ')
        const [wrong, right] = text.split('->').map((s) => s.trim())
        db.prepare('INSERT INTO note (at, topic, wrong, right) VALUES (?, ?, ?, ?)')
          .run(new Date().toISOString(), (wrong ?? text).slice(0, 60), wrong ?? text, right ?? '')
        console.log('  recorded')
      } else {
        for (const n of db.prepare('SELECT * FROM note ORDER BY id DESC LIMIT 40').all()) {
          console.log(`\n  ${n.at.slice(0, 10)}  ${n.wrong}`)
          if (n.right) console.log(`              -> ${n.right}`)
        }
      }
      break
    }
    default: {
      const rows = db.prepare('SELECT kind, source, COUNT(*) n FROM entity GROUP BY kind, source ORDER BY n DESC').all()
      for (const r of rows) console.log(`  ${r.kind.padEnd(10)} ${String(r.source).padEnd(14)} ${r.n}`)
      const notes = db.prepare('SELECT COUNT(*) n FROM note').get()
      console.log(`  notes recorded: ${notes.n}`)
    }
  }
  db.close()
}
