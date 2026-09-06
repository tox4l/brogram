import { describe, expect, it, vi } from 'vitest'
import { REFUSAL as AGENT_REFUSAL } from '@/lib/agents/buddy'
import { handleSuggestionClick, REFUSAL, suggestionHref } from './state'

describe('suggestionHref', () => {
  it('links an exercise suggestion to the exercise screen', () => {
    expect(suggestionHref('exercise', 'ex-9')).toBe('/exercise/ex-9')
  })

  it('links a derot suggestion to the drill query', () => {
    expect(suggestionHref('derot', 'trace')).toBe('/derot?drill=trace')
  })

  it('points a break suggestion at the dashboard pomodoro anchor when not on an exercise page', () => {
    expect(suggestionHref('break', 'pomodoro')).toBe('#pomodoro')
    expect(suggestionHref('break', 'pomodoro', '/dashboard')).toBe('#pomodoro')
    expect(suggestionHref('break', 'pomodoro', null)).toBe('#pomodoro')
  })

  it('falls back to /dashboard#pomodoro when the current page is an exercise page', () => {
    expect(suggestionHref('break', 'pomodoro', '/exercise')).toBe('/dashboard#pomodoro')
    expect(suggestionHref('break', 'pomodoro', '/exercise/ex-1')).toBe('/dashboard#pomodoro')
  })
})

describe('handleSuggestionClick', () => {
  it('closes the drawer before the break chip navigates to the pomodoro anchor', () => {
    const onOpenChange = vi.fn()
    handleSuggestionClick('break', onOpenChange)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  it('leaves the drawer open for exercise and derot chips, which navigate to another screen', () => {
    const onOpenChange = vi.fn()
    handleSuggestionClick('exercise', onOpenChange)
    handleSuggestionClick('derot', onOpenChange)
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('REFUSAL', () => {
  it('re-exports the single fixed refusal sentence owned by the buddy agent module', () => {
    expect(REFUSAL).toBe(AGENT_REFUSAL)
  })
})
