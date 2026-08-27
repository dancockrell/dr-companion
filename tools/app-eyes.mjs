/**
 * Look at the actual desktop app, not a browser standing in for it.
 *
 * # Why this exists
 *
 * Every visual check in this repo went through `launch()` in browser.mjs,
 * which starts Chrome and points it at the Vite dev server. That renders the
 * React tree honestly and it is worth having - but it is not the app. The app
 * is a WebView2 with a Rust process behind it, and the half that is only on
 * the Rust side is the half this client is actually about:
 *
 *   - the TCP socket to Lich, so `game:line` events and therefore every line
 *     of game text
 *   - `read_genie_config`, so highlights
 *   - `read_sound`, so alerts
 *   - the window at its real size, with its real chrome
 *
 * In Chrome all four are absent, and absent quietly: `isTauri()` is false, the
 * components take their empty branches, and the page renders perfectly. So a
 * check could report a clean layout for a pane that has never had a line in
 * it. The channel tabs are the sharp case - the row is empty in Chrome by
 * construction, and the question worth asking is what it does with twelve
 * channels and five log tabs in it, which Chrome cannot be asked.
 *
 * WebView2 takes command-line arguments through an environment variable, so
 * the app can be started with a debugging port and then driven exactly like a
 * browser. That is all this is.
 *
 * # Use
 *
 *   node tools/app-eyes.mjs status                 is it running, and can I see it
 *   node tools/app-eyes.mjs start                  (re)start it with eyes open
 *   node tools/app-eyes.mjs shot out.png           screenshot the real window
 *   node tools/app-eyes.mjs text                   the window's visible text
 *   node tools/app-eyes.mjs eval "<expression>"    ask the real page a question
 *
 * `start` stops a running instance first. There is deliberately no "attach to
 * the one already running without a port", because there is no such thing: a
 * WebView2 started without the argument has no debugger to attach to, and
 * pretending otherwise would produce a timeout that reads like a crash.
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { attach } from './browser.mjs'

export const PORT = 9223
const EXE = 'src-tauri/target/debug/dr-companion.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Pids of every running instance, or an empty list. */
export function running() {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-Process dr-companion -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }",
      ],
      { encoding: 'utf8' }
    )
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
  } catch {
    return []
  }
}

/** Whether something is answering the debugging protocol on our port. */
export async function seeing() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
      signal: AbortSignal.timeout(1500),
    })
    const info = await res.json()
    return info.webSocketDebuggerUrl ? info : null
  } catch {
    return null
  }
}

/**
 * Start the app with its debugging port open, replacing any running instance.
 *
 * Replacing rather than adding: two instances would both hold a socket to the
 * same Lich port and the second would be told no, which is the failure that
 * looks like a bug in the connection code.
 */
export async function start({ quiet = false } = {}) {
  if (!existsSync(EXE)) {
    throw new Error(
      `${EXE} is not built. Run \`npm run tauri:dev\` once, or \`cargo build\` in src-tauri.`
    )
  }

  for (const pid of running()) {
    if (!quiet) console.log(`stopping the running app (pid ${pid})`)
    try {
      process.kill(pid)
    } catch {
      // Already gone between listing and killing. Nothing to do.
    }
  }
  if (running().length) await sleep(700)

  const proc = spawn(EXE, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    },
  })
  proc.unref()

  // Wait for the debugger, not for a guessed number of seconds.
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const info = await seeing()
    if (info) return info
    await sleep(250)
  }
  throw new Error(
    `the app started but never opened a debugging port on ${PORT}. ` +
      'WebView2 reads WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS at creation; if it ' +
      'is ignored here the runtime is older than that support.'
  )
}

/**
 * Attach, starting the app first if it cannot currently be seen.
 *
 * And then check that what we are attached to is the app, which this did not
 * do for its first twenty minutes of life and was wrong the first time it
 * mattered. The dev server had died, the WebView's reload landed on
 * `chrome-error://chromewebdata/`, and `overflow` reported
 *
 *     window 1180x820, document 1180 wide
 *       nothing outside the window
 *
 * against an error page with nothing in it. Perfectly true, and it would have
 * been read as "the layout fix works". An empty document has no elements
 * outside the window for the same reason a suite that never ran has no
 * failures.
 *
 * So the page says what it is before anything is measured on it.
 */
export async function eyes({ require = true } = {}) {
  if (!(await seeing())) await start({ quiet: true })
  const b = await attach({ port: PORT, timeoutMs: 8000 })

  const where = await b.eval(
    'JSON.stringify({ href: location.href, ready: document.readyState, roots: document.querySelectorAll("#root").length })'
  )
  const at = JSON.parse(where)
  b.where = at

  if (require && (at.href.startsWith('chrome-error:') || at.roots === 0)) {
    await b.close()
    throw new Error(
      `the app window is not showing the app: ${at.href}\n` +
        '  A WebView that failed to load renders an error page, and every measurement\n' +
        '  taken on it comes back clean. Usually the dev server is down - check\n' +
        '  http://127.0.0.1:1420/ and run `npx vite` if nothing answers.'
    )
  }
  return b
}

const [, , cmd, arg] = process.argv

if (cmd) {
  const run = async () => {
    switch (cmd) {
      case 'status': {
        const pids = running()
        const info = await seeing()
        console.log(pids.length ? `app running: pid ${pids.join(', ')}` : 'app not running')
        console.log(
          info
            ? `debugger on ${PORT}: ${info.Browser}`
            : `nothing answering on ${PORT} - run \`node tools/app-eyes.mjs start\``
        )
        break
      }

      case 'start': {
        const info = await start()
        console.log(`app up with eyes open on ${PORT}: ${info.Browser}`)
        break
      }

      case 'shot': {
        const b = await eyes()
        const path = arg ?? 'app.png'
        await b.screenshot(path)
        await b.close()
        console.log(path)
        break
      }

      case 'text': {
        const b = await eyes()
        console.log(await b.eval('document.body.innerText'))
        await b.close()
        break
      }

      case 'click': {
        if (!arg) throw new Error('click needs a CSS selector')
        const b = await eyes()
        // Through the real input pipeline, so a control that is off screen or
        // covered fails here exactly as it fails for a person. That matters
        // more in the app than in a browser: the window is a fixed size and
        // things leave it.
        await b.click(arg)
        await b.close()
        console.log(`clicked ${arg}`)
        break
      }

      /** Everything that has escaped the window, which a screenshot cannot show. */
      case 'overflow': {
        const b = await eyes()
        const found = await b.run(`
          const W = innerWidth, H = innerHeight, out = [];
          for (const el of document.querySelectorAll('button, input, a, [role="tab"], h1, h2, h3')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1) {
              out.push({
                what: (el.innerText || el.title || el.tagName).trim().slice(0, 34),
                x: Math.round(r.left), y: Math.round(r.top),
                over: Math.round(Math.max(r.right - W, r.bottom - H, -r.left, -r.top)),
              });
            }
          }
          return {
            W, H,
            scrollW: document.documentElement.scrollWidth,
            // The denominator. "Nothing is outside the window" is the same
            // sentence whether the layout is right or the page is empty, and
            // only this number tells the two apart.
            examined: document.querySelectorAll('button, input, a, [role="tab"], h1, h2, h3').length,
            out,
          };
        `)
        await b.close()
        console.log(`window ${found.W}x${found.H}, document ${found.scrollW} wide`)
        console.log(`${found.examined} controls examined`)
        if (found.examined < 5) {
          console.log('  too few to conclude anything - is the app showing what you think it is?')
          process.exitCode = 1
          break
        }
        console.log(
          found.out.length
            ? found.out.map((o) => `  ${String(o.over).padStart(5)}px out  ${o.what}`).join('\n')
            : '  nothing outside the window'
        )
        break
      }

      case 'eval': {
        if (!arg) throw new Error('eval needs an expression')
        const b = await eyes()
        const v = await b.eval(arg)
        await b.close()
        console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1))
        break
      }

      default:
        throw new Error(`unknown command ${cmd} - try status, start, shot, text, eval`)
    }
  }

  run().catch((e) => {
    console.error(String(e.message ?? e))
    process.exit(1)
  })
}
