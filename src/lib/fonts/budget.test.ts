import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Wave 4 T4.0 fix round 2 (ruling, plan §8, 12:05 Doha): the self-hosted
// Archivo/Newsreader instances in this directory replace next/font/google's
// 602 KB variable downloads. This pins the ceiling the ruling set so a
// future font swap can't silently regress past it without a failing test,
// the same way contrast.test.ts pins the palette gates.
const FONT_BUDGET_BYTES = 320 * 1024;

// T4.0 fix round 3 (N3): the round-2 version of this test summed only
// `src/lib/fonts/*.woff2` (89,648 B against the ceiling), which is a real
// but narrow guard -- it cannot fail for any of the ways spec §3.4's
// budget actually regresses (a Geist weight added, a third `next/font/
// google` family, `latin-ext` re-enabled), because none of those land in
// this directory. The deployed number spec §3.4 gates is every `*.woff2`
// under `.next/static/media/`. This test now measures *that* whenever a
// build exists (`npm run build` first -- CI and this task's own
// verification both do), and only falls back to the narrower directory-
// plus-Geist estimate when it does not, so a fresh checkout with no build
// yet still gets a number rather than skipping. Either way the test's own
// title says which one ran, so a green run is never mistaken for the
// other's guarantee.
const GEIST_BYTES = 146_464; // Geist Sans + Geist Mono, next/font/google, unchanged since T4.0's first commit -- reproduced on every clean build this task has run (fix rounds 1-3 all measure the identical 146,464 B for the two Geist families).

function sumWoff2(dir: string): number {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".woff2"))
    .reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
}

const fontsDir = __dirname;
const nextMediaDir = join(fontsDir, "..", "..", "..", ".next", "static", "media");
const buildExists = existsSync(nextMediaDir);

describe("font budget (Wave 4 Family I, plan §8 ruling)", () => {
  it(
    buildExists
      ? "deployed woff2 in .next/static/media/ (Geist + self-hosted) totals at or under 320 KB"
      : "no build yet: src/lib/fonts/*.woff2 plus Geist's known 146,464 B estimates at or under 320 KB -- run npm run build for the real number",
    () => {
      const total = buildExists ? sumWoff2(nextMediaDir) : sumWoff2(fontsDir) + GEIST_BYTES;
      expect(total).toBeLessThanOrEqual(FONT_BUDGET_BYTES);
    },
  );

  it("self-hosted woff2 files under src/lib/fonts are present (five faces: two Archivo, three Newsreader)", () => {
    const woff2Files = readdirSync(fontsDir).filter((f) => f.endsWith(".woff2"));
    expect(woff2Files.length).toBe(5);
  });
});
