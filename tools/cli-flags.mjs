/**
 * Flag reading for the release scripts, with an unknown flag as a hard error.
 *
 * # Why this exists
 *
 * `.github/workflows/release.yml` passes both of its guard flags through a
 * template expression:
 *
 *     npm run release:config -- ${{ steps.assets.outputs.viewer == 'true' && '--require-viewer' || '' }}
 *
 * Until this file, `tools/build-release-config.mjs` and
 * `tools/verify-release-bundle.mjs` both read their flags with
 * `process.argv.includes('--flag')`, which cannot tell a flag that was not
 * passed from a flag that was misspelled. `--requre-viewer` would have been
 * read as "no viewer required", the script would have exited 0, and the
 * release would have shipped the smaller installer with every step green -
 * which is the exact failure `--require-viewer` was written to prevent.
 *
 * That is the shape this repository keeps paying for: a negative result and an
 * absent result printing identically. The guard flags are worse than most,
 * because the branch they guard has never once executed (there is no
 * `SHARED_ASSETS_TOKEN` - see `docs/RELEASE.md`), so nobody would notice the
 * typo until the first real viewer-carrying release quietly failed to carry
 * one.
 *
 * # What it does
 *
 * One parse, shared by both scripts rather than copied into each: the caller
 * declares every flag it accepts, and anything else - an unknown flag, a
 * value on a boolean flag, a boolean used where a value was required, a stray
 * positional argument - stops the process with a message naming the token and
 * listing what was allowed. Neither script takes positional arguments, so an
 * argument that is not a declared flag is a mistake by construction.
 *
 * Exiting rather than throwing is deliberate: these are command-line entry
 * points, and a stack trace is not what a workflow log should carry. The
 * behaviour is covered by `tools/release-flags-test.mjs`, which runs the real
 * scripts as child processes rather than this function in isolation, because
 * what matters is that the scripts reject the flag, not that this file can.
 */

/**
 * @param {object} spec
 * @param {string} spec.name        Program name, for the error message.
 * @param {string[]} [spec.boolean] Flags that take no value.
 * @param {string[]} [spec.value]   Flags that take the next argument as a value.
 * @param {string[]} [spec.argv]    Defaults to the real arguments.
 * @returns {Record<string, boolean|string|null>} every declared flag, with
 *   `false`/`null` for the ones that were not passed. Never partially filled:
 *   a bad argument list exits instead of returning.
 */
export function readFlags({ name, boolean: booleanFlags = [], value: valueFlags = [], argv }) {
  const args = argv ?? process.argv.slice(2)
  const known = new Set([...booleanFlags, ...valueFlags])

  /** @type {Record<string, boolean|string|null>} */
  const flags = {}
  for (const flag of booleanFlags) flags[flag] = false
  for (const flag of valueFlags) flags[flag] = null

  const refuse = (token, why) => {
    console.error(`${name}: ${why}: ${token}`)
    console.error(`  Accepts: ${[...known].sort().join(', ') || '(no flags)'}`)
    console.error(
      '  Refusing to run. A flag that is silently ignored is indistinguishable from one that worked.'
    )
    process.exit(1)
  }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith('-')) refuse(token, 'unexpected argument (this command takes only flags)')

    const eq = token.indexOf('=')
    const flag = eq === -1 ? token : token.slice(0, eq)
    if (!known.has(flag)) refuse(token, 'unknown flag')

    if (valueFlags.includes(flag)) {
      const value = eq === -1 ? args[i + 1] : token.slice(eq + 1)
      if (eq === -1) i += 1
      if (value === undefined || value === '') refuse(token, 'flag needs a value')
      flags[flag] = value
    } else {
      if (eq !== -1) refuse(token, 'flag takes no value')
      flags[flag] = true
    }
  }

  return flags
}
