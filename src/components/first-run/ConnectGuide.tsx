/**
 * Getting your frontend talking to Lich, which is the step people lose days to.
 *
 * From the Lich help channel:
 *
 *     "Is there anyone that can walk me through installing lich for genie? Im
 *      seeing everything pointing to wrayth and stormfront but when I try
 *      following that install instructions I only got it to login with
 *      stormfront not genie. Ive been at this for 2 days"
 *
 *     "You can't launch genie with the lich launcher"
 *
 * That second line is the whole confusion, and it explains the first. For most
 * frontends you launch Lich and Lich brings the frontend up. For Genie you do
 * the opposite: Genie launches, and you point it at the port Lich opened. Any
 * guide written for one looks broken if you are using the other.
 *
 * Values from the Genie 4 wiki, "Connecting and Profiles".
 */
import { useState } from 'react'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { FRONTENDS, frontendById, bridgeCommand } from '../../lib/frontends'
import type { GameInstance } from '../../types'
import { INSTANCES } from '../../data/instances'


function Line({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      {/* `min-w-0` is doing real work here, and its absence was visible.
       *
       * A flex item defaults to `min-width: auto`, which means it will not
       * shrink below its own content. These lines are `whitespace-nowrap`
       * Windows paths - `#config lichpath C:\Ruby4Lich5\Lich5\lich.rbw` - so
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
  const isGenie = fe.id === 'genie'

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

      {isGenie ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted leading-snug">
            Genie is the exception: the Lich launcher will not start it. Instead
            Genie connects to a port Lich opens, and you set that up inside
            Genie.
          </p>

          <div className="space-y-1">
            <p className="text-xs text-ink-muted">
              1. See what Genie currently thinks:
            </p>
            <Line text="#lichsettings" />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-ink-muted">
              2. Point it at your actual lich.rbw. A wrong path here is a
              common cause of the connect-retry loop, and the error does not
              say so:
            </p>
            <Line
              text={`#config lichpath ${lichPath ?? 'C:\\Ruby4Lich5\\Lich5\\lich.rbw'}`}
            />
            {lichPath && (
              <p className="text-xs text-good leading-snug">
                That is where this app found Lich on your machine.
              </p>
            )}
          </div>

          {instance === 'Prime' ? (
            <p className="text-xs text-ink-faint leading-snug">
              3. Prime is the default, so port {cfg.port} and{' '}
              <code className="text-ink-muted">{cfg.genieArgs}</code> should
              already be set. Only change them if the above disagrees.
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">
                3. {cfg.label} needs a different port and different arguments.
                This is the part that is easy to get wrong and gives no useful
                error:
              </p>
              <Line text={`#config lichport ${cfg.port}`} />
              <Line text={`#config licharguments ${cfg.genieArgs}`} />
              <Line text="#config save" />
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs text-ink-muted">
              4. Connect, using a profile you have already saved:
            </p>
            <Line text={`#lichconnect YourCharacter${cfg.suffix}`} />
          </div>

          {/* Genie's own config always carries --genie, which is the correct
            * flag for Genie and the wrong one for this app's channel tabs -
            * see the same note in Dashboard.tsx. Not repeated per game
            * variant above; the limitation is about the flag, not the game. */}
          <p className="text-xs text-warn leading-snug">
            This keeps Genie as your window. The channel tabs in this app stay
            empty either way, because Lich only sends the game's channel
            labels to a frontend that asks for them, and{' '}
            <code className="text-ink-muted">--genie</code> does not. Use "Open
            Lich to sign in" on the dashboard instead if you want those.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted leading-snug">
            For {fe.label} it works the other way round from Genie: you start
            Lich and it brings the frontend up for you.
          </p>
          <Line
            text={`ruby lich.rbw ${cfg.lichArgs}${fe.lichFlag ? ` ${fe.lichFlag}` : ''}`}
          />
          {!fe.lichFlag && (
            <p className="text-xs text-ink-faint leading-snug">
              We do not have a confirmed Lich flag for {fe.label}. Check its own
              documentation for the flag, or connect it to port {cfg.port} the
              way Genie does.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
        <p className="text-xs text-ink-muted leading-snug">
          Then start the bridge in game with{' '}
          <code className="text-accent">{bridgeCommand(frontend)}</code>
          {isGenie ? (
            <>
              {' '}
              — note the comma. Genie starts Lich scripts with a comma; every
              other frontend uses a semicolon.
            </>
          ) : (
            <> and switch this app to Live Lich in Settings.</>
          )}
        </p>
      </div>

      {isGenie && (
        <p className="text-xs text-warn leading-snug">
          On Genie 5 these commands may not exist yet: it is still in beta and
          the guides describe Genie 4. If <code>#lichsettings</code> comes back
          as an unknown command, that is why.
        </p>
      )}

      <a
        href={
          isGenie
            ? 'https://github.com/GenieClient/Genie4/wiki/02.-Connecting-and-Profiles#lich-connect'
            : 'https://elanthipedia.play.net/Lich_scripting_engine'
        }
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-info hover:underline"
      >
        <ExternalLink className="w-3 h-3" />
        {isGenie ? 'The Genie wiki page this comes from' : 'Lich on Elanthipedia'}
      </a>
    </div>
  )
}
