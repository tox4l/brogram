"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import type { ThemeName } from "@/lib/contracts"

// R8.7 (sonner.tsx is the only next-themes consumer besides `Providers`):
// Paper is the one light personality, the other three are all dark surfaces.
// `theme` is undefined when no `ThemeProvider` wraps this (e.g. a component
// test rendering `Toaster` standalone) -- default to "dark", the app's
// actual default theme (Midnight), rather than falling through to Sonner's
// own OS-based "system" detection, which BroGram's four-theme model has no
// use for (`enableSystem` is `false` on the real provider).
const THEME_TO_SONNER: Record<ThemeName, "light" | "dark"> = {
  midnight: "dark",
  amber: "dark",
  paper: "light",
  arcade: "dark",
}

function isThemeName(value: string | undefined): value is ThemeName {
  return value === "midnight" || value === "amber" || value === "paper" || value === "arcade"
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
