# DR Companion — Lich Bridge Contract

**Version:** 0.1  
**Status:** Design + mock implemented; live Ruby side not yet shipped

## Why a bridge exists

Genie is the primary game window. Lich is the automation engine (TCP proxy + Ruby scripts).  
The Companion is a separate desktop UI. It must not parse the game stream itself.

A small **Lich script** exposes a **localhost-only** WebSocket so the Companion can:

1. Receive live character / location / situation / inventory status
2. Send high-level **intents** (`go_healer`, `town_run`, `stop_all`, …)
3. Remain policy-safe (attended use; Stop always available)

## Endpoint

| Item | Value |
|------|--------|
| Default URL | `ws://127.0.0.1:7415/companion` |
| Binding | Localhost only |
| Protocol version | `1` (sent in `hello`) |

## Server → Client messages

```ts
{ type: 'hello', protocol: 1, lichVersion: string, bridgeVersion: string }
{ type: 'status', payload: CharacterStatus }
{ type: 'inventory', payload: InventorySummary }
{ type: 'scripts', payload: { name: string, status: string }[] }
{ type: 'log', line: string, level?: 'info' | 'warn' | 'error' }
{ type: 'intent_ack', intent: string, ok: boolean, detail?: string }
{ type: 'error', message: string }
```

`CharacterStatus` includes:

- `name`, `instance` (`Prime` | `Platinum` | `Fallen` | …)
- `location` (title, zone, province, isTown, isSafe, roomId optional)
- `vitals` (health, spirit, fatigue, …)
- `situation` flags (`in_combat`, `low_health`, `stunned`, `bags_full`, …)
- `activity` (human-readable current activity string)
- `connected`

## Client → Server messages

```ts
{ type: 'ping' }
{ type: 'subscribe', channels: ['status', 'inventory', 'scripts', 'log'] }
{ type: 'get_status' }
{ type: 'get_inventory' }
{ type: 'intent', intent: IntentName, args?: object }
```

### Supported intents (v0.1)

| Intent | Meaning |
|--------|---------|
| `stop_all` | Emergency / full stop of Companion-driven scripts |
| `pause` / `resume` | Pause automation |
| `go_healer` | **Capability-aware** heal path (not “closest only”) |
| `town_run` | Heal → sell/deposit → basic chores |
| `start_training` | Conservative attended training routine |
| `loot` | Loot pass per preferences |
| `buffs` | Buff routine |
| `escape` | Emergency exit to safety |
| `stow_all` | Stow loose items per rules |

## Capability-aware rule (mandatory)

For `go_healer`, `town_run`, travel, and hunting selection, Lich-side logic **must** evaluate:

1. Character needs (wounds, bleeding, dead/dying)
2. Character capabilities (skills, spells, circle, transport, wealth, access)
3. Instance differences
4. Path safety vs combat ability
5. Prefer safe / free / high-quality options; explain when none exist

Never implement “closest healer by room distance only” as the final decision.

## Launch context (research notes)

- Lich 5 acts as a proxy between Genie and the game server.
- Typical Genie launch pattern:  
  `ruby lich.rbw --dragonrealms --genie`  
  (or packaged Ruby4Lich5 equivalents)
- Genie is identified as a frontend with XML + Mono capabilities.
- There is **no** built-in public WebSocket API for external UIs; the Companion bridge script provides that surface.
- Recent Lich 5.20.x adds multi-client detach support and Genie identification for headless launches — useful later for robust attach.

## Security

- Bind to `127.0.0.1` only
- No authentication required for local v0.1 (single-user machine assumption)
- Future: optional token file if multi-user or remote is ever considered (not planned)

## Implementation order

1. ✅ TypeScript contract + mock bridge (this repo)
2. ⬜ Lich Ruby script: WebSocket server + status push from Infomon / Room / XMLData
3. ⬜ Intent handlers calling existing or new Lich scripts (dr-scripts patterns)
4. ⬜ Real `go_healer` capability scoring
5. ⬜ Tauri side: spawn/monitor Lich, detect ports, reconnect

## Account tier (required on status)

`CharacterStatus.accountTier` must be present on every status payload:

`'f2p' | 'basic' | 'premium' | 'platinum' | 'fallen' | 'unknown'`

### Intent gating examples

| Intent | F2P behavior |
|--------|----------------|
| Travel outside Zoluren | Reject with clear reason |
| Vault deposit | Reject / skip (no vault) |
| Town run | Skip vault step; respect bank 10p cap |
| Loot | Prefer selective loot; inventory pressure is tighter |
| Fang Cove / premium hunt | Never offer |
| Healer | NPC healers in Zoluren only; no premium-only facilities |

Detection may come from Lich/Infomon or a user setting; until known, use `unknown` and act conservatively.

## The Fallen

`instance: 'Fallen'` and `accountTier` are independent fields.

- A Platinum account on The Fallen → `instance: 'Fallen'`, `accountTier: 'platinum'`
- A Fallen-only subscription → `instance: 'Fallen'`, `accountTier: 'fallen'`
- Maps, healers, and routes must be instance-scoped; vault/home/private-area features follow accountTier
- Never run Prime navigation data against a Fallen session
