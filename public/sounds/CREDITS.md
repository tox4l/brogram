# Asset credits — the licence ledger

This file, not a blanket licence claim, is what makes an MIT, publicly
forkable repository like this one actually safe to fork: a row here for
every non-source file under `public/`, naming exactly what it is and under
what terms. The accurate claim is narrower than "everything in `public/` is
CC0, ISC or MIT": **every asset BroGram itself authors or curates is** — the
sounds below, and the two small tree-sitter grammars under `public/java/` —
**but `public/java/tools.jar` is not.** It's the OpenJDK 8 compiler,
self-hosted so CheerpJ can run it in the browser, and it ships under the GNU
GPLv2 with the Classpath Exception: a copyleft licence, fine for a
fetched-at-build runtime dependency that BroGram never modifies or links
into its own source, and disclosed here rather than folded into a claim that
isn't true of it. See §2 below.

## 1. Sounds (`public/sounds/`)

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

## 2. Java runtime assets (`public/java/`)

Java is the one language BroGram cannot run with a plain WebAssembly
interpreter — see `public/java/README.md` for the full picture (CheerpJ, the
vendor CDN, why `tools.jar` has to be self-hosted). The licence facts, one
row per file:

| File | Source | Author | License | URL |
|---|---|---|---|---|
| `tree-sitter-java.wasm` | Copied from `node_modules/tree-sitter-java` by `scripts/fetch-java-tools.mjs` | tree-sitter-java contributors | MIT | <https://github.com/tree-sitter/tree-sitter-java> |
| `web-tree-sitter.wasm` | Copied from `node_modules/web-tree-sitter` by `scripts/fetch-java-tools.mjs` | tree-sitter contributors | MIT | <https://github.com/tree-sitter/tree-sitter> |
| `tools.jar` | Extracted from Eclipse Temurin 8 (`jdk8u504-b01`) by `scripts/fetch-java-tools.mjs`, fetched at install time, **not committed** (`.gitignore`) | Oracle / OpenJDK contributors, packaged by Eclipse Adoptium | **GPLv2 with the Classpath Exception** — not CC0, ISC, or MIT, and not covered by this repository's own MIT licence | <https://github.com/adoptium/temurin8-binaries/releases/tag/jdk8u504-b01> |
| `README.md`, `TOOLS-JAR-LICENSE.md` | BroGram | BroGram | CC0 (documentation, not a redistributable asset) | n/a |

`tools.jar`'s full provenance — exact build, archive URL, sha256 of both the
archive and the extracted jar, and why the Classpath Exception makes
self-hosting it safe without changing BroGram's own MIT status — is recorded
in `public/java/TOOLS-JAR-LICENSE.md`, which travels with the file wherever
it's fetched. CheerpJ itself (the JVM) is never in this repository at all:
it loads at runtime from Leaning Technologies' own CDN under its free
Community License, which is a licensing condition on where the runtime is
served from, not a file this ledger can list a row for.

## 3. Everything else tracked under `public/`

`public/sql-wasm.wasm` (sql.js's compiled SQLite, copied from `node_modules`
by `scripts/copy-sqljs-wasm.mjs`, same pattern as the tree-sitter grammars
above) is MIT, under the same upstream project as the `sql.js` dependency in
`package.json`. `git ls-files public` is the complete list of what's
committed; anything not named in this file or in `public/java/README.md` is
generated at build time from `seed/` (`public/curriculum/**`, covered by
`docs/CONTENT.md`) and carries no separate licence of its own — it's
BroGram's own seed content, MIT like the rest of the source.

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
