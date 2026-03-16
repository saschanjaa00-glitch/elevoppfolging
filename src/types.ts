export interface AbsenceRecord {
  navn: string
  class: string
  subject: string
  subjectGroup: string
  percentageAbsence: number
  hoursAbsence: number
  teacher: string
  avbrudd: boolean
}

export interface WarningRecord {
  navn: string
  class: string
  subjectGroup: string
  warningType: string
  sentDate: string
  dateOfBirth: string
}

export interface StudentInfoRecord {
  navn: string
  fornavn: string
  etternavn: string
  class?: string
  dateOfBirth?: string
  programArea: string
  sidemalExemption: boolean
  intakePoints: number | null
}

export interface StudentAbsenceSummary {
  navn: string
  className: string
  maxPercentage: number
  totalHours: number
  subjects: Array<{
    subject: string
    subjectGroup: string
    teacher?: string
    percentageAbsence: number
    warnings: Array<{ warningType: string; sentDate: string }>
    grade?: string
    inheritsFromSubject?: string
  }>
  avbrudd: boolean
  hasWarnings: boolean
  isAdult: boolean
  programArea?: string
  sidemalExemption: boolean
  intakePoints: number | null
  hasTalentProgram: boolean
}

export interface GradeRecord {
  navn: string
  subjectGroup: string
  fagkode: string
  grade: string
  subjectTeacher?: string
  halvår: string
}

export interface DataStore {
  absences: AbsenceRecord[]
  warnings: WarningRecord[]
  grades: GradeRecord[]
  studentInfo: StudentInfoRecord[]
  warningFileCreatedDate?: string
}
