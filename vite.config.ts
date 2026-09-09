import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The repository enforces raw and gzip startup budgets from the built
  // artifact in tools/bundle-test.mjs. Keep Vite's generic warning aligned
  // with that measured limit so CI has one actionable threshold, not two
  // contradictory ones.
  build: { chunkSizeWarningLimit: 1700 },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    /**
     * The address Tauri actually polls.
     *
     * Without this, Vite binds `localhost`, which on a machine with IPv6
     * enabled resolves to `::1`. `tauri.conf.json` sets devUrl to
     * `http://127.0.0.1:1420` - a different address - so `tauri dev` printed
     * "Waiting for your frontend dev server to start" forever and no window
     * ever appeared. The dev server was up the whole time, answering on
     * localhost.
     *
     * That is the entire desktop app unable to start, presenting as a hang
     * rather than an error: the log line is literally true and reads like
     * patience. It stayed hidden because a browser and the browser pane both
     * use `localhost`, so everything anyone actually looked at worked.
     *
     * Bound explicitly rather than set to `true`. `true` listens on every
     * interface, which puts a dev server on the local network that nobody
     * asked for.
     */
    host: '127.0.0.1',

    /**
     * Do not watch the Rust build directory.
     *
     * Vite watches the whole project root, which includes
     * `src-tauri/target` - tens of thousands of files that Cargo is writing
     * while the app builds. On Windows the watcher opens a handle on a
     * `.dll` Cargo currently has locked, throws `EBUSY`, and takes the dev
     * server down with it. Tauri then reports only that its
     * `beforeDevCommand` exited non-zero, which says nothing about a file
     * watcher.
     *
     * This exclusion is in Tauri's own Vite template and was missing here.
     * Together with the host binding above it is the second of two reasons
     * `tauri dev` had never produced a window on this machine.
     *
     * `data/art/comfy-venv` and `data/art/out` need the same treatment, for
     * the same reason with a worse outcome. `comfy-venv` is the art
     * pipeline's vendored ComfyUI venv - tens of thousands of files under
     * site-packages (torch, setuptools, comfy_angle) - and `out` is its
     * generated renders, both written into continuously by
     * `art-daemon.mjs`. Watching either unignored crashed a dev server
     * outright: chokidar held the tree open, the daemon kept touching files
     * under it, and the process ran out of heap and died with "JavaScript
     * heap out of memory" after about 74 minutes - not a hang, a hard
     * crash that took the dev server, and whatever was attached to it, down
     * without warning. Measured on this machine, not assumed: the crash log
     * named data/art/comfy-venv specifically as what was still being
     * reloaded in the seconds before it went down.
     *
     * # Two wrong-shaped fixes already tried, both measured rather than
     * # assumed correct before being narrowed further
     *
     * The first version was an unanchored double-star glob around `data`,
     * which also matched **`src/data/`** - 23 source files including
     * `taskFlows.ts`, `scriptCatalog.ts`, `macros.ts`, `demoMap.ts` and the
     * bestiary. Editing any of them stopped triggering a reload, silently.
     * The failure was nothing like the cause: an export added to
     * `src/data/taskFlows.ts` never reached the dev server, its importer
     * asked for a name the served module did not have, that threw a
     * `SyntaxError` during module evaluation, React never mounted, and
     * **the app opened as a blank white window**. Fixed by anchoring to
     * `root`.
     *
     * The second version ignored all of `data/` (root-anchored, so it did
     * not repeat the first mistake) - and that silently broke hot-reload
     * for `data/audio/manifest.json`, which the ambient-audio system reads
     * as a real ES module import (`with { type: 'json' }`), not just a
     * static asset. Editing the manifest updated the file on disk and
     * nothing else: Vite kept serving a stale cached transform of it
     * indefinitely, because its watcher was told never to look at anything
     * under `data/` in the first place. A radio/zone-playlist change that
     * looked correct in every static read of the source produced zero new
     * `Audio.play()` calls in the running app until the dev server was
     * restarted by hand - the exact "looks right, does nothing" shape this
     * whole file exists to prevent, just moved one directory over. Fixed by
     * naming the two churny directories specifically rather than their
     * parent.
     */
    watch: {
      ignored: [
        path.resolve(root, 'src-tauri') + '/**',
        path.resolve(root, 'data/art/comfy-venv') + '/**',
        path.resolve(root, 'data/art/out') + '/**',
        // Generated atlas masters and source renders are production inputs,
        // not live modules. Windows can hold them locked while they are cut,
        // which otherwise kills the preview watcher with EBUSY.
        path.resolve(root, 'data/art/map-stamp-sources') + '/**',
        /*
         * Logs and capture files written into the project root while the dev
         * server is up. Measured, not guessed (9 September 2026, issue #532).
         *
         * A session recorder was appending to `lane-live-capture/events.jsonl`
         * and `lane-live-capture/tauri-dev.log` inside the watched root, and
         * every append was a change to a watched file, so Vite issued a
         * full-reload. `Page.frameNavigated` over CDP against the running app:
         * `reason=reload`, same URL, **every 2 to 6 seconds**, indefinitely.
         *
         * That is not a cosmetic annoyance. A reload destroys the document, so
         * every timer in it dies and every mount effect runs again - which for
         * the bridge means the reconnect run restarts at attempt zero forever
         * and can never reach its own bound. Sampled over 40 seconds, the
         * footer never got past `1/8`. It is the second half of why Dan's
         * build sat amber "indefinitely" rather than settling after two
         * minutes: the ladder was honest about being bounded and was simply
         * never allowed to finish.
         *
         * Named as suffixes rather than as one directory on purpose. The
         * directory is a lane's scratch name and the next one will pick a
         * different one; a log or a capture file anywhere in the root is never
         * a live module, and this file's own history is two fixes that were
         * right about the churn and wrong about the scope.
         */
        path.resolve(root, '**/*.log'),
        path.resolve(root, '**/*.jsonl'),
      ],
    },
  },
  clearScreen: false,
})
