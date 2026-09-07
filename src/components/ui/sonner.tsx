"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import type { ThemeName } from "@/lib/contracts"
import { THEMES } from "@/lib/theme/themes"

// R8.7 (sonner.tsx is the only next-themes consumer besides `Providers`):
// Folio is the one light personality, the other four are all dark surfaces.
// `theme` is undefined when no `ThemeProvider` wraps this (e.g. a component
// test rendering `Toaster` standalone) -- default to "dark", the app's
// actual default theme (Midnight), rather than falling through to Sonner's
// own OS-based "system" detection, which BroGram's five-theme model has no
// use for (`enableSystem` is `false` on the real provider).
//
// T4.0 recheck 3, N12 (carried to T4.5): fix round 2's `THEME_TO_SONNER`
// (a hand-written `Record<ThemeName, ...>`) is superseded here -- `scheme`
// on each `THEMES` entry (`src/lib/theme/themes.ts`) is now the single
// authored fact "is this palette light or dark," so this map derives from
// the registry instead of re-stating it. `Record<ThemeName, ...>`'s own
// exhaustiveness check (what caught the missing `eclipse` entry originally)
// still applies: `Object.fromEntries` needs the cast below, but if a sixth
// `THEMES` entry ever shipped without a `scheme`, `themes.ts`'s own object
// literal would fail to satisfy its declared element type at that call
// site, not silently here.
const THEME_TO_SONNER: Record<ThemeName, "light" | "dark"> = Object.fromEntries(
  THEMES.map((t) => [t.id, t.scheme] as const),
) as Record<ThemeName, "light" | "dark">

const THEME_NAME_SET = new Set<ThemeName>(THEMES.map((t) => t.id))

function isThemeName(value: string | undefined): value is ThemeName {
  return value !== undefined && THEME_NAME_SET.has(value as ThemeName)
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  const sonnerTheme: ToasterProps["theme"] = isThemeName(theme) ? THEME_TO_SONNER[theme] : "dark"

  return (
    <Sonner
      theme={sonnerTheme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
