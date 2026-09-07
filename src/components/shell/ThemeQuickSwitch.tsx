'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTheme } from 'next-themes'
import { PaletteIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { THEMES } from '@/lib/theme/themes'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'
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
  const userId = useSession((session) => session.user?.id ?? null)
  // V4/A11Y-03 (wave 2 review): a bare `useReducedMotion()` call means
  // 'system' -- it can never see a learner who chose Reduced (or Full) in
  // the app on an OS that reports no preference either way, which is
  // exactly the load-bearing case this control's own view-transition wipe
  // exists to respect. `(app)/layout.tsx` already seeds the resolved
  // wellness row into the query cache, so this costs no extra request.
  const wellnessQuery = useWellness()
  const motionPref = resolveWellnessPrefs(wellnessQuery.data?.prefs).motion
  const reducedMotion = useReducedMotion(motionPref)
  const prefsMutation = useWellnessPrefsMutation(userId)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([])

  const active: ThemeName = isThemeName(theme) ? theme : 'midnight'
  const activeIndex = Math.max(0, THEME_IDS.indexOf(active))
  const switchingTimeoutRef = useRef<number | null>(null)
  const blurbId = useId()

  useEffect(() => () => {
    if (switchingTimeoutRef.current !== null) window.clearTimeout(switchingTimeoutRef.current)
  }, [])

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
   *  I4 (review): `setTheme` alone only schedules a state update; next-themes
   *  applies the `data-theme` attribute in a *passive* effect, which runs
   *  after `startViewTransition`'s callback has already returned. Left
   *  alone, the browser's "new" snapshot is captured before the attribute
   *  changes -- identical to the "old" one -- so the wipe animates nothing
   *  and the old theme sits frozen on screen until the effect catches up.
   *  `flushSync` forces the state update *and* its effect to land
   *  synchronously before the callback returns, which is the documented
   *  way to drive a view transition from React state.
   *
   *  §8.2 step 5: marks `<html data-theme-switching>` for the duration of
   *  the switch so `globals.css`'s `[data-theme-switching] * { transition:
   *  none }` catches anything next-themes' own `disableTransitionOnChange`
   *  style-tag trick misses -- belt and suspenders, not a replacement for
   *  it. Minor 3 (review): one timeout ref, cleared and rescheduled on every
   *  call, so two switches in quick succession (arrowing through the group)
   *  can't have the first one's timer strip the attribute mid-transition.
   *
   *  X5 (wave 2 review): also writes the choice through to `wellness.prefs`
   *  (the single writer every other prefs control already uses), the same
   *  write the Account picker's own `applyTheme` makes -- so a theme picked
   *  from the header quick-switch, not only from Account, follows the
   *  learner to their next sign-in (`src/lib/theme/useThemeSync.ts`). */
  function applyTheme(id: ThemeName) {
    if (id === active) return
    const root = document.documentElement
    root.setAttribute('data-theme-switching', '')
    const canAnimate = !reducedMotion && typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
    if (canAnimate) document.startViewTransition!(() => flushSync(() => setTheme(id)))
    else setTheme(id)
    if (switchingTimeoutRef.current !== null) window.clearTimeout(switchingTimeoutRef.current)
    switchingTimeoutRef.current = window.setTimeout(() => {
      root.removeAttribute('data-theme-switching')
      switchingTimeoutRef.current = null
    }, 350)
    prefsMutation.mutate(() => ({ theme: id }))
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
              const describedById = `${blurbId}-${entry.id}`
              return (
                <button
                  key={entry.id}
                  ref={(el) => { radioRefs.current[index] = el }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={entry.name}
                  aria-describedby={describedById}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => selectAndClose(entry.id)}
                  onKeyDown={(event) => onRadioKeyDown(event, index)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-lg border p-2 text-left text-xs outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
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
                  {/* Minor 4 (review): `blurb` existed but was rendered nowhere.
                      It is the natural `aria-describedby` for the radio -- a
                      screen reader announces the name, then this. */}
                  <span id={describedById} className="sr-only">{entry.blurb}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
