/**
 * Whether a download was actually checked against a known-good hash, as
 * opposed to merely saved.
 *
 * `DownloadResult.verified` on the Rust side can't answer this by itself:
 * `setup.rs` sets it to `true` whenever `expected_sha256` is empty, the same
 * value it gets when a hash genuinely matched, so it conflates "nothing to
 * check" with "checked and passed." Before this existed, the persistent
 * status shown on a completed download said "Verified" unconditionally in
 * both cases — the transient log line and the detail dropdown beside it were
 * already careful to say "source only, not upstream's" for a project that
 * publishes no checksum, but the loud, permanent line never carried that
 * caveat. See `tools/verified-claim-test.mjs`.
 *
 * `SetupWizard.tsx`'s `done` message and `ComponentCard.tsx`'s installer
 * caption both call this rather than each re-deriving `bundled || !!sha256`,
 * so the two texts can't drift back apart the way the persistent status once
 * drifted from the wording next to it.
 *
 * No imports on purpose — this file is deliberately free of `./tauri` and
 * everything downstream of it, so it can be unit tested by importing the
 * `.ts` source directly in plain Node, the way `highlights.ts`/
 * `gameStream.ts`/`trail.ts` already are, rather than needing the
 * compile-to-temp-file machinery `layout-test.mjs` uses for a module with
 * its own relative imports.
 */
export function wasChecked(o: { bundled: boolean; sha256: string }): boolean {
  return o.bundled || !!o.sha256
}
