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
  }>
  avbrudd: boolean
  hasWarnings: boolean
  isAdult: boolean
}

export interface GradeRecord {
  navn: string
  subjectGroup: string
  fagkode: string
  grade: string
  halvår: string
}

export interface DataStore {
  absences: AbsenceRecord[]
  warnings: WarningRecord[]
  grades: GradeRecord[]
}
