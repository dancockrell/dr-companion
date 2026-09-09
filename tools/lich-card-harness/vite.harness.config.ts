/**
 * A dev server for the Lich-card harness, and nothing else.
 *
 * Separate from `vite.config.ts` on purpose: the alias below replaces the app's
 * Rust boundary with a stub, which must never be reachable from the real dev
 * server or the build. Root is this directory, so `index.html` here is the only
 * entry, and `src/` is reached by relative import.
 *
 * The port is passed by `tools/lich-card-shots.mjs` rather than fixed here:
 * several sessions run dev servers on this machine and 1420, 5180 and 5184 are
 * spoken for. `strictPort` so a taken port is an error rather than a silent
 * move to another one - a shot taken against somebody else's server is the
 * failure this whole lane is about.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(root, 'src') },
      // Matched against the *import specifier*, which components write
      // relatively (`../../lib/tauri.ts`) - a pattern naming `src/` matches
      // nothing and the card then renders null, which looks like a broken
      // page rather than a broken alias. The whole id must match, because
      // Vite replaces the matched portion and a partial match yields a
      // mangled path. `tools/lich-card-shots.mjs` fails loudly on an empty
      // render, which is what caught this.
      {
        find: /^.*\/lib\/tauri\.ts$/,
        replacement: path.resolve(here, 'tauri-stub.ts'),
      },
    ],
  },
  server: { host: '127.0.0.1', strictPort: true },
})
