import { describe, expect, it } from 'vitest'
import {
  buildStudentSubjectKey,
  createAbsenceSubjectClassLookup,
  createStudentInfoLookup,
  findStudentInfoInLookup,
  resolveClassFromSubjectLookup,
} from '../src/studentInfoUtils'
import { sanitizeFilenamePart } from '../src/securityUtils'

describe('privacy regression tests', () => {
  it('keeps same-name students in different classes separated', () => {
    const firstKey = buildStudentSubjectKey('Ola Hansen', '1STA', 'NOR1267')
    const secondKey = buildStudentSubjectKey('Ola Hansen', '2STA', 'NOR1267')

    expect(firstKey).not.toBe(secondKey)
  })

  it('does not fall back to name-only student info matching', () => {
    const lookup = createStudentInfoLookup([
      {
        navn: 'Ola Hansen',
        fornavn: 'Ola',
        etternavn: 'Hansen',
        class: '1STA',
        isAdult: false,
        programArea: 'ST',
        sidemalExemption: false,
        intakePoints: null,
      },
    ])

    expect(findStudentInfoInLookup(lookup, 'Ola Hansen', '1STA')?.class).toBe('1STA')
    expect(findStudentInfoInLookup(lookup, 'Ola Hansen', '2STA')).toBeUndefined()
    expect(findStudentInfoInLookup(lookup, 'Ola Hansen')).toBeUndefined()
  })

  it('only infers a class from absence data when the subject mapping is unique', () => {
    const lookup = createAbsenceSubjectClassLookup([
      { navn: 'Ola Hansen', class: '1STA', subjectGroup: 'NOR1267' },
      { navn: 'Ola Hansen', class: '1STA', subjectGroup: 'NOR1267' },
      { navn: 'Ola Hansen', class: '1STA', subjectGroup: 'MAT1001' },
      { navn: 'Ola Hansen', class: '2STA', subjectGroup: 'MAT1001' },
    ])

    expect(resolveClassFromSubjectLookup(lookup, 'Ola Hansen', 'NOR1267')).toBe('1STA')
    expect(resolveClassFromSubjectLookup(lookup, 'Ola Hansen', 'MAT1001')).toBeUndefined()
  })

  it('sanitizes class hints for export filenames', () => {
    expect(sanitizeFilenamePart('1STA / Klasse A')).toBe('1sta-klasse-a')
  })
})