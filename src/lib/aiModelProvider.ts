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
  | 'error'

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
 * Refuse to build a prompt that carries a credential.
 *
 * Throws, and this is the one place in this module that does: a caller cannot
 * be allowed to continue past it. Everything else here degrades to a typed
 * failure so the client keeps working, but a leak must stop the call, not
 * produce a value somebody might log.
 */
export function assertPromptCarriesNoSecrets(request: ModelRequest): void {
  for (const [field, text] of [
    ['instructions', request.instructions],
    ['state', request.state],
  ] as const) {
    const scan = scanForSecrets(text)
    if (!scan.safe) {
      throw new Error(
        `Refusing to send a prompt: request.${field} matched ${scan.found.join(', ')}. ` +
          `Credentials must never enter a model prompt.`
      )
    }
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
