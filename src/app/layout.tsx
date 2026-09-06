import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "BroGram",
  description: "A coding tutor by Velocity. Learn by writing code.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
