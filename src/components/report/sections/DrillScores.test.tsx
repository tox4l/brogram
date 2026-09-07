import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DRILL_META } from '@/app/(app)/derot/lib'
import type { DrillResult } from '@/lib/contracts'
import { deriveDrillScores } from '../derive'
import { DrillScores } from './DrillScores'

afterEach(cleanup)

/**
 * TI-7 / W2-SCHEMA-I2: this file exists specifically so a `DRILL_META`
 * rename cannot land here silently the way it did before (`v2-T2.9a-report.md`,
 * `v2-T2.9a-recheck.md`) -- title parity is asserted directly against the one
 * real source, and a lane-less legacy row is proven to reach this component
 * at all rather than only exercised at the `derive.ts` layer.
 */

let drillSeq = 0
function drillResult(over: Partial<DrillResult> = {}): DrillResult {
  drillSeq += 1
  return {
    drillId: `drill-${drillSeq}`,
    kind: 'trace',
    correct: true,
    timeMs: 1000,
    score: 80,
    at: '2026-09-01T00:00:00.000Z',
    lane: 'arcade',
    ...over,
  }
}

describe('DrillScores', () => {
  it('renders every kind\'s title from DRILL_META directly -- no hand-copied duplicate to drift', () => {
    const groups = deriveDrillScores([
      drillResult({ kind: 'color-nback', lane: 'play' }),
      drillResult({ kind: 'rhythm', lane: 'play' }),
    ])
    render(<DrillScores groups={groups} />)
    screen.getByText(DRILL_META['color-nback'].title)
    screen.getByText(DRILL_META.rhythm.title)
  })

  it('shows the empty state with no groups', () => {
    render(<DrillScores groups={[]} />)
    screen.getByText('No de-rot runs yet. Scores appear here after the first one.')
  })

  it('W2-SCHEMA-I2: a pre-Wave-2 row with no lane still reaches the screen, grouped under its kind\'s real lane', () => {
    const legacyRow = { ...drillResult({ kind: 'trace' }), lane: undefined } as unknown as DrillResult
    const groups = deriveDrillScores([legacyRow])
    render(<DrillScores groups={groups} />)
    expect(screen.queryByText('No de-rot runs yet. Scores appear here after the first one.')).toBeNull()
    screen.getByText('Arcade')
    screen.getByText(DRILL_META.trace.title)
  })
})
