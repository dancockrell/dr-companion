/**
 * The one live-shaped zone the Node-side tests compile a real `WorldSnapshot`
 * from.
 *
 * It started as a literal inside `tools/presentation-bridge-test.mjs`. It is
 * out here because `tools/godot-fixture-contract-test.mjs` needs the same
 * input: that file checks the manifest contract against the committed mock
 * fixture *and* against a snapshot the real compiler produced, and a second
 * copy of this zone would be free to drift from this one — at which point the
 * two suites would be asserting things about different worlds while appearing
 * to agree.
 *
 * A deliberately synthetic contract fixture, not DragonRealms map data.
 * Its south link from14 to13 is artificial (the actual Crossing exit is north).
 * Never use it as a recorded session or a real-world navigation fixture.
 * A zone-leaving exit ("go gate") has no local target — the exact shape `mapData.ts`'s `toZoneRoom` produces when
 * `moves.length` exceeds `links.length`. That zone-leaving exit is the
 * load-bearing part: it is the only reason a compiled snapshot carries a
 * `targetCellId: null`, which is the honest-absence form the whole exit
 * contract turns on.
 */

/** Synthetic data in the shape mapData.ts reports; topology is not real. */
export const LIVE_ZONE = {
  ok: true,
  zone: '1',
  name: 'The Crossing',
  here: 14,
  rooms: [
    {
      id: 14,
      uid: null,
      title: 'The Crossing, Town Green North',
      x: 100,
      y: -50,
      z: 0,
      moves: ['south', 'go gate'],
      links: [{ to: 13, kind: 'walk' }],
      to: [13],
    },
    {
      id: 13,
      uid: null,
      title: 'The Crossing, Town Green',
      x: 100,
      y: -46,
      z: 0,
      moves: ['north'],
      links: [{ to: 14, kind: 'walk' }],
      to: [14],
    },
  ],
}

/** The character's current room, as the store reports it. */
export const LIVE_HERE = { id: 14, uid: null, title: null, location: null }
