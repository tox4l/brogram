import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        {children}
        <footer className="flex flex-wrap justify-center gap-x-4 gap-y-2 px-6 py-8 text-center text-sm text-muted-foreground">
          Built by Velocity
          <a href="https://github.com/musallam/brogram" className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Open source</a>
        </footer>
      </body>
    </html>
  );
}
