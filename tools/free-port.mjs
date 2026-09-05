/**
 * Ask the operating system for a port nobody is using.
 *
 * # Why this exists
 *
 * Three suites used to hardcode a port: `test:link` on 11731, `test:live` on
 * 7894, `test:cdp-timeout` on 9934 and 9935. Each was chosen carefully to
 * dodge a *known* occupant - a real Lich, the other fixture - and each is
 * still wrong for the reason that actually bites here, which is that several
 * sessions run `node tools/run-tests.mjs` on this one machine at the same
 * time. Two runs of the same suite want the same port, the second fixture
 * cannot bind, and the failure surfaces as `FAIL the fixture is listening`:
 * a message about the code under test, produced by a collision that has
 * nothing to do with it.
 *
 * A carefully chosen constant cannot fix that, because the occupant is not a
 * different program, it is another copy of the same suite. Only asking for a
 * port at run time can.
 *
 * # The race, stated rather than hidden
 *
 * Binding port 0 gets a free port, and closing it frees the port again, so
 * between `freePort()` returning and the fixture binding there is a window in
 * which something else could take it. That window is microseconds wide and
 * the alternative is a guaranteed collision, so this is the right trade - but
 * a caller that must not flake should use `freePortWithRetry`, which simply
 * asks for another port when the first attempt does not come up.
 *
 * Ephemeral ports are used deliberately. A caller that needs a port a *human*
 * will type, or that a second process must find without being told, wants a
 * fixed one and should keep it: `fake-lich.mjs`'s default and the bridge's
 * own port file are both correct as they are.
 */
import { createServer } from 'node:net'

/**
 * One free TCP port on the loopback interface.
 *
 * Loopback specifically: binding 0.0.0.0 would test whether a port is free on
 * every interface, which is a stricter question than the one being asked and
 * can fail on a machine with a VPN or a container bridge attached.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('The OS did not report a numeric port for the probe socket.'))
        return
      }
      const { port } = address
      probe.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

/**
 * Run `attempt(port)` against a fresh free port, retrying on a different port
 * when it reports failure.
 *
 * `attempt` must resolve to `true` when the thing it started is actually
 * listening and `false` when it is not - never throw for an ordinary "did not
 * come up", or the retry cannot tell a lost race from a broken fixture.
 *
 * Returns `{ ok, port, attempts }`. A caller that gets `ok: false` has a real
 * failure and should report it as one: the port is no longer a plausible
 * excuse after several distinct ports have been tried.
 */
export async function freePortWithRetry(attempt, tries = 3) {
  let lastPort = 0
  for (let i = 1; i <= tries; i++) {
    lastPort = await freePort()
    if (await attempt(lastPort)) return { ok: true, port: lastPort, attempts: i }
  }
  return { ok: false, port: lastPort, attempts: tries }
}
