/**
 * Frontends, and the prefix each one uses to start a Lich script.
 *
 * This exists because of one line in the Lich help channel:
 *
 *     "genie uses commas to start lich scripts, every other FE uses semicolon"
 *
 * Every instruction this app gave said `;companion_bridge`. For a Genie user
 * that is simply wrong, and the failure is silent: Genie treats it as a game
 * command, the game says it does not understand, and the bridge never starts.
 * A first-run instruction that does not work for the most common frontend is
 * about as bad as a first-run instruction gets.
 *
 * The wider point, and the reason this file is a list rather than a boolean:
 * **DR Companion is a GUI for Lich, and Lich is frontend-agnostic.** Genie is
 * the most common one, not the only one, and the community is actively using
 * several others. Treating Genie as required would narrow the audience for no
 * reason.
 */

export interface Frontend {
  id: string
  label: string
  /** What you type before a Lich script name. */
  prefix: ';' | ','
  /** The flag Lich is launched with for this frontend, where one exists. */
  lichFlag: string | null
  /** Executables to look for when detecting it. */
  executables: string[]
  /** Folder names it is commonly installed under. */
  folders: string[]
  note?: string
}

export const FRONTENDS: Frontend[] = [
  {
    id: 'genie',
    label: 'Genie',
    // The one that is different, and the most widely used.
    prefix: ',',
    lichFlag: '--genie',
    executables: ['Genie.exe', 'Genie4.exe', 'Genie5.exe', 'GenieClient.exe'],
    folders: ['Genie', 'Genie4', 'Genie5', 'GenieClient', 'Genie Client'],
    note: 'Genie starts Lich scripts with a comma, not a semicolon.',
  },
  {
    id: 'wrayth',
    label: 'Wrayth',
    prefix: ';',
    lichFlag: '--wrayth',
    executables: ['Wrayth.exe', 'StormFront.exe'],
    folders: ['Wrayth', 'StormFront'],
    note: 'Formerly StormFront. Simutronics’ long-running Windows client.',
  },
  {
    id: 'frostbite',
    label: 'Frostbite',
    prefix: ';',
    lichFlag: '--frostbite',
    executables: ['Frostbite.exe'],
    folders: ['Frostbite'],
    note: 'Community client. Uses Genie’s map files for its built-in mapper.',
  },
  {
    id: 'saga',
    label: 'Saga',
    prefix: ';',
    lichFlag: null,
    executables: ['Saga.exe'],
    folders: ['Saga'],
    note: 'Simutronics’ newer client. Reducing typeahead helps script-driven movement.',
  },
  {
    id: 'avalon',
    label: 'Avalon',
    prefix: ';',
    lichFlag: '--avalon',
    executables: ['Avalon.exe'],
    folders: ['Avalon'],
  },
  {
    id: 'profanity',
    label: 'ProfanityFE',
    prefix: ';',
    lichFlag: '--profanity',
    executables: ['profanity'],
    folders: ['ProfanityFE', 'profanity'],
    note: 'Terminal client from elanthia-online.',
  },
  {
    id: 'other',
    label: 'Something else',
    prefix: ';',
    lichFlag: null,
    executables: [],
    folders: [],
    note: 'Every frontend except Genie uses a semicolon.',
  },
]

export const DEFAULT_FRONTEND = 'genie'

export function frontendById(id: string): Frontend {
  return FRONTENDS.find((f) => f.id === id) ?? FRONTENDS[0]!
}

/** The prefix for a frontend, defaulting to the safe majority case. */
export function prefixFor(id: string | null | undefined): string {
  if (!id) return ';'
  return frontendById(id).prefix
}

/**
 * How to start the bridge, spelled for the frontend in use.
 *
 * Everywhere the app tells someone to run a Lich script should go through
 * here rather than hardcoding a punctuation mark.
 */
export function bridgeCommand(frontendId: string | null | undefined, arg?: string): string {
  const p = prefixFor(frontendId)
  return arg ? `${p}companion_bridge ${arg}` : `${p}companion_bridge`
}

/** Guess the frontend from a detected executable path. */
export function frontendFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const lower = path.toLowerCase()
  for (const f of FRONTENDS) {
    if (f.executables.some((e) => lower.endsWith(e.toLowerCase()))) return f.id
  }
  return null
}
