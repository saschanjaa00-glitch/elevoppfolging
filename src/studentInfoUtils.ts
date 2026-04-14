import type { AbsenceRecord, StudentInfoRecord } from './types'

export const normalizeMatch = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')

export const buildStudentClassKey = (navn: string, className?: string): string => {
  const normalizedName = normalizeMatch(navn)
  const normalizedClass = normalizeMatch(className ?? '')
  return normalizedClass ? `${normalizedName}::${normalizedClass}` : normalizedName
}

export const buildStudentSubjectKey = (navn: string, className: string | undefined, subjectGroup: string): string => {
  const studentKey = buildStudentClassKey(navn, className)
  const normalizedSubjectGroup = normalizeSubjectGroupKey(subjectGroup)
  return normalizedSubjectGroup ? `${studentKey}::${normalizedSubjectGroup}` : studentKey
}

const buildNameSubjectLookupKey = (navn: string, subjectGroup: string): string =>
  `${normalizeMatch(navn)}::${normalizeSubjectGroupKey(subjectGroup)}`

export const createAbsenceSubjectClassLookup = (
  absences: Array<Pick<AbsenceRecord, 'navn' | 'class' | 'subjectGroup'>>
): Map<string, string | null> => {
  const lookup = new Map<string, string | null>()

  absences.forEach(record => {
    const key = buildNameSubjectLookupKey(record.navn, record.subjectGroup)
    const className = record.class?.trim() ?? ''
    if (!key || !className) return

    const existing = lookup.get(key)
    if (existing === undefined) {
      lookup.set(key, className)
      return
    }

    if (existing !== null && normalizeMatch(existing) !== normalizeMatch(className)) {
      lookup.set(key, null)
    }
  })

  return lookup
}

export const resolveClassFromSubjectLookup = (
  lookup: Map<string, string | null>,
  navn: string,
  subjectGroup: string,
): string | undefined => {
  const resolved = lookup.get(buildNameSubjectLookupKey(navn, subjectGroup))
  return resolved ?? undefined
}

export const normalizeSubjectGroupKey = (value: string): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''

  // Some files include class prefix in subjectGroup, e.g. "3STC/NOR1268".
  const slashParts = trimmed.split('/')
  const tail = slashParts[slashParts.length - 1]?.trim() ?? trimmed

  return normalizeMatch(tail || trimmed)
}

export const isNorskSubject = (subject: string): boolean =>
  normalizeMatch(subject).includes('norsk')

export const hasTalentProgramTag = (className: string, programArea?: string): boolean => {
  if (!programArea) return false
  const normalizedClass = className.trim().toUpperCase()
  const normalizedProgram = programArea.trim().toUpperCase()
  return ['1STA', '2STA', '3STA'].includes(normalizedClass) && /-T-?$/.test(normalizedProgram)
}

export const getDisplayClassName = (className: string, programArea?: string): string =>
  hasTalentProgramTag(className, programArea) ? `${className} T` : className

export const findStudentInfo = (
  studentInfo: StudentInfoRecord[],
  navn: string,
  className?: string
): StudentInfoRecord | undefined => {
  const normalizedName = normalizeMatch(navn)
  const normalizedClass = className ? normalizeMatch(className) : ''

  return studentInfo.find(info => {
    if (normalizeMatch(info.navn) !== normalizedName) return false
    if (!className || !info.class) return true
    return normalizeMatch(info.class) === normalizedClass
  })
}

export const createStudentInfoLookup = (studentInfo: StudentInfoRecord[]): Map<string, StudentInfoRecord> => {
  const lookup = new Map<string, StudentInfoRecord>()

  studentInfo.forEach(info => {
    if (!info.class) return
    const classKey = buildStudentClassKey(info.navn, info.class)
    if (!classKey) return
    lookup.set(classKey, info)
  })

  return lookup
}

export const findStudentInfoInLookup = (
  lookup: Map<string, StudentInfoRecord>,
  navn: string,
  className?: string
): StudentInfoRecord | undefined => {
  return className ? lookup.get(buildStudentClassKey(navn, className)) : undefined
}

export const formatIntakePoints = (intakePoints: number | null): {
  label: string
  tone: 'green' | 'slate'
  empty: boolean
} => {
  if (intakePoints === null || Number.isNaN(intakePoints)) {
    return { label: '', tone: 'green', empty: true }
  }

  if (intakePoints === 400 || intakePoints === 900) {
    return { label: String(intakePoints), tone: 'green', empty: false }
  }

  if (intakePoints > 900 && intakePoints < 1000) {
    return {
      label: ((intakePoints - 900) / 10).toFixed(2).replace('.', ','),
      tone: 'green',
      empty: false,
    }
  }

  if (intakePoints > 400 && intakePoints < 500) {
    return {
      label: ((intakePoints - 400) / 10).toFixed(2).replace('.', ','),
      tone: 'slate',
      empty: false,
    }
  }

  return {
    label: String(intakePoints).replace('.', ','),
    tone: intakePoints >= 900 ? 'green' : 'slate',
    empty: false,
  }
}
