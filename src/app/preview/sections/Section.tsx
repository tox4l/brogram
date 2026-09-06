'use client'

import { Component, type ReactNode } from 'react'

export function Section({ id, title, caption, children }: { id: string; title: string; caption: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24 space-y-5 border-t border-border pt-10 first:border-t-0 first:pt-0">
      <div className="space-y-1.5">
        <h2 id={`${id}-heading`} className="text-lg font-medium tracking-tight text-foreground">{title}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{caption}</p>
      </div>
      {children}
    </section>
  )
}

interface BoundaryState { error: Error | null }

/**
 * The wellness rail and buddy button read from Supabase; with the placeholder
 * env var every real fetch fails. Their own code already degrades to empty or
 * default state on a fetch error, but this boundary is the backstop so a
 * genuine render crash in one section never takes down the rest of the gallery.
 */
export class SectionErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="rounded-lg border border-dashed border-input p-4 text-sm text-muted-foreground">
          This section could not render: {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}
