# Sound credits

Every sound BroGram ships is synthesized procedurally by `scripts/synth-sounds.mjs`
(additive sine synthesis and filtered noise, pure Node, no samples, no network)
and encoded into a sprite by `scripts/build-sound-sprite.mjs`. There is no
third-party audio in this repository.

| File | Source | Author | License | URL |
|---|---|---|---|---|
| `brogram.json` | BroGram, `scripts/synth-sounds.mjs` + `scripts/build-sound-sprite.mjs` | BroGram | CC0 | n/a |
| `brogram.webm` | BroGram, `scripts/synth-sounds.mjs` + `scripts/build-sound-sprite.mjs` | BroGram | CC0 | n/a |
| `brogram.mp3` | BroGram, `scripts/synth-sounds.mjs` + `scripts/build-sound-sprite.mjs` | BroGram | CC0 | n/a |

Every clip inside the sprite (`ui.tap`, `run.go`, `submit.send`, `pass`, `fail`,
`chain.tick`, `clo.close`, `first.win`, `level.up`, `xp.settle`, `streak.light`,
`streak.milestone`, `streak.lost`, `best`, `hint`, `drill.hit`, `drill.miss`,
`goal.done`, `wellness.chime`) is generated the same way, from the same two
scripts, under the same CC0 dedication. Regenerating the source clips
(`npm run sounds:synth`) is deterministic — no `Math.random()` is used
anywhere, only a seeded PRNG keyed by each clip's own id — so re-running it
never changes a byte of the output and never churns the sprite.

## If BroGram ever wants a bigger or hand-crafted sound library

Two sources are safe to add to an MIT, publicly-forkable repository like this
one, because both dedicate their assets to the public domain outright:

- **[Kenney](https://kenney.nl/)** — game-asset packs (UI Audio, Interface
  Sounds, Impact Sounds, Digital Audio) published under **CC0**. No
  attribution required, no redistribution restriction. Add a row to this
  table per file if any are ever committed.
- **[Freesound.org](https://freesound.org/)**, filtered to **CC0** in search
  (or the CC0 tag in the API). A CC-BY sound is also fine to commit, but its
  attribution (author, title, source URL, license URL) then **must** stay in
  this file for as long as the file ships.

**Mixkit and Pixabay are never committed here.** Both sites' own terms
restrict redistributing their audio "as a Standalone asset" / "in their
original form" — a `.mp3` sitting in `public/sounds/` in a public MIT
repository is exactly that. They're fine to browse for inspiration, never to
commit as a raw file.
