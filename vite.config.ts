import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
     * `data/` needs the same treatment, for the same reason with a worse
     * outcome. It holds the art pipeline's vendored ComfyUI venv
     * (`data/art/comfy-venv`, tens of thousands of files under
     * site-packages - torch, setuptools, comfy_angle) which `art-daemon.mjs`
     * writes into continuously. Watching it unignored crashed a dev server
     * outright: chokidar held the whole tree open, the daemon kept touching
     * files under it, and the process ran out of heap and died with
     * "JavaScript heap out of memory" after about 74 minutes - not a hang, a
     * hard crash that took the dev server, and whatever was attached to it,
     * down without warning. Measured on this machine, not assumed: the
     * crash log names data/art/comfy-venv specifically as what was still
     * being reloaded in the seconds before it went down.
     *
     * # Anchored to the project root, and that is not a detail
     *
     * The first version was an unanchored double-star glob around `data`, and
     * that also matches **`src/data/`** - 23 source files including
     * `taskFlows.ts`,
     * `scriptCatalog.ts`, `macros.ts`, `demoMap.ts` and the bestiary. Editing
     * any of them stopped triggering a reload, silently, while every other
     * source file kept working normally.
     *
     * The failure it produced was nothing like its cause. An export added to
     * `src/data/taskFlows.ts` never reached the dev server, its importer asked
     * for a name the served module did not have, that threw a `SyntaxError`
     * during module evaluation, React never mounted, and **the app opened as a
     * blank white window**. The production build was clean throughout, because
     * the build does not use the watcher at all.
     *
     * Measured rather than reasoned: picomatch returns true for
     * `src/data/taskFlows.ts` against that glob. Anchoring to `root` keeps the
     * fix that was
     * intended (the whole top-level `data/`, venv included) and stops it
     * reaching into `src/`.
     */
    watch: {
      ignored: [
        path.resolve(root, 'src-tauri') + '/**',
        path.resolve(root, 'data') + '/**',
      ],
    },
  },
  clearScreen: false,
})
