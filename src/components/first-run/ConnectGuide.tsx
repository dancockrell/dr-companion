/**
 * Getting your frontend talking to Lich, for anybody who wants to keep using
 * their own window alongside this app.
 *
 * # What this page used to be, and why half of it is gone
 *
 * Most of it was a walkthrough for one particular frontend: four config
 * commands typed into that program, a connect command, and a warning that the
 * route it described left this app's channel tabs empty. It existed because
 * that program was how the app got a logged-in Lich to read.
 *
 * It is not any more. The app signs in itself
 * (`src/components/shared/SignIn.tsx`) and starts Lich with the result, so
 * instructions for configuring another program to do this app's job point
 * somewhere nobody needs to go. Dan gave the instruction on 6 September 2026;
 * `docs/LICH_NATIVE_LOGIN.md` quotes it in full and carries the design.
 *
 * What is left is the case this page was always right about: you start Lich and
 * it brings your frontend up for you. That is one command, and it is the same
 * shape for every frontend that has a flag.
 */
import { useState } from 'react'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore.ts'
import { FRONTENDS, frontendById, bridgeCommand } from '../../lib/frontends.ts'
import type { GameInstance } from '../../types'
import { INSTANCES } from '../../data/instances.ts'


function Line({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      {/* `min-w-0` is doing real work here, and its absence was visible.
       *
       * A flex item defaults to `min-width: auto`, which means it will not
       * shrink below its own content. These lines are `whitespace-nowrap`
       * commands carrying a Windows path - the launch line this page still
       * renders, `ruby C:\Ruby4Lich5\Lich5\lich.rbw --dragonrealms` - so
       * their content width is fixed and large, the `overflow-x-auto` beside
       * it never got a chance to engage, and the floor propagated all the way
       * out to the column.
       *
       * Measured: the whole connect column wanted 339px however narrow the
       * window got. At 1180x820 it was given 281 and at 1000x700 it was given
       * 221, so sentences in the surrounding prose were cut off mid-word with
       * a horizontal scrollbar under them. Nothing about the layout code
       * looked wrong; it was only visible in a render.
       */}
      <code className="min-w-0 flex-1 text-xs font-mono bg-surface border border-border rounded-md px-2 py-1.5 text-ink-muted overflow-x-auto whitespace-nowrap">
        {text}
      </code>
      <button
        type="button"
        aria-label={copied ? 'Command copied' : 'Copy command'}
        title={copied ? 'Command copied' : 'Copy command'}
        className="shrink-0 text-xs flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-ink-faint hover:text-ink"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          } catch {
            // Clipboard refused. The text is on screen either way.
          }
        }}
      >
        {copied ? <Check aria-hidden="true" className="w-3 h-3 text-good" /> : <Copy aria-hidden="true" className="w-3 h-3" />}
      </button>
    </div>
  )
}

export function ConnectGuide({ lichPath }: { lichPath?: string | null }) {
  const frontend = useAppStore((s) => s.frontend)
  const setFrontend = useAppStore((s) => s.setFrontend)
  const [instance, setInstance] = useState<GameInstance>('Prime')

  const cfg = INSTANCES.find((i) => i.id === instance) ?? INSTANCES[0]!
  const fe = frontendById(frontend)

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-accent shrink-0" />
        <h2 className="font-medium text-ink">Connect your frontend to Lich</h2>
      </div>

      <p className="text-xs text-ink-muted leading-snug">
        This app is a panel for Lich, and Lich works with whichever frontend you
        already use. Getting the two introduced is the part people get stuck on,
        because it works in opposite directions depending on which one you have.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-ink-muted">Frontend</span>
        <select
          className="text-xs bg-surface-overlay border border-border rounded-lg px-2 py-1 text-ink"
          value={frontend}
          onChange={(e) => setFrontend(e.target.value)}
        >
          {FRONTENDS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>

        <span className="text-xs text-ink-muted">Instance</span>
        <select
          className="text-xs bg-surface-overlay border border-border rounded-lg px-2 py-1 text-ink"
          value={instance}
          onChange={(e) => setInstance(e.target.value as GameInstance)}
        >
          {INSTANCES.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-ink-muted leading-snug">
          You start Lich and it brings {fe.label} up for you.
        </p>
        {/* The detected path rather than a generic `lich.rbw`, when this app
          * has found one: a wrong path here is the commonest cause of a
          * connect-retry loop and the error does not say so. */}
        <Line
          text={`ruby ${lichPath ?? 'lich.rbw'} ${cfg.lichArgs}${fe.lichFlag ? ` ${fe.lichFlag}` : ''}`}
        />
        {lichPath && (
          <p className="text-xs text-good leading-snug">
            That is where this app found Lich on your machine.
          </p>
        )}
        {!fe.lichFlag && (
          <p className="text-xs text-ink-faint leading-snug">
            We do not have a confirmed Lich flag for {fe.label}. Check its own
            documentation for the flag, or point it at port {cfg.port}, which is
            the port Lich opens for this app.
          </p>
        )}
        <p className="text-xs text-ink-faint leading-snug">
          None of this is needed to use this app on its own. Sign in on the main
          screen and it starts Lich for you, with no other program involved.
        </p>
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
        <p className="text-xs text-ink-muted leading-snug">
          Then start the bridge in game with{' '}
          <code className="text-accent">{bridgeCommand(frontend)}</code> and
          switch this app to Live Lich in Settings.
        </p>
      </div>

      <a
        href="https://elanthipedia.play.net/Lich_scripting_engine"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-info hover:underline"
      >
        <ExternalLink className="w-3 h-3" />
        Lich on Elanthipedia
      </a>
    </div>
  )
}
