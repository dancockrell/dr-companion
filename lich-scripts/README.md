# Lich scripts for DR Companion

## companion_bridge.rb

Sketch of the localhost WebSocket server the Companion connects to.

**Protocol:** see `../docs/BRIDGE_CONTRACT.md`  
**Default URL:** `ws://127.0.0.1:7415/companion`

Until this script is fully implemented, use the UI **Mock** bridge mode.

### Implementation checklist

1. Bind TCP to 127.0.0.1:7415 only
2. Accept WebSocket upgrade on `/companion`
3. On connect: send `hello` with protocol version
4. Push `status` from Char / Room / XMLData / Infomon (include `accountTier` + `instance`)
5. Push `inventory` summaries
6. Handle `intent` messages with capability-aware handlers
7. `go_healer` → use multi-factor scoring (see Companion `src/data/healers.ts` logic)
8. `town_run` → use step planner (vault/bank gated by tier)

### Launch Lich with Genie

```text
ruby lich.rbw --dragonrealms --genie
```

Then start the bridge script from in-game (`;companion_bridge`) once implemented.
