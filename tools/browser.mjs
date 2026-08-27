/**
 * Drive a real browser, the way a person drives it.
 *
 * A tiny DevTools Protocol client: launch Chrome with a debugging port, talk to
 * it over the WebSocket Node has had built in since v22, and get the whole
 * surface - navigate, click, type, evaluate, screenshot. No dependency, no
 * install, nothing for anyone to set up before they can look at the app.
 *
 * # Why this exists rather than a query parameter
 *
 * The first version of the layout checker could not click, so the app grew a
 * `?demo=<preset>` URL that jumped straight to a loaded dashboard. That was the
 * wrong fix twice over, and Dan called it: it put test scaffolding into the
 * product, and it meant every automated check exercised a path no player ever
 * takes. A check that reaches the screen by a private door is not checking the
 * screen a person sees - the setup wizard, the demo button and the settings
 * sheet were all bypassed, which is exactly where a bug would sit.
 *
 * So the tool got harder instead of the app getting weaker. This clicks the
 * button.
 *
 * # Shape
 *
 *   const b = await launch({ width, height })
 *   await b.goto('http://localhost:1420/')
 *   await b.click('button', /demo dashboard/i)
 *   const v = await b.eval('document.title')
 *   await b.screenshot('out.png')
 *   await b.close()
 *
 * Clicking is done by dispatching real input events at the element's centre
 * through `Input.dispatchMouseEvent`, not by calling `.click()` in the page.
 * The difference matters: a control covered by another element, or scrolled out
 * of view, or zero-sized, is unclickable to a person and this reports that,
 * where `.click()` would happily fire and report success.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export function findBrowser() {
  return BROWSERS.find((p) => existsSync(p)) ?? null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait for the debugger to answer, rather than sleeping a guessed amount.
 *
 * Chrome writes its WebSocket URL to a file once it is listening. Polling that
 * is the difference between "we waited two seconds and hoped" and knowing.
 */
async function debuggerUrl(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      const info = await res.json()
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl
    } catch (e) {
      lastError = e
    }
    await sleep(150)
  }
  throw new Error(
    `browser never opened a debugging port on ${port}${lastError ? `: ${lastError.message}` : ''}`
  )
}

export async function launch({ width = 1280, height = 860, headless = true } = {}) {
  const exe = findBrowser()
  if (!exe) throw new Error('no Chrome or Edge found')

  // A port nobody else is on. Chosen from the pid so two of these can run at
  // once without agreeing on anything.
  const port = 9500 + (process.pid % 400)
  const profile = mkdtempSync(join(tmpdir(), 'drc-browser-'))

  const args = [
    headless ? '--headless=new' : '--new-window',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ]

  const proc = spawn(exe, args, { stdio: 'ignore' })
  const wsUrl = await debuggerUrl(port).catch((e) => {
    proc.kill()
    rmSync(profile, { recursive: true, force: true })
    throw e
  })

  return session(wsUrl, {
    target: 'new',
    async cleanup() {
      proc.kill()
      // Chrome writes to the profile as it exits, so removing it immediately
      // races and throws on Windows. Best effort, and a temp directory the OS
      // will clear anyway.
      await sleep(300)
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        // Left for the OS. Failing a layout check over a temp folder would be
        // the tool making its own housekeeping somebody else's problem.
      }
    },
  })
}

/**
 * Attach to an engine that is already running, and drive the page it has.
 *
 * This is the half that was missing, and it was the half that mattered. Every
 * check written against `launch()` renders the app in Chrome, which is not
 * where the app runs: the desktop app is a WebView2 with a Rust process behind
 * it, and everything interesting about this client - the socket to Lich, the
 * config reads, the channels the game labels - lives on that side. A Chrome
 * render can tell you a button is clipped. It cannot tell you what the channel
 * pane looks like with twelve live channels in it, because in Chrome there is
 * no socket and there are never any channels.
 *
 * Start the app with
 *
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
 *
 * and this attaches to it. `tools/app-eyes.mjs` does that part.
 *
 * `target: 'first-page'` rather than creating one: a fresh target in WebView2
 * is a blank page with none of the app in it, and it would render perfectly
 * and mean nothing.
 */
export async function attach({ port = 9223, timeoutMs = 5000, pick = null } = {}) {
  const wsUrl = await debuggerUrl(port, timeoutMs)
  return session(wsUrl, { target: 'first-page', pick })
}

async function session(wsUrl, { target = 'new', cleanup = null, pick = null } = {}) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('could not attach to the browser'))
  })

  let nextId = 1
  const pending = new Map()
  const events = []

  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.method ?? ''})`))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  }

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, sessionId }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`${method} timed out`))
        }
      }, 30000)
    })

  // One tab, attached, with a session we can talk to.
  let targetId
  if (target === 'new') {
    ;({ targetId } = await send('Target.createTarget', { url: 'about:blank' }))
  } else {
    const { targetInfos } = await send('Target.getTargets')
    const pages = targetInfos.filter((t) => t.type === 'page')
    if (pages.length === 0) {
      // Said out loud rather than throwing something about `undefined`. In
      // WebView2 this means the app is running without a debugging port, which
      // is a setup problem with a one-line fix, not a bug in the page.
      throw new Error(
        'the engine is listening but has no page target - is this the app, and was it started with --remote-debugging-port?'
      )
    }
    // Which page, decided rather than guessed.
    //
    // This used to take `pages[0]` and print a note to stderr when there were
    // several. That is a chooser whose wrong answer was never available to the
    // test: with one target it cannot be wrong, and one target was the only
    // case anybody had run it against.
    //
    // Several is the *normal* state of this app, not an edge case - it opens
    // panel windows and a map window, each its own WebView target. Measured
    // with two open: the HTTP target list returned `about:blank` first and the
    // real app second, while `Target.getTargets` returned them the other way
    // round in the same moment. So the order is not something to rely on, and
    // `pages[0]` was a coin flip that happened to be landing right. A check
    // that is correct by accident teaches the wrong lesson, and the failure it
    // produces - measuring a different window - is silent and looks exactly
    // like a result.
    //
    // So: a caller that knows which window it wants says so, and ambiguity is
    // refused rather than resolved by position. Refusing is right because
    // there is no answer here that is better than half correct, and a wrong
    // window is indistinguishable downstream from a reload, a stale value, or
    // a genuine reading.
    const candidates = pick ? pages.filter((p) => pick(p)) : pages

    if (candidates.length === 0) {
      throw new Error(
        `no page target matched. ${pages.length} page(s) available:\n` +
          pages.map((p) => `  ${p.url}`).join('\n')
      )
    }
    if (candidates.length > 1) {
      throw new Error(
        `AMBIGUOUS: ${candidates.length} page targets matched, refusing to pick one by position.\n` +
          candidates.map((p) => `  ${p.url}`).join('\n') +
          '\n  Narrow it with `pick`, or close the windows you are not measuring.\n' +
          '  Picking arbitrarily here measures a different window and reads as a result.'
      )
    }
    targetId = candidates[0].targetId
  }
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)

  await call('Page.enable')
  await call('Runtime.enable')

  const api = {
    async goto(url, { waitFor = 'main' } = {}) {
      await call('Page.navigate', { url })
      // Wait for something real rather than for a timer. A fixed sleep is the
      // check that passes on a slow machine and fails on a fast one, or the
      // reverse, and never says which.
      if (waitFor) await api.waitFor(waitFor, 15000)
    },

    /**
     * Evaluate an *expression* in the page and return its value.
     *
     * Raw, with no wrapper. An earlier version guessed whether to wrap by
     * looking for the word "return" in the source, which is exactly the kind
     * of cleverness that fails silently: the layout probe is an IIFE whose
     * body contains returns, so it was left unwrapped, evaluated fine, and
     * handed back undefined. Nothing errored. The caller got `undefined` and
     * blamed itself.
     *
     * Pass statements to `run` instead. Two functions that each do one thing
     * beat one that infers which you meant.
     */
    async eval(expression) {
      const r = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? 'page threw')
      }
      return r.result.value
    },

    /** Run a function *body* in the page, with `return` available. */
    async run(body) {
      return api.eval(`(() => { ${body} })()`)
    },

    /** Wait until a selector matches, or say plainly that it never did. */
    async waitFor(selector, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const there = await api.eval(`!!document.querySelector(${JSON.stringify(selector)})`)
        if (there) return true
        await sleep(100)
      }
      throw new Error(`${selector} never appeared within ${timeoutMs}ms`)
    },

    /**
     * Click the first element matching a selector, optionally filtered by the
     * text it carries.
     *
     * Real mouse events at the element's centre. If it is off screen, covered,
     * or zero-sized, this fails - which is the point, because all three are
     * states where a person cannot click it either.
     */
    async click(selector, textMatch = null) {
      const box = await api.run(`
        const want = ${textMatch ? textMatch.toString() : 'null'};
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = want ? els.find(e => want.test((e.innerText||'').trim())) : els[0];
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return { dead: 'zero-sized' };
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        if (!top || !(el === top || el.contains(top) || top.contains(el))) {
          return { dead: 'covered by ' + (top ? top.tagName.toLowerCase() + '.' + String(top.className).slice(0,30) : 'nothing') };
        }
        return { x, y };
      `)

      if (!box) throw new Error(`nothing matched ${selector}${textMatch ? ` with ${textMatch}` : ''}`)
      if (box.dead) throw new Error(`${selector} is not clickable: ${box.dead}`)

      for (const type of ['mousePressed', 'mouseReleased']) {
        await call('Input.dispatchMouseEvent', {
          type,
          x: box.x,
          y: box.y,
          button: 'left',
          clickCount: 1,
        })
      }
      return true
    },

    /** Choose an option in a native select, and fire what React listens for. */
    async select(value) {
      const done = await api.run(`
        const sel = [...document.querySelectorAll('select')]
          .find(s => [...s.options].some(o => o.value === ${JSON.stringify(value)}));
        if (!sel) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, ${JSON.stringify(value)});
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      `)
      if (!done) throw new Error(`no select offers the value ${value}`)
      return true
    },

    async screenshot(path) {
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(path, Buffer.from(data, 'base64'))
      return path
    },

    /** Console errors the page produced, so a silent failure is not silent. */
    consoleErrors() {
      return events
        .filter((e) => e.method === 'Runtime.exceptionThrown')
        .map((e) => e.params?.exceptionDetails?.exception?.description ?? 'exception')
    },

    /**
     * Let go.
     *
     * Only a launched browser gets killed. Attaching to the running app and
     * then killing it on the way out would mean every look at the app closed
     * the app, so `cleanup` is supplied by whoever started something and
     * absent for whoever merely borrowed it.
     */
    async close() {
      try {
        ws.close()
      } catch {
        // Already gone; the cleanup below is what actually matters.
      }
      if (cleanup) await cleanup()
    },
  }

  return api
}
