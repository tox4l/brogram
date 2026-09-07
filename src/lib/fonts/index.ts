import localFont from "next/font/local";

// Wave 4 T4.0 fix round 2 -- ruling at docs/superpowers/plans/2026-09-07-brogram-wave4-plan.md:529
// (12:05 Doha, controller): next/font/google shipped 602 KB for Archivo +
// Newsreader against T4.0's 320 KB ceiling. Two causes, both structural to
// the loader, not fixable by config: every subset in Google's CSS response
// downloads regardless of the `subsets` option (latin + latin-ext +
// vietnamese, all three), and a two-axis variable font cannot ship a
// partial weight range. These five files are self-hosted static instances
// instead: pinned with `fonttools varLib.instancer` at exactly the axis
// coordinates spec §3.1/§3.3 uses, then subset with `fonttools subset` and
// re-encoded woff2. Fix round 3 (N5): the subset range was widened past
// bare Latin-1 to cover Latin Extended-A, arrows, box/block drawing,
// general punctuation and the currency symbols block -- the exact commands
// and the per-file before/after sizes are in the T4.0 fix round 2 and
// round 3 reports. OFL licence files for both upstream families sit
// beside the fonts in this directory (OFL-archivo.txt, OFL-newsreader.txt).

// Eclipse's display face (spec §3.1, §3.3): Archivo. `wght 700` for H1,
// `wght 850` at the expanded `wdth 118` for the once-per-screen Hero /
// `.display-caps` treatment -- the exact two rows spec §3.3 lists under
// `--font-display`. Nothing else in the app ever renders Archivo, so no
// other weight or width is shipped.
export const archivoDisplay = localFont({
  src: [
    { path: "./archivo-display-700.woff2", weight: "700", style: "normal" },
    { path: "./archivo-display-850.woff2", weight: "850", style: "normal" },
  ],
  variable: "--font-archivo-display",
  display: "swap",
  preload: false,
  fallback: ["Arial", "Helvetica", "sans-serif"],
});

// Folio's display face (spec §3.1): Newsreader at `opsz 56`, the same two
// weight rows as Archivo above (700 for H1, the Hero band's 800-900).
// Newsreader's `wght` axis tops out at 800 (Archivo's tops out at 900), so
// the Hero row renders at the font's actual maximum instead of 850.
export const newsreaderDisplay = localFont({
  src: [
    { path: "./newsreader-display-700.woff2", weight: "700", style: "normal" },
    { path: "./newsreader-display-800.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-newsreader-display",
  display: "swap",
  preload: false,
  fallback: ["Times New Roman", "serif"],
  // T4.0 fix round 3 (N4): next/font/local's `adjustFontFallback` default
  // is `'Arial'` (node_modules/next/dist/docs/.../font.md), not the serif
  // spec §3.4 calls for -- an unset default face was sitting ahead of the
  // `fallback` list's own "Times New Roman" during the swap window, so
  // Folio's masthead briefly rendered sans on every first theme switch.
  adjustFontFallback: "Times New Roman",
});

// Folio's prose face (spec §3.1, §3.3): Newsreader at `opsz 18`, weight 400
// only -- lesson prose is never bold and never italic (ruling W4.8).
export const newsreaderProse = localFont({
  src: [{ path: "./newsreader-prose-400.woff2", weight: "400", style: "normal" }],
  variable: "--font-newsreader-prose",
  display: "swap",
  preload: false,
  fallback: ["Times New Roman", "serif"],
  // T4.0 fix round 3 (N4): see newsreaderDisplay's comment above.
  adjustFontFallback: "Times New Roman",
});
