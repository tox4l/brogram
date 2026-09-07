'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Blocks reveal on scroll into view, once, with an 8px rise and fade over
 * 300ms on the enter curve (spec 10.5). Under reduced motion every block is
 * present at full opacity on first render, with no transform: `visible`
 * starts `true` from the `useState` initializer (never set by an effect), so
 * this holds even before any effect has run, and the effect below returns
 * before constructing an `IntersectionObserver` at all -- R7.9's "no
 * IntersectionObserver gating" requirement is met by never calling `new
 * IntersectionObserver(...)` in that case, not by disconnecting one early.
 *
 * `onReveal` fires exactly once, the first time the block becomes visible --
 * `LessonView` uses it to advance the progress rail's furthest-seen block,
 * never to gate content.
 *
 * Fix round 1 (I1): `announced` must start `false` unconditionally, not
 * `reduced`. Under reduced motion `visible` is already `true` from the very
 * first render, so the "announce once" effect below fires `onReveal` on
 * mount by itself -- no `IntersectionObserver` is ever constructed in that
 * case (the acceptance requirement), but block progress still advances
 * instead of freezing at 0 for the whole lesson.
 */
export function RevealBlock({ reduced, onReveal, children }: {
  reduced: boolean
  onReveal?: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(() => reduced)
  const announced = useRef(false)

  useEffect(() => {
    if (reduced) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
          break
        }
      }
    }, { threshold: 0.2 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [reduced])

  useEffect(() => {
    if (!visible || announced.current) return
    announced.current = true
    onReveal?.()
  }, [visible, onReveal])

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: !reduced && !visible ? 'translateY(8px)' : 'none',
        transition: reduced ? 'none' : 'opacity 300ms var(--ease-enter), transform 300ms var(--ease-enter)',
      }}
    >
      {children}
    </div>
  )
}
