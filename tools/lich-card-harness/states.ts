/**
 * The machine answers that select each of the Lich card's states.
 *
 * One entry per branch in `LichLauncher`'s render body. `tools/lich-card-test.mjs`
 * derives that branch list from the component's own source and asserts a
 * sentence for each, so this file is the photographic companion to a check that
 * already counts them - not a second, drifting list of what the states are.
 *
 * The `note` strings are the ones `lich_status` builds (`src-tauri/src/lich.rs`),
 * copied because a browser cannot call Rust. They are asserted against the Rust
 * source by `tools/lich-card-test.mjs`'s companion check.
 */
export interface HarnessState {
  slug: string
  status: Record<string, unknown>
  health?: Record<string, unknown> | null
}

const INSTALLED = {
  installDir: 'C:/Ruby4Lich5/Lich5',
  launcher: 'C:/Ruby4Lich5/Lich5/lich.rbw',
  ruby: 'C:/Ruby4Lich5/bin/rubyw.exe',
  dataDir: 'C:/Ruby4Lich5/Lich5/data',
  runningKnown: true,
}

const READY_NOTE = 'Lich is installed and not running.'

export const STATES: HarnessState[] = [
  {
    slug: 'ready',
    status: { ...INSTALLED, running: false, guiLoginUsable: false, note: READY_NOTE },
  },
  {
    slug: 'gui-usable',
    status: { ...INSTALLED, running: false, guiLoginUsable: true, note: READY_NOTE },
  },
  {
    // What Dan pressed "Why won't it start?" and got: the green line stays,
    // and nothing red stands beside it any more.
    slug: 'health-ok',
    status: { ...INSTALLED, running: false, guiLoginUsable: false, note: READY_NOTE },
    health: {
      boots: true,
      version: '5.20.1',
      problem: null,
      diagnosis: null,
      remedy: null,
      note: 'The Lich, version 5.20.1 starts cleanly.',
    },
  },
  {
    slug: 'health-broken',
    status: { ...INSTALLED, running: false, guiLoginUsable: false, note: READY_NOTE },
    health: {
      boots: false,
      version: null,
      problem: "lich.rbw:24:in `require': cannot load such file -- sqlite3",
      diagnosis: 'A gem Lich needs is not installed.',
      remedy: 'Run Setup again, or install the gems from the Lich folder.',
      note: 'Lich is installed but does not start.',
    },
  },
  {
    slug: 'running',
    status: { ...INSTALLED, running: true, guiLoginUsable: false, note: 'Lich is already running.' },
  },
  {
    slug: 'not-installed',
    status: {
      installDir: null,
      launcher: null,
      ruby: null,
      dataDir: null,
      running: false,
      runningKnown: true,
      guiLoginUsable: false,
      note: 'Lich is not installed where the app can find it.',
    },
  },
  {
    slug: 'no-ruby',
    status: {
      installDir: 'C:/Ruby4Lich5/Lich5',
      launcher: 'C:/Ruby4Lich5/Lich5/lich.rbw',
      ruby: null,
      dataDir: null,
      running: false,
      runningKnown: true,
      guiLoginUsable: false,
      note: 'Lich is here but Ruby is not, and Lich is a Ruby program.',
    },
  },
]
