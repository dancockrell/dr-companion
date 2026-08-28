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
 *   node tools/app-eyes.mjs identity               which document is loaded now
 *
 * # Measurements that span more than one call
 *
 * The app is hot-reloaded constantly while people work on it - four different
 * pids inside twenty minutes was measured. So a value set in one call can be
 * gone by the next, and nothing about the second call distinguishes "the page
 * reloaded underneath you" from "the value was never there". Somebody lost a
 * real test to exactly that.
 *
 * Bracket anything that spans calls:
 *
 *   id=$(node tools/app-eyes.mjs identity)
 *   node tools/app-eyes.mjs eval "window.__probe = measure()" --require-doc "$id"
 *   node tools/app-eyes.mjs eval "window.__probe"              --require-doc "$id"
 *
 * `--require-doc` works on every command that reads the app. If the document
 * or the process changed, the call exits non-zero saying so rather than
 * returning a number from somewhere else - a refusal, because the measurement
 * genuinely did not happen and any value would be a reading of a different
 * document.
 *
 * `start` stops a running instance first. There is deliberately no "attach to
 * the one already running without a port", because there is no such thing: a
 * WebView2 started without the argument has no debugger to attach to, and
 * pretending otherwise would produce a timeout that reads like a crash.
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { attach } from './browser.mjs'

export const PORT = 9223
const EXE = 'src-tauri/target/debug/dr-companion.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Floor between two *implicit* restarts triggered by `eyes()` failing to see
 * the app - not between explicit `start` calls, which always run.
 *
 * Measured need: an orphaned polling loop (`until ...eval "window.X"...; do
 * sleep 2; done`) outlived the session that started it, surviving a machine
 * restart notification that read as "may have been running when the process
 * exited." Every 2-second poll found the app not answering (crashed on the
 * dev server being down, separately) and `eyes()` did exactly what it is
 * documented to do - kill and relaunch - with nothing to notice that this was
 * the fifth relaunch in ten seconds rather than the first ever. The app plays
 * audio on load, so `dr-companion.exe`, `msedgewebview2.exe` and the WebView2
 * autoplay policy turned an orphaned test loop into a real person hearing a
 * few seconds of music, over and over, with no session realising it owned the
 * loop until someone went looking for the process tree by hand.
 *
 * This does not fix the orphaned-loop problem - a background shell surviving
 * its own session is a Claude Code lifecycle question, not this tool's to
 * solve. It bounds the blast radius of any caller, orphaned or not, hammering
 * `eyes()` in a tight loop: at most one real restart per window, and callers
 * in between get the existing (still-failing, if it's still failing) instance
 * rather than a fresh kill.
 */
const AUTO_RESTART_COOLDOWN_MS = 10_000
let lastAutoStart = 0

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
export async function eyes({ require = true, requireDoc = null } = {}) {
  if (!(await seeing())) {
    const sinceLastAutoStart = Date.now() - lastAutoStart
    if (lastAutoStart && sinceLastAutoStart < AUTO_RESTART_COOLDOWN_MS) {
      // Already restarted recently on this same "can't see it" reason. Wait
      // out the rest of the cooldown instead of kill-and-relaunching again -
      // if the last restart is going to work, this is what waiting for it
      // looks like; if it never will, one throttled failure a caller can see
      // beats an unbounded restart loop they can't.
      await sleep(AUTO_RESTART_COOLDOWN_MS - sinceLastAutoStart)
    } else {
      lastAutoStart = Date.now()
      await start({ quiet: true })
    }
  }

  // Say which window, rather than taking whichever came back first.
  //
  // This app routinely has several page targets: it opens panel windows
  // (`?view=panel&id=...`) and a map window (`?view=map`), each its own
  // WebView. So "the main window" has to be stated, not assumed. Measured with
  // two open, the HTTP target list put `about:blank` first and the app second
  // while `Target.getTargets` returned the reverse in the same moment - so
  // position was never a rule, only a coin flip that had been landing right.
  //
  // The main window is the app root with no `view` parameter. `about:blank`,
  // devtools and the popped-out windows all fail that, and `attach` refuses
  // outright if this matches none or more than one rather than picking by
  // position.
  const b = await attach({
    port: PORT,
    timeoutMs: 8000,
    pick: (t) => {
      if (!t.url.startsWith('http')) return false
      try {
        return !new URL(t.url).searchParams.has('view')
      } catch {
        return false
      }
    },
  })

  // Stamp the document with an identity, and pair it with the process id.
  //
  // This exists because the app is hot-reloaded constantly - four different
  // `dr-companion` pids inside twenty minutes, measured while somebody was
  // trying to take one reading. A value set on `window` in one call was gone
  // by the next, and nothing distinguished that from the value having been
  // null all along. A reload mid-measurement read exactly like a result.
  //
  // A property on `window`, which is exactly the lifetime wanted: it survives
  // an HMR module swap, because that replaces modules without navigating and
  // is not a new document, and it does not survive a reload, because that is.
  //
  // The first version used `sessionStorage` on the reasoning that it was the
  // more durable choice. That was backwards, and the test caught it: reloading
  // the page left the identity unchanged and the guard passed, so a
  // measurement spanning a genuine reload was waved through as a result -
  // precisely the failure this was written to stop. `sessionStorage` survives
  // reloads by design; that is what it is for. Durability was the wrong axis.
  // What is wanted is a marker whose lifetime *is* the document's.
  //
  // The pid covers the other half - the whole process restarting, where a
  // fresh document would otherwise look like ordinary continuity.
  const idJson = await b.eval(`(() => {
    if (!window.__drcEyesDoc) {
      window.__drcEyesDoc = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
    }
    return JSON.stringify({
      doc: window.__drcEyesDoc,
      href: location.href,
      ready: document.readyState,
      roots: document.querySelectorAll('#root').length
    });
  })()`)

  const at = JSON.parse(idJson)
  const pids = running()
  // Exactly one instance, or no answer. Two instances means any pid we pick is
  // a guess, and a guessed identity is worse than an absent one.
  at.pid = pids.length === 1 ? pids[0] : null
  at.identity = at.doc && at.pid ? `${at.pid}:${at.doc}` : null
  b.where = at
  b.identity = at.identity

  if (require && (at.href.startsWith('chrome-error:') || at.roots === 0)) {
    await b.close()
    throw new Error(
      `the app window is not showing the app: ${at.href}\n` +
        '  A WebView that failed to load renders an error page, and every measurement\n' +
        '  taken on it comes back clean. Usually the dev server is down - check\n' +
        '  http://127.0.0.1:1420/ and run `npx vite` if nothing answers.'
    )
  }

  // The whole point: a caller that says which document it expects gets a hard
  // failure when the target moved underneath it, rather than a number from
  // somewhere else. Refusing to answer is the correct result here - the
  // measurement genuinely did not happen, and any value returned would be a
  // reading of a different process.
  if (requireDoc) {
    if (!at.identity) {
      await b.close()
      throw new Error(
        `TARGET CHANGED: expected ${requireDoc}, but the current target has no stable identity\n` +
          `  (doc=${at.doc ?? 'unavailable'}, ${pids.length} app processes running)\n` +
          '  This is not a result. Re-take the whole measurement.'
      )
    }
    if (at.identity !== requireDoc) {
      await b.close()
      throw new Error(
        `TARGET CHANGED: expected ${requireDoc}, now ${at.identity}\n` +
          '  The app reloaded or restarted between calls, so anything measured\n' +
          '  across them came from two different documents. This is not a result.'
      )
    }
  }

  return b
}

const argv = process.argv.slice(2)

/**
 * `--require-doc <id>` - refuse to answer unless the target is still the
 * document that id came from. Pulled out of the positional arguments so it can
 * be added to any command without changing its shape.
 */
const requireDocIdx = argv.indexOf('--require-doc')
const REQUIRE_DOC = requireDocIdx >= 0 ? argv[requireDocIdx + 1] : null
if (requireDocIdx >= 0) argv.splice(requireDocIdx, 2)

const [cmd, arg] = argv

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

      /**
       * The identity of the document currently loaded, for bracketing a
       * measurement that spans several calls:
       *
       *   id=$(node tools/app-eyes.mjs identity)
       *   node tools/app-eyes.mjs eval "..." --require-doc "$id"
       *   node tools/app-eyes.mjs eval "..." --require-doc "$id"
       *
       * If the app reloads or restarts anywhere in that sequence, the next
       * call exits non-zero saying so instead of returning a number measured
       * on a different document.
       */
      case 'identity': {
        const b = await eyes({ requireDoc: REQUIRE_DOC })
        await b.close()
        if (!b.identity) {
          console.error(
            'no stable identity available: ' +
              `doc=${b.where.doc ?? 'unavailable'}, ${running().length} app processes running`
          )
          process.exitCode = 1
          break
        }
        console.log(b.identity)
        break
      }

      case 'start': {
        const info = await start()
        console.log(`app up with eyes open on ${PORT}: ${info.Browser}`)
        break
      }

      case 'shot': {
        const b = await eyes({ requireDoc: REQUIRE_DOC })
        const path = arg ?? 'app.png'
        const size = await b.eval('JSON.stringify({w: innerWidth, h: innerHeight})')
        await b.screenshot(path)
        await b.close()
        console.log(path)

        // A minimized window screenshots as a blank frame, and says nothing
        // about it.
        //
        // Found the hard way: a capture of the app at 3072x1658 came back
        // pure white while the DOM had 3,576 characters of text in it and
        // `body` computed to rgb(13,12,10). Nothing errored. The window was
        // simply minimized, and `Page.captureScreenshot` handed back an empty
        // frame rather than refusing - so the honest reading of that image
        // would have been "the app renders blank at 4K", which is a bug
        // report about the wrong thing entirely.
        //
        // `document.hidden` does not help: WebView2 reports `visible` and
        // `visibilityState: "visible"` for a minimized window. Measured.
        //
        // What does separate them is how well the PNG compresses, because a
        // uniform frame compresses to almost nothing. Calibrated against real
        // captures from this same tool:
        //
        //   blank, minimized   3072x1658   28,208 B   0.0055 B/px
        //   real dashboard     2105x945   411,292 B   0.207  B/px
        //   real, sparser      2105x945   110,791 B   0.056  B/px
        //
        // A tenfold gap between the blank and the least detailed real capture,
        // so the threshold sits well clear of both. This warns rather than
        // failing: a legitimately near-empty screen is possible, and the point
        // is that nobody reads a blank image as evidence without being told.
        try {
          const { w, h } = JSON.parse(size)
          const bytes = statSync(path).size
          const perPixel = bytes / (w * h)
          if (w * h > 0 && perPixel < 0.02) {
            console.error(
              `\nWARNING: ${bytes} bytes for ${w}x${h} is ${perPixel.toFixed(4)} bytes/pixel.\n` +
                '  That is the signature of a blank frame, not a rendered one. The window is\n' +
                '  most likely minimized - restore it and capture again. Do not read this\n' +
                '  image as evidence of what the app looks like.'
            )
          }
        } catch {
          // Size check is a courtesy, not the job. A screenshot that was
          // written is still worth having if this cannot measure it.
        }
        break
      }

      case 'text': {
        const b = await eyes({ requireDoc: REQUIRE_DOC })
        console.log(await b.eval('document.body.innerText'))
        await b.close()
        break
      }

      case 'click': {
        if (!arg) throw new Error('click needs a CSS selector')
        const b = await eyes({ requireDoc: REQUIRE_DOC })
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
        const b = await eyes({ requireDoc: REQUIRE_DOC })
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
        const b = await eyes({ requireDoc: REQUIRE_DOC })
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
