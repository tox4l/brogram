'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { PaletteIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { THEMES } from '@/lib/theme/themes'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import type { ThemeName } from '@/lib/contracts'

const THEME_IDS = THEMES.map((entry) => entry.id)

function isThemeName(value: string | undefined): value is ThemeName {
  return (THEME_IDS as string[]).includes(value ?? '')
}

/**
 * The shell-header quick-switch popover (§8.8, R8.4). Four live swatch
 * previews, not a segmented control -- four full personalities are not
 * four steps on a scale. `role="radiogroup"` / `role="radio"` with a
 * roving tabindex so the whole thing is keyboard- and screen-reader-
 * navigable; `document.startViewTransition` is an optional, feature-
 * detected, reduced-motion-gated circular wipe -- never required for the
 * switch itself to take effect.
 */
export function ThemeQuickSwitch() {
  const { theme, setTheme } = useTheme()
  const reducedMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([])

  const active: ThemeName = isThemeName(theme) ? theme : 'midnight'
  const activeIndex = Math.max(0, THEME_IDS.indexOf(active))

  useEffect(() => {
    if (!open) return
    radioRefs.current[activeIndex]?.focus()
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** Applies a theme (view-transition-wrapped where allowed). Never touches
   *  open/focus state -- callers decide whether the choice also dismisses
   *  the popover, matching native radio semantics (arrowing through a
   *  group selects as it goes, without closing anything).
   *
   *  §8.2 step 5: marks `<html data-theme-switching>` for the duration of
   *  the switch so `globals.css`'s `[data-theme-switching] * { transition:
   *  none }` catches anything next-themes' own `disableTransitionOnChange`
   *  style-tag trick misses (in particular, elements re-rendered mid-way
   *  through a `startViewTransition` callback) -- belt and suspenders, not
   *  a replacement for it. */
  function applyTheme(id: ThemeName) {
    if (id === active) return
    const root = document.documentElement
    root.setAttribute('data-theme-switching', '')
    const canAnimate = !reducedMotion && typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
    if (canAnimate) document.startViewTransition!(() => setTheme(id))
    else setTheme(id)
    window.setTimeout(() => root.removeAttribute('data-theme-switching'), 350)
  }

  /** Click, Enter, Space: choose and dismiss, same as a menu item. */
  function selectAndClose(id: ThemeName) {
    applyTheme(id)
    setOpen(false)
    triggerRef.current?.focus()
  }

  /** Arrow/Home/End: move the roving-tabindex focus and select as you go,
   *  keeping the popover open so the next arrow press keeps working. */
  function moveTo(index: number) {
    radioRefs.current[index]?.focus()
    applyTheme(THEME_IDS[index])
  }

  function onRadioKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = THEME_IDS.length
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveTo((index + 1) % count)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveTo((index - 1 + count) % count)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveTo(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveTo(count - 1)
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      selectAndClose(THEME_IDS[index])
    }
  }

  return (
    <div className="relative inline-block">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-label="Choose theme"
        onClick={() => setOpen((v) => !v)}
      >
        <PaletteIcon aria-hidden="true" />
      </Button>
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Theme">
            {THEMES.map((entry, index) => {
              const checked = entry.id === active
              return (
                <button
                  key={entry.id}
                  ref={(el) => { radioRefs.current[index] = el }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={entry.name}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => selectAndClose(entry.id)}
                  onKeyDown={(event) => onRadioKeyDown(event, index)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-lg border p-2 text-left text-xs outline-none',
                    checked ? 'border-ring ring-2 ring-ring/50' : 'border-border hover:border-ring/50',
                  )}
                >
                  <span className="flex gap-1" aria-hidden="true">
                    {entry.swatch.map((color, dotIndex) => (
                      <span
                        key={dotIndex}
                        className="size-3 rounded-full border border-border/50"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="font-medium text-foreground">{entry.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
