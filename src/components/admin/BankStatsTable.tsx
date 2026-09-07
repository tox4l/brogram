import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import type { BankStatRow, CloRef } from './types'

interface BankStatsTableProps {
  rows: BankStatRow[]
  clos: CloRef[]
}

/** seed_count / verified_count / unverified-generated (generated_count - verified_count). */
function cellLabel(seedCount: number, verifiedCount: number, generatedCount: number): string {
  const unverified = Math.max(0, generatedCount - verifiedCount)
  return `${seedCount} / ${verifiedCount} / ${unverified}`
}

export function BankStatsTable({ rows, clos }: BankStatsTableProps) {
  if (clos.length === 0 || rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-small text-muted-foreground">
        No bank data yet. Seed or generate exercises to see coverage.
      </div>
    )
  }

  // Columns are every pattern any CLO declares as relevant, plus any extra pattern
  // that only shows up in the rows (defensive: never hide data we were given).
  const columnPatterns = new Set<string>()
  for (const clo of clos) {
    for (const pattern of clo.patterns) columnPatterns.add(pattern)
  }
  for (const row of rows) columnPatterns.add(row.pattern)
  const patterns = Array.from(columnPatterns).sort()

  const byClo = new Map<string, Map<string, BankStatRow>>()
  for (const row of rows) {
    if (!byClo.has(row.clo_id)) byClo.set(row.clo_id, new Map())
    byClo.get(row.clo_id)!.set(row.pattern, row)
  }

  const courses = Array.from(new Set(clos.map((clo) => clo.course))).sort()

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-micro text-muted-foreground">
            <th className="px-3 py-2 font-medium">CLO</th>
            {patterns.map((pattern) => (
              <th key={pattern} className="px-3 py-2 font-medium whitespace-nowrap">
                {pattern}
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => {
            const cloRows = clos.filter((clo) => clo.course === course).sort((a, b) => a.ordinal - b.ordinal)
            return (
              <Fragment key={course}>
                <tr>
                  <td colSpan={patterns.length + 2} className="bg-muted/40 px-3 py-2 text-micro font-medium text-muted-foreground">
                    {course}
                  </td>
                </tr>
                {cloRows.map((clo) => {
                  const patternMap = byClo.get(clo.id)
                  let totalSeed = 0
                  let totalVerified = 0
                  let totalGenerated = 0
                  for (const cell of patternMap?.values() ?? []) {
                    totalSeed += cell.seed_count
                    totalVerified += cell.verified_count
                    totalGenerated += cell.generated_count
                  }
                  const totalFlagged = totalSeed === 0

                  return (
                    <tr key={clo.id} data-clo={clo.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-medium">{clo.id}</td>
                      {patterns.map((pattern) => {
                        const cell = patternMap?.get(pattern)
                        const isRelevant = clo.patterns.includes(pattern)

                        if (!cell) {
                          if (!isRelevant) {
                            // Pattern belongs to a different CLO; not applicable here.
                            return (
                              <td key={pattern} data-pattern={pattern} className="px-3 py-2 text-muted-foreground">
                                —
                              </td>
                            )
                          }
                          // Relevant pattern with no exercises at all: a real coverage gap.
                          return (
                            <td
                              key={pattern}
                              data-pattern={pattern}
                              data-flagged="true"
                              className={cn('px-3 py-2', 'bg-destructive/10 text-destructive')}
                            >
                              {cellLabel(0, 0, 0)}
                            </td>
                          )
                        }

                        const flagged = cell.seed_count === 0
                        return (
                          <td
                            key={pattern}
                            data-pattern={pattern}
                            data-flagged={flagged ? 'true' : undefined}
                            className={cn('px-3 py-2', flagged && 'bg-destructive/10 text-destructive')}
                          >
                            {cellLabel(cell.seed_count, cell.verified_count, cell.generated_count)}
                          </td>
                        )
                      })}
                      <td
                        data-total="true"
                        data-flagged={totalFlagged ? 'true' : undefined}
                        className={cn('px-3 py-2 font-medium', totalFlagged && 'bg-destructive/10 text-destructive')}
                      >
                        {cellLabel(totalSeed, totalVerified, totalGenerated)}
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
