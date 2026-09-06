/**
 * The player config panel: one tab per domain, the Genie import, and the
 * whole-store transfer.
 *
 * The shell, deliberately. Q1 owned the store, the schema, the migration and
 * the Genie import; Q2, Q3 and Q4 filled the seven tabs and Q6 added the
 * transfer section below them. Every tab used to name the increment that would
 * fill it rather than showing an empty form, so the gap was on screen rather
 * than only in a planning document; all seven have editors now, and the
 * placeholder line is each tab's one-sentence description.
 *
 * The transfer section is not an eighth tab on purpose. The tab strip is keyed
 * on `DOMAINS`, which is the denominator every check in
 * `tools/player-config-test.mjs` counts against, and a tab that is not a domain
 * would make "seven tabs" mean two things.
 *
 * Reachable as `?view=panel&id=config`, like every other dockable panel.
 */
import { useState, type ChangeEvent, type ReactElement } from 'react'
import {
  DOMAINS,
  loadPlayerConfig,
  mergeImported,
  playerConfigMigrations,
  resetPlayerConfigCache,
  savePlayerConfig,
  storageKeyFor,
  usePlayerConfig,
  type Domain,
} from '../../lib/playerConfig.ts'
import {
  GENIE_LEAF_ORDER,
  importGenieConfig,
  type GenieLeaf,
  type ImportReport,
} from '../../lib/playerConfigImport.ts'
import { invokeTauri, isTauri } from '../../lib/tauri.ts'
import { AliasesTab } from './AliasesTab.tsx'
import { HighlightsTab } from './HighlightsTab.tsx'
import { MacrosTab } from './MacrosTab.tsx'
import { PresetsTab } from './PresetsTab.tsx'
import { VariablesTab } from './VariablesTab.tsx'
import { SubstitutesTab } from './SubstitutesTab.tsx'
import { GagsTab } from './GagsTab.tsx'
import { ExportImportTab } from './ExportImportTab.tsx'

const TAB_LABEL: Record<Domain, string> = {
  presets: 'Presets',
  highlights: 'Highlights',
  aliases: 'Aliases',
  macros: 'Macros',
  substitutes: 'Substitutes',
  gags: 'Gags',
  variables: 'Variables',
}

/** What each tab will hold, and which increment builds it. Named on screen so
 *  a missing editor reads as unbuilt rather than as broken. A tab whose editor
 *  exists keeps its line as the tab's one-sentence description; `TAB_EDITOR`
 *  below is what decides whether a tab is a form or a promise. */
const TAB_PLACEHOLDER: Record<Domain, string> = {
  presets: 'Colour presets a highlight can name.',
  highlights: 'Colour and sound rules for game text.',
  aliases: 'Short words that expand into commands.',
  macros: 'Keys that send a list of commands.',
  substitutes:
    'Text rewritten before a line is shown. The line is kept as the game sent it, so this changes what you read and not what is recorded.',
  gags: 'Lines hidden from the game pane. The line is still there: it stays in the buffer and in anything you export, and the switch below puts it back on screen.',
  variables: 'Values an alias or a macro can use as $name.',
}

/**
 * The tabs that have an editor, and what it is.
 *
 * A record rather than a switch in the body, so "which tabs are built" is one
 * readable line and a tab that is still a placeholder is visibly absent from
 * it rather than being the default branch of something.
 */
const TAB_EDITOR: Partial<Record<Domain, () => ReactElement>> = {
  presets: PresetsTab,
  highlights: HighlightsTab,
  aliases: AliasesTab,
  macros: MacrosTab,
  variables: VariablesTab,
  substitutes: SubstitutesTab,
  gags: GagsTab,
}

interface Loaded {
  files: Partial<Record<GenieLeaf, string>>
  from: string
}

export function PlayerConfigPanel() {
  const config = usePlayerConfig()
  const [tab, setTab] = useState<Domain>('highlights')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Not memoised on `config`: every read is served from the store's own cache,
  // and a memo keyed on a value this component already re-renders for is a
  // second cache that can disagree with the first.
  const migrations = playerConfigMigrations()
  const Editor = TAB_EDITOR[tab]

  const runImport = (loaded: Loaded) => {
    const { config: imported, report: next } = importGenieConfig(loaded.files)
    setReport(next)
    if (next.refused) {
      setApplied(null)
      return
    }
    // `keep-mine`: a second Genie import must not overwrite rules the player
    // has edited here since the first one. The config document's own import
    // uses `update`, which is a different question answered by the same merge.
    const { config: merged, report: merge } = mergeImported(loadPlayerConfig(), imported, 'keep-mine')
    const write = savePlayerConfig(merged)
    resetPlayerConfigCache()
    const added = DOMAINS.reduce((n, d) => n + merge.added[d], 0)
    const duplicates = DOMAINS.reduce((n, d) => n + merge.unchanged[d], 0)
    setApplied(
      write.ok
        ? `Added ${added} rules from ${loaded.from}. ${duplicates} were already here and were left alone.`
        : `Could not save: ${write.failures.map((f) => `${f.domain} (${f.message})`).join(', ')}`
    )
  }

  const importFromInstall = async () => {
    setBusy(true)
    try {
      const files: Partial<Record<GenieLeaf, string>> = {}
      for (const leaf of GENIE_LEAF_ORDER) {
        const cfg = (await invokeTauri('read_genie_config', { leaf })) as {
          found: boolean
          text: string
          note: string
        }
        if (cfg.found) files[leaf] = cfg.text
      }
      runImport({ files, from: 'your Genie install' })
    } catch (e) {
      setApplied(String(e))
    } finally {
      setBusy(false)
    }
  }

  const importFromFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])]
    if (picked.length === 0) return
    setBusy(true)
    try {
      const files: Partial<Record<GenieLeaf, string>> = {}
      for (const file of picked) {
        const leaf = GENIE_LEAF_ORDER.find((l) => l === file.name)
        if (leaf) files[leaf] = await file.text()
      }
      runImport({ files, from: `${picked.length} files you picked` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-sm" data-testid="player-config-panel">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Player config">
        {DOMAINS.map((domain) => (
          <button
            key={domain}
            type="button"
            role="tab"
            aria-selected={tab === domain}
            data-testid={`config-tab-${domain}`}
            onClick={() => setTab(domain)}
            className={
              'rounded border px-2 py-1 text-xs ' +
              (tab === domain
                ? 'border-accent text-accent'
                : 'border-border text-ink-muted hover:text-ink')
            }
          >
            {TAB_LABEL[domain]} ({config[domain].length})
          </button>
        ))}
      </div>

      <div
        className="flex min-h-0 flex-col overflow-y-auto rounded border border-border p-2"
        data-testid={`config-body-${tab}`}
      >
        <p className="text-ink-muted">{TAB_PLACEHOLDER[tab]}</p>
        {Editor && <Editor />}
        <p className="mt-1 text-xs text-ink-faint">
          {config[tab].length} stored in <code>{storageKeyFor(tab)}</code>. Read:{' '}
          {migrations[tab].status}
          {migrations[tab].migrated ? `, ${migrations[tab].migrated} migrated` : ''}
          {migrations[tab].dropped.length ? `, ${migrations[tab].dropped.length} unreadable` : ''}.
        </p>
        {migrations[tab].why && (
          <p className="mt-1 text-xs text-warn" data-testid="config-refused">
            {migrations[tab].why}
          </p>
        )}
      </div>

      <div className="rounded border border-border p-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Import from Genie
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          Reads your Genie config files once and copies the rules in here. Nothing is written back
          to Genie, and a rule that is already here is left alone.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isTauri() && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void importFromInstall()}
              data-testid="config-import-install"
              className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
            >
              Import from my Genie install
            </button>
          )}
          <label className="text-xs text-ink-muted">
            <span className="mr-2">Or pick the cfg files:</span>
            <input
              type="file"
              multiple
              accept=".cfg"
              data-testid="config-import-files"
              onChange={(e) => void importFromFiles(e)}
            />
          </label>
        </div>

        {applied && (
          <p className="mt-2 text-xs text-ink" data-testid="config-import-applied">
            {applied}
          </p>
        )}

        {report && (
          <div className="mt-2" data-testid="config-import-report">
            {report.refused && (
              <p className="text-xs text-warn" data-testid="config-import-refused">
                {report.refused}
              </p>
            )}
            <table className="mt-1 w-full text-xs">
              <thead className="text-ink-faint">
                <tr>
                  <th className="text-left">File</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">Parsed</th>
                  <th className="text-right">Imported</th>
                  <th className="text-right">Skipped</th>
                </tr>
              </thead>
              <tbody>
                {report.perFile.map((f) => (
                  <tr key={f.leaf} data-testid={`config-import-row-${f.leaf}`}>
                    <td className="text-left">{f.leaf}</td>
                    <td className="text-right">{f.found ? f.lines : 'not found'}</td>
                    <td className="text-right">{f.found ? f.parsed : '-'}</td>
                    <td className="text-right">{f.found ? f.imported : '-'}</td>
                    <td className="text-right">{f.found ? f.skipped.length : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.perFile.some((f) => f.skipped.length > 0) && (
              <ul className="mt-1 list-disc pl-4 text-xs text-warn">
                {report.perFile.flatMap((f) =>
                  f.skipped.map((s) => <li key={`${f.leaf}-${s}`}>{`${f.leaf}: ${s}`}</li>)
                )}
              </ul>
            )}
            <h4 className="mt-2 text-xs font-semibold text-ink-faint">What did not come across</h4>
            <ul className="list-disc pl-4 text-xs text-ink-muted" data-testid="config-unsupported">
              {report.unsupported.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ExportImportTab config={config} />
    </div>
  )
}
