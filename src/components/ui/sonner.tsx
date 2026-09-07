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
// Fix round 2 (T4.0 recheck R1): `THEME_TO_SONNER` stays an explicit
// `Record<ThemeName, ...>` on purpose -- light/dark is a judgment call per
// palette, not derivable from the registry, and the exhaustiveness check
// TypeScript already runs on a `Record` over a union is exactly the gate
// that caught the missing `eclipse` entry here. `isThemeName` is the one
// that must never hand-enumerate again: it is now a runtime derivation of
// `THEMES` (`src/lib/theme/themes.ts`), the same registry `ThemeQuickSwitch`
// and the Account picker render from, so a sixth palette added there can
// never leave this guard silently stale the way a plain `||` chain can.
const THEME_TO_SONNER: Record<ThemeName, "light" | "dark"> = {
  midnight: "dark",
  amber: "dark",
  eclipse: "dark",
  paper: "light",
  arcade: "dark",
}

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
