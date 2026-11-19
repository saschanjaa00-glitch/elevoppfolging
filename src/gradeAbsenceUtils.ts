import { useMemo, useState } from 'react'
import type { AbsenceRecord, DataStore, StudentGender, StudentInfoRecord } from './types'
import {
  buildStudentClassKey,
  buildStudentSubjectKey,
  createAbsenceSubjectClassLookup,
  createStudentInfoLookup,
  resolveClassFromSubjectLookup,
} from './studentInfoUtils'
import { resolveTeacher } from './teacherUtils'
import { fagkodeLookup } from './fagkodeLookup'

// Shared data, filters and chart scaffolding for the "… vs. fravær" subtabs under Statistikk.

export type Term = '1' | '2'
export type GenderFilter = 'all' | StudentGender
export type HistogramMode = 'antall' | 'andel'
export type ChartMode = 'elev' | 'fag' | 'faggruppe'
export type CompareBy = 'none' | 'kjonn' | 'trinn'
export type DotColorBy = 'gender' | 'trinn' | 'single'
export type AverageVariant = 'bars' | 'box'

export const CHART_MODE_UNIT: Record<ChartMode, string> = { elev: 'elever', fag: 'fag', faggruppe: 'faggrupper' }
export const CHART_MODE_SINGULAR: Record<ChartMode, string> = { elev: 'elev', fag: 'fag', faggruppe: 'faggruppe' }
export const CHART_MODE_LABEL: Record<ChartMode, string> = { elev: 'Elev', fag: 'Fag', faggruppe: 'Faggruppe' }

export const GRADE_LABELS = ['IV', '1', '2', '3', '4', '5', '6'] as const
export type GradeLabel = (typeof GRADE_LABELS)[number]

export const GRADE_COLOR: Record<GradeLabel, string> = {
  IV: '#7f1d1d',
  '1': '#dc2626',
  '2': '#f97316',
  '3': '#facc15',
  '4': '#a3e635',
  '5': '#22c55e',
  '6': '#15803d',
}

export const GENDER_LABEL: Record<StudentGender, string> = { girl: 'Jenter', boy: 'Gutter' }
export const GENDER_COLOR: Record<StudentGender, string> = { girl: '#e11d48', boy: '#0284c7' }
export const UNKNOWN_GENDER_COLOR = '#64748b'
export const SINGLE_DOT_COLOR = '#0369a1'
const TRINN_COLOR: Record<string, string> = { '1': '#059669', '2': '#d97706', '3': '#0891b2' }
const OTHER_TRINN_COLOR = '#64748b'
export const trinnColor = (level: string) => TRINN_COLOR[level] ?? OTHER_TRINN_COLOR

export const STEP_OPTIONS = [1, 2, 2.5, 5, 10]
export const CAP_OPTIONS = [10, 15, 20, 25, 30, 40, 50]
export const FRAVAER_ROUNDING_OPTIONS = [0.25, 0.5, 1, 2]
export const FRAVAER_AVERAGE_COLOR = '#6d28d9'

export type FravaerType = 'X' | 'D' | '!' | 'R'
export const FRAVAER_TYPES: FravaerType[] = ['X', 'D', '!', 'R']
export const FRAVAER_TYPE_INFO: Record<FravaerType, { label: string; title: string }> = {
  X: { label: 'X, M', title: 'Udokumentert fravær (X, M), prosent fra fraværsfilen' },
  D: { label: 'D', title: 'Dokumentert fravær (D): timer / årstimer' },
  '!': { label: '!', title: 'Fravær (!): timer / årstimer' },
  R: { label: 'R', title: 'Fravær (R): timer / årstimer' },
}
export const emptyParts = (): Record<FravaerType, number> => ({ X: 0, D: 0, '!': 0, R: 0 })

// One student's grade in one subject, paired with the fravær in that same subject.
export interface DataPoint {
  id: string
  navn: string
  studentKey: string
  className: string
  level: string
  subject: string
  subjectGroup: string
  teacher: string
  gender: StudentGender | null
  // Fravær on the x-axis: sum of the selected fravær types (% of årstimer, X straight from the file).
  absence: number
  parts: Record<FravaerType, number>
  gradeLabel: GradeLabel
  grade: number | null
}

export interface Regression {
  r: number | null
  slope: number | null
  intercept: number | null
}

// Pearson correlation and least-squares line of y on x.
export function linearRegression(pairs: Array<[number, number]>): Regression {
  const n = pairs.length
  if (n < 3) return { r: null, slope: null, intercept: null }
  const meanX = pairs.reduce((s, [x]) => s + x, 0) / n
  const meanY = pairs.reduce((s, [, y]) => s + y, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  pairs.forEach(([x, y]) => {
    const dx = x - meanX
    const dy = y - meanY
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  })
  if (sxx === 0) return { r: null, slope: null, intercept: null }
  const slope = sxy / sxx
  return { r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : null, slope, intercept: meanY - slope * meanX }
}

export interface BucketRange<T> {
  key: string
  label: string
  lo: number
  hi: number
  overflow: boolean
  points: T[]
}

// Regular fravær intervals of `step` up to `cap`, then one overflow interval for everything at or above the cap.
export function groupIntoBuckets<T extends { absence: number }>(points: T[], step: number, cap: number): BucketRange<T>[]
export function groupIntoBuckets<T>(points: T[], step: number, cap: number, valueOf: (point: T) => number): BucketRange<T>[]
export function groupIntoBuckets<T>(
  points: T[],
  step: number,
  cap: number,
  valueOf: (point: T) => number = point => (point as { absence: number }).absence,
): BucketRange<T>[] {
  const regularCount = Math.max(1, Math.ceil(cap / step - 1e-9))
  const ranges: Array<{ lo: number; hi: number; overflow: boolean }> = []
  for (let i = 0; i < regularCount; i++) {
    ranges.push({ lo: i * step, hi: Math.min((i + 1) * step, cap), overflow: false })
  }
  ranges.push({ lo: cap, hi: Infinity, overflow: true })

  const grouped: T[][] = ranges.map(() => [])
  points.forEach(point => {
    const value = valueOf(point)
    const index = value >= cap
      ? ranges.length - 1
      : Math.min(regularCount - 1, Math.floor(value / step + 1e-9))
    grouped[index].push(point)
  })

  return ranges.map((range, index) => ({
    key: `${range.lo}`,
    label: range.overflow ? `≥ ${fmtPct(range.lo)} %` : `${fmtPct(range.lo)}–${fmtPct(range.hi)} %`,
    ...range,
    points: grouped[index],
  }))
}

// D, ! and R are hours / årstimer. Without Årstimer, derive it from udok. timer and udok. %.
export function annualHoursOf(absence: AbsenceRecord): number | null {
  if ((absence.annualHours ?? 0) > 0) return absence.annualHours!
  if (absence.percentageAbsence > 0 && absence.hoursAbsence > 0) return absence.hoursAbsence / (absence.percentageAbsence / 100)
  return null
}

export const isT1 = (halvaar: string) => halvaar === '1' || (halvaar.includes('1') && !halvaar.includes('2'))
export const isT2 = (halvaar: string) => halvaar === '2' || (halvaar.includes('2') && !halvaar.includes('1'))

export function parseGradeLabel(raw: string): GradeLabel | null {
  const value = raw.trim().toUpperCase()
  return (GRADE_LABELS as readonly string[]).includes(value) ? (value as GradeLabel) : null
}

export function fmt(n: number | null, decimals = 2): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(decimals).replace('.', ',')
}

// Like fmt, but with an explicit + for positive values (for differences).
export function fmtSigned(n: number | null, decimals = 2): string {
  if (n === null || Number.isNaN(n)) return '—'
  const text = fmt(Math.abs(n), decimals)
  if (Number(n.toFixed(decimals)) === 0) return text
  return n > 0 ? `+${text}` : `−${text}`
}

export function fmtPct(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))).replace('.', ',')
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower)
}

export interface BoxStats {
  n: number
  min: number
  max: number
  q1: number
  median: number
  q3: number
  mean: number
  whiskerLow: number
  whiskerHigh: number
  outliers: number[]
}

// Tukey box plot: whiskers reach the furthest values within 1.5 × IQR of the box; anything beyond is an outlier.
export function computeBoxStats(values: number[]): BoxStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  const lowFence = q1 - 1.5 * iqr
  const highFence = q3 + 1.5 * iqr
  const inside = sorted.filter(v => v >= lowFence && v <= highFence)
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1,
    median: quantile(sorted, 0.5),
    q3,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    whiskerLow: inside[0] ?? q1,
    whiskerHigh: inside[inside.length - 1] ?? q3,
    outliers: sorted.filter(v => v < lowFence || v > highFence),
  }
}

export function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  values.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1))
  let best = values[0] ?? ''
  counts.forEach((count, value) => { if (count > (counts.get(best) ?? 0)) best = value })
  return best
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null
}

// Deterministic jitter in [-1, 1] so points don't move between renders.
export function jitter(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * 2 - 1
}

export function compareClassNames(a: string, b: string): number {
  return a.localeCompare(b, 'nb-NO', { numeric: true })
}

export function niceMax(value: number): number {
  if (value <= 5) return 5
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const nice = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

// Grunnskolepoeng on the 1–6 grade scale: Inntakspoeng / 10.
// Inntakspoeng prefixed with 400/900 (e.g. 945 = 45 poeng) has the prefix removed first; a bare 400/900 has no poeng.
export function intakeAsGrade(intakePoints: number | null | undefined): number | null {
  if (intakePoints === null || intakePoints === undefined || Number.isNaN(intakePoints)) return null
  let points = intakePoints
  if (points >= 900 && points < 1000) points -= 900
  else if (points >= 400 && points < 500) points -= 400
  if (points <= 0 || points >= 100) return null
  return points / 10
}

export const CHART_WIDTH = 960
export const MARGIN = { left: 52, right: 16, top: 16, bottom: 40 }
export const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right
export const PLOT_RIGHT = CHART_WIDTH - MARGIN.right

// Shared x axis. The fravær axis has regular intervals from 0 up to the cap, then one overflow band of the same width;
// a range axis (e.g. inntak) just spans `start`–`cap` with no overflow band.
export interface XScale {
  step: number
  // First value on the axis (0 for fravær).
  start: number
  cap: number
  span: number
  overflow: boolean
  title: string
  boundaries: number[]
  labelEvery: number
  formatTick: (value: number) => string
  lin: (value: number) => number
  xOfAbsence: (value: number) => number
}

export function makeXScale(points: Array<{ absence: number }>, step: number, cap: number, title: string): XScale {
  const span = cap + step
  const lin = (value: number) => MARGIN.left + (value / span) * PLOT_WIDTH
  // Values above the cap are squeezed into the overflow band so a few extreme values don't flatten the rest.
  const maxAbsence = points.reduce((max, p) => Math.max(max, p.absence), 0)
  const xOfAbsence = (value: number) => {
    if (value < cap) return lin(value)
    const range = maxAbsence - cap
    const fraction = range > 0 ? Math.min(1, (value - cap) / range) : 0
    return lin(cap + step * (0.08 + 0.84 * fraction))
  }
  const boundaries: number[] = []
  for (let value = 0; value < cap - 1e-9; value += step) boundaries.push(value)
  boundaries.push(cap)
  const labelEvery = boundaries.length > 16 ? Math.ceil(boundaries.length / 12) : 1
  return { step, start: 0, cap, span, overflow: true, title, boundaries, labelEvery, formatTick: fmtPct, lin, xOfAbsence }
}

// Linear axis from `lo` to `hi` with interval lines every `step`; values outside are clamped to the edges.
export function makeRangeXScale(lo: number, hi: number, step: number, title: string): XScale {
  const lin = (value: number) => MARGIN.left + ((value - lo) / (hi - lo)) * PLOT_WIDTH
  const boundaries: number[] = []
  const count = Math.round((hi - lo) / step)
  for (let i = 0; i <= count; i++) boundaries.push(Math.round((lo + i * step) * 100) / 100)
  const labelEvery = boundaries.length > 16 ? Math.ceil(boundaries.length / 12) : 1
  return {
    step,
    start: lo,
    cap: hi,
    span: hi,
    overflow: false,
    title,
    boundaries,
    labelEvery,
    formatTick: value => fmt(value, Number.isInteger(Math.round(value * 100) / 10) ? 1 : 2),
    lin,
    xOfAbsence: value => lin(Math.min(hi, Math.max(lo, value))),
  }
}

// Intervals of `step` from `lo` to `hi`; values outside the range land in the first or last interval.
export function groupIntoRangeBuckets<T>(
  points: T[],
  valueOf: (point: T) => number,
  lo: number,
  hi: number,
  step: number,
  formatValue: (value: number) => string,
): BucketRange<T>[] {
  const count = Math.max(1, Math.round((hi - lo) / step))
  const grouped: T[][] = Array.from({ length: count }, () => [])
  points.forEach(point => {
    const index = Math.min(count - 1, Math.max(0, Math.floor((valueOf(point) - lo) / step + 1e-9)))
    grouped[index].push(point)
  })
  return grouped.map((bucketPoints, index) => {
    const bucketLo = Math.round((lo + index * step) * 100) / 100
    const bucketHi = Math.round((lo + (index + 1) * step) * 100) / 100
    return {
      key: `${bucketLo}`,
      label: `${formatValue(bucketLo)}–${formatValue(bucketHi)}`,
      lo: bucketLo,
      hi: bucketHi,
      overflow: false,
      points: bucketPoints,
    }
  })
}

export function bucketX(scale: XScale, bucket: { lo: number; hi: number; overflow: boolean }): { x1: number; x2: number } {
  return { x1: scale.lin(bucket.lo), x2: scale.lin(bucket.overflow ? scale.span : bucket.hi) }
}

// Term, trinn, kjønn, klasser, fravær types and the D/IV graph filters, plus every T1/T2 grade matched to fravær in the same fag.
export function useGradeAbsenceData(data: DataStore) {
  const hasT1 = useMemo(() => data.grades.some(g => isT1(g.halvår?.toString().trim().toLowerCase() ?? '')), [data.grades])
  const hasT2 = useMemo(() => data.grades.some(g => isT2(g.halvår?.toString().trim().toLowerCase() ?? '')), [data.grades])
  const [term, setTerm] = useState<Term>(() => (hasT2 ? '2' : '1'))
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all')
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [step, setStep] = useState(2.5)
  const [cap, setCap] = useState(20)
  const [compareBy, setCompareBy] = useState<CompareBy>('none')
  const [fravaerTypes, setFravaerTypes] = useState<Record<FravaerType, boolean>>({ X: true, D: true, '!': true, R: false })
  const [excludeHighD, setExcludeHighD] = useState(false)
  const [maxD, setMaxD] = useState(2)
  const [excludeIv, setExcludeIv] = useState(false)

  const absenceSubjectClassLookup = useMemo(() => createAbsenceSubjectClassLookup(data.absences), [data.absences])
  const studentInfoLookup = useMemo<Map<string, StudentInfoRecord>>(() => createStudentInfoLookup(data.studentInfo), [data.studentInfo])

  const absenceByStudentSubject = useMemo(() => {
    const result = new Map<string, AbsenceRecord>()
    data.absences.forEach(record => {
      if (record.avbrudd) return
      const key = buildStudentSubjectKey(record.navn, record.class, record.subjectGroup)
      if (!result.has(key)) result.set(key, record)
    })
    return result
  }, [data.absences])

  const fravaerAvailable = useMemo<Record<FravaerType, boolean>>(() => ({
    X: true,
    D: data.absences.some(a => a.documentedHours !== undefined),
    '!': data.absences.some(a => a.exclamationHours !== undefined),
    R: data.absences.some(a => a.rHours !== undefined),
  }), [data.absences])
  const activeTypes = useMemo(
    () => FRAVAER_TYPES.filter(type => fravaerTypes[type] && fravaerAvailable[type]),
    [fravaerTypes, fravaerAvailable]
  )
  const onlyX = activeTypes.length === 1 && activeTypes[0] === 'X'
  const activeTypesLabel = activeTypes.map(type => FRAVAER_TYPE_INFO[type].label).join(' + ')
  const toggleFravaerType = (type: FravaerType) => {
    // Keep at least one type selected so there is always a fravær value.
    if (fravaerTypes[type] && activeTypes.length === 1 && activeTypes[0] === type) return
    setFravaerTypes(current => ({ ...current, [type]: !current[type] }))
  }

  const { points: allPoints, missingAnnualHours } = useMemo(() => {
    const result: DataPoint[] = []
    const seen = new Set<string>()
    let missingAnnual = 0
    data.grades.forEach(grade => {
      const halvaar = grade.halvår?.toString().trim().toLowerCase() ?? ''
      if (term === '1' ? !isT1(halvaar) : !isT2(halvaar)) return
      // Exam grades say nothing about fravær in the subject; only use halvår/standpunkt.
      if ((grade.assessmentType ?? '').toLowerCase().includes('eksam')) return

      const gradeLabel = parseGradeLabel(grade.grade)
      if (!gradeLabel) return

      const className = grade.class?.trim() || resolveClassFromSubjectLookup(absenceSubjectClassLookup, grade.navn, grade.subjectGroup)
      if (!className) return

      const key = buildStudentSubjectKey(grade.navn, className, grade.subjectGroup)
      if (seen.has(key)) return
      const absence = absenceByStudentSubject.get(key)
      if (!absence) return

      const studentKey = buildStudentClassKey(grade.navn, className)
      const subject = absence.subject?.trim()
        || fagkodeLookup[(grade.fagkode ?? '').trim().toUpperCase()]
        || grade.subjectGroup.trim()
      const teacher = grade.subjectTeacher?.trim()
        || resolveTeacher(absence.subject ?? '', absence.teacher ?? '').trim()
        || '—'

      const parts = emptyParts()
      parts.X = Math.max(0, absence.percentageAbsence)
      const hoursOf: Record<FravaerType, number | undefined> = {
        X: undefined,
        D: absence.documentedHours,
        '!': absence.exclamationHours,
        R: absence.rHours,
      }
      if (activeTypes.some(type => type !== 'X' && (hoursOf[type] ?? 0) > 0)) {
        const annualHours = annualHoursOf(absence)
        if (annualHours === null) {
          missingAnnual++
          return
        }
        activeTypes.forEach(type => {
          if (type !== 'X') parts[type] = ((hoursOf[type] ?? 0) / annualHours) * 100
        })
      }
      seen.add(key)

      result.push({
        id: key,
        navn: grade.navn,
        studentKey,
        className: absence.class.trim() || className,
        level: className.trim().match(/^(\d)/)?.[1] ?? '',
        subject,
        subjectGroup: absence.subjectGroup?.trim() || grade.subjectGroup.trim(),
        teacher,
        gender: studentInfoLookup.get(studentKey)?.gender ?? null,
        absence: activeTypes.reduce((sum, type) => sum + parts[type], 0),
        parts,
        gradeLabel,
        grade: gradeLabel === 'IV' ? null : Number(gradeLabel),
      })
    })
    return { points: result, missingAnnualHours: missingAnnual }
  }, [data.grades, term, activeTypes, absenceSubjectClassLookup, absenceByStudentSubject, studentInfoLookup])

  const hasGenderData = useMemo(() => allPoints.some(p => p.gender !== null), [allPoints])
  const levelOptions = useMemo(
    () => Array.from(new Set(allPoints.map(p => p.level).filter(Boolean))).sort(),
    [allPoints]
  )

  // Filters cascade: trinn + kjønn → klasser → lærer / fag.
  const levelGenderPoints = useMemo(
    () => allPoints.filter(p =>
      (!levelFilter || p.level === levelFilter)
      && (genderFilter === 'all' || p.gender === genderFilter)
    ),
    [allPoints, levelFilter, genderFilter]
  )
  const classOptions = useMemo(
    () => Array.from(new Set(levelGenderPoints.map(p => p.className))).sort(compareClassNames),
    [levelGenderPoints]
  )
  const activeClasses = useMemo(
    () => selectedClasses.filter(c => classOptions.includes(c)),
    [selectedClasses, classOptions]
  )
  const points = useMemo(
    () => activeClasses.length === 0
      ? levelGenderPoints
      : levelGenderPoints.filter(p => activeClasses.includes(p.className)),
    [levelGenderPoints, activeClasses]
  )

  // Each student's D-fravær: mean of D-timer / årstimer over all their fag in the fravær file.
  // Rows where årstimer can't be found are skipped; students with no usable row are never removed.
  const studentDShare = useMemo(() => {
    const sums = new Map<string, { sum: number; n: number }>()
    data.absences.forEach(record => {
      if (record.avbrudd || record.documentedHours === undefined) return
      const annualHours = annualHoursOf(record)
      if (annualHours === null && record.documentedHours > 0) return
      const share = annualHours === null ? 0 : (record.documentedHours / annualHours) * 100
      const key = buildStudentClassKey(record.navn, record.class)
      const entry = sums.get(key)
      if (entry) {
        entry.sum += share
        entry.n++
      } else {
        sums.set(key, { sum: share, n: 1 })
      }
    })
    const result = new Map<string, number>()
    sums.forEach(({ sum, n }, key) => result.set(key, sum / n))
    return result
  }, [data.absences])

  const useDFilter = excludeHighD && fravaerAvailable.D
  const { graphSourcePoints, removedByD, removedByIv } = useMemo(() => {
    if (!useDFilter && !excludeIv) return { graphSourcePoints: points, removedByD: 0, removedByIv: 0 }
    // IV in any fag this term removes the student from the graphs.
    const ivStudents = excludeIv
      ? new Set(points.filter(p => p.gradeLabel === 'IV').map(p => p.studentKey))
      : new Set<string>()
    const droppedByD = new Set<string>()
    const droppedByIv = new Set<string>()
    const kept = points.filter(p => {
      let drop = false
      if (useDFilter) {
        const share = studentDShare.get(p.studentKey)
        if (share !== undefined && share > maxD) {
          droppedByD.add(p.studentKey)
          drop = true
        }
      }
      if (ivStudents.has(p.studentKey)) {
        droppedByIv.add(p.studentKey)
        drop = true
      }
      return !drop
    })
    return { graphSourcePoints: kept, removedByD: droppedByD.size, removedByIv: droppedByIv.size }
  }, [points, useDFilter, maxD, studentDShare, excludeIv])

  const filtersActive = levelFilter !== null || genderFilter !== 'all' || activeClasses.length > 0
  const resetFilters = () => {
    setLevelFilter(null)
    setGenderFilter('all')
    setSelectedClasses([])
  }
  const toggleClass = (className: string) => {
    setSelectedClasses(current =>
      current.includes(className) ? current.filter(c => c !== className) : [...current, className]
    )
  }
  const clearClasses = () => setSelectedClasses([])

  return {
    hasT1, hasT2, term, setTerm,
    levelFilter, setLevelFilter, levelOptions,
    genderFilter, setGenderFilter, hasGenderData,
    classOptions, activeClasses, toggleClass, clearClasses,
    filtersActive, resetFilters,
    step, setStep, cap, setCap,
    compareBy, setCompareBy,
    fravaerTypes, fravaerAvailable, activeTypes, onlyX, activeTypesLabel, toggleFravaerType,
    excludeHighD, setExcludeHighD, maxD, setMaxD, useDFilter,
    excludeIv, setExcludeIv,
    allPoints, missingAnnualHours, points, graphSourcePoints, removedByD, removedByIv,
    studentInfoLookup,
  }
}

export type GradeAbsenceData = ReturnType<typeof useGradeAbsenceData>
