import { describe, expect, it } from 'vitest'
import { describeGenderCoverage } from '../src/studentInfoUtils'

describe('describeGenderCoverage', () => {
  it('is unavailable without an Elevfil', () => {
    const r = describeGenderCoverage({ studentInfoLoaded: false, total: 30, withGender: 0 })
    expect(r.available).toBe(false)
    expect(r.message).toContain('ingen elevfil')
  })

  it('is unavailable when the Elevfil has no valid fødselsnumre', () => {
    const r = describeGenderCoverage({ studentInfoLoaded: true, total: 30, withGender: 0 })
    expect(r.available).toBe(false)
    expect(r.message).toContain('Fødselsnummer')
  })

  it('says how many pupils are left out when some are missing', () => {
    const r = describeGenderCoverage({ studentInfoLoaded: true, total: 32, withGender: 30 })
    expect(r.available).toBe(true)
    expect(r.message).toMatch(/^2 av 32 elever/)
  })
})
