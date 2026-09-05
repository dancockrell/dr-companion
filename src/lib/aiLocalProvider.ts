/**
 * A `ModelProvider` that talks to an OpenAI-compatible server running on this
 * machine.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 11 names Qwen3 4B Instruct in
 * non-thinking mode as the reference profile, and says plainly that it is "a
 * deployment profile, not a hard-coded provider". So nothing here is
 * Qwen-shaped or Ollama-shaped beyond one documented flag: this speaks the
 * `/v1/models` and `/v1/chat/completions` subset that Ollama, LM Studio and
 * `llama.cpp`'s server all implement, and reports whatever model it finds.
 *
 * # This makes a local model possible, never assumed
 *
 * `absentProvider()` remains the default in `aiWorkerHost.ts`. Most installs
 * will never construct this. The client works exactly as well with no model,
 * and that is the state this file must not degrade.
 *
 * # Loopback only, and it is refused rather than warned about
 *
 * A model server address is the one setting in this app that could quietly
 * turn "local AI" into "your game text is being posted to somebody else's
 * machine". So a `baseUrl` whose host is not `127.0.0.1`, `localhost` or
 * `::1` is refused outright: `describe()` says why, `generate()` returns an
 * ordinary failure, and **no request is ever issued**. `allowRemote` exists
 * so the refusal is a decision a caller can override on purpose rather than a
 * limitation somebody works around by editing this file, and nothing in the
 * app passes it today.
 *
 * # Every failure is a value
 *
 * Same rule as `aiModelProvider.ts`: absence, timeout, cancellation, invalid
 * output and out-of-memory are ordinary results. A local runtime is the most
 * likely thing in this app to refuse a connection, run out of VRAM mid-token,
 * or return HTML from a proxy, and a rejected promise reaching the client's
 * render path is exactly how "the client works fine without a model" gets
 * broken. `generate()` has no path that rejects.
 *
 * # `describe()` is synchronous because it is called on render
 *
 * `AiWorkerPanel` reads health every time it draws. So health is a cached
 * value updated by a background probe of `GET /v1/models`, never a network
 * call made from a render. The probe is scheduled with an unref'd timer: a
 * pending timer keeps the Node event loop alive, which is how a tool on this
 * machine came to take thirty seconds to exit while doing its work in 277 ms.
 *
 * # Qwen3 thinking mode: what was actually checked
 *
 * Recent Ollama builds accept `"think": false` in the request body, and the
 * plan says to check the installed version's documentation and record which
 * switch was used. **Ollama is not installed on this machine** — verified by
 * `Get-Command ollama` (nothing), a `C:\` recursive search for `ollama*.exe`
 * with a positive control that did find `node.exe`, an empty
 * `~/.ollama/models`, and nothing listening on 11434 — so no installed
 * version's documentation could be read, and this is written to be correct
 * without knowing the answer rather than to guess it:
 *
 * - `think: false` is sent by default (`disableThinking`);
 * - a `400` whose body mentions `think` is retried **once** without the
 *   field, so a server that has never heard of it still works;
 * - `<think>…</think>` is stripped from the returned text regardless, because
 *   a structured parser taking the first `{…}` block would otherwise read the
 *   model's reasoning as its answer.
 *
 * The retry is the part that matters: it makes the flag self-correcting
 * against a server nobody here could test against.
 */
import {
  type ModelHealth,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
  aiLog,
} from './aiModelProvider.ts'

/**
 * Ports tried when nothing is configured, in the order the plan gives:
 * Ollama, LM Studio, `llama.cpp` server. First that answers wins.
 */
export const DEFAULT_LOCAL_PORTS: readonly number[] = [11434, 1234, 8080]

/** How often the background probe refreshes cached health. */
const PROBE_INTERVAL_MS = 10_000

/** A probe that has not answered in this long is a server that is not there.
 * Short on purpose: `describe()` must never be stale for long, and a loopback
 * server that needs three seconds to list its models is already unusable. */
const PROBE_TIMEOUT_MS = 3_000

/**
 * Is this address on this machine?
 *
 * Exported so the refusal can be tested directly rather than only through a
 * provider, and deliberately a whitelist: anything not recognised is remote.
 * `0.0.0.0` is not loopback — it is every interface, which is the opposite of
 * what this check is for.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

export interface LocalProviderOptions {
  /** e.g. `http://127.0.0.1:11434`. A trailing `/v1` is tolerated. */
  baseUrl: string
  /** Deliberate escape hatch. Nothing in the app sets it. */
  allowRemote?: boolean
  /** Sends `"think": false`. See the header. */
  disableThinking?: boolean
  /** Injected so tests can drive a local `http.createServer` double without
   * touching global state another suite might be relying on. */
  fetchImpl?: typeof fetch
  /** Set to 0 to disable the background probe; `refresh()` still works. This
   * is what tests use, so a suite never leaves a timer running. */
  probeIntervalMs?: number
}

/** What `localProvider` returns: a `ModelProvider` plus the two controls the
 * host and the "Test connection" button need. */
export interface LocalModelProvider extends ModelProvider {
  /** Probe now and return the fresh health. This is the one health call that
   * is asynchronous, and it is never called from a render. */
  refresh(): Promise<ModelHealth>
  /** Stop the background probe. The host calls this when it tears down. */
  stop(): void
  /** The normalised origin actually in use. */
  readonly baseUrl: string
}

/** Strip a trailing slash and a trailing `/v1`, so both forms a person might
 * paste in Settings resolve to the same origin. */
function normaliseBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

/**
 * A provider that refuses, without ever opening a socket.
 *
 * Returned instead of the real thing for a remote address. It is a full
 * `LocalModelProvider` rather than a throw, because the caller is a React
 * render path and a stored setting that is now wrong must not take the app
 * down — it must show a reason.
 */
function refusingProvider(baseUrl: string, reason: string): LocalModelProvider {
  const health: ModelHealth = { available: false, reason }
  return {
    baseUrl,
    describe: () => health,
    generate: async () => ({ ok: false, failure: 'absent', message: reason }),
    refresh: async () => health,
    stop: () => {},
  }
}

/** `<think>…</think>` and the unterminated form a truncated response leaves
 * behind. Removed before anything downstream looks for a JSON block. */
function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim()
}

/** A 5xx body that names memory is the local runtime running out of VRAM,
 * which is a different problem from a crashed server and sends a person
 * somewhere different: use a smaller profile. */
function looksLikeOom(body: string): boolean {
  return /memory|oom/i.test(body)
}

export function localProvider(options: LocalProviderOptions): LocalModelProvider {
  const baseUrl = normaliseBaseUrl(options.baseUrl)
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const interval = options.probeIntervalMs ?? PROBE_INTERVAL_MS
  const sendThink = options.disableThinking !== false

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return refusingProvider(baseUrl, `"${options.baseUrl}" is not a URL.`)
  }

  if (!options.allowRemote && !isLoopbackHost(parsed.hostname)) {
    return refusingProvider(
      baseUrl,
      `Refusing ${parsed.hostname}: a model server must run on this machine ` +
        `(127.0.0.1 or localhost). Nothing was sent.`
    )
  }

  if (typeof doFetch !== 'function') {
    return refusingProvider(baseUrl, 'This build has no fetch, so it cannot reach a model server.')
  }

  const absentReason = `No local model server at ${baseUrl}`
  let health: ModelHealth = { available: false, reason: absentReason }
  /** The model id the server reported. Held separately from `health` so a
   * probe that fails between two generations does not erase the id the
   * in-flight request was made against. */
  let modelId: string | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  const refresh = async (): Promise<ModelHealth> => {
    if (stopped) return health
    const controller = new AbortController()
    const cutoff = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const response = await doFetch(`${baseUrl}/v1/models`, { signal: controller.signal })
      if (!response.ok) {
        health = { available: false, reason: `${baseUrl} answered ${response.status}` }
        return health
      }
      const body = (await response.json()) as { data?: Array<{ id?: string }> }
      const first = body?.data?.[0]?.id
      if (!first) {
        // A server with no model loaded is reachable and useless, and the two
        // read identically if this is folded into "not there".
        health = { available: false, reason: `${baseUrl} is running but has no model loaded.` }
        modelId = null
        return health
      }
      modelId = first
      health = { available: true, profile: first }
      return health
    } catch {
      // Connection refused, DNS, timeout: all of them mean the same thing to
      // a person, which is that nothing is listening. The exception text is
      // deliberately not shown; it is a stack detail, not a next step.
      health = { available: false, reason: absentReason }
      return health
    } finally {
      clearTimeout(cutoff)
    }
  }

  if (interval > 0) {
    timer = setInterval(() => void refresh(), interval)
    // A pending timer keeps Node's event loop alive. Without this a test
    // process that built a provider hangs for the interval after finishing.
    ;(timer as unknown as { unref?: () => void }).unref?.()
    void refresh()
  }

  const post = async (
    request: ModelRequest,
    signal: AbortSignal | undefined,
    withThink: boolean
  ): Promise<Response> => {
    const body: Record<string, unknown> = {
      model: modelId ?? health.profile ?? 'local',
      messages: [
        { role: 'system', content: request.instructions },
        { role: 'user', content: request.state },
      ],
      max_tokens: request.budget.maxTokens,
      temperature: 0,
      stream: false,
    }
    if (withThink) body.think = false
    return doFetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }

  const generate = async (request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> => {
    if (signal?.aborted) {
      return { ok: false, failure: 'cancelled', message: 'Cancelled before the request started.' }
    }
    try {
      let response = await post(request, signal, sendThink)

      // A server that has never heard of `think` says so with a 400. Retried
      // once without it rather than failing, because which servers accept the
      // field could not be established from this machine.
      if (response.status === 400 && sendThink) {
        const complaint = await response.text()
        if (/think/i.test(complaint)) {
          aiLog('info', 'model server rejected the think flag; retrying without it')
          response = await post(request, signal, false)
        } else {
          return { ok: false, failure: 'error', message: `${baseUrl} answered 400` }
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        if (response.status >= 500 && looksLikeOom(body)) {
          return {
            ok: false,
            failure: 'out_of_memory',
            message: 'The model ran out of memory. Try a smaller profile.',
          }
        }
        return { ok: false, failure: 'error', message: `${baseUrl} answered ${response.status}` }
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return { ok: false, failure: 'invalid_output', message: 'The server did not return JSON.' }
      }

      const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices
      const content = choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        return {
          ok: false,
          failure: 'invalid_output',
          message: 'The server returned no message content.',
        }
      }

      const usage = (payload as { usage?: { completion_tokens?: number } })?.usage
      return {
        ok: true,
        text: stripThinking(content),
        // `??` rather than `||`: zero generated tokens is a real answer for a
        // model that returned an empty string, and must not read as unknown.
        tokens: usage?.completion_tokens ?? 0,
      }
    } catch (error) {
      // An abort arrives here as a thrown DOMException, and it is the one
      // case that is emphatically not a failure of the server.
      if (signal?.aborted) {
        return { ok: false, failure: 'cancelled', message: 'Cancelled while generating.' }
      }
      const message = error instanceof Error ? error.message : String(error)
      if (/out of memory|oom|allocat/i.test(message)) {
        return { ok: false, failure: 'out_of_memory', message }
      }
      // A refused connection is absence, not an error: the server is simply
      // not running, which is the ordinary state and has its own next step.
      health = { available: false, reason: absentReason }
      return { ok: false, failure: 'absent', message: absentReason }
    }
  }

  return {
    baseUrl,
    describe: () => health,
    generate,
    refresh,
    stop: () => {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
    },
  }
}

/**
 * Find a model server when nothing has been configured.
 *
 * Tries the three documented ports in order and returns the first that
 * answers `GET /v1/models`. Returns `null` when none does, which is the
 * ordinary result on almost every machine and is not an error.
 */
export async function discoverLocalBaseUrl(fetchImpl?: typeof fetch): Promise<string | null> {
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return null
  for (const port of DEFAULT_LOCAL_PORTS) {
    const baseUrl = `http://127.0.0.1:${port}`
    const controller = new AbortController()
    const cutoff = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const response = await doFetch(`${baseUrl}/v1/models`, { signal: controller.signal })
      if (response.ok) return baseUrl
    } catch {
      // Nothing on that port. Expected for at least two of the three.
    } finally {
      clearTimeout(cutoff)
    }
  }
  return null
}
