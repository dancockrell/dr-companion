import { ExternalLink } from 'lucide-react'

/**
 * The reference links Lich's own `links` script prints to the console.
 *
 * Read from `links.lic` verbatim (`C:\Ruby4Lich5\Lich5\scripts\links.lic`),
 * not retyped from memory - the same rule as `highlights.ts`/`aliases.ts`
 * reading Genie's real config rather than an assumed shape. Two of the
 * script's twelve entries are left out on purpose, not by omission:
 *
 * - `Lich Discord` resolves `$DR_SCRIPTS_DISCORD_LINK`, a Lich global set at
 *   runtime. This module has no route to that value without a live Lich
 *   process to ask, and a guessed invite link would be exactly the kind of
 *   fabricated data this project's own history warns against - a link that
 *   looks right and quietly is not, in a panel offered as a place a player
 *   can go for real help.
 * - `Trigger to fix GENIE chat spam` is not a link. It is a Genie client
 *   command (`#queue clear;#send 1 ,chat #queue clear`), and this app is not
 *   Genie - it has no `#queue`, and the bug it works around is specific to
 *   Genie's own chat window.
 */
const LINKS: { title: string; url: string }[] = [
  {
    title: 'Getting Help with Lich',
    url: 'https://github.com/elanthia-online/dr-scripts/wiki/Getting-Help-With-Lich',
  },
  {
    title: 'Lich & DR-Scripts Wiki',
    url: 'https://github.com/elanthia-online/dr-scripts/wiki',
  },
  {
    title: 'Script Settings Documentation',
    url: 'https://elanthipedia.play.net/Lich_script_repository',
  },
  {
    title: 'Guild Scripting Tutorials',
    url: 'https://github.com/elanthia-online/dr-scripts/wiki/DR-Scripts-Tutorials',
  },
  {
    title: 'Hunting Ladder Spreadsheet',
    url: 'http://i.imgur.com/lCcb3rD.jpg',
  },
  {
    title: 'Add and Check Known Issues',
    url: 'https://github.com/elanthia-online/dr-scripts/issues',
  },
  {
    title: 'Recent Script Changes (Updated Weekly)',
    url: 'https://github.com/elanthia-online/dr-scripts/wiki/dr-scripts-update-summary',
  },
  {
    title: 'YAML Validator',
    url: 'http://yaml-online-parser.appspot.com/',
  },
  {
    title: 'Player Shops',
    url: 'http://drservice.info/Plaza/',
  },
  {
    title: 'Lich mapping guide',
    url: 'https://elanthipedia.play.net/Lich_mapping_reference',
  },
]

export function LinksPanel() {
  return (
    <ul className="space-y-1">
      {LINKS.map((l) => (
        <li key={l.url}>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-info hover:underline"
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate">{l.title}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
