# DR Companion

A desktop control panel for [DragonRealms](https://www.play.net/dr/), built on
top of [Lich 5](https://github.com/elanthia-online/lich-5). Tauri 2 and React,
talking to Lich over a localhost WebSocket bridge.

DragonRealms is thirty years old and, at the modern skill curve, effectively
unplayable unattended: reaching level 150 is roughly a year of continuous
scripting, and a competent script keeps forty-odd skills in mind at once. The
community solved this with scripts. What it does not have is a way to *see* what
those scripts are doing, or to intervene without reading a console.

That is the whole idea. Companion does not replace the scripts. It calls them,
shows their state, and puts a Stop button where you can always reach it.

## The documents

These are working documents rather than marketing. They are written to be
argued with.

| | |
|---|---|
| [Design](DESIGN.md) | The long one. Evidence, audience, layout reasoning, script library, YAML, the map, the art pack, distribution. |
| [How DragonRealms actually works](DOMAIN.md) | The domain constraints everything else is downstream of. |
| [Bridge contract](BRIDGE_CONTRACT.md) | The protocol between the app and the Lich script. |
| [Game knowledge vs script property](GAME_KNOWLEDGE.md) | Which facts belong in the app and which belong to whoever wrote the script. |
| [Knowledge base](KNOWLEDGE.md) | How the project stops guessing about the game. |
| [Setup policy](SETUP-POLICY.md) | Exactly what the installer touches, and what it will not. |
| [Packaging](PACKAGING.md) | How it is built and shipped. |
| [Testing](TESTING.md) | How it is tested against a live game. |

## Licence

MIT. The point is adoption, not control: anything here can be taken, including
by Simutronics, including into a commercial client, with no conditions worth
reading.
