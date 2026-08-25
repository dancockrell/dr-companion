/**
 * Turning "that broke" into a report, without making the tester do the work.
 *
 * The friction we are removing: copy the console, open pastebin, paste, copy
 * the link, find the Discord channel, explain the context from memory. People
 * do that once and then stop reporting, which is how a project stops learning
 * from the only testers it has.
 *
 * The design constraints, in order:
 *
 * 1. **Nothing leaves without being seen.** The preview shows the exact text
 *    that will be submitted. No hidden fields, no silent upload, no telemetry.
 *    A report is a thing the user sends, not a thing we collect.
 *
 * 2. **Scope the capture, do not vacuum the stream.** DragonRealms text
 *    contains tells, ESP thoughts, whispers and other players' names. We
 *    capture our own commands and the replies to them, which is what actually
 *    fixes a pattern, rather than everything the game said for five minutes.
 *
 * 3. **Scrub what still slips through.** Even scoped capture can catch a tell
 *    that arrived mid-command. Known private-channel shapes are redacted
 *    before the preview, not after, so the user never has to spot them.
 *
 * 4. **Two clicks, not seven.** Button, glance at the preview, submit.
 */

import type { CharacterStatus, LogRow, TraceRow } from '../types'
import type { VersionState } from './versions'

/**
 * Lines that are somebody's private conversation rather than our business.
 *
 * These are the shapes DragonRealms uses for directed and channel speech. A
 * miss here means someone's tell ends up in a public issue, so the patterns
 * are deliberately broad: over-redacting costs a little context, under-
 * redacting costs someone's privacy.
 */
const PRIVATE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\byou hear the faint thoughts of\b/i, label: 'ESP thought' },
  { re: /\bthinks? to you\b/i, label: 'ESP thought' },
  { re: /\bwhispers?\b/i, label: 'whisper' },
  { re: /\btells you\b/i, label: 'tell' },
  { re: /\byou tell\b/i, label: 'tell' },
  { re: /\byou whisper\b/i, label: 'whisper' },
  { re: /\bsends? you\b/i, label: 'directed message' },
  { re: /\[(?:general|trade|newbie|ooc|guild|group)\]/i, label: 'channel' },
  { re: /\byou say to\b/i, label: 'directed speech' },
]

export interface ScrubResult {
  text: string
  /** What was removed, so the preview can say so rather than hiding it. */
  removed: string[]
}

/**
 * Redact private speech, and optionally other players' names.
 *
 * Returns what it removed so the UI can tell the user. Silently scrubbing
 * would be its own kind of dishonesty: they should know the report is
 * incomplete and why.
 */
export function scrub(
  lines: string[],
  opts?: { otherPlayers?: string[]; redactNames?: boolean }
): ScrubResult {
  const removed: string[] = []
  const names = (opts?.otherPlayers ?? []).filter((n) => n.length > 2)

  const text = lines
    .map((line) => {
      for (const { re, label } of PRIVATE_PATTERNS) {
        if (re.test(line)) {
          removed.push(label)
          return `[redacted: ${label}]`
        }
      }
      if (opts?.redactNames && names.length > 0) {
        let out = line
        for (const n of names) {
          const nameRe = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
          if (nameRe.test(out)) {
            out = out.replace(nameRe, '[player]')
            removed.push('player name')
          }
        }
        return out
      }
      return line
    })
    .join('\n')

  return { text, removed: [...new Set(removed)] }
}

export interface ReportInput {
  /** What the user says went wrong. Optional: a report with no words still helps. */
  description: string
  character: CharacterStatus | null
  trace: TraceRow[]
  logLines: LogRow[]
  bridgeMode: 'mock' | 'live'
  appVersion: string
  /**
   * Versions of everything. First on the list because "what version are you
   * on" is the first question every support thread in this ecosystem asks,
   * usually twice.
   */
  versions?: VersionState
  /** Minutes of history to include. */
  windowMinutes: number
  redactNames: boolean
}

export interface BuiltReport {
  title: string
  body: string
  /** Everything, for the local file. The body may be trimmed to fit a URL. */
  full: string
  removed: string[]
  /** Rows that looked like failures, which is what we lead the report with. */
  problems: TraceRow[]
}

const PROBLEM_KINDS = new Set(['no_match', 'refused', 'gave_up', 'error'])

/** GitHub rejects very long URLs. Keep the prefilled body well under it. */
const MAX_BODY = 5500

function recent<T extends { at: string }>(rows: T[], minutes: number): T[] {
  // `at` is a wall-clock string, so compare against the same format rather
  // than parsing: this only needs to be roughly right, and a bad parse
  // silently dropping everything would be worse than including too much.
  const cutoff = new Date(Date.now() - minutes * 60_000)
  const hh = cutoff.getHours()
  const mm = cutoff.getMinutes()
  return rows.filter((r) => {
    const m = /(\d{1,2}):(\d{2})/.exec(r.at)
    if (!m) return true
    const h = Number(m[1])
    const min = Number(m[2])
    if (Number.isNaN(h) || Number.isNaN(min)) return true
    // Same hour: compare minutes. Different hour: assume within the window.
    if (h === hh) return min >= mm
    return true
  })
}

export function buildReport(input: ReportInput): BuiltReport {
  const trace = recent(input.trace, input.windowMinutes)
  const logs = recent(input.logLines, input.windowMinutes)
  const problems = trace.filter((t) => PROBLEM_KINDS.has(t.kind))

  const c = input.character
  const others = c?.roomPlayers ?? []

  // Interleave by arrival sequence, not by concatenating the two sources.
  // A report where every log line precedes every trace row reads as though
  // the failure happened before the thing that caused it, which is worse than
  // no report at all.
  const merged = [
    ...trace.map((t, i) => ({
      seq: t.seq ?? i,
      text: `${t.at}  ${t.kind.padEnd(8)} ${t.detail}`,
    })),
    ...logs.map((l) => ({ seq: l.seq, text: `${l.at}  ${l.text}` })),
  ]
    .sort((a, b) => a.seq - b.seq)
    .map((r) => r.text)

  const scrubbed = scrub(merged, {
    otherPlayers: others,
    redactNames: input.redactNames,
  })

  // Lead with the failures. Whoever reads this should not have to search.
  const problemSummary =
    problems.length > 0
      ? problems
          .slice(-8)
          .map((p) => `- \`${p.kind}\` ${p.detail}`)
          .join('\n')
      : '_No failed matches recorded. The problem may be elsewhere._'

  // Versions first, and the mismatch called out in capitals, because "what
  // version are you on" is the first question every support thread in this
  // ecosystem asks, and often the second one too.
  const v = input.versions
  const mismatch =
    v?.actualBridge && v.actualBridge !== v.expectedBridge
      ? ` **MISMATCH — this app ships v${v.expectedBridge}**`
      : ''

  const env = [
    `- App: ${input.appVersion}`,
    `- Bridge script: ${v?.actualBridge ?? 'not connected'}${mismatch}`,
    `- Lich: ${v?.lich ?? 'unknown'}`,
    `- Protocol: ${v?.protocol ?? 'unknown'}`,
    `- Bridge mode: ${input.bridgeMode}`,
    c ? `- Instance: ${c.instance}` : '- Instance: unknown',
    c ? `- Account tier: ${c.accountTier}` : '',
    c ? `- Guild: ${c.guild ?? 'unknown'}` : '',
    c ? `- Circle: ${c.circle ?? 'unknown'}` : '',
    c ? `- Situation: ${c.situation.join(', ') || 'none'}` : '',
    c ? `- Location: ${c.location.title}` : '',
    c?.skills ? `- Skills reported: ${c.skills.length}` : '- Skills reported: none',
  ]
    .filter(Boolean)
    .join('\n')

  const redactionNote =
    scrubbed.removed.length > 0
      ? `\n> Redacted before sending: ${scrubbed.removed.join(', ')}.\n`
      : ''

  const header = [
    '### What went wrong',
    '',
    input.description.trim() || '_(no description given)_',
    '',
    '### Failures in the trace',
    '',
    problemSummary,
    '',
    '### Environment',
    '',
    env,
    redactionNote,
    '### Trace',
    '',
  ].join('\n')

  const full = `${header}\`\`\`\n${scrubbed.text}\n\`\`\`\n`

  // Trim from the front of the trace, not the back: the end is where the
  // failure is.
  let body = full
  if (body.length > MAX_BODY) {
    const keep = MAX_BODY - header.length - 120
    const tail = scrubbed.text.slice(-Math.max(keep, 500))
    body =
      `${header}\`\`\`\n[earlier lines trimmed to fit; the full report was saved locally]\n${tail}\n\`\`\`\n`
  }

  const lead = problems.at(-1)
  const title = lead
    ? `${lead.kind}: ${lead.detail.slice(0, 60)}`
    : input.description.slice(0, 60) || 'Problem report'

  return { title, body, full, removed: scrubbed.removed, problems }
}

const REPO = 'dancockrell/dr-companion'

/**
 * A prefilled GitHub issue, which the user reviews and submits themselves.
 *
 * No token, no account of ours, nothing posted on their behalf. They see the
 * issue form with everything filled in and press the button, or do not.
 */
export function issueUrl(report: BuiltReport): string {
  const params = new URLSearchParams({
    title: report.title,
    body: report.body,
    labels: 'bug,from-app',
  })
  return `https://github.com/${REPO}/issues/new?${params.toString()}`
}
