import * as XLSX from 'xlsx'
import type { DataStore } from './types'
import { normalizeSubjectGroupKey } from './studentInfoUtils'
import { fagkodeLookup } from './fagkodeLookup'

export interface ParsedExamRow {
  navn: string
  klasse?: string
  telefon?: string
  subjectGroup: string
  subject: string
  grade: string
  standpunkt: string
  teacher?: string
  imDoc?: 'dok' | 'udok' | null
  // True when the student failed standpunkt but has no exam in this subject.
  noExam?: boolean
}

// Worst-to-best ordering so failing grades sort first in ascending order.
export const GRADE_ORDER = ['IM', 'IV', '1', '2', '3', '4', '5', '6']
export const gradeRank = (g: string): number => {
  const i = GRADE_ORDER.indexOf((g || '').toUpperCase())
  return i === -1 ? GRADE_ORDER.length : i
}

// Numeric value of a passing grade (1-6), or null for IV/IM/empty/unknown.
export const numericGrade = (g: string): number | null => {
  const v = (g || '').trim()
  return /^[1-6]$/.test(v) ? Number(v) : null
}

// Display value for the exam grade, e.g. "IM (udok)". Rows without an exam show "-".
export const formatExamGrade = (r: ParsedExamRow): string =>
  r.noExam ? '-' : r.grade === 'IM' && r.imDoc ? `IM (${r.imDoc})` : r.grade

// Truncate long subject names for display.
export const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

const stripDiacritics = (s: string): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// Order-invariant, token-based match against a single field value. Every
// whitespace separated token in the query must appear in the value, so e.g.
// "Per Pettersen Jan" still matches "Jan Per Pettersen". Empty query = match.
export const fieldMatchesQuery = (value: string | undefined, query: string): boolean => {
  const tokens = stripDiacritics(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const hay = stripDiacritics(value ?? '')
  return tokens.every(t => hay.includes(t))
}

// Strip a leading +47 country code and format as "xx xx xx xx".
export const normalizePhone = (raw: string): string => {
  const digits = (raw ?? '').trim().replace(/^\+47[\s-]*/, '').replace(/\D/g, '')
  if (digits.length === 8) return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
  return digits
}

// Derive the trinn (VG1/VG2/VG3) from the leading digit of a class name, e.g. "2STB" -> '2'.
export const classLevel = (klasse?: string): '1' | '2' | '3' | null => {
  const m = (klasse ?? '').trim().match(/^(\d)/)
  return m && (m[1] === '1' || m[1] === '2' || m[1] === '3') ? (m[1] as '1' | '2' | '3') : null
}

const normalizeHeader = (h: string) =>
  h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '')

const getRowValue = (row: Record<string, any>, aliases: string[]) => {
  const headers = Object.keys(row)
  const normalizedAliases = aliases.map(a => normalizeHeader(a))
  const header = headers.find(h => normalizedAliases.includes(normalizeHeader(h)))
  return header ? String(row[header] ?? '').trim() : ''
}

// Order-independent name key so "Ola Nordmann" and "Nordmann Ola" match.
export const orderInvariantNameKey = (navn: string): string =>
  (navn ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join('')

const buildNameSubjectKey = (navn: string, subjectGroup: string): string =>
  `${orderInvariantNameKey(navn)}::${normalizeSubjectGroupKey(subjectGroup)}`

// Pull the bare fagkode out of a record's fagkode / faggruppe field.
const subjectCodeOf = (fagkode: string, subjectGroup: string): string => {
  const fk = (fagkode || '').toUpperCase().trim()
  if (fk) return fk
  return (subjectGroup || '').toUpperCase().split('/').pop()?.trim() ?? ''
}

const resolveSubjectName = (subject: string, fagkode: string, subjectGroup: string): string => {
  if (subject) return subject
  return fagkodeLookup[subjectCodeOf(fagkode, subjectGroup)] || subjectGroup
}

// Base subject key that ignores oral/written qualifiers so e.g. "Spansk II"
// (standpunkt) matches "Spansk II, muntlig" (oral exam, different fagkode).
const subjectNameKey = (name: string): string =>
  (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(muntlig|skriftlig|praktisk)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')

// Canonicalise a grade value. Handles decorated values such as
// "IM (dokumentert fravær)", "IV", "1 (klage)" -> "IM" / "IV" / "1".
const canonicalGrade = (raw: string): string => {
  const up = (raw ?? '').toString().toUpperCase().trim()
  if (!up) return ''
  if (/\bIM\b/.test(up) || up.startsWith('IM')) return 'IM'
  if (/\bIV\b/.test(up) || up.startsWith('IV')) return 'IV'
  const digit = up.match(/[1-6]/)
  return digit ? digit[0] : up
}

// For an IM grade, detect whether the absence is documented (dok) or not (udok).
// udok covers "udokumentert" as well as "ikke dokumentert fravær".
const detectImDoc = (raw: string): 'dok' | 'udok' | null => {
  const low = (raw ?? '').toString().toLowerCase()
  const compact = low.replace(/[^a-z]/g, '')
  if (low.includes('udok') || compact.includes('ikkedok')) return 'udok'
  if (compact.includes('dok')) return 'dok'
  return null
}

// Whether a grade row from the vurderingsfile should be treated as the final
// (standpunkt) grade: Halvår column = 2 AND assessment type is Standpunkt or Halvår.
const isFinalGrade = (g: { halvår?: string; assessmentType?: string }): boolean => {
  const halv = (g.halvår ?? '').toString().toLowerCase()
  const assessment = (g.assessmentType ?? '').toString().toLowerCase()
  if (!halv.includes('2')) return false
  return assessment.includes('standpunkt') || assessment.includes('halvår') || assessment.includes('halvar')
}

// Parse an uploaded exam/grade workbook into normalised rows. Resolves each
// student's standpunkt grade (Halvår 2, type Standpunkt/Halvår) and class from
// the imported data set.
export async function parseExamFile(file: File, data: DataStore): Promise<ParsedExamRow[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer)
  const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, any>[]

  // Standpunkt grade per student+subject, name-order independent.
  // Indexed both by fagkode and by base subject name, so an oral exam with a
  // different fagkode still resolves the matching standpunkt grade.
  const byCode = new Map<string, string>()
  const byName = new Map<string, string>()
  data.grades.forEach(g => {
    if (!isFinalGrade(g)) return
    const nameKey = orderInvariantNameKey(g.navn)
    if (!nameKey) return
    const grade = canonicalGrade(g.grade ?? '')
    const codeKey = buildNameSubjectKey(g.navn, g.subjectGroup || g.fagkode)
    if (codeKey && !byCode.has(codeKey)) byCode.set(codeKey, grade)
    const subName = fagkodeLookup[subjectCodeOf(g.fagkode, g.subjectGroup)] || ''
    const nKey = subjectNameKey(subName)
    if (nKey) {
      const k = `${nameKey}::${nKey}`
      if (!byName.has(k)) byName.set(k, grade)
    }
  })

  const resolveStandpunkt = (navn: string, _fagkode: string, subjectGroup: string, subjectName: string): string => {
    const code = byCode.get(buildNameSubjectKey(navn, subjectGroup))
    if (code) return code
    const nKey = subjectNameKey(subjectName)
    if (!nKey) return ''
    return byName.get(`${orderInvariantNameKey(navn)}::${nKey}`) ?? ''
  }

  // Resolve a student's class from absences/grades, by name (and subject when available).
  const classMap = new Map<string, string>()
  const addClass = (navn: string, subjectGroup: string, className?: string) => {
    const cls = className?.trim()
    if (!cls) return
    const subjectKey = buildNameSubjectKey(navn, subjectGroup)
    if (!classMap.has(subjectKey)) classMap.set(subjectKey, cls)
    const nameKey = orderInvariantNameKey(navn)
    if (nameKey && !classMap.has(nameKey)) classMap.set(nameKey, cls)
  }
  data.absences.forEach(a => addClass(a.navn, a.subjectGroup, a.class))
  data.grades.forEach(g => addClass(g.navn, g.subjectGroup || g.fagkode, g.class))
  const resolveClass = (navn: string, subjectGroup: string): string | undefined =>
    classMap.get(buildNameSubjectKey(navn, subjectGroup)) ?? classMap.get(orderInvariantNameKey(navn))

  // Resolve a student's subject teacher from grades (subjectTeacher) and
  // absences (teacher), keyed by name+subject (code and base subject name).
  const teacherMap = new Map<string, string>()
  const addTeacher = (navn: string, subjectGroup: string, subjectName: string, teacher?: string) => {
    const t = (teacher ?? '').trim()
    if (!t) return
    const codeKey = buildNameSubjectKey(navn, subjectGroup)
    if (!teacherMap.has(codeKey)) teacherMap.set(codeKey, t)
    const nk = subjectNameKey(subjectName)
    if (nk) {
      const k = `${orderInvariantNameKey(navn)}::${nk}`
      if (!teacherMap.has(k)) teacherMap.set(k, t)
    }
  }
  data.grades.forEach(g => {
    const subName = fagkodeLookup[subjectCodeOf(g.fagkode, g.subjectGroup)] || g.subjectGroup || g.fagkode
    addTeacher(g.navn, g.subjectGroup || g.fagkode, subName, g.subjectTeacher)
  })
  data.absences.forEach(a => addTeacher(a.navn, a.subjectGroup, a.subject, a.teacher))
  const resolveTeacherFor = (navn: string, subjectGroup: string, subjectName: string): string | undefined => {
    const byGroup = teacherMap.get(buildNameSubjectKey(navn, subjectGroup))
    if (byGroup) return byGroup
    const nk = subjectNameKey(subjectName)
    if (!nk) return undefined
    return teacherMap.get(`${orderInvariantNameKey(navn)}::${nk}`)
  }

  const parsed: ParsedExamRow[] = []
  for (const r of sheet) {
    const fornavn = getRowValue(r, ['fornavn', 'first name', 'firstname'])
    const etternavn = getRowValue(r, ['etternavn', 'last name', 'lastname'])
    const navn =
      [fornavn, etternavn].filter(Boolean).join(' ').trim() ||
      getRowValue(r, ['navn', 'elev', 'student', 'navn_elev', 'elevnavn'])

    const klasse = getRowValue(r, ['klasse', 'class', 'klassegruppe'])
    const telefon = normalizePhone(getRowValue(r, ['telefon', 'phone', 'mobil', 'mobile', 'tlf', 'mobiltelefon']))
    const fagkode = getRowValue(r, ['fagkode', 'code'])
    const faggruppe = getRowValue(r, ['faggruppe', 'gruppe', 'subjectgroup'])
    const subjectGroup = faggruppe || fagkode
    const subject = getRowValue(r, ['fagnavn', 'fag', 'subject'])
    const grade = getRowValue(r, ['karakter', 'grade', 'resultat'])
    const halv = getRowValue(r, ['halvår', 'halvar', 'termin', 'term'])
    const assessmentType = getRowValue(r, ['vurderingstype', 'assessment type', 'type'])

    if (!navn || !subjectGroup || !grade) continue

    const gradeNorm = canonicalGrade(grade)
    const halvarNorm = halv.toString().trim().toLowerCase()
    const assessmentNorm = assessmentType.toString().trim().toLowerCase()

    const isExam =
      assessmentNorm.includes('eksam') || assessmentNorm.includes('pas') || halvarNorm.includes('2')

    // Only skip rows that explicitly belong to another term/assessment.
    // When the file has no term/assessment columns, treat every row as relevant.
    if (!isExam && !halvarNorm.includes('2') && (halvarNorm || assessmentNorm)) continue

    const subjectName = resolveSubjectName(subject, fagkode, subjectGroup)
    const resolvedClass = klasse || resolveClass(navn, subjectGroup)
    const standpunkt = resolveStandpunkt(navn, fagkode, subjectGroup, subjectName)

    parsed.push({
      navn,
      klasse: resolvedClass,
      telefon,
      subjectGroup,
      subject: subjectName,
      grade: gradeNorm,
      standpunkt,
      teacher: resolveTeacherFor(navn, subjectGroup, subjectName),
      imDoc: gradeNorm === 'IM' ? detectImDoc(grade) : null,
    })
  }

  // Add students who failed standpunkt (IM/IV/1) but have no exam in that
  // subject, so they still surface on the "Ikke bestått" tab. These rows are
  // flagged noExam so the Eksamen tab can exclude them.
  const FAILING_STANDPUNKT = new Set(['IM', 'IV', '1'])
  const examKeys = new Set<string>()
  parsed.forEach(p => {
    examKeys.add(buildNameSubjectKey(p.navn, p.subjectGroup))
    const nk = subjectNameKey(p.subject)
    if (nk) examKeys.add(`${orderInvariantNameKey(p.navn)}::${nk}`)
  })
  const syntheticSeen = new Set<string>()
  data.grades.forEach(g => {
    if (!isFinalGrade(g)) return
    const standpunkt = canonicalGrade(g.grade ?? '')
    if (!FAILING_STANDPUNKT.has(standpunkt)) return
    const subjectGroup = g.subjectGroup || g.fagkode
    if (!g.navn || !subjectGroup) return
    const subjectName = fagkodeLookup[subjectCodeOf(g.fagkode, g.subjectGroup)] || subjectGroup
    const codeKey = buildNameSubjectKey(g.navn, subjectGroup)
    const nk = subjectNameKey(subjectName)
    const nameKey = nk ? `${orderInvariantNameKey(g.navn)}::${nk}` : ''
    // Skip when an exam row already covers this student+subject.
    if (examKeys.has(codeKey) || (nameKey && examKeys.has(nameKey))) return
    if (syntheticSeen.has(codeKey)) return
    syntheticSeen.add(codeKey)
    parsed.push({
      navn: g.navn,
      klasse: g.class || resolveClass(g.navn, subjectGroup),
      telefon: undefined,
      subjectGroup,
      subject: subjectName,
      grade: '',
      standpunkt,
      imDoc: standpunkt === 'IM' ? detectImDoc(g.grade ?? '') : null,
      noExam: true,
    })
  })

  return parsed
}
