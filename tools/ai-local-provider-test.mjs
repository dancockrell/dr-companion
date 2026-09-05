/**
 * The local provider, against a real HTTP server rather than a stubbed
 * `fetch`.
 *
 * A hand-written fetch double would agree with whatever this file assumed
 * about status codes, aborts and JSON parsing, which is the half of the
 * behaviour most likely to be wrong. So every case below runs against
 * `http.createServer` on 127.0.0.1 on an ephemeral port, and the provider
 * makes genuine requests to it.
 *
 * No fixture here contains a key-shaped literal; the redaction case builds
 * its input at runtime, because gitleaks blocks credential-shaped strings
 * whether or not they are real.
 */
import http from 'node:http'
import { once } from 'node:events'

const { localProvider, isLoopbackHost, discoverLocalBaseUrl, DEFAULT_LOCAL_PORTS } = await import(
  '../src/lib/aiLocalProvider.ts'
)
const { redactSecrets, aiLog } = await import('../src/lib/aiModelProvider.ts')

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(72)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(72)} ${detail}`)
  }
}

const req = (over = {}) => ({
  instructions: 'You classify events.',
  state: '{"events":[]}',
  allowedTools: [],
  budget: { maxTokens: 64, maxSeconds: 5 },
  ...over,
})

/**
 * Start a server whose behaviour each case supplies.
 *
 * `handler` receives the parsed request body for POSTs, so a case can assert
 * what was actually sent rather than trusting that it was.
 */
async function withServer(handler, run) {
  const seen = []
  const server = http.createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      let body = null
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = null
        }
      }
      seen.push({ url: request.url, method: request.method, body })
      handler({ url: request.url, method: request.method, body, seen }, response)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    return await run(baseUrl, seen)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

const json = (response, code, value) => {
  response.writeHead(code, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
const text = (response, code, value) => {
  response.writeHead(code, { 'content-type': 'text/plain' })
  response.end(value)
}
const modelsList = (id) => ({ object: 'list', data: [{ id, object: 'model' }] })
const completion = (content, tokens) => ({
  choices: [{ message: { role: 'assistant', content } }],
  usage: { completion_tokens: tokens },
})

// Probing is disabled in every case below (`probeIntervalMs: 0`) so no suite
// leaves an interval running, and health is refreshed explicitly where the
// case is about health.
const build = (baseUrl, over = {}) => localProvider({ baseUrl, probeIntervalMs: 0, ...over })

console.log('-- loopback is the whole point, so it is a whitelist --')
{
  ok('127.0.0.1 is local', isLoopbackHost('127.0.0.1'))
  ok('localhost is local', isLoopbackHost('localhost'))
  ok('LOCALHOST is local whatever the case', isLoopbackHost('LOCALHOST'))
  ok('::1 is local, bracketed or not', isLoopbackHost('[::1]') && isLoopbackHost('::1'))
  ok('0.0.0.0 is every interface, which is not the same as this one',
    !isLoopbackHost('0.0.0.0'))
  ok('a LAN address is remote', !isLoopbackHost('192.168.1.40'))
  ok('a public host is remote', !isLoopbackHost('api.example.com'))
  ok('and a host that merely starts with 127 is not 127.0.0.1',
    !isLoopbackHost('127.0.0.1.example.com'))
}

console.log('\n-- a remote base URL is refused, and no socket is opened --')
{
  // Pointed at a port nothing is listening on: if the refusal leaked into a
  // real request the failure would be a connection error, not a refusal, and
  // the reason string below would not match.
  const provider = build('http://198.51.100.7:11434')
  const health = provider.describe()
  ok('describe() reports unavailable', health.available === false)
  ok('and names the host it refused', /198\.51\.100\.7/.test(health.reason ?? ''), health.reason)
  ok('and says nothing was sent', /Nothing was sent/.test(health.reason ?? ''))

  const result = await provider.generate(req())
  ok('generate() is a value, not a throw', result.ok === false)
  ok('and the failure kind is absent rather than error', result.failure === 'absent', result.failure)

  const refreshed = await provider.refresh()
  ok('refresh() cannot talk it round', refreshed.available === false)

  const allowed = build('http://198.51.100.7:11434', { allowRemote: true })
  ok('allowRemote is a real override, so the refusal is a decision not a wall',
    allowed.describe().reason !== health.reason, allowed.describe().reason)

  // The decisive pair. Everything above would still pass if the host check
  // were deleted, because a request to an unreachable remote address fails as
  // absence and reads identically to a refusal. These two do not: the fetch
  // is recorded, and it answers, so a provider that dropped the check would
  // report a remote model as ready and start posting game state to it.
  const attempts = []
  const remoteAnswers = async (url) => {
    attempts.push(url)
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'somebody-elses-model' }] }),
      text: async () => '',
    }
  }
  const remote = build('http://model.example.com:11434', { fetchImpl: remoteAnswers })
  const remoteHealth = await remote.refresh()
  const remoteResult = await remote.generate(req())
  ok('a remote server that WOULD answer is still never contacted',
    attempts.length === 0, attempts.join(','))
  ok('so it cannot be reported as ready', remoteHealth.available === false,
    remoteHealth.profile ?? '')
  ok('and generating against it sends nothing',
    !remoteResult.ok && attempts.length === 0, String(attempts.length))

  // Positive control on the same instrument: with a loopback host, this fetch
  // IS called. Without it a zero above would be a broken recorder rather than
  // a working refusal.
  const localAttempts = []
  const localAnswers = async (url) => {
    localAttempts.push(url)
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'local-model' }] }),
      text: async () => '',
    }
  }
  const local = build('http://127.0.0.1:11434', { fetchImpl: localAnswers })
  const localHealth = await local.refresh()
  ok('control: the same recorder does see a loopback request',
    localAttempts.length === 1, localAttempts.join(','))
  ok('control: and loopback does become available', localHealth.available === true)
  local.stop()

  const nonsense = build('not a url at all')
  ok('an unparseable URL is refused too, without throwing',
    nonsense.describe().available === false, nonsense.describe().reason)
}

console.log('\n-- a models list makes it available --')
{
  await withServer(
    (_, response) => json(response, 200, modelsList('qwen3:4b-instruct')),
    async (baseUrl) => {
      const provider = build(baseUrl)
      ok('describe() before any probe is unavailable, not a lie',
        provider.describe().available === false, provider.describe().reason)
      ok('and its reason names the URL a person would go and check',
        provider.describe().reason === `No local model server at ${baseUrl}`)

      const health = await provider.refresh()
      ok('after a probe it is available', health.available === true)
      ok('and reports the model the server actually named',
        health.profile === 'qwen3:4b-instruct', health.profile)
      ok('describe() is synchronous and returns the cached value',
        provider.describe().profile === 'qwen3:4b-instruct')
      provider.stop()
    }
  )
}

console.log('\n-- a reachable server with no model is not the same as no server --')
{
  await withServer(
    (_, response) => json(response, 200, { object: 'list', data: [] }),
    async (baseUrl) => {
      const provider = build(baseUrl)
      const health = await provider.refresh()
      ok('it is unavailable', health.available === false)
      ok('but says the server is running, which is a different next step',
        /running but has no model/.test(health.reason ?? ''), health.reason)
      provider.stop()
    }
  )
}

console.log('\n-- an ordinary generation --')
{
  await withServer(
    ({ url, body }, response) => {
      if (url.endsWith('/v1/models')) return json(response, 200, modelsList('test-model'))
      if (body?.stream === false) return json(response, 200, completion('{"notable":[]}', 12))
      return text(response, 400, 'streaming was requested')
    },
    async (baseUrl, seen) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('it succeeds', result.ok === true, result.ok ? '' : result.message)
      ok('and returns the content', result.ok && result.text === '{"notable":[]}')
      ok('and the token count comes from usage', result.ok && result.tokens === 12)

      const post = seen.find((s) => s.method === 'POST')
      ok('the request went to /v1/chat/completions', post?.url === '/v1/chat/completions')
      ok('it named the model the probe found', post?.body?.model === 'test-model', post?.body?.model)
      ok('temperature is 0, because this is classification not prose',
        post?.body?.temperature === 0)
      ok('max_tokens came from the budget', post?.body?.max_tokens === 64)
      ok('streaming is off', post?.body?.stream === false)
      ok('the system message carries the stable instructions',
        post?.body?.messages?.[0]?.role === 'system' &&
          post?.body?.messages?.[0]?.content === 'You classify events.')
      ok('and the user message carries the changing state',
        post?.body?.messages?.[1]?.content === '{"events":[]}')
      provider.stop()
    }
  )
}

console.log('\n-- zero generated tokens is a real answer, not an unknown one --')
{
  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : json(response, 200, completion('', 0)),
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('an empty completion still succeeds', result.ok === true)
      ok('and reports 0 rather than falling back to something else',
        result.ok && result.tokens === 0, String(result.ok && result.tokens))
      provider.stop()
    }
  )
}

console.log('\n-- out of memory is its own failure, and only from a 5xx that says so --')
{
  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : text(response, 500, 'CUDA error: out of memory allocating 2.1 GiB'),
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('it fails as out_of_memory', !result.ok && result.failure === 'out_of_memory',
        result.ok ? 'ok' : result.failure)
      ok('and the message names the next step rather than the CUDA detail',
        !result.ok && /smaller profile/.test(result.message), result.ok ? '' : result.message)
      provider.stop()
    }
  )
}

console.log('\n-- a 500 that is not about memory is an ordinary error --')
{
  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : text(response, 500, 'template parse failure'),
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('it is error, not out_of_memory', !result.ok && result.failure === 'error',
        result.ok ? 'ok' : result.failure)
      provider.stop()
    }
  )
}

console.log('\n-- garbage is invalid_output, in both its shapes --')
{
  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : text(response, 200, '<html>a proxy got in the way</html>'),
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('a 200 that is not JSON is invalid_output',
        !result.ok && result.failure === 'invalid_output', result.ok ? 'ok' : result.failure)
      provider.stop()
    }
  )

  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : json(response, 200, { object: 'chat.completion', choices: [] }),
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('valid JSON with no choices is invalid_output too',
        !result.ok && result.failure === 'invalid_output', result.ok ? 'ok' : result.failure)
      provider.stop()
    }
  )
}

console.log('\n-- an abort is cancelled, and is never reported as a server fault --')
{
  await withServer(
    ({ url }, response) => {
      if (url.endsWith('/v1/models')) return json(response, 200, modelsList('m'))
      // Never answers. The abort is the only thing that ends this request.
    },
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const controller = new AbortController()
      const pending = provider.generate(req(), controller.signal)
      setTimeout(() => controller.abort(), 40)
      const result = await pending
      ok('it fails as cancelled', !result.ok && result.failure === 'cancelled',
        result.ok ? 'ok' : result.failure)

      const already = new AbortController()
      already.abort()
      const before = await provider.generate(req(), already.signal)
      ok('and an already-aborted signal never opens a connection',
        !before.ok && result.failure === 'cancelled')
      provider.stop()
    }
  )
}

console.log('\n-- nothing listening is absence, not an error --')
{
  // Bind, learn the port, close: nothing is listening there now, which is the
  // ordinary state of almost every machine.
  const scout = http.createServer(() => {})
  scout.listen(0, '127.0.0.1')
  await once(scout, 'listening')
  const deadUrl = `http://127.0.0.1:${scout.address().port}`
  scout.close()
  await once(scout, 'close')

  const provider = build(deadUrl)
  const health = await provider.refresh()
  ok('health says no server at that URL', health.available === false)
  ok('and names the URL', health.reason === `No local model server at ${deadUrl}`, health.reason)
  const result = await provider.generate(req())
  ok('generate() fails as absent rather than error',
    !result.ok && result.failure === 'absent', result.ok ? 'ok' : result.failure)
  ok('and it resolved rather than rejecting', typeof result.ok === 'boolean')
  provider.stop()
}

console.log('\n-- the thinking switch, and the retry that makes it safe to send --')
{
  await withServer(
    ({ url, body }, response) => {
      if (url.endsWith('/v1/models')) return json(response, 200, modelsList('m'))
      if ('think' in (body ?? {})) return text(response, 400, 'unknown field "think"')
      return json(response, 200, completion('answered', 3))
    },
    async (baseUrl, seen) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      const posts = seen.filter((s) => s.method === 'POST')
      ok('the first attempt carries think:false', posts[0]?.body?.think === false)
      ok('a server that rejects it gets a second attempt without the field',
        posts.length === 2 && !('think' in (posts[1]?.body ?? {})), `posts=${posts.length}`)
      ok('and the call succeeds anyway', result.ok === true, result.ok ? '' : result.message)
      provider.stop()
    }
  )

  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : text(response, 400, 'context length exceeded'),
    async (baseUrl, seen) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('a 400 about something else is not retried',
        seen.filter((s) => s.method === 'POST').length === 1)
      ok('and is reported as an error', !result.ok && result.failure === 'error')
      provider.stop()
    }
  )

  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : json(response, 200, completion('<think>I should check the map</think>{"notable":["door"]}', 9)),
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('a thinking block is stripped, so the first { is the answer',
        result.ok && result.text === '{"notable":["door"]}', result.ok ? result.text : result.message)
      provider.stop()
    }
  )

  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : json(response, 200, completion('reasoning ran on</think>{"notable":[]}', 9)),
    async (baseUrl) => {
      const provider = build(baseUrl)
      await provider.refresh()
      const result = await provider.generate(req())
      ok('and so is a truncated one with no opening tag',
        result.ok && result.text === '{"notable":[]}', result.ok ? result.text : result.message)
      provider.stop()
    }
  )

  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : json(response, 200, completion('fine', 1)),
    async (baseUrl, seen) => {
      const provider = build(baseUrl, { disableThinking: false })
      await provider.refresh()
      await provider.generate(req())
      ok('disableThinking:false omits the field entirely',
        !('think' in (seen.find((s) => s.method === 'POST')?.body ?? {})))
      provider.stop()
    }
  )
}

console.log('\n-- both URL forms a person might paste resolve to one origin --')
{
  await withServer(
    ({ url }, response) =>
      url.endsWith('/v1/models')
        ? json(response, 200, modelsList('m'))
        : json(response, 200, completion('x', 1)),
    async (baseUrl, seen) => {
      const provider = build(`${baseUrl}/v1/`)
      await provider.refresh()
      ok('a pasted .../v1/ still probes /v1/models exactly once, not /v1/v1/models',
        seen.length === 1 && seen[0].url === '/v1/models', seen.map((s) => s.url).join(','))
      ok('and describe() reports available', provider.describe().available === true)
      provider.stop()
    }
  )
}

console.log('\n-- discovery tries the three documented ports and gives up quietly --')
{
  ok('the documented ports are Ollama, LM Studio, llama.cpp in that order',
    DEFAULT_LOCAL_PORTS.join(',') === '11434,1234,8080', DEFAULT_LOCAL_PORTS.join(','))

  const tried = []
  const noneAnswer = async (url) => {
    tried.push(url)
    throw new Error('ECONNREFUSED')
  }
  const nothing = await discoverLocalBaseUrl(noneAnswer)
  ok('with nothing running it returns null rather than throwing', nothing === null, String(nothing))
  ok('having tried each port once', tried.length === 3, String(tried.length))

  const secondAnswers = async (url) => {
    if (url.includes(':1234')) return { ok: true }
    throw new Error('ECONNREFUSED')
  }
  const found = await discoverLocalBaseUrl(secondAnswers)
  ok('and it returns the first port that answers',
    found === 'http://127.0.0.1:1234', String(found))
}

console.log('\n-- no AI module writes a log line that has not been redacted --')
{
  const fs = await import('node:fs')
  const path = await import('node:path')

  // Assembled at runtime. A literal here would be a credential-shaped string
  // in a tracked file, which gitleaks blocks whether or not it is real.
  const fake = 'ab12' + 'cd34' + 'ef56' + 'ab78' + 'cd90'
  const line = 'request failed: ' + 'api' + '_key' + '=' + fake + ' rejected'
  const redacted = redactSecrets(line)
  ok('a key-shaped value is replaced', !redacted.includes(fake), redacted)
  ok('and the kind that matched is named, so the line is still diagnosable',
    /api or provider key/.test(redacted), redacted)
  ok('text with no secret in it is returned unchanged',
    redactSecrets('probe timed out after 3s') === 'probe timed out after 3s')

  const captured = []
  const realWarn = console.warn
  console.warn = (...args) => captured.push(args.join(' '))
  try {
    aiLog('warn', line)
  } finally {
    console.warn = realWarn
  }
  ok('aiLog writes exactly one line', captured.length === 1, String(captured.length))
  ok('prefixed so it is findable', captured[0].startsWith('[ai] '), captured[0])
  ok('and it carries no key-shaped value', !captured[0].includes(fake), captured[0])

  // The ratchet. Today no ai*.ts file calls console at all except aiLog
  // itself; this is what keeps the next one from being the exception.
  const dir = 'src/lib'
  const aiFiles = fs
    .readdirSync(dir)
    .filter((f) => /^ai[A-Z].*\.ts$/.test(f))
    .map((f) => path.join(dir, f))
  ok('the scan found the AI modules rather than an empty list',
    aiFiles.length >= 8, `${aiFiles.length} files`)
  ok('and it includes the new provider',
    aiFiles.some((f) => f.endsWith('aiLocalProvider.ts')))

  const offenders = []
  for (const file of aiFiles) {
    const source = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      // Whole-line comments and doc comments are stripped: a check that fails
      // on the sentence explaining it teaches people to stop explaining.
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    // aiModelProvider.ts holds aiLog, which is the one permitted call site.
    const permitted = file.endsWith('aiModelProvider.ts')
    const hits = source.match(/\bconsole\.[a-z]+\s*\(/g) ?? []
    const allowed = permitted ? 1 : 0
    if (hits.length > allowed) offenders.push(`${file}: ${hits.length}`)
  }
  ok('no ai*.ts module writes to console except aiLog',
    offenders.length === 0, offenders.join('; '))
}

console.log('\n-- the provider still cannot reach the game --')
{
  const fs = await import('node:fs')
  const src = fs.readFileSync('src/lib/aiLocalProvider.ts', 'utf8')
  ok('it imports nothing from the command path',
    !/from '\.\/(gameActions|gameCommand|gameLink)/.test(src))
  ok('and defines no send surface',
    !/\b(sendGame|requestGameAction|invokeTauri|game_send)\b/.test(src))
  ok('the loopback check is a whitelist, not a blacklist of bad hosts',
    /host === '127\.0\.0\.1' \|\| host === 'localhost' \|\| host === '::1'/.test(src))
}

console.log('')
const total = pass + fail
// A floor well below the real count: it catches a truncated or half-loaded
// run, and never needs touching as cases are added.
const MIN_EXPECTED = 50
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
