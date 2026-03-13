import { describe, expect, it } from 'vitest'
import { normalizeCellText, sanitizeCsvCell } from '../src/securityUtils'
import { csvFormulaCases } from './fixtures/csvFormulaCases'
import { importCellCases } from './fixtures/importCellCases'

describe('security smoke tests', () => {
  it('neutralizes spreadsheet formula injection triggers', () => {
    for (const testCase of csvFormulaCases) {
      expect(sanitizeCsvCell(testCase.input)).toBe(testCase.expected)
    }
  })

  it('normalizes imported cells by stripping nulls/trimming/limiting', () => {
    for (const testCase of importCellCases) {
      expect(normalizeCellText(testCase.input, testCase.maxChars)).toBe(testCase.expected)
    }
  })

  it('keeps Date objects parseable in upload flow', () => {
    const date = new Date('2026-03-13T10:00:00.000Z')
    expect(typeof date.getTime).toBe('function')
    expect(normalizeCellText(date).length).toBeGreaterThan(0)
  })
})
