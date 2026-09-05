/**
 * The one boundary a model is allowed to sit behind.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 13.4: "typed input/output,
 * cancellation, timeout, health, and capability reporting. No command access."
 *
 * # No model ships here, and that is the point
 *
 * The only implementation in this file is `absentProvider`, which never
 * pretends to answer. That is the honest default state of the app: nothing is
 * installed, the client works perfectly well, and the UI can say so.
 *
 * A scripted provider that returned plausible sentences would be worse than
 * nothing. It would pass every scheduling test, look like progress, and the
 * first person to trust one of its answers would be trusting a fixture. So the
 * deterministic provider used to prove the scheduling lives in the test files
 * only, where it cannot be imported by the app.
 *
 * # No command access, structurally
 *
 * This module imports nothing from `gameActions.ts`, `gameCommand.ts` or
 * `gameLink.ts`, and neither does `aiWorker.ts`. A model result is a string
 * and a token count. There is no function here that could send anything to
 * the game even if a caller wanted it to - section 2's "one command path" is
 * enforced by there being no second path to write, not by a rule asking
 * everyone to be careful.
 *
 * # Every failure is a value, never a throw
 *
 * Absence, timeout, cancellation, invalid output and out-of-memory are all
 * ordinary results. "Model failure, absence, timeout, and out-of-memory state
 * are visible and do not impair ordinary client use" is an acceptance
 * criterion (section 14), and a rejected promise crossing into the client's
 * render path is exactly how that gets broken.
 */

/** Why a generation did not produce usable output. Each is distinct because
 * each sends a person somewhere different: absent means install one, timeout
 * means the budget was too small or the machine too slow, out_of_memory means
 * the profile is too large for this GPU. */
export type ProviderFailure =
  | 'absent'
  | 'timeout'
  | 'cancelled'
  | 'invalid_output'
  | 'out_of_memory'
  /** The prompt carried something that matches a credential, so the call was
   * refused before it left this process. A working gate, not a broken model,
   * and named separately so it does not read as one. */
  | 'privacy_gate'
  | 'error'

/**
 * One sentence per failure kind, written for the person looking at the panel.
 *
 * Section 14 requires that "model failure, absence, timeout, and
 * out-of-memory state are visible", and visible is not the same as present: a
 * single "the model failed" covering all seven leaves somebody with no idea
 * whether to install something, buy a smaller model, or wait. Each sentence
 * below names a different next action, which is the test - if two of them
 * would send the same person to do the same thing, one of them is wrong.
 *
 * Exhaustive by type rather than by a default branch. A new
 * `ProviderFailure` must fail to compile here rather than quietly inherit
 * somebody else's sentence.
 */
const FAILURE_SENTENCES: Record<ProviderFailure, string> = {
  absent: 'No model server answered. Check that yours is running.',
  timeout: 'The model did not answer in time. It may be too large for this machine.',
  cancelled: 'The last review was interrupted. Nothing was lost.',
  invalid_output: 'The model answered, but not in the form this asks for.',
  out_of_memory: 'The model ran out of memory. Try a smaller profile.',
  privacy_gate: 'Sensitive input withheld: the review was refused before it reached the model.',
  error: 'The model server returned an error.',
}

export function failureSentence(kind: ProviderFailure): string {
  return FAILURE_SENTENCES[kind]
}

/** The kinds, for a test that wants to walk all of them rather than a list
 * somebody has to remember to update. */
export const PROVIDER_FAILURE_KINDS = Object.keys(FAILURE_SENTENCES) as ProviderFailure[]

export interface ModelHealth {
  available: boolean
  /** Why not, when unavailable. Shown to a person, so it names the next step
   * rather than the internal condition. */
  reason?: string
  /**
   * What is loaded, reported rather than required. The reference profile is
   * Qwen3 4B Instruct in non-thinking mode at 4-bit, but nothing in this
   * interface is Qwen-shaped: a provider reports whatever it actually is.
   */
  profile?: string
  maxContextTokens?: number
}

/**
 * A request. Split into a stable prefix and a changing suffix on purpose -
 * section 5 wants provider-supported prefix caching, and that only works if
 * the unchanging part is actually unchanging.
 */
export interface ModelRequest {
  /** Stable across calls: role, rules, tool schemas. Cacheable. */
  instructions: string
  /** The compact changing part: current state and recent delta. */
  state: string
  /** Exactly what this call may ask for. An empty list is legitimate. */
  allowedTools: string[]
  budget: { maxTokens: number; maxSeconds: number }
}

export type ModelResult =
  | { ok: true; text: string; tokens: number }
  | { ok: false; failure: ProviderFailure; message: string }

export interface ModelProvider {
  /** Cheap, synchronous, safe to call on every render. */
  describe(): ModelHealth
  /**
   * Generate. Must resolve rather than reject: a provider that throws is a
   * provider that can take the client down with it.
   */
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>
}

/**
 * The default when no model is installed.
 *
 * Not a stub standing in for future work - this is the correct, permanent
 * behaviour of a client with no local model, and most installs will use it.
 */
export function absentProvider(reason = 'No local model is installed.'): ModelProvider {
  return {
    describe: () => ({ available: false, reason }),
    generate: async () => ({ ok: false, failure: 'absent', message: reason }),
  }
}

/**
 * Patterns that must never reach a model, a log, or an export.
 *
 * Section 2 rule 9 is absolute: "Game passwords, API keys, provider tokens,
 * private keys, and unrelated private messages never enter prompts, training
 * corpora, logs, or published datasets."
 *
 * Deliberately broad and deliberately dumb. A narrow, clever matcher that
 * tries to understand context will eventually decide something is fine; this
 * refuses on shape alone, and a false refusal costs one review cycle while a
 * false pass costs a credential.
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'account password', re: /\b(password|passwd|pw)\s*[:=]\s*\S+/i },
  { name: 'api or provider key', re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i },
  { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  // Lich and this app both write a session token file; the value is a
  // credential for a socket that can become a game command.
  { name: 'bridge session token', re: /\b(session|bridge)[_-]?token\s*[:=]\s*\S+/i },
]

export interface SecretScan {
  safe: boolean
  /** Which pattern matched. Names the kind, never the value - a diagnostic
   * that quoted the secret would be the leak it exists to prevent. */
  found: string[]
}

export function scanForSecrets(text: string): SecretScan {
  const found = SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name)
  return { safe: found.length === 0, found }
}

/**
 * Replace anything credential-shaped with a note naming the kind.
 *
 * Built from the same patterns as the scan, deliberately: a redactor with its
 * own private list would eventually disagree with the gate, and the half
 * nobody re-read would be the half that leaks.
 */
export function redactSecrets(text: string): string {
  let out = text
  for (const p of SECRET_PATTERNS) {
    const flags = p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g'
    out = out.replace(new RegExp(p.re.source, flags), `[redacted ${p.name}]`)
  }
  return out
}

/**
 * The only way anything under `src/lib/ai*.ts` writes a diagnostic.
 *
 * Section 2 rule 9 says credentials "never enter prompts, training corpora,
 * logs, or published datasets", and a log is the easiest of those four to
 * forget. A bare `console.warn(error.message)` in a provider is one upstream
 * error away from printing a request body. So every AI log line goes through
 * here and is redacted first, and `tools/ai-worker-test.mjs` fails the build
 * if any `ai*.ts` module calls `console` directly - the rule is a check
 * rather than a promise to remember.
 *
 * Prefixed so these lines stay findable in a console full of the game's own
 * noise.
 */
export function aiLog(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const line = `[ai] ${redactSecrets(message)}`
  const extra = detail === undefined ? [] : [redactSecrets(String(detail))]
  // The one permitted console call in this directory, which is why the source
  // check allows exactly this file and this function.
  const write = globalThis.console?.[level]
  if (typeof write === 'function') write.call(globalThis.console, line, ...extra)
}

/**
 * Pull the first complete JSON object out of a model's answer and check its
 * shape.
 *
 * A local instruct model will not reliably return bare JSON. It prefixes
 * "Sure, here is the analysis:", wraps the object in a ```json fence, or adds
 * a sentence afterwards, and every one of those is an ordinary Tuesday rather
 * than a fault worth failing the whole turn over. So the object is extracted
 * rather than required to stand alone.
 *
 * Brace-matched, not regular-expression-matched. `/\{.*\}/` is greedy and
 * swallows a trailing object; `/\{.*?\}/` is lazy and truncates the first
 * nested one. Neither can describe balanced delimiters, and both fail on the
 * exact input this is for - a nested result inside a chatty sentence. Strings
 * are tracked so a `}` inside a quoted value does not close the object.
 *
 * `validate` is the caller's, because this module must not know what a live
 * review looks like. A parse that succeeds and a shape that validates are
 * different questions and both are asked: JSON.parse is happy with
 * `{"notable": "a door"}` and that is not the contract.
 *
 * Returns a discriminated result rather than throwing or returning null with
 * a reason on the side, so a caller cannot use the value without having
 * looked at whether there is one.
 */
export type StructuredParse<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string }

export function parseStructured<T>(text: string, validate: (value: unknown) => value is T): StructuredParse<T> {
  const start = text.indexOf('{')
  if (start === -1) return { ok: false, reason: 'no JSON object in the answer' }

  let depth = 0
  let inString = false
  let escaped = false
  let end = -1

  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end === -1) return { ok: false, reason: 'the JSON object was never closed' }

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { ok: false, reason: 'the JSON object did not parse' }
  }

  if (!validate(parsed)) return { ok: false, reason: 'the object did not match the schema' }
  return { ok: true, value: parsed }
}

/**
 * Refuse to build a prompt that carries a credential.
 *
 * Throws, and this is the one place in this module that does: a caller cannot
 * be allowed to continue past it. Everything else here degrades to a typed
 * failure so the client keeps working, but a leak must stop the call, not
 * produce a value somebody might log.
 */
/**
 * Thrown by the gate below, and the only error this module raises.
 *
 * A distinct type so a caller can turn it into a visible failure without
 * swallowing genuine bugs alongside it: catching Error would also catch a
 * typo in the provider, and report it to the player as a privacy refusal.
 * `patterns` names the kinds that matched and never the text that matched
 * them - a diagnostic quoting the secret would be the leak it exists to
 * prevent.
 */
export class PrivacyGateError extends Error {
  readonly patterns: string[]

  constructor(field: string, patterns: string[]) {
    super(
      `Refusing to send a prompt: request.${field} matched ${patterns.join(', ')}. ` +
        `Credentials must never enter a model prompt.`
    )
    this.name = 'PrivacyGateError'
    this.patterns = patterns
  }
}

export function assertPromptCarriesNoSecrets(request: ModelRequest): void {
  for (const [field, text] of [
    ['instructions', request.instructions],
    ['state', request.state],
  ] as const) {
    const scan = scanForSecrets(text)
    if (!scan.safe) throw new PrivacyGateError(field, scan.found)
  }
}

/**
 * Run a generation under its own budget, converting everything into a typed
 * result.
 *
 * The timeout is enforced here rather than trusted to the provider, because a
 * provider that hangs is exactly the provider that will not honour its own
 * deadline. Cancellation and timeout are reported distinctly: a preempted job
 * and a slow model need different responses, and collapsing them would hide
 * which one happened.
 */
export async function generateWithinBudget(
  provider: ModelProvider,
  request: ModelRequest,
  signal?: AbortSignal
): Promise<ModelResult> {
  assertPromptCarriesNoSecrets(request)

  if (signal?.aborted) {
    return { ok: false, failure: 'cancelled', message: 'Cancelled before the request started.' }
  }

  const budgetMs = Math.max(0, request.budget.maxSeconds * 1000)
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const timeout = new Promise<ModelResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ok: false,
            failure: 'timeout',
            message: `No result within the ${request.budget.maxSeconds}s budget.`,
          }),
        budgetMs
      )
    })

    const cancelled = new Promise<ModelResult>((resolve) => {
      if (!signal) return
      signal.addEventListener(
        'abort',
        () => resolve({ ok: false, failure: 'cancelled', message: 'Cancelled while generating.' }),
        { once: true }
      )
    })

    const result = await Promise.race([provider.generate(request, signal), timeout, cancelled])

    // A provider that resolves with something that is not a ModelResult is a
    // broken provider, not a successful call. Checked rather than trusted.
    if (!result || typeof result !== 'object' || typeof (result as ModelResult).ok !== 'boolean') {
      return { ok: false, failure: 'invalid_output', message: 'Provider returned a malformed result.' }
    }
    return result
  } catch (error) {
    // Including out-of-memory, which is the failure most likely to arrive as a
    // thrown error from a local runtime and the one that must least be allowed
    // to reach the client's render path.
    const message = error instanceof Error ? error.message : String(error)
    const failure: ProviderFailure = /out of memory|oom|allocat/i.test(message)
      ? 'out_of_memory'
      : 'error'
    return { ok: false, failure, message }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
