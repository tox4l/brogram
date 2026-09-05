import { Fragment } from 'react'
import type { AgentName } from '@/lib/contracts'
import type { AgentUsageRow } from './types'

const AGENT_ORDER: AgentName[] = ['profiler', 'planner', 'author', 'diagnoser', 'coach', 'reviewer', 'buddy']
const MAX_DAYS = 14

function compactNumber(value: number): string {
  if (value >= 1000) {
    const scaled = (value / 1000).toFixed(1).replace(/\.0$/, '')
    return `${scaled}k`
  }
  return String(value)
}

function formatDayLabel(day: string): string {
  const parsed = new Date(day)
  if (Number.isNaN(parsed.getTime())) return day
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
}

interface DayTotal {
  calls: number
  fallback: number
}

interface TokenTotal {
  prompt: number
  completion: number
  cache: number
}

export function AgentUsageTable({ rows }: { rows: AgentUsageRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No agent calls recorded yet.
      </div>
    )
  }

  const allDays = Array.from(new Set(rows.map((row) => row.day))).sort()
  const days = allDays.slice(Math.max(0, allDays.length - MAX_DAYS))

  const byAgentDay = new Map<string, AgentUsageRow>()
  for (const row of rows) {
    if (days.includes(row.day)) byAgentDay.set(`${row.agent}:${row.day}`, row)
  }

  const dayTotals = new Map<string, DayTotal>(days.map((day) => [day, { calls: 0, fallback: 0 }]))
  const tokenTotals = new Map<AgentName, TokenTotal>()

  for (const agent of AGENT_ORDER) {
    const tokens: TokenTotal = { prompt: 0, completion: 0, cache: 0 }
    for (const day of days) {
      const cell = byAgentDay.get(`${agent}:${day}`)
      if (!cell) continue
      const dayTotal = dayTotals.get(day)!
      dayTotal.calls += cell.calls
      dayTotal.fallback += cell.fallback_calls
      tokens.prompt += cell.prompt_tokens
      tokens.completion += cell.completion_tokens
      tokens.cache += cell.cache_hit_tokens
    }
    tokenTotals.set(agent, tokens)
  }

  const grandCalls = Array.from(dayTotals.values()).reduce((sum, t) => sum + t.calls, 0)
  const grandFallback = Array.from(dayTotals.values()).reduce((sum, t) => sum + t.fallback, 0)

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Agent</th>
            {days.map((day) => (
              <th key={day} className="px-3 py-2 font-medium whitespace-nowrap">
                {formatDayLabel(day)}
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {AGENT_ORDER.map((agent) => {
            let agentCalls = 0
            let agentFallback = 0
            const cells = days.map((day) => {
              const cell = byAgentDay.get(`${agent}:${day}`)
              const calls = cell?.calls ?? 0
              const fallback = cell?.fallback_calls ?? 0
              agentCalls += calls
              agentFallback += fallback
              return { day, calls, fallback }
            })
            const tokens = tokenTotals.get(agent)!

            return (
              <Fragment key={agent}>
                <tr data-agent-row={agent} className="border-b border-border/30">
                  <td className="px-3 py-1.5 font-medium capitalize">{agent}</td>
                  {cells.map(({ day, calls, fallback }) => (
                    <td key={day} data-day={day} className="px-3 py-1.5">
                      {calls} <span className="text-muted-foreground">({fallback})</span>
                    </td>
                  ))}
                  <td className="px-3 py-1.5 font-medium">
                    {agentCalls} <span className="text-muted-foreground">({agentFallback})</span>
                  </td>
                </tr>
                <tr className="border-b border-border/60">
                  <td colSpan={days.length + 2} data-agent-tokens={agent} className="px-3 pt-0 pb-1.5 text-xs text-muted-foreground">
                    tokens: {compactNumber(tokens.prompt)} prompt · {compactNumber(tokens.completion)} completion ·{' '}
                    {compactNumber(tokens.cache)} cache
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr data-totals-row="true" className="border-t border-border font-medium">
            <td className="px-3 py-2">Total</td>
            {days.map((day) => {
              const t = dayTotals.get(day)!
              return (
                <td key={day} data-day={day} className="px-3 py-2">
                  {t.calls} <span className="text-muted-foreground">({t.fallback})</span>
                </td>
              )
            })}
            <td className="px-3 py-2">
              {grandCalls} <span className="text-muted-foreground">({grandFallback})</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
