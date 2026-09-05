import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AgentUsageTable } from './AgentUsageTable'
import type { AgentUsageRow } from './types'

afterEach(cleanup)

const rows: AgentUsageRow[] = [
  { day: '2026-09-01', agent: 'coach', calls: 10, fallback_calls: 1, prompt_tokens: 1000, completion_tokens: 500, cache_hit_tokens: 200 },
  { day: '2026-09-01', agent: 'buddy', calls: 4, fallback_calls: 0, prompt_tokens: 300, completion_tokens: 100, cache_hit_tokens: 50 },
  { day: '2026-09-02', agent: 'coach', calls: 6, fallback_calls: 2, prompt_tokens: 600, completion_tokens: 300, cache_hit_tokens: 100 },
  { day: '2026-09-02', agent: 'buddy', calls: 5, fallback_calls: 0, prompt_tokens: 400, completion_tokens: 150, cache_hit_tokens: 60 },
]

function dayCell(agent: string, day: string) {
  return document.querySelector(`[data-agent-row="${agent}"] [data-day="${day}"]`)
}

function totalsDayCell(day: string) {
  return document.querySelector(`[data-totals-row="true"] [data-day="${day}"]`)
}

describe('AgentUsageTable', () => {
  it('shows a designed empty state when there is no usage data', () => {
    render(<AgentUsageTable rows={[]} />)
    expect(screen.getByText(/no agent calls/i)).toBeTruthy()
  })

  it('shows calls with fallbacks in parentheses per agent per day', () => {
    render(<AgentUsageTable rows={rows} />)
    expect(dayCell('coach', '2026-09-01')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('10 (1)')
    expect(dayCell('buddy', '2026-09-02')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('5 (0)')
  })

  it('sums a totals row correctly across agents for each day', () => {
    render(<AgentUsageTable rows={rows} />)
    // 2026-09-01: coach 10(1) + buddy 4(0) = 14 calls, 1 fallback
    expect(totalsDayCell('2026-09-01')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('14 (1)')
    // 2026-09-02: coach 6(2) + buddy 5(0) = 11 calls, 2 fallbacks
    expect(totalsDayCell('2026-09-02')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('11 (2)')
  })

  it('shows a compact per-agent token totals line', () => {
    render(<AgentUsageTable rows={rows} />)
    const tokenLine = document.querySelector('[data-agent-tokens="coach"]')
    // coach prompt: 1000+600=1600 -> 1.6k; completion: 500+300=800; cache: 200+100=300
    expect(tokenLine?.textContent).toMatch(/1\.6k/)
    expect(tokenLine?.textContent).toMatch(/800/)
    expect(tokenLine?.textContent).toMatch(/300/)
  })
})
