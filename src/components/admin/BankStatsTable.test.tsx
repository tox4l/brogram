import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BankStatsTable } from './BankStatsTable'
import type { BankStatRow, CloRef } from './types'

afterEach(cleanup)

const clos: CloRef[] = [
  { id: 'INFS1101-1', ordinal: 1, course: 'INFS1101', patterns: ['accumulate', 'filter', 'guard'] },
  { id: 'INFS1101-2', ordinal: 2, course: 'INFS1101', patterns: ['accumulate'] },
]

// INFS1101-1 total: seed 3+2+0=5, verified 1+2+0=3, generated 4+2+0=6 -> unverified 3 -> "5 / 3 / 3"
// INFS1101-2 total: seed 5, verified 1, generated 1 -> unverified 0 -> "5 / 1 / 0"
const rows: BankStatRow[] = [
  { clo_id: 'INFS1101-1', pattern: 'accumulate', seed_count: 3, generated_count: 4, verified_count: 1 },
  { clo_id: 'INFS1101-1', pattern: 'filter', seed_count: 2, generated_count: 2, verified_count: 2 },
  { clo_id: 'INFS1101-1', pattern: 'guard', seed_count: 0, generated_count: 0, verified_count: 0 },
  { clo_id: 'INFS1101-2', pattern: 'accumulate', seed_count: 5, generated_count: 1, verified_count: 1 },
]

function cell(cloId: string, pattern: string) {
  return document.querySelector(`[data-clo="${cloId}"] [data-pattern="${pattern}"]`)
}

function total(cloId: string) {
  return document.querySelector(`[data-clo="${cloId}"] [data-total="true"]`)
}

describe('BankStatsTable', () => {
  it('shows a designed empty state when there are no CLOs', () => {
    render(<BankStatsTable rows={[]} clos={[]} />)
    expect(screen.getByText(/no bank data yet/i)).toBeTruthy()
  })

  it('flags the zero-seed cell and shows seed / verified / unverified for it', () => {
    render(<BankStatsTable rows={rows} clos={clos} />)
    const guardCell = cell('INFS1101-1', 'guard')
    expect(guardCell?.getAttribute('data-flagged')).toBe('true')
    expect(guardCell?.textContent?.trim()).toBe('0 / 0 / 0')
  })

  it('does not flag a cell that has seed exercises', () => {
    render(<BankStatsTable rows={rows} clos={clos} />)
    const accumulateCell = cell('INFS1101-1', 'accumulate')
    expect(accumulateCell?.getAttribute('data-flagged')).toBeFalsy()
    expect(accumulateCell?.textContent?.trim()).toBe('3 / 1 / 3')
  })

  it('renders a per-CLO total that sums seed, verified, and unverified-generated across patterns', () => {
    render(<BankStatsTable rows={rows} clos={clos} />)
    expect(total('INFS1101-1')?.textContent?.trim()).toBe('5 / 3 / 3')
    expect(total('INFS1101-2')?.textContent?.trim()).toBe('5 / 1 / 0')
  })

  it('groups rows by course', () => {
    render(<BankStatsTable rows={rows} clos={clos} />)
    expect(screen.getByText('INFS1101')).toBeTruthy()
  })

  it('flags a relevant pattern that has no row at all as a coverage gap', () => {
    const soloClos: CloRef[] = [{ id: 'C-1', ordinal: 1, course: 'COURSE', patterns: ['a', 'b'] }]
    const soloRows: BankStatRow[] = [{ clo_id: 'C-1', pattern: 'a', seed_count: 4, generated_count: 1, verified_count: 1 }]
    render(<BankStatsTable rows={soloRows} clos={soloClos} />)

    const missingCell = cell('C-1', 'b')
    expect(missingCell?.getAttribute('data-flagged')).toBe('true')
    expect(missingCell?.textContent?.trim()).toBe('0 / 0 / 0')

    const presentCell = cell('C-1', 'a')
    expect(presentCell?.getAttribute('data-flagged')).toBeFalsy()
    expect(presentCell?.textContent?.trim()).toBe('4 / 1 / 0')
  })
})
