"""The smallest useful script: watch the game, react to one thing.

Run it with DR Companion open and attached to a game (real Lich, or the
replay fixture via `node tools/fake-lich.mjs`):

    python python/examples/hello.py
"""

from dr_companion import Companion

c = Companion()


@c.on_line
def watch(line):
    print(f"[{line.seq}] {line.text.rstrip()}")


print(f"attached: {c.status()}")
print("watching for game lines - Ctrl+C to stop")
c.run()
