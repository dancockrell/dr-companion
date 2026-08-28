/**
 * Curation layer over the bridge's `script_catalog` payload (a flat list of
 * raw filenames from `list_scripts`, source: `lich-scripts/companion_bridge.lic`).
 *
 * The bridge enumerates; this file decides what that enumeration means to a
 * player. 234 scripts cannot become 234 identical buttons — this is the
 * grouping, promotion and exclusion logic that keeps the Script Library
 * legible. See docs/DESIGN.md §2.1, §5 and build order step 5.
 *
 * Ruled by DR Prime (session downloads-e7), 2026-08-27: three tiers, the
 * hidden list, and the twelve categories below are approved as the taxonomy.
 *
 * Every `description` is short by design (DESIGN.md §2.5 — the panel shows
 * values, not sentences). `verified: true` means the description was written
 * from having read the script's own source; `verified: false` means it was
 * inferred from the script's name and general DragonRealms/dr-scripts
 * knowledge and has not been checked against the file. dr-scripts carries no
 * in-source description convention beyond an Elanthipedia doc link (checked
 * combat-trainer.lic, craft.lic, coordinator.lic, hunting-buddy.lic,
 * newbie-gear.lic, taskmaster.lic — none), so "unverified" is the honest
 * default and is a field on the entry, never buried in a comment.
 */

export type ScriptTier = 'promoted' | 'standard' | 'hidden'

export const SCRIPT_CATEGORIES = [
  'Combat & Survival',
  'Training & Skills',
  'Hunting & Scheduling',
  'Crafting',
  'Travel & Navigation',
  'Money, Trade & Inventory',
  'Character Setup & Config',
  'Foraging & Gathering',
  'Companions & Pets',
  'Monitoring & Notifications',
  'Quests & Events',
  'Risk & Consequence',
  // Fallback only. Never assigned deliberately — a script with no catalog
  // entry lands here rather than disappearing, per the "silent omission is
  // its own bug" ruling. A name showing up here is a prompt to curate it,
  // not a stable resting place.
  'Uncategorized',
] as const

export type ScriptCategory = (typeof SCRIPT_CATEGORIES)[number]

export interface ScriptCatalogEntry {
  category: ScriptCategory
  tier: ScriptTier
  /** Display label, if it should differ from the raw script name. */
  label?: string
  /** Short, one-line. Present for every standard/promoted entry. */
  description?: string
  /** Was `description` read from the script's own source? */
  verified: boolean
  /**
   * Risk & Consequence only: what actually happens on failure, not just that
   * it's "risky". Per DESIGN.md §6 — the consequence half of a Situation
   * matters as much as the odds, and it differs by where you do the thing.
   */
  riskNote?: string
  /**
   * Promoted only: where the real first-class control for this script lives
   * (or is speced to live), so the Script Library can point there instead of
   * rendering a second, redundant raw launch button.
   */
  realControl?: string
}

/**
 * Scripts that were filed as engine tooling and are not.
 *
 * The `HIDDEN` list below means "not a player activity, so no control is
 * owed". Thirteen entries in it failed that test when their source was
 * actually read - `alias` ships its own GTK settings tab, `autostart` exists
 * so a player can choose what runs at login, `esp` opens and closes thought
 * channels. Players wrote these for a reason, and hiding them meant the app
 * silently offered less than Lich does.
 *
 * Same reasoning as the earlier correction to `download-prime-map` further
 * down: visible as "a control is owed" beats invisible as "never a player
 * action", because the second is unfalsifiable from the UI - nobody can
 * discover what was withheld.
 *
 * `verified: true` on every one of these: the description comes from the
 * script's own source, quoted in the comment beside it, not from its name.
 * The line count is there because it is the cheapest honest signal that
 * something is a feature rather than a stub - `noop` is 14 lines, `alias` is
 * 520.
 */
const RECLASSIFIED: Record<string, ScriptCatalogEntry> = {
  // 520 lines, and it builds `Gtk::Box` tabs - it has a settings UI of its own.
  'alias': {
    category: 'Character Setup & Config',
    tier: 'standard',
    verified: true,
    description: 'Define command shortcuts, with its own settings window.',
  },
  // "#{...} is already set to start at login for all characters"
  'autostart': {
    category: 'Character Setup & Config',
    tier: 'standard',
    verified: true,
    description: 'Choose which scripts start automatically at login.',
  },
  // Matches /you (open|close) your mind to the #{channel} channel/
  'esp': {
    category: 'Monitoring & Notifications',
    tier: 'standard',
    verified: true,
    description: 'Opens and closes ESP thought channels.',
  },
  // "Show help menu if no NPC specified."
  'find': {
    category: 'Travel & Navigation',
    tier: 'standard',
    verified: true,
    description: 'Locates an NPC and tells you where they are.',
  },
  // "Super simple script to show some useful links"
  'links': {
    category: 'Character Setup & Config',
    tier: 'standard',
    verified: true,
    description: 'Shows useful DragonRealms reference links.',
  },
  // "For usage, see https://elanthipedia.play.net/Lich_script_repository#schedule"
  'schedule': {
    category: 'Hunting & Scheduling',
    tier: 'standard',
    verified: true,
    description: 'Runs scripts on a schedule.',
  },
  // "Links text to Elanthipedia" - SELF.ELANTHIPEDIA, MikeLC 2/15/2025
  'textsubs': {
    category: 'Character Setup & Config',
    tier: 'standard',
    verified: true,
    description: 'Substitutes text in game output, including Elanthipedia links.',
  },
  // "When trigger command =exec has been used. Executes a specified script..."
  'trigger-watcher': {
    category: 'Monitoring & Notifications',
    tier: 'standard',
    verified: true,
    description: 'Runs a script when a trigger fires.',
  },
  // "--- variable #{name} changed to: #{value} (was #{old_value})"
  'vars': {
    category: 'Character Setup & Config',
    tier: 'standard',
    verified: true,
    description: 'Views and sets Lich variables for this character.',
  },
  // 607 lines; "No matching scripts found!" - it searches and reports versions.
  'version': {
    category: 'Character Setup & Config',
    tier: 'standard',
    verified: true,
    description: 'Checks installed script versions and finds outdated ones.',
  },
  // "Your version of Lich is too old for this script." - session logging.
  'log': {
    category: 'Monitoring & Notifications',
    tier: 'standard',
    verified: true,
    description: 'Logs the session to a file.',
  },
  'logxml': {
    category: 'Monitoring & Notifications',
    tier: 'standard',
    verified: true,
    description: 'Logs the raw XML stream, for diagnosing parsing problems.',
  },
  // "Required gems missing that are needed for newer version of Lich5."
  // A control is owed here for the same reason as download-prime-map: this is
  // how Lich updates itself, and burying it means the app cannot offer the fix
  // for a class of problem it can already detect.
  'lich5-update': {
    category: 'Character Setup & Config',
    tier: 'standard',
    verified: true,
    description: 'Updates Lich itself to a newer version.',
  },
}

const HIDDEN: Record<string, ScriptCatalogEntry> = Object.fromEntries(
  [
    'dependency',
    'echo',
    'help-me',
    'mock',
    'noop',
    'register',
    // `repeat` is 15 lines and only re-issues a command a script already has;
    // there is nothing here a player sets up or configures, so unlike the
    // thirteen moved into RECLASSIFIED above, this one really is plumbing.
    'repeat',
    'wait',
    'dr-scripts_install',
    // Our own bridge. Excluded by name alongside the rest of Lich's own
    // tooling, not as a special case — it is not a player action either.
    'companion_bridge',
  ].map((name) => [
    name,
    {
      category: 'Uncategorized',
      tier: 'hidden',
      verified: false,
      description: 'Lich/dr-scripts engine tooling, not a player activity.',
    } satisfies ScriptCatalogEntry,
  ]),
)

const PROMOTED: Record<string, ScriptCatalogEntry> = {
  'go2': {
    category: 'Travel & Navigation',
    tier: 'promoted',
    description: 'Walks to any tagged destination — town, guild, locker and more.',
    verified: false,
    realControl: 'Route preview → go2 walk action (DESIGN.md §2.1, §2.12).',
  },
  'weararmor': {
    category: 'Combat & Survival',
    tier: 'promoted',
    description: "Switches to a named gear set in one command.",
    verified: false,
    realControl: 'Gear profile panel (DESIGN.md §2.9).',
  },
  'healer': {
    category: 'Combat & Survival',
    tier: 'promoted',
    description: 'Finds and walks to a healer suited to your wounds and account tier.',
    verified: false,
    realControl: 'Snooze sequence and the capability-aware go_healer intent (DESIGN.md §2.10; BRIDGE_CONTRACT.md).',
  },
  'healme': {
    category: 'Combat & Survival',
    tier: 'promoted',
    description: 'Casts or uses your own healing on yourself.',
    verified: false,
    realControl: 'Snooze sequence (DESIGN.md §2.10).',
  },
  'tendme': {
    category: 'Combat & Survival',
    tier: 'promoted',
    description: 'Tends your own bleeding wounds.',
    verified: false,
    realControl: 'Snooze sequence (DESIGN.md §2.10).',
  },
  'gosafe': {
    category: 'Combat & Survival',
    tier: 'promoted',
    description: 'Retreats to your configured safe room.',
    verified: false,
    realControl: 'Snooze sequence (DESIGN.md §2.10) — already 15 lines per the design doc.',
  },
  'coordinator': {
    category: 'Hunting & Scheduling',
    tier: 'promoted',
    description: 'Priority task scheduler — runs hunting, town and cleanup tasks from YAML predicates.',
    verified: false,
    realControl: 'Workflow editor over coordinator_* keys (DESIGN.md §2.2).',
  },
  'combat-trainer': {
    category: 'Training & Skills',
    tier: 'promoted',
    description: 'The dr-scripts combat loop: engages, defends, buffs and heals per your YAML setup.',
    verified: true,
    realControl: 'Mindstate/throughput board (DESIGN.md §2.35).',
  },
  'crossing-training': {
    category: 'Training & Skills',
    tier: 'promoted',
    description: "Cycles roughly 28 town-trainable skills so pools don't sit idle.",
    verified: false,
    realControl: 'Mindstate/throughput board (DESIGN.md §2.35).',
  },
  'training-manager': {
    category: 'Training & Skills',
    tier: 'promoted',
    description: 'Alternates hunting and town training based on which skills are running low.',
    verified: false,
    realControl: 'Mindstate/throughput board (DESIGN.md §2.35).',
  },
  'newbie-gear': {
    category: 'Character Setup & Config',
    tier: 'promoted',
    description: 'Scavenges donation shelves and chests for a basic starter kit.',
    verified: false,
    realControl: "Starter loop — the 'donation-shelf gear run' (DESIGN.md §2.8).",
  },
  'new-character': {
    category: 'Character Setup & Config',
    tier: 'promoted',
    description: 'Guides a brand-new character through initial setup steps.',
    verified: false,
    realControl: 'Starter-loop onboarding path (DESIGN.md §2.8).',
  },
  // Corrected by Prime's ruling: these were proposed hidden, but hiding them
  // would make the map database unreachable from the app with no button
  // anywhere to fix it. install_mapdb already runs one of these two; neither
  // has a UI control yet, so they stay visible as "a control is owed" rather
  // than disappearing as "never a player action".
  'download-prime-map': {
    category: 'Travel & Navigation',
    tier: 'promoted',
    description: "Downloads Lich's Prime map database from the Lich project's own repository.",
    verified: false,
    realControl:
      "The install_mapdb bridge intent — implemented in Ruby (companion_bridge.lic), not yet called from any UI. No button owns this control today.",
  },
  'repository': {
    category: 'Travel & Navigation',
    tier: 'promoted',
    description: "Lich's script repository client — downloads and updates scripts and the map database.",
    verified: false,
    realControl:
      'Fallback path for install_mapdb when download-prime-map is absent. Same unbuilt-button status.',
  },
}

const STANDARD: Record<string, ScriptCatalogEntry> = {
  'accept-sell': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: "Accepts a shop's sell offer automatically." },
  'addroom': { category: 'Travel & Navigation', tier: 'standard', verified: false, description: 'Adds an unmapped room to the local map data.' },
  'afk': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Marks you away and watches for nearby danger while unattended.' },
  'alchemy': { category: 'Crafting', tier: 'standard', verified: false, description: 'Trains and runs the alchemy crafting loop.' },
  'almanac': { category: 'Travel & Navigation', tier: 'standard', verified: false, description: "Looks up in-game calendar, season and moon data." },
  'appraisal': { category: 'Crafting', tier: 'standard', verified: false, description: 'Trains Appraisal by identifying items in inventory.' },
  'arenawatch': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Watches for arena events and announces matches.' },
  'arrows': { category: 'Crafting', tier: 'standard', verified: false, description: 'Crafts arrows for archery.' },
  'astrology': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Runs Astrology training via the observatory.' },
  'athletics': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Trains Athletics through climbing, swimming and jumping.' },
  'attunement': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Handles attunement-related training or upkeep.' },
  'autocontingency': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Sets automatic contingency spells to trigger on danger.' },
  'automap': { category: 'Travel & Navigation', tier: 'standard', verified: false, description: 'Builds and updates the local room map as you walk.' },
  'avtalia': { category: 'Companions & Pets', tier: 'standard', verified: false, description: 'Manages an Avtalia companion.' },
  'bankbot': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Automates bank deposits and withdrawals.' },
  'bard-whistle': { category: 'Companions & Pets', tier: 'standard', verified: false, description: "Handles a Bard's whistle summon routine." },
  'bescort': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: 'Escorts or follows a designated player.' },
  'better-book': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Improves reading and using in-game books.' },
  'boggle_blast': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Boggle Blast seasonal event.' },
  'bolts': { category: 'Crafting', tier: 'standard', verified: false, description: 'Crafts crossbow bolts.' },
  'bonding-rose': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles a bonding-rose holiday event item.' },
  'buff': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Casts your standard pre-fight buff spells.' },
  'buff-watcher': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Watches active buffs and warns when they expire.' },
  'buffother': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Buffs another player or group member.' },
  'bug-grabber': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Captures in-game bug report text for submission.' },
  'burgle': {
    category: 'Risk & Consequence',
    tier: 'standard',
    verified: false,
    description: 'Breaks into houses to steal from containers.',
    riskNote:
      "Caught = jail (a fine and lost time); in a clan house it's maiming instead. Same crime, very different cost depending on where you do it (DESIGN.md §6).",
  },
  'capture-critter': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Catches small creatures for taming or collection.' },
  'card-collector': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Collects seasonal or event trading cards.' },
  'carve': { category: 'Crafting', tier: 'standard', verified: false, description: 'Carving crafting loop.' },
  'carve-bead': { category: 'Crafting', tier: 'standard', verified: false, description: 'Carves prayer or trade beads.' },
  'carve-lockpicks': { category: 'Crafting', tier: 'standard', verified: false, description: 'Carves lockpicks from wood.' },
  'cast': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Casts a specified spell, once or on a loop.' },
  'charge-elemental-charge': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Recharges an elemental charge item.' },
  'charge-holy-weapon': { category: 'Combat & Survival', tier: 'standard', verified: false, description: "Recharges a holy weapon's charge." },
  'checkfavors': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Reports your current favor count from the gods.' },
  'chop-wood': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Chops wood for lumber.' },
  'circlecheck': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Reports circle and experience needed for the next.' },
  'clean-leather': { category: 'Crafting', tier: 'standard', verified: false, description: 'Cleans and tans leather for crafting.' },
  'clean-lumber': { category: 'Crafting', tier: 'standard', verified: false, description: 'Cleans lumber for woodworking.' },
  'cleric-quests': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs Cleric guild quest chains.' },
  'clerk-tools': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Helper commands for interacting with shop clerks.' },
  'commune': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Prays to your deity for guidance or favor.' },
  'corn-maze': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the harvest-season corn maze event.' },
  'craft': { category: 'Crafting', tier: 'standard', verified: false, description: 'General crafting loop: forging, outfitting, engineering, alchemy or enchanting.' },
  'create_remedies': { category: 'Crafting', tier: 'standard', verified: false, description: 'Brews first-aid remedies.' },
  'crossing-repair': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Repairs gear as part of a town-training loop.' },
  'crowns': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles a holiday crown or gift event.' },
  'discern': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Reads magical or divination detail off an item or effect.' },
  'droughtmans': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs a seasonal drought-themed event.' },
  'dusk-labyrinth': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Dusk Labyrinth event puzzle.' },
  'edityaml': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'In-game text editor for a dr-scripts YAML profile.' },
  'empathylink': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Links empath group-heal targeting.' },
  'enchant': { category: 'Crafting', tier: 'standard', verified: false, description: 'Enchants weapons and armor.' },
  'examine': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Looks up detail on an examined item or creature.' },
  'expreset': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Resets the session experience baseline used to measure gains.' },
  'faskinner': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Skins creature corpses quickly.' },
  'faux-atmo': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Simulates ambient atmospheric messaging.' },
  'favor': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Tracks and reports deity favor status.' },
  'feed-cloak': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Feeds a familiar or cloak-bound creature during an event.' },
  'fenvol-puzzle': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Fenvol seasonal puzzle event.' },
  'fill-dirt': { category: 'Crafting', tier: 'standard', verified: false, description: 'Fills containers with dirt for gardening or crafting.' },
  'find-darkbox': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Searches for hidden dark boxes.' },
  'fir': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles a fir or holiday-tree event.' },
  'first-aid': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Applies first aid to stop bleeding and treat wounds.' },
  'forestry-buddy': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Automates lumberjacking and forestry gathering.' },
  'forge': { category: 'Crafting', tier: 'standard', verified: false, description: 'Forging crafting loop.' },
  'gate': { category: 'Travel & Navigation', tier: 'standard', verified: false, description: 'Casts or uses a teleportation gate.' },
  'gbox': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Purpose not confirmed against source — name pattern matches gpouch/gscroll container helpers.' },
  'generate-profile': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Scans your character and proposes a starting dr-scripts YAML profile.' },
  'get2': { category: 'Travel & Navigation', tier: 'standard', verified: false, description: 'Fetches an item or container by name, walking there if needed.' },
  'glyph-of-mana': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Uses a glyph-of-mana item for mana recovery.' },
  'gmoney': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Reports and manages held coin across containers.' },
  'gpouch': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Manages a coin pouch.' },
  'gscroll': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Manages scroll inventory and use.' },
  'grave-pile': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles a graveyard event.' },
  'heal-remedy': { category: 'Crafting', tier: 'standard', verified: false, description: 'Brews healing remedies.' },
  'herb-stock': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Tracks and restocks herb supplies.' },
  'heroic-tattoo': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles a heroic event tattoo item.' },
  'horse-trainer': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Trains horsemanship.' },
  'hunting-buddy': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: 'General-purpose hunting loop: engage, loot, heal, repeat.' },
  'inventory-manager': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Sorts and manages inventory across containers.' },
  'invoke-rune': { category: 'Combat & Survival', tier: 'standard', verified: false, description: "Invokes a rune weapon's effect." },
  'jail-buddy': {
    category: 'Risk & Consequence',
    tier: 'standard',
    verified: false,
    description: 'Manages a jail sentence — waits it out or handles the consequence.',
    riskNote: 'The consequence side of burgle/steal (DESIGN.md §6): a jailed character is out of play until this resolves.',
  },
  'jinx': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Tracks a jinx or curse status effect.' },
  'join-thieves': {
    category: 'Risk & Consequence',
    tier: 'standard',
    verified: false,
    description: "Joins the thieves' guild questline.",
    riskNote: 'Gateway into burgle/steal content and its jail or maiming consequences.',
  },
  'journal': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Reads or writes your in-game journal.' },
  'kill-counter': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: 'Tallies kills during a hunting session.' },
  'knackstone': { category: 'Crafting', tier: 'standard', verified: false, description: 'Uses a knack stone to boost a crafting attempt.' },
  'lamprey': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Handles lamprey / fishing-related gathering.' },
  'learn-fou': { category: 'Training & Skills', tier: 'standard', verified: false, description: "Purpose not confirmed against source — name suggests a guided technique lesson." },
  'learned': { category: 'Training & Skills', tier: 'standard', verified: false, description: "Reports which techniques or spells you've learned." },
  'levelup': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Announces or logs circle level-up milestones.' },
  'lichbot': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'General Lich status and notification bot.' },
  'lockbox': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Manages a lockbox container.' },
  'locksmithing': { category: 'Crafting', tier: 'standard', verified: false, description: 'Trains Locksmithing by crafting and picking locks.' },
  'magic-training': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Runs a magic-skill training loop.' },
  'makesteel': { category: 'Crafting', tier: 'standard', verified: false, description: 'Smelts steel for forging.' },
  'map': { category: 'Travel & Navigation', tier: 'standard', verified: false, description: "Displays the current room's map and exit data." },
  'mech-lore': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Trains Mechanical Lore.' },
  'mine': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Mines ore in a loop.' },
  'mining-buddy': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Automates mining, moving between veins.' },
  'mining-manager': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Manages a mining session and its stock.' },
  'mm': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: "Purpose not confirmed against source — likely a short-form macro/task runner." },
  'mooniefill': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles a moon-related seasonal event.' },
  'moonwatch': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Watches moon phases for astrology timing.' },
  'multi': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: 'Runs several scripts together as one coordinated loop.' },
  'nexus': { category: 'Travel & Navigation', tier: 'standard', verified: false, description: 'Uses a nexus portal network for fast travel.' },
  'offload-items': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Drops or sells items to free up encumbrance.' },
  'om': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Purpose not confirmed against source.' },
  'oshu_manor': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Oshu Manor event.' },
  'outdoorsmanship': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Trains Outdoorsmanship — foraging, fire-building and the like.' },
  'paladin-quests': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs Paladin guild quest chains.' },
  'pattern-hues': { category: 'Crafting', tier: 'standard', verified: false, description: 'Applies pattern and hue options to crafted items.' },
  'pawn-items': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Pawns items for quick coin.' },
  'pay-debt': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Automatically pays off an owed debt.' },
  'performance': {
    category: 'Training & Skills',
    tier: 'standard',
    verified: false,
    description: 'Runs a Bard performance/song training loop.',
  },
  'performance-monitor': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Tracks in-progress performance state.' },
  'pick': {
    category: 'Risk & Consequence',
    tier: 'standard',
    verified: false,
    description: 'Picks locks on boxes and doors.',
    riskNote: 'A failed attempt can trap: acid, wounds or a ruined lock (DESIGN.md §6).',
  },
  'pilgrimage': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Guides a pilgrimage circuit for religious favor.' },
  'plantheal': { category: 'Crafting', tier: 'standard', verified: false, description: 'Grows and harvests healing plants.' },
  'play': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Plays a specific song for Performance training.' },
  'playermonitor': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Watches nearby players and reports arrivals.' },
  'pray-chadatru': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Prays at the Chadatru shrine event.' },
  'ranger-companion': { category: 'Companions & Pets', tier: 'standard', verified: false, description: "Manages a Ranger's animal companion." },
  'registergear': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Registers gear sets for scripts to recognise.' },
  'release_cyclic': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Releases a cyclical spell or effect.' },
  'remedy': { category: 'Crafting', tier: 'standard', verified: false, description: 'Brews or applies a remedy item.' },
  'repair': { category: 'Crafting', tier: 'standard', verified: false, description: 'Repairs damaged gear.' },
  'researcher': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Automates the Scholarship research activity.' },
  'restock': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Restocks consumables from a shop or storage.' },
  'restock-shop': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: "Restocks a player-run shop's inventory." },
  'rezz': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Handles resurrection-related actions.' },
  'riverhaven-thieves': {
    category: 'Risk & Consequence',
    tier: 'standard',
    verified: false,
    description: "Runs Riverhaven's thieves' guild content.",
    riskNote: 'Shares the burgle/steal consequence model — jail or worse on failure.',
  },
  'rummage': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Rummages containers and donation piles for usable items.' },
  'safe-room': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Defines or reports your configured safe room.' },
  'sanowret-crystal': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles the Sanowret crystal event item.' },
  'scouting': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: 'Scouts ahead for hunting or travel safety.' },
  'script-watch': {
    category: 'Monitoring & Notifications',
    tier: 'standard',
    verified: false,
    description: 'Watches running scripts and reports their state in a separate GTK window.',
  },
  'scroll-search': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Searches inventory and storage for a specific scroll.' },
  'sea-creature-grabber': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Catches sea creatures while fishing.' },
  'sell-loot': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Sells looted items to shops automatically.' },
  'sell-pouches': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Sells gathered material pouches.' },
  'setupaliases': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Sets up command aliases for other scripts.' },
  'sew': { category: 'Crafting', tier: 'standard', verified: false, description: 'Sewing and tailoring crafting loop.' },
  'shape': { category: 'Crafting', tier: 'standard', verified: false, description: 'Shapes a crafted item into its final form.' },
  'shit-list': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Tracks a personal list of flagged players or creatures.' },
  'shockquest': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs a Shock-themed event quest.' },
  'sigilharvest': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Harvests sigils during a seasonal event.' },
  'sigilrecorder': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Records collected sigils for an event.' },
  'smartlisten': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Listens for and reacts to specific trigger phrases.' },
  'smarttransfer': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Transfers items between containers.' },
  'smash-pumpkins': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the pumpkin-smashing autumn event.' },
  'smash-shells': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs a shell-smashing beach event.' },
  'smelt': { category: 'Crafting', tier: 'standard', verified: false, description: 'Smelts ore into usable metal.' },
  'smelt-deeds': { category: 'Crafting', tier: 'standard', verified: false, description: 'Smelts deed items for crafting materials.' },
  'smith': { category: 'Crafting', tier: 'standard', verified: false, description: 'Blacksmithing crafting loop.' },
  'smoke': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Uses smoke items for escape or cover.' },
  'sorcery': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Trains Sorcery lore.' },
  'sort-scrolls': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Sorts scrolls in inventory.' },
  'sorter': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'General inventory sorter across containers.' },
  'spin': { category: 'Crafting', tier: 'standard', verified: false, description: 'Spins thread or yarn for weaving.' },
  'spinner': { category: 'Crafting', tier: 'standard', verified: false, description: 'Runs a spinning-wheel crafting loop.' },
  'stabbity': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'A lightweight melee combat loop.' },
  'stack-scrolls': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Stacks and combines scrolls in inventory.' },
  'status-monitor': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Reports character status changes to the log.' },
  'steal': {
    category: 'Risk & Consequence',
    tier: 'standard',
    verified: false,
    description: 'Steals items from NPCs or players.',
    riskNote: 'Same jail/maiming consequence model as burgle (DESIGN.md §6).',
  },
  'study-art': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Studies a technique for skill gain.' },
  'su-helmas': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Su-Helmas event.' },
  'summoning': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Summons a creature or ally via ritual.' },
  'symbiosis': { category: 'Companions & Pets', tier: 'standard', verified: false, description: 'Manages a symbiotic bonded creature.' },
  't2': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: 'An alternate task-runner alongside taskmaster.' },
  'taisidon': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Taisidon event.' },
  'tarantula': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs a tarantula-themed Halloween event.' },
  'task-forage': { category: 'Foraging & Gathering', tier: 'standard', verified: false, description: 'Forages for herbs, wood and other gatherables.' },
  'taskmaster': { category: 'Hunting & Scheduling', tier: 'standard', verified: false, description: 'Schedules and runs a list of tasks in sequence.' },
  'tdps': { category: 'Combat & Survival', tier: 'standard', verified: false, description: 'Tracks damage-per-second output in combat.' },
  'tendother': { category: 'Combat & Survival', tier: 'standard', verified: false, description: "Tends another player's bleeding wounds." },
  'tessera': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Handles a tessera event token.' },
  'theurgy': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Trains Theurgy lore.' },
  'tinker': { category: 'Crafting', tier: 'standard', verified: false, description: 'Engineering/tinkering crafting loop.' },
  'tip': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Tips an NPC or shopkeeper.' },
  'tithe': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Tithes coin to your deity.' },
  'titlecheck': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Reports available in-game titles and their requirements.' },
  'tome': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Reads a tome or spellbook item.' },
  'trade': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'General buy/sell trading loop with shops.' },
  'train': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Generic skill-training dispatcher.' },
  'transfer-items': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Transfers items between characters or containers.' },
  'truffenyi-commune-quest': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Truffenyi commune quest.' },
  'ulfhara': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Ulfhara event.' },
  'validate': { category: 'Character Setup & Config', tier: 'standard', verified: false, description: 'Checks a dr-scripts YAML profile for errors.' },
  'vanity-pet': { category: 'Companions & Pets', tier: 'standard', verified: false, description: 'Summons and manages a cosmetic vanity pet.' },
  'walkingastro': { category: 'Training & Skills', tier: 'standard', verified: false, description: 'Trains Astrology while walking a route.' },
  'wand-watcher': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: "Watches a wand's charge count." },
  'weave-cloth': { category: 'Crafting', tier: 'standard', verified: false, description: 'Weaves cloth for tailoring.' },
  'wild-monitor': { category: 'Monitoring & Notifications', tier: 'standard', verified: false, description: 'Watches for random wild events nearby.' },
  'workorders': { category: 'Money, Trade & Inventory', tier: 'standard', verified: false, description: 'Fulfills merchant work orders for pay and favor.' },
  'yiamura': { category: 'Quests & Events', tier: 'standard', verified: false, description: 'Runs the Yiamura event.' },
}

export const SCRIPT_CATALOG: Record<string, ScriptCatalogEntry> = {
  ...HIDDEN,
  // After HIDDEN on purpose. These were wrongly filed as engine tooling, and
  // spreading them later means the correction wins even if a name is left in
  // both lists by mistake - a duplicate should not be settled by whichever
  // literal happens to sit higher in the file.
  ...RECLASSIFIED,
  ...PROMOTED,
  ...STANDARD,
}

const FALLBACK_ENTRY: ScriptCatalogEntry = {
  category: 'Uncategorized',
  tier: 'standard',
  verified: false,
}

/**
 * Look up a script's catalog entry by its raw `list_scripts` name.
 * A name with no entry falls back to standard/uncategorized rather than
 * being dropped, so a new or renamed script never silently vanishes from
 * the Script Library — it just shows up asking to be curated.
 */
export function getScriptCatalogEntry(name: string): ScriptCatalogEntry {
  return SCRIPT_CATALOG[name.toLowerCase()] ?? FALLBACK_ENTRY
}

export function scriptsByCategory(names: string[]): Map<ScriptCategory, string[]> {
  const grouped = new Map<ScriptCategory, string[]>()
  for (const name of names) {
    const entry = getScriptCatalogEntry(name)
    if (entry.tier === 'hidden') continue
    const bucket = grouped.get(entry.category) ?? []
    bucket.push(name)
    grouped.set(entry.category, bucket)
  }
  return grouped
}
