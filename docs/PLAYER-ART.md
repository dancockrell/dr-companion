# Submitting your own character portrait

DR Companion draws a picture for everyone in your room. A character's
published race and sex select the bundled default portrait; their own
submitted character art replaces that default.

## How it works

1. Fork this repo.
2. Add a `.webp` image at `public/player-art/<your-character-name>.webp`,
   lowercase, spaces and punctuation replaced with hyphens. `Dan the Bold`
   becomes `dan-the-bold.webp`.
3. Open a pull request. A maintainer reviews it before it merges — nothing
   you submit reaches anyone else's game until that happens.
4. Once merged, `node tools/build-player-art-manifest.mjs` regenerates the
   manifest. Every client checks that repository folder when the game loads,
   bypassing stale caches, and falls back to its bundled copy when offline.

If a character publishes race and sex but no custom image, add that opt-in
metadata to `public/player-art/profiles.json`:

```json
{
  "Dan the Bold": { "race": "Gor'Tog", "guild": "Barbarian", "sex": "male" }
}
```

The client resolves another player's image in this order: their exact custom
file, their published race/guild/sex default, their race/sex default, then a
stable, varied generic default portrait if their public profile is incomplete. It never shows
a letter tile and never guesses demographics from a character name. A future
in-client publisher should open a reviewed GitHub contribution for these files
only after the player explicitly opts in; selecting local artwork by itself
must not silently make it public.

## What to submit

**A character illustration, not a photograph of yourself.** This is a
picture representing your character in the game, the same kind of art the
rest of this pack is — painterly, fantasy, not a real-world photo. A few
reasons that's the actual rule, not just a style preference:

- **It's a public repository.** Anything merged here is permanently public
  and forkable. A real photo of a real, identifiable person carries privacy
  and consent weight that a drawn character concept doesn't — and that
  weight doesn't go away just because a reviewer approved the PR once.
- **It has to survive review by someone who's never met you.** A reviewer
  can reasonably judge "is this an appropriate fantasy character portrait"
  in a way they can't judge "did this real person actually consent to their
  photo being here."
- **It fits the pack.** Every other image in `public/` — creatures, NPCs,
  the default race portraits — is a painterly illustration. A photo sitting
  next to those reads as broken, not personal.

If you draw or commission your own art, or generate one that matches this
style, that's exactly what this slot is for.

## What a reviewer is checking for

- Full body or clear portrait, not a crop that could be anyone.
- Clothed, no suggestive content — same standard as every other image in
  this pack.
- Roughly matches the illustration style already in `public/creatures/` and
  `public/npcs/` — painterly, not a photograph, not a screenshot.
- The character name in the filename is plausible as a real DragonRealms
  character name, not something that reads as an attempt to overwrite or
  impersonate someone else's.

A submission that doesn't meet these gets asked for changes or closed, the
same as any other PR review — this isn't a special automated gate, it's the
normal review this repo already does for everything else.
