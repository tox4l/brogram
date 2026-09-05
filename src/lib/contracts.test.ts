import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('contracts', () => {
  it('src copy matches docs copy byte for byte', () => {
    expect(readFileSync('src/lib/contracts.ts', 'utf8')).toBe(readFileSync('docs/contracts/brogram-contracts.ts', 'utf8'))
  })
})
