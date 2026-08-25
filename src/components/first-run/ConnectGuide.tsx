/**
 * Connecting Genie to Lich, which is the step people actually lose days to.
 *
 * From the Lich help channel:
 *
 *     "Is there anyone that can walk me through installing lich for genie? Im
 *      seeing everything pointing to wrayth and stormfront but when I try
 *      following that install instructions I only got it to login with
 *      stormfront not genie. Ive been at this for 2 days and I really want to
 *      come back to play again"
 *
 *     "You can't launch genie with the lich launcher"
 *
 *     "Lich is installed separately, and then Genie connects to it through the
 *      port Lich opens."
 *
 * Detecting that both are installed and then saying nothing leaves someone at
 * exactly that cliff. The port and the launch arguments differ per instance,
 * which is the part that is easy to get wrong and hard to diagnose, so this
 * asks which instance and gives the exact lines to paste.
 *
 * Values from the Genie 4 wiki, "Connecting and Profiles".
 */
import { useState } from 'react'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'
import type { GameInstance } from '../../types'

interface InstanceConfig {
  id: GameInstance
  label: string
  port: number
  args: string
  suffix: string
}

const INSTANCES: InstanceConfig[] = [
  {
    id: 'Prime',
    label: 'Prime',
    port: 11024,
    args: '--genie --dragonrealms',
    suffix: 'DR',
  },
  {
    id: 'Platinum',
    label: 'Platinum',
    port: 11124,
    args: '--genie --platinum --dragonrealms',
    suffix: 'DRX',
  },
  {
    id: 'Fallen',
    label: 'The Fallen',
    port: 11324,
    args: '--genie --fallen',
    suffix: 'DRF',
  },
  {
    id: 'Test',
    label: 'Test',
    port: 11624,
    args: '--genie --test --dragonrealms',
    suffix: 'DRT',
  },
]

function Line({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      <code className="flex-1 text-[10px] font-mono bg-surface border border-border rounded-md px-2 py-1.5 text-ink-muted overflow-x-auto whitespace-nowrap">
        {text}
      </code>
      <button
        type="button"
        className="shrink-0 text-[10px] flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-ink-faint hover:text-ink"
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
        {copied ? <Check className="w-3 h-3 text-good" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  )
}

export function ConnectGuide() {
  const [instance, setInstance] = useState<GameInstance>('Prime')
  const cfg = INSTANCES.find((i) => i.id === instance) ?? INSTANCES[0]!

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-accent shrink-0" />
        <h2 className="font-medium text-ink">Connect Genie to Lich</h2>
      </div>

      <p className="text-xs text-ink-muted leading-snug">
        Lich does not launch Genie, and Genie does not install Lich. They are
        separate, and Genie connects to a port Lich opens. This is the step
        people lose days to, so here are the exact lines. Type them into Genie.
      </p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">Which instance?</span>
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
        <div className="space-y-1">
          <p className="text-[11px] text-ink-muted">
            1. Check what Genie currently thinks:
          </p>
          <Line text="#lichsettings" />
        </div>

        {instance !== 'Prime' && (
          <div className="space-y-1">
            <p className="text-[11px] text-ink-muted">
              2. {cfg.label} uses a different port and different launch
              arguments. Prime is the default, so these need setting:
            </p>
            <Line text={`#config lichport ${cfg.port}`} />
            <Line text={`#config licharguments ${cfg.args}`} />
            <Line text="#config save" />
          </div>
        )}

        {instance === 'Prime' && (
          <p className="text-[11px] text-ink-faint leading-snug">
            2. Prime is the default, so port {cfg.port} and{' '}
            <code className="text-ink-muted">{cfg.args}</code> should already be
            set. If <code className="text-ink-muted">#lichsettings</code>{' '}
            disagrees, set them with{' '}
            <code className="text-ink-muted">#config lichport</code> and{' '}
            <code className="text-ink-muted">#config licharguments</code>, then{' '}
            <code className="text-ink-muted">#config save</code>.
          </p>
        )}

        <div className="space-y-1">
          <p className="text-[11px] text-ink-muted">
            3. Connect, using a profile you have already saved for that
            character:
          </p>
          <Line text={`#lichconnect YourCharacter${cfg.suffix}`} />
        </div>
      </div>

      <div className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 space-y-1">
        <p className="text-[11px] text-warn leading-snug">
          On Genie 5 these commands may not exist yet. It is still in beta and
          the documentation describes Genie 4. If{' '}
          <code>#lichsettings</code> comes back as an unknown command, that is
          why, and Genie 4 is the smoother route for now.
        </p>
      </div>

      <a
        href="https://github.com/GenieClient/Genie4/wiki/02.-Connecting-and-Profiles#lich-connect"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
      >
        <ExternalLink className="w-3 h-3" />
        The Genie wiki page this comes from
      </a>
    </div>
  )
}
