import type { StudentInfoRecord } from './types'

export const normalizeMatch = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')

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
