import type { Metadata } from "next";
import { Archivo, Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_SEED_SCRIPT } from "@/lib/theme/themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  fallback: ["Arial", "Helvetica", "sans-serif"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["Consolas", "Courier New", "monospace"],
});

// Wave 4 §3.1/§3.4: the two display/prose faces, both OFL 1.1 and fetched
// only on a theme switch (`preload: false` -- they are not on the critical
// path for the seeded Midnight default). `axes` is required explicitly:
// next/font excludes every variable axis but weight by default, and Eclipse
// needs Archivo's `wdth` while Folio needs Newsreader's `opsz`.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  preload: false,
  fallback: ["Arial", "Helvetica", "sans-serif"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  preload: false,
  fallback: ["Times New Roman", "serif"],
});

export const metadata: Metadata = {
  title: "BroGram",
  description: "A coding tutor by Velocity. Learn by writing code.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // I6 (review): a real default, not an absent attribute. This Next
      // version's own no-flash guide renders exactly this
      // (`preventing-flash-before-hydration.md`, "Themes"): the static
      // default lets `[data-theme="midnight"]` match immediately from the
      // server-rendered markup alone, with `:root`'s mirrored fallback (see
      // globals.css) as the last resort if that selector somehow can't. The
      // two inline scripts below still overwrite it with the real stored
      // choice before paint; this is what the app degrades *to*, not the
      // no-flash mechanism itself.
      data-theme="midnight"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        {/* §8.2 critic addendum: seeds an empty `brogram:theme` from the OS's
            contrast/colour-scheme signal, *before* next-themes' own injected
            script (rendered inside <Providers>) reads storage. Both run
            before first paint -- this is the no-flash mechanism, not a
            progressive enhancement. */}
        <script
          id="theme-seed"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_SEED_SCRIPT }}
        />
        <Providers>
          {children}
          <footer className="flex flex-wrap justify-center gap-x-4 gap-y-2 px-6 py-8 text-center text-sm text-muted-foreground">
            Built by Velocity
            <a href="https://github.com/tox4l/brogram" className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Open source</a>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
