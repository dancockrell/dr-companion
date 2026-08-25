# DR Companion

A desktop control panel for [DragonRealms](https://www.play.net/dr/), built on
top of [Lich 5](https://github.com/elanthia-online/lich-5). Tauri 2 and React,
talking to Lich over a localhost WebSocket bridge.

It calls your scripts instead of replacing them, shows what they are doing, and
keeps a Stop button somewhere you can always reach.

## The documents

| | |
|---|---|
| [Design](DESIGN.md) | The long one. Layout, the script library, YAML, the map, the art pack, how the data gets distributed. |
| [How DragonRealms actually works](DOMAIN.md) | The game constraints that decide everything else. |
| [Bridge contract](BRIDGE_CONTRACT.md) | The protocol between the app and the Lich script. |
| [Game knowledge vs script property](GAME_KNOWLEDGE.md) | Which facts belong in the app and which belong to whoever wrote the script. |
| [Knowledge base](KNOWLEDGE.md) | The indexed game and script data, and how to query it. |
| [Setup policy](SETUP-POLICY.md) | Exactly what the installer touches, and what it will not. |
| [Packaging](PACKAGING.md) | How it is built and shipped. |
| [Testing](TESTING.md) | How it is tested against a live game. |

## Licence

MIT.
