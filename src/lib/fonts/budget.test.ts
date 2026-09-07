import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Wave 4 T4.0 fix round 2 (ruling, plan §8, 12:05 Doha): the self-hosted
// Archivo/Newsreader instances in this directory replace next/font/google's
// 602 KB variable downloads. This pins the ceiling the ruling set so a
// future font swap can't silently regress past it without a failing test,
// the same way contrast.test.ts pins the palette gates.
const FONT_BUDGET_BYTES = 320 * 1024;

describe("font budget (Wave 4 Family I, plan §8 ruling)", () => {
  it("self-hosted woff2 files under src/lib/fonts total at or under 320 KB", () => {
    const dir = __dirname;
    const woff2Files = readdirSync(dir).filter((f) => f.endsWith(".woff2"));

    expect(woff2Files.length).toBeGreaterThan(0);

    const total = woff2Files.reduce(
      (sum, f) => sum + statSync(join(dir, f)).size,
      0,
    );

    expect(total).toBeLessThanOrEqual(FONT_BUDGET_BYTES);
  });
});
