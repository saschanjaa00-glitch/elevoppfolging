import { useDeferredValue, useMemo, useState } from 'react'
import type { DataStore, StudentAbsenceSummary } from '../types'
import { Eye, X, Printer, FileText } from 'lucide-react'
import StudentDetail from './StudentDetail'
import { resolveTeacher } from '../teacherUtils'
import { createStudentInfoLookup, findStudentInfoInLookup, formatIntakePoints, getDisplayClassName, hasTalentProgramTag, isNorskSubject, normalizeMatch, normalizeSubjectGroupKey } from '../studentInfoUtils'
import { compareDateStrings, formatDateDdMmYyyy, todayDdMmYyyy, warningDateColorClass } from '../dateUtils'

interface StudentListProps {
  data: DataStore
  selectedClasses: string[]
  threshold: number
  studentSearch: string
  kontaktlaererSearch: string
  faglaererSearch: string
  missingWarningsOnly: boolean
  lowGradeFilter: string[]
  fullRapport: boolean
  fullRapportInclude2: boolean
  noFilter: boolean
}

const LOW_GRADES = ['IV', '1', '2']

const RADGIVER: Record<string, string[]> = {
  Lasse: ['1IDA', '1IDB', '2IDA', '2IDB', '3IDA', '3IDB', '1TMT', '2TMT', '3TMT'],
  Trond: ['1TID', '2TID', '3TID', '1STA', '1STB', '1STC', '2STA', '2STB', '3STA', '3STB', '3STC'],
  Trude: ['1STD', '1STE', '1STF', '2STC', '2STD', '2STE', '2STF', '3STD', '3STE', '3STF'],
}

let jsPdfModulePromise: Promise<typeof import('jspdf')> | null = null
let docxModulePromise: Promise<typeof import('docx')> | null = null

const loadJsPdf = async () => {
  if (!jsPdfModulePromise) jsPdfModulePromise = import('jspdf')
  return jsPdfModulePromise
}

const loadDocx = async () => {
  if (!docxModulePromise) docxModulePromise = import('docx')
  return docxModulePromise
}

export default function StudentList({
  data,
  selectedClasses,
  threshold,
  studentSearch,
  kontaktlaererSearch,
  faglaererSearch,
  missingWarningsOnly,
  lowGradeFilter,
  fullRapport,
  fullRapportInclude2,
  noFilter,
}: StudentListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [showPdfMenu, setShowPdfMenu] = useState(false)
  const deferredStudentSearch = useDeferredValue(studentSearch)
  const selectedClassSet = useMemo(() => new Set(selectedClasses), [selectedClasses])
  const classData = useMemo(
    () => data.absences.filter(a => selectedClassSet.has(a.class)),
    [data.absences, selectedClassSet]
  )
  const studentInfoLookup = useMemo(() => createStudentInfoLookup(data.studentInfo), [data.studentInfo])
  const warningLookup = useMemo(() => {
    const warningMap = new Map<string, Array<{ warningType: string; sentDate: string }>>()
    const studentDobMap = new Map<string, string>()
    data.warnings.forEach(warning => {
      const studentNorm = normalizeMatch(warning.navn)
      const key = `${studentNorm}::${normalizeSubjectGroupKey(warning.subjectGroup)}`
      if (!warningMap.has(key)) warningMap.set(key, [])
      warningMap.get(key)!.push({ warningType: warning.warningType, sentDate: warning.sentDate })
      if (warning.dateOfBirth) studentDobMap.set(studentNorm, warning.dateOfBirth)
    })
    return { warningMap, studentDobMap }
  }, [data.warnings])

  const gradeLookup = useMemo(() => {
    const gradeMap = new Map<string, string>()
    const subjectTeacherMap = new Map<string, string>()
    data.grades.forEach(g => {
      const halvar = g.halvår.toString().trim()
      if (halvar === '1' || halvar.toLowerCase().includes('1')) {
        const key = `${normalizeMatch(g.navn)}::${normalizeSubjectGroupKey(g.subjectGroup)}`
        if (!gradeMap.has(key)) gradeMap.set(key, g.grade)
        if (g.subjectTeacher && !subjectTeacherMap.has(key)) subjectTeacherMap.set(key, g.subjectTeacher)
      }
    })
    return { gradeMap, subjectTeacherMap }
  }, [data.grades])

  const ownerForClass = (className: string, mapping: Record<string, string[]>) => {
    const found = Object.entries(mapping).find(([, classes]) => classes.includes(className))
    return found?.[0] ?? 'Ukjent'
  }

  const dateColor = (dateStr: string): string => warningDateColorClass(dateStr)

  const groupWarnings = (warnings: Array<{ warningType: string; sentDate: string }>) => {
    const getLabel = (wt: string) => {
      const l = wt.toLowerCase()
      if (l.includes('frav')) return 'Fravær'
      if (l.includes('vurdering') || l.includes('grunnlag')) return 'Grunnlag'
      return wt
    }
    const labelOrder = (l: string) =>
      l === 'Fravær' ? 0 : l === 'Grunnlag' ? 1 : 2
    const grouped = new Map<string, string[]>()
    warnings.forEach(w => {
      const label = getLabel(w.warningType)
      if (!grouped.has(label)) grouped.set(label, [])
      if (w.sentDate) grouped.get(label)!.push(formatDateDdMmYyyy(w.sentDate))
    })
    grouped.forEach((dates, label) =>
      grouped.set(
        label,
        [...dates].sort((a, b) => compareDateStrings(a, b))
      )
    )
    return Array.from(grouped.entries()).sort(
      ([a], [b]) => labelOrder(a) - labelOrder(b)
    )
  }

  const formatWarningSummary = (warnings: Array<{ warningType: string; sentDate: string }>) => {
    const grouped = groupWarnings(warnings)
    if (grouped.length === 0) return 'Ingen varsler sendt'

    return grouped
      .map(([label, dates]) => {
        const shortLabel = label === 'Fravær' ? 'F' : label === 'Grunnlag' ? 'G' : label
        return `${shortLabel}: ${dates.join(', ')}`
      })
      .join('   |   ')
  }

  const normalizeTeacherSearch = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const matchesTeacherNameSearch = (teacherName: string, query: string): boolean => {
    const normalizedQuery = normalizeTeacherSearch(query)
    if (!normalizedQuery) return true

    const queryTokens = normalizedQuery.split(' ').filter(Boolean)
    if (queryTokens.length === 0) return true

    const candidateTokens = normalizeTeacherSearch(teacherName).split(' ').filter(Boolean)
    return queryTokens.every(token => candidateTokens.some(candidate => candidate.includes(token)))
  }

  const studentSummaries = useMemo(() => {
    const { warningMap, studentDobMap } = warningLookup
    const { gradeMap, subjectTeacherMap } = gradeLookup
    const classDataByStudent = new Map<string, typeof classData>()

    const effectiveLowGrades = fullRapport
      ? (fullRapportInclude2 ? ['IV', '1', '2'] : ['IV', '1'])
      : LOW_GRADES
    const lowGradeSet = new Set(lowGradeFilter)
    const effectiveLowGradeSet = new Set(effectiveLowGrades.map(g => g.toUpperCase()))

    const shouldIncludeSubject = (percentageAbsence: number, grade: string | undefined): boolean => {
      if (noFilter) return true

      const overThreshold = percentageAbsence > threshold
      const matchesSelectedGrade = grade !== undefined && lowGradeSet.has(grade)
      const matchesFullRapportGrade = grade !== undefined && effectiveLowGradeSet.has(grade.toUpperCase())

      if (fullRapport) return overThreshold || matchesFullRapportGrade
      if (lowGradeFilter.length > 0) return overThreshold || matchesSelectedGrade
      return overThreshold
    }

    const ageCache = new Map<string, boolean>()
    const parseDob = (dobStr: string): Date | null => {
      const value = dobStr.trim()
      if (!value) return null

      // dd.mm.yyyy / dd-mm-yyyy / dd/mm/yyyy
      const dmy = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
      if (dmy) {
        const d = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10))
        return isNaN(d.getTime()) ? null : d
      }

      // yyyy-mm-dd / yyyy/mm/dd (optionally with a time part)
      const iso = value.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T].*)?$/)
      if (iso) {
        const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10))
        return isNaN(d.getTime()) ? null : d
      }

      const parsed = new Date(value)
      return isNaN(parsed.getTime()) ? null : parsed
    }

    const isOver18 = (dobStr: string): boolean => {
      if (!dobStr) return false
      const cached = ageCache.get(dobStr)
      if (cached !== undefined) return cached

      const dob = parseDob(dobStr)
      if (!dob) {
        ageCache.set(dobStr, false)
        return false
      }

      const now = new Date()
      const result = now >= new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate())
      ageCache.set(dobStr, result)
      return result
    }

    const summaryMap = new Map<string, StudentAbsenceSummary>()
    const subjectKeysBySummary = new Map<string, Set<string>>()
    const studentInfoCache = new Map<string, ReturnType<typeof findStudentInfoInLookup>>()

    classData.forEach(record => {
      const studentNorm = normalizeMatch(record.navn)
      const subjectGroupKey = normalizeSubjectGroupKey(record.subjectGroup)
      const key = `${record.class}::${record.navn}`
      const warningKey = `${studentNorm}::${subjectGroupKey}`
      const warnings = warningMap.get(warningKey) ?? []
      const hasSubjectWarning = warnings.length > 0
      const grade = gradeMap.get(warningKey)
      const subjectTeacher = subjectTeacherMap.get(warningKey) ?? record.teacher
      const includeSubject = shouldIncludeSubject(record.percentageAbsence, grade)

      const studentInfoKey = `${record.class}::${studentNorm}`
      if (!studentInfoCache.has(studentInfoKey)) {
        studentInfoCache.set(studentInfoKey, findStudentInfoInLookup(studentInfoLookup, record.navn, record.class))
      }
      const matchedStudentInfo = studentInfoCache.get(studentInfoKey)
      const dobStr = matchedStudentInfo?.dateOfBirth ?? studentDobMap.get(studentNorm) ?? ''

      if (!classDataByStudent.has(studentNorm)) classDataByStudent.set(studentNorm, [])
      classDataByStudent.get(studentNorm)!.push(record)

      const subjectDedupKey = `${record.subject}::${record.subjectGroup}`

      if (!summaryMap.has(key)) {
        const subjectKeys = new Set<string>()
        if (includeSubject) subjectKeys.add(subjectDedupKey)
        subjectKeysBySummary.set(key, subjectKeys)

        summaryMap.set(key, {
          navn: record.navn,
          className: record.class,
          maxPercentage: record.percentageAbsence,
          totalHours: record.hoursAbsence,
          subjects: includeSubject
            ? [{ subject: record.subject, subjectGroup: record.subjectGroup, teacher: subjectTeacher, percentageAbsence: record.percentageAbsence, warnings, grade }]
            : [],
          avbrudd: record.avbrudd,
          hasWarnings: includeSubject ? hasSubjectWarning : false,
          isAdult: isOver18(dobStr),
          programArea: matchedStudentInfo?.programArea,
          sidemalExemption: matchedStudentInfo?.sidemalExemption ?? false,
          intakePoints: matchedStudentInfo?.intakePoints ?? null,
          hasTalentProgram: hasTalentProgramTag(record.class, matchedStudentInfo?.programArea),
        })
      } else {
        const summary = summaryMap.get(key)!
        const subjectKeys = subjectKeysBySummary.get(key)
        summary.maxPercentage = Math.max(summary.maxPercentage, record.percentageAbsence)
        summary.totalHours += record.hoursAbsence

        if (includeSubject) {
          if (!subjectKeys?.has(subjectDedupKey)) {
            summary.subjects.push({ subject: record.subject, subjectGroup: record.subjectGroup, teacher: subjectTeacher, percentageAbsence: record.percentageAbsence, warnings, grade })
            subjectKeys?.add(subjectDedupKey)
          }
          if (hasSubjectWarning) summary.hasWarnings = true
        }

        summary.avbrudd = summary.avbrudd || record.avbrudd
        if (!summary.isAdult && dobStr) summary.isAdult = isOver18(dobStr)
        if (!summary.programArea && matchedStudentInfo?.programArea) {
          summary.programArea = matchedStudentInfo.programArea
          summary.sidemalExemption = matchedStudentInfo.sidemalExemption
          summary.intakePoints = matchedStudentInfo.intakePoints
          summary.hasTalentProgram = hasTalentProgramTag(record.class, matchedStudentInfo.programArea)
        }
      }
    })

    // Add Norwegian grade-only subjects from vurderinger even when fravær rows do not exist.
    const norskSupplements: Record<string, string> = {
      NOR1268: 'Norsk sidemål',
      NOR1269: 'Norsk muntlig',
    }

    summaryMap.forEach(summary => {
      const studentNorm = normalizeMatch(summary.navn)
      const studentRecords = classDataByStudent.get(studentNorm) ?? []
      const requiredCodes = Object.keys(norskSupplements)

      // Look up NOR1267 directly from raw absence data regardless of threshold filtering
      const nor1267RawRecord =
        studentRecords.find(r =>
          normalizeSubjectGroupKey(r.subjectGroup) === normalizeSubjectGroupKey('NOR1267')
        ) ??
        studentRecords.find(r =>
          normalizeMatch(r.subject).includes('norsk') &&
          normalizeMatch(r.subject).includes('hoved')
        )

      const norskHovedmalSource =
        summary.subjects.find(s => {
          const n = normalizeMatch(s.subject)
          return n.includes('norsk') && n.includes('hoved')
        }) ??
        summary.subjects.find(s => isNorskSubject(s.subject))

      const sourceAbsencePercentage = nor1267RawRecord?.percentageAbsence ?? norskHovedmalSource?.percentageAbsence ?? 0
      const sourceSubjectName = nor1267RawRecord?.subject ?? norskHovedmalSource?.subject

      const sourceFravaerWarnings = (norskHovedmalSource?.warnings ?? []).filter(w =>
        w.warningType.toLowerCase().includes('frav')
      )

      requiredCodes.forEach(code => {
        const codeKey = normalizeSubjectGroupKey(code)
        const gradeKey = `${studentNorm}::${codeKey}`
        const grade = gradeMap.get(gradeKey)
        if (!grade) return

        const matchesSelectedGrade = lowGradeSet.has(grade)
        const matchesFullRapportGrade = effectiveLowGradeSet.has(grade.toUpperCase())

        let includeSubject = noFilter
        if (!noFilter && fullRapport) includeSubject = matchesFullRapportGrade
        else if (!noFilter && lowGradeFilter.length > 0) includeSubject = matchesSelectedGrade
        if (!includeSubject) return

        const alreadyExists = summary.subjects.some(
          s => normalizeSubjectGroupKey(s.subjectGroup) === codeKey
        )
        if (alreadyExists) return

        const warningKey = `${studentNorm}::${codeKey}`
        const warnings = warningMap.get(warningKey) ?? []
        const teacher = subjectTeacherMap.get(gradeKey) ?? ''

        summary.subjects.push({
          subject: norskSupplements[code],
          subjectGroup: code,
          teacher,
          percentageAbsence: sourceAbsencePercentage,
          warnings: sourceFravaerWarnings.length > 0 ? sourceFravaerWarnings : warnings,
          grade,
          inheritsFromSubject: sourceSubjectName,
        })

        if ((sourceFravaerWarnings.length > 0 ? sourceFravaerWarnings : warnings).length > 0) summary.hasWarnings = true
      })
    })

    return Array.from(summaryMap.values())
  }, [classData, warningLookup, gradeLookup, threshold, lowGradeFilter, fullRapport, fullRapportInclude2, noFilter, studentInfoLookup])

  const kontaktlaererByStudentKey = useMemo(() => {
    const explicitMap = new Map<string, string>()
    const teacherCountsByStudent = new Map<string, Map<string, number>>()

    classData.forEach(record => {
      const studentKey = `${record.class}::${normalizeMatch(record.navn)}`

      // Prefer explicit kontaktlærer field from absence file
      const kl = record.kontaktlaerer?.trim()
      if (kl && !explicitMap.has(studentKey)) {
        explicitMap.set(studentKey, kl)
      }

      // Build frequency map as fallback
      const teacher = record.teacher?.trim()
      if (!teacher) return
      if (!teacherCountsByStudent.has(studentKey)) {
        teacherCountsByStudent.set(studentKey, new Map<string, number>())
      }
      const counts = teacherCountsByStudent.get(studentKey)!
      counts.set(teacher, (counts.get(teacher) ?? 0) + 1)
    })

    const kontaktlaererMap = new Map<string, string>()
    teacherCountsByStudent.forEach((counts, studentKey) => {
      const kontaktlaerer = explicitMap.get(studentKey) ??
        Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Ukjent'
      kontaktlaererMap.set(studentKey, kontaktlaerer)
    })
    explicitMap.forEach((kl, studentKey) => {
      if (!kontaktlaererMap.has(studentKey)) kontaktlaererMap.set(studentKey, kl)
    })

    return kontaktlaererMap
  }, [classData])

  const atRiskStudents = useMemo(() => {
    const searchNorm = deferredStudentSearch.toLowerCase().trim()
    const searchWords = searchNorm ? searchNorm.split(/\s+/) : []
    const isMissingOverride = missingWarningsOnly
    const filtered: StudentAbsenceSummary[] = []

    studentSummaries.forEach(student => {
      if (student.subjects.length === 0) return

      if (!isMissingOverride && searchWords.length > 0 && !searchWords.every(w => student.navn.toLowerCase().includes(w))) {
        return
      }

      const studentKey = `${student.className}::${normalizeMatch(student.navn)}`
      const studentKontaktlaerer = kontaktlaererByStudentKey.get(studentKey) ?? ''
      if (!matchesTeacherNameSearch(studentKontaktlaerer, kontaktlaererSearch)) return

      const teacherFilteredSubjects = student.subjects.filter(subject =>
        matchesTeacherNameSearch(subject.teacher ?? '', faglaererSearch)
      )
      if (teacherFilteredSubjects.length === 0) return

      const studentWithTeacherFilteredSubjects =
        teacherFilteredSubjects.length === student.subjects.length
          ? student
          : { ...student, subjects: teacherFilteredSubjects }

      if (!isMissingOverride) {
        filtered.push(studentWithTeacherFilteredSubjects)
        return
      }

      const subjects = teacherFilteredSubjects.filter(
        sub => sub.warnings.length === 0 && sub.percentageAbsence > threshold
      )
      if (subjects.length === 0) return
      filtered.push({ ...studentWithTeacherFilteredSubjects, subjects })
    })

    return filtered.sort((a, b) => {
      const classCompare = a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
      if (classCompare !== 0) return classCompare
      return a.navn.localeCompare(b.navn, 'nb-NO')
    })
  }, [
    studentSummaries,
    deferredStudentSearch,
    missingWarningsOnly,
    threshold,
    kontaktlaererByStudentKey,
    kontaktlaererSearch,
    faglaererSearch,
  ])

  const getKontaktlaererForStudent = (student: StudentAbsenceSummary) => {
    const key = `${student.className}::${normalizeMatch(student.navn)}`
    return kontaktlaererByStudentKey.get(key) ?? 'Ukjent'
  }

  if (atRiskStudents.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
            <span className="text-2xl">✓</span>
          </div>
        </div>
        <p className="text-slate-600 text-lg font-medium">Gode nyheter!</p>
        <p className="text-slate-500">
          Ingen elever overstiger fraværsgrensen på {threshold.toFixed(1)}%
        </p>
      </div>
    )
  }

  const generatePDF = async (layout: 'combined' | 'per-student' = 'combined') => {
    const { jsPDF } = await loadJsPdf()
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const pageH = 297
    const marginX = 14
    const usableW = pageW - marginX * 2
    let y = 14

    // helpers
    const chip = (
      text: string,
      x: number,
      baseY: number,
      bg: [number, number, number],
      fg: [number, number, number],
      bold = false,
      fs = 7.5
    ): number => {
      doc.setFontSize(fs)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      const tw = doc.getTextWidth(text)
      const w = tw + 4
      const h = 4.5
      doc.setFillColor(...bg)
      doc.roundedRect(x, baseY - 3.2, w, h, 0.8, 0.8, 'F')
      doc.setTextColor(...fg)
      doc.text(text, x + 2, baseY)
      return w + 2 // step
    }

    const checkPageBreak = (needed: number) => {
      if (y + needed > pageH - 14) { doc.addPage(); y = 14 }
    }

    // Page header
    doc.setFillColor(2, 132, 199)
    doc.rect(0, 0, pageW, 18, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(255, 255, 255)
    doc.text('Oppfølging - Elever', marginX, 11)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(
      `Klasser: ${selectedClasses.join(', ')}   |   Grense: ${threshold.toFixed(1)}%   |   ${atRiskStudents.length} elever   |   ${new Date().toLocaleDateString('nb-NO')}`,
      marginX, 16
    )
    y = 24
    doc.setTextColor(0, 0, 0)

    atRiskStudents.forEach((student, index) => {
      if (layout === 'per-student' && index > 0) {
        doc.addPage()
        y = 24
      }

      const kontaktlaerer = getKontaktlaererForStudent(student)
      // Calculate card height: name row + per-subject rows
      const rowsPerSubject = student.subjects.map(s => {
        const teacher = resolveTeacher(s.subject, s.teacher ?? '').trim()
        const warningRows = groupWarnings(s.warnings).length
        const noWarningRow = s.warnings.length === 0 && s.percentageAbsence >= 5 ? 1 : 0
        return 1 + (teacher ? 1 : 0) + warningRows + noWarningRow
      })
      const totalSubjectRows = rowsPerSubject.reduce((a, b) => a + b, 0)
      const cardHeight = 15 + totalSubjectRows * 5 + 2

      checkPageBreak(cardHeight + 3)

      const cardY = y
      const isAvbrudd = student.avbrudd

      // Card background + left stripe
      if (isAvbrudd) {
        doc.setFillColor(255, 251, 235)
      } else {
        doc.setFillColor(255, 255, 255)
      }
      doc.rect(marginX, cardY, usableW, cardHeight, 'F')
      if (isAvbrudd) {
        doc.setFillColor(245, 158, 11)
      } else {
        doc.setFillColor(239, 68, 68)
      }
      doc.rect(marginX, cardY, 2.5, cardHeight, 'F')
      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.2)
      doc.rect(marginX, cardY, usableW, cardHeight)

      // --- Name row ---
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(isAvbrudd ? 71 : 15, isAvbrudd ? 85 : 23, isAvbrudd ? 105 : 42)
      doc.text(student.navn, marginX + 5, cardY + 6.5)

      // Measure with the same font settings used for the rendered name
      let bx = marginX + 5 + doc.getTextWidth(student.navn) + 3
      const bY = cardY + 6.5

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text(`Kontaktlærer: ${kontaktlaerer}`, marginX + 5, cardY + 10.5)

      // Class chip (slate)
      bx += chip(student.className, bx, bY, [241, 245, 249], [71, 85, 105])

      // T talent program chip
      if (student.hasTalentProgram) {
        bx += chip('T', bx, bY, [224, 242, 254], [3, 105, 161], true)
      }

      // Warnings chip
      const warningBreakdown = student.subjects.reduce(
        (acc, s) => {
          s.warnings.forEach(w => {
            const t = w.warningType.toLowerCase()
            if (t.includes('frav')) acc.f++
            else if (t.includes('vurdering') || t.includes('grunnlag')) acc.g++
            else acc.o++
          })
          return acc
        },
        { f: 0, g: 0, o: 0 }
      )
      const wTotal = warningBreakdown.f + warningBreakdown.g + warningBreakdown.o
      const wLabel = wTotal > 0
        ? `Varsler: ${wTotal} (${warningBreakdown.f}+${warningBreakdown.g}${warningBreakdown.o > 0 ? '+' + warningBreakdown.o : ''})`
        : 'Varsler funnet: 0'
      bx += chip(wLabel, bx, bY,
        wTotal > 0 ? [254, 226, 226] : [241, 245, 249],
        wTotal > 0 ? [185, 28, 28] : [100, 116, 139]
      )

      // 18+ chip
      if (student.isAdult) {
        bx += chip('18+', bx, bY, [237, 233, 254], [109, 40, 217], true)
      }

      // Avbrudd chip
      if (isAvbrudd) {
        bx += chip('Avbrudd', bx, bY, [254, 215, 170], [120, 53, 15])
      }

      // Fritak sidemål chip
      if (student.sidemalExemption) {
        bx += chip('Fritak sidemål', bx, bY, [209, 250, 229], [6, 95, 70], true)
      }

      // Intake points chip
      {
        const intake = formatIntakePoints(student.intakePoints)
        if (intake.empty) {
          chip('•', bx, bY, [22, 163, 74], [255, 255, 255], true)
        } else {
          const intakeBg: [number, number, number] = intake.tone === 'green' ? [220, 252, 231] : [241, 245, 249]
          const intakeFg: [number, number, number] = intake.tone === 'green' ? [22, 101, 52] : [71, 85, 105]
          chip(intake.label, bx, bY, intakeBg, intakeFg, true)
        }
      }

      // --- Subject rows ---
      let subY = cardY + 16
      student.subjects.forEach(subjectEntry => {
        const pct = subjectEntry.percentageAbsence
        const isHighRisk = pct > 10
        const isMedRisk = pct >= 5

        // Subject name — grey chip (matches app)
        doc.setFontSize(8.5)
        doc.setFont('helvetica', 'normal')
        const subjectTw = doc.getTextWidth(subjectEntry.subject)
        const subjectChipW = subjectTw + 4
        doc.setFillColor(241, 245, 249)   // slate-100
        doc.roundedRect(marginX + 5, subY - 3.5, subjectChipW, 5, 0.8, 0.8, 'F')
        doc.setTextColor(55, 65, 81)       // slate-700
        doc.text(subjectEntry.subject, marginX + 7, subY)

        // Percentage chip — red >10%, amber ≥5%, slate otherwise
        const pctLabel = `${pct.toFixed(1)}%`
        doc.setFontSize(7.5)
        const pctX = marginX + 5 + subjectChipW + 2
        let subjectRowX = pctX
        if (isHighRisk) {
          subjectRowX += chip(pctLabel, pctX, subY, [254, 226, 226], [185, 28, 28])
        } else if (isMedRisk) {
          subjectRowX += chip(pctLabel, pctX, subY, [254, 243, 199], [180, 83, 9])
        } else {
          subjectRowX += chip(pctLabel, pctX, subY, [241, 245, 249], [100, 116, 139])
        }

        // Grade chip — orange, only for IV/1/2
        if (subjectEntry.grade && ['iv', '1', '2'].includes(subjectEntry.grade.toLowerCase())) {
          const gradeLabel = `Karakter T1: ${subjectEntry.grade}`
          subjectRowX += chip(gradeLabel, subjectRowX, subY, [253, 186, 116], [154, 52, 18], true, 7.5)
        }

        // Fritak sidemål chip per subject
        if (student.sidemalExemption && isNorskSubject(subjectEntry.subject)) {
          chip('Fritak sidemål', subjectRowX, subY, [209, 250, 229], [6, 95, 70], true, 7.5)
        }

        subY += 5

        // Teacher line
        const resolvedTeacher = resolveTeacher(subjectEntry.subject, subjectEntry.teacher ?? '').trim()
        if (resolvedTeacher) {
          doc.setFontSize(7)
          doc.setFont('helvetica', 'italic')
          doc.setTextColor(148, 163, 184)  // slate-400
          doc.text(`Lærer: ${resolvedTeacher}`, marginX + 10, subY)
          subY += 4.5
        }

        // Warning lines
        const grouped = groupWarnings(subjectEntry.warnings)
        grouped.forEach(([label, dates]) => {
          doc.setFontSize(7.5)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(71, 85, 105)
          doc.text(`${label}:`, marginX + 10, subY)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(100, 116, 139)
          doc.text(` ${dates.join(', ')}`, marginX + 10 + doc.getTextWidth(`${label}:`), subY)
          subY += 4.5
        })

        // "No warning" line
        if (subjectEntry.warnings.length === 0 && pct >= 5) {
          doc.setFontSize(7)
          doc.setFont('helvetica', 'italic')
          doc.setTextColor(148, 163, 184)
          doc.text('Ingen varsel funnet for dette faget', marginX + 10, subY)
          subY += 4.5
        }
      })

      y = cardY + cardHeight + 3
    })

    doc.save(`oppfolging_${selectedClasses.join('-')}_${todayDdMmYyyy()}.pdf`)
  }

  const generateOppfolgingsarkForUtvalg = async () => {
    if (atRiskStudents.length === 0) return

    const {
      BorderStyle,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    } = await loadDocx()

    const children: Array<any> = []

    atRiskStudents.forEach((student, index) => {
      const { allSubjectEntries, kontaktlaerer, studentInfo } = getAllSubjectEntries(student)
      const radgiver = ownerForClass(student.className, RADGIVER)
      const displayClassName = getDisplayClassName(student.className, studentInfo?.programArea)

      children.push(
        new Paragraph({
          text: 'Oppfølgingsark',
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: index > 0,
        }),
        new Paragraph({ children: [new TextRun({ text: `Elev: ${student.navn}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Klasse: ${displayClassName}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Kontaktlærer: ${kontaktlaerer}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Rådgiver: ${radgiver}` })] }),
        new Paragraph({ text: '' }),
      )

      allSubjectEntries.forEach(subjectEntry => {
        const resolvedTeacher = resolveTeacher(subjectEntry.subject, subjectEntry.teacher)
        const teacherText = resolvedTeacher ? ` (Lærer: ${resolvedTeacher})` : ''
        const sidemalText = subjectEntry.showSidemalExemption && isNorskSubject(subjectEntry.subject)
          ? '   |   Fritak sidemål'
          : ''
        const infoText = `Fravær: ${subjectEntry.percentageAbsence.toFixed(1)}%   |   Karakter: ${subjectEntry.grade ?? '-'}   |   Varsler: ${subjectEntry.warningCount}${sidemalText}`
        const warningText = `Varselbrev sendt: ${formatWarningSummary(subjectEntry.warnings)}`

        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                      left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                      right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                    },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: `${subjectEntry.subject}${teacherText}`, bold: true })] }),
                      new Paragraph({ text: infoText }),
                      new Paragraph({ text: warningText }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        )
      })

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                    left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                    right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  },
                  children: [
                    new Paragraph({ children: [new TextRun({ text: 'Andre notater', bold: true })] }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                  ],
                }),
              ],
            }),
          ],
        }),
      )
    })

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Calibri' },
          },
        },
      },
      sections: [{ children }],
    })

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `oppfolgingsark_utvalg_${todayDdMmYyyy()}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const generateMissingWarningsDocx = async () => {
    if (!missingWarningsOnly) return

    const {
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      TextRun,
    } = await loadDocx()

    type MissingWarningEntry = {
      teacher: string
      subject: string
      subjectGroup: string
      studentName: string
      percentageAbsence: number
      grunnlagWarningDate: string | null
    }

    const selectedClassSet = new Set(selectedClasses)
    const warningMap = new Map<string, Array<{ warningType: string; sentDate: string }>>()

    data.warnings.forEach(w => {
      const key = `${normalizeMatch(w.navn)}::${normalizeSubjectGroupKey(w.subjectGroup)}`
      if (!warningMap.has(key)) warningMap.set(key, [])
      warningMap.get(key)!.push({ warningType: w.warningType, sentDate: w.sentDate })
    })

    // Build subject teacher lookup from grades/vurderinger file (student+subjectGroup -> faglærer)
    const gradeTeacherMap = new Map<string, string>()
    data.grades.forEach(g => {
      if (!g.subjectTeacher) return
      const key = `${normalizeMatch(g.navn)}::${normalizeSubjectGroupKey(g.subjectGroup)}`
      if (!gradeTeacherMap.has(key)) gradeTeacherMap.set(key, g.subjectTeacher)
    })

    const dedupedEntries = new Map<string, MissingWarningEntry>()

    data.absences
      .filter(record => selectedClassSet.has(record.class) && record.percentageAbsence > threshold)
      .forEach(record => {
        const studentNorm = normalizeMatch(record.navn)
        const subjectGroupNorm = normalizeSubjectGroupKey(record.subjectGroup)
        const warningKey = `${studentNorm}::${subjectGroupNorm}`
        const warnings = warningMap.get(warningKey) ?? []

        const hasFravaerWarning = warnings.some(w => w.warningType.toLowerCase().includes('frav'))
        if (hasFravaerWarning) return

        const grunnlagWarningDates = warnings
          .filter(w => {
            const type = w.warningType.toLowerCase()
            return type.includes('vurdering') || type.includes('grunnlag')
          })
          .map(w => formatDateDdMmYyyy(w.sentDate))

        const latestGrunnlagWarningDate = grunnlagWarningDates.length > 0
          ? [...grunnlagWarningDates].sort((a, b) => compareDateStrings(b, a))[0]
          : null

        // Prefer faglærer from vurderinger file; fall back to absence file teacher
        const gradeTeacher = gradeTeacherMap.get(`${studentNorm}::${subjectGroupNorm}`)
        const resolvedTeacher = resolveTeacher(record.subject, gradeTeacher ?? record.teacher ?? '').trim() || 'Ukjent'

        const dedupKey = `${studentNorm}::${subjectGroupNorm}::${normalizeMatch(resolvedTeacher)}`

        const nextEntry: MissingWarningEntry = {
          teacher: resolvedTeacher,
          subject: record.subject,
          subjectGroup: record.subjectGroup,
          studentName: record.navn,
          percentageAbsence: record.percentageAbsence,
          grunnlagWarningDate: latestGrunnlagWarningDate,
        }

        const existing = dedupedEntries.get(dedupKey)
        if (!existing || nextEntry.percentageAbsence > existing.percentageAbsence) {
          dedupedEntries.set(dedupKey, nextEntry)
        }
      })

    const entries = Array.from(dedupedEntries.values())
    if (entries.length === 0) return

    const entriesByTeacher = new Map<string, MissingWarningEntry[]>()
    entries.forEach(entry => {
      if (!entriesByTeacher.has(entry.teacher)) entriesByTeacher.set(entry.teacher, [])
      entriesByTeacher.get(entry.teacher)!.push(entry)
    })

    const thresholdText = `${threshold.toFixed(1).replace('.', ',')}%`
    const reportPerDate = (() => {
      const raw = (data.warningFileCreatedDate ?? '').trim()
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!m) return null
      const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
      if (isNaN(d.getTime())) return null
      d.setDate(d.getDate() - 1)
      const day = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const year = d.getFullYear()
      return `${day}.${month}.${year}`
    })()
    const perDateText = reportPerDate ? ` per ${reportPerDate}` : ''
    const teacherNames = Array.from(entriesByTeacher.keys()).sort((a, b) => a.localeCompare(b, 'nb-NO'))
    const children: Array<any> = []

    teacherNames.forEach((teacher, index) => {
      const teacherFirstName = teacher.trim().split(/\s+/)[0] || teacher
      const teacherEntries = entriesByTeacher.get(teacher) ?? []
      const subjectsMap = new Map<string, MissingWarningEntry[]>()

      teacherEntries.forEach(entry => {
        const subjectKey = `${entry.subject}::${entry.subjectGroup}`
        if (!subjectsMap.has(subjectKey)) subjectsMap.set(subjectKey, [])
        subjectsMap.get(subjectKey)!.push(entry)
      })

      const sortedSubjects = Array.from(subjectsMap.entries()).sort(([a], [b]) => {
        const [subjectA, groupA] = a.split('::')
        const [subjectB, groupB] = b.split('::')
        const subjectCompare = subjectA.localeCompare(subjectB, 'nb-NO')
        if (subjectCompare !== 0) return subjectCompare
        return groupA.localeCompare(groupB, 'nb-NO')
      })

      children.push(
        new Paragraph({
          text: 'Melding om manglende varselbrev',
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: index > 0,
        }),
        new Paragraph({ children: [new TextRun({ text: `Fraværsgrense: ${thresholdText}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Lærer: ${teacher}` })] }),
        new Paragraph({ text: '' }),
        new Paragraph({
          children: [
            new TextRun({ text: `Hei ${teacherFirstName},` }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Det er tatt ut rapport på manglende varselbrev${perDateText}. Følgende elever har fravær over ${thresholdText} men har ikke fått varsel på fravær i faget. Ber om at varsler sendes ut snarest.`,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'I noen tilfeller kan det være etter avtale at dette ikke er gjort, sjekk med trinnleder hva som bør gjøres.',
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'Vi informerer også her om det er sendt noe på manglende vurderingsgrunnlag, dette er bare informasjon, du som faglærer vurderer om det trengs varsel på vurderingsgrunnlag.',
            }),
          ],
        }),
        new Paragraph({ text: '' }),
      )

      sortedSubjects.forEach(([subjectKey, subjectEntries]) => {
        const [subjectName, subjectGroup] = subjectKey.split('::')
        const sortedEntries = [...subjectEntries].sort((a, b) => a.studentName.localeCompare(b.studentName, 'nb-NO'))

        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${subjectName} (${subjectGroup})`, bold: true })],
          }),
        )

        sortedEntries.forEach(entry => {
          const pctText = `${entry.percentageAbsence.toFixed(1).replace('.', ',')}%`
          const grunnlagText = entry.grunnlagWarningDate
            ? `Det har blitt sendt varsel på manglende grunnlag ${entry.grunnlagWarningDate}.`
            : 'Det er heller ikke sendt varsel på manglende vurderingsgrunnlag.'

          children.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: `${entry.studentName} - ${pctText}` })],
            }),
            new Paragraph({
              indent: { left: 720 },
              children: [new TextRun({ text: grunnlagText })],
            }),
          )
        })

        children.push(new Paragraph({ text: '' }))
      })
    })

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Calibri' },
          },
        },
      },
      sections: [{ children }],
    })

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `manglende_varsler_${todayDdMmYyyy()}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const generateOppfolgingsark = async (student: StudentAbsenceSummary) => {
    const { jsPDF } = await loadJsPdf()
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const pageH = 297
    const marginX = 14
    const usableW = pageW - marginX * 2
    let y = 16

    const { allSubjectEntries, kontaktlaerer, studentInfo } = getAllSubjectEntries(student)
    const radgiver = ownerForClass(student.className, RADGIVER)
    const displayClassName = getDisplayClassName(student.className, studentInfo?.programArea)
    const acroSupported =
      typeof (jsPDF as unknown as { AcroFormTextField?: unknown }).AcroFormTextField === 'function' &&
      typeof (doc as unknown as { addField?: unknown }).addField === 'function'

    const addMultilineField = (fieldName: string, x: number, yPos: number, w: number, h: number) => {
      if (!acroSupported) return
      const JsPDFAny = jsPDF as unknown as {
        AcroFormTextField: new () => {
          fieldName: string
          Rect: number[]
          multiline: boolean
          doNotScroll?: boolean
          value: string
          borderWidth: number
          fontSize: number
        }
      }
      const field = new JsPDFAny.AcroFormTextField()
      field.fieldName = fieldName
      field.Rect = [x, yPos, w, h]
      field.multiline = true
      field.doNotScroll = false
      field.value = ''
      field.borderWidth = 0
      field.fontSize = 10
      ;(doc as unknown as { addField: (f: unknown) => void }).addField(field)
    }

    const ensureSpace = (needed: number) => {
      if (y + needed > pageH - 14) {
        doc.addPage()
        y = 16
      }
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('Oppfølgingsark', marginX, y)
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Elev: ${student.navn}`, marginX, y)
    y += 6
    doc.text(`Klasse: ${displayClassName}`, marginX, y)
    y += 6
    doc.text(`Kontaktlærer: ${kontaktlaerer}`, marginX, y)
    y += 6
    doc.text(`Rådgiver: ${radgiver}`, marginX, y)
    y += 8

    if (acroSupported) {
      doc.setFontSize(8)
      doc.setTextColor(100, 116, 139)
      doc.text('Felt under hvert fag er utfyllbare. Skriv over flere linjer ved behov.', marginX, y)
      y += 6
      doc.setTextColor(0, 0, 0)
    }

    allSubjectEntries.forEach(subjectEntry => {
      const resolvedTeacherPdf = resolveTeacher(subjectEntry.subject, subjectEntry.teacher)
      const teacherText = resolvedTeacherPdf ? ` (Lærer: ${resolvedTeacherPdf})` : ''
      const headerLines = doc.splitTextToSize(`${subjectEntry.subject}${teacherText}`, usableW - 6)
      const headerLineCount = Array.isArray(headerLines) ? headerLines.length : 1
      const sidemalText = subjectEntry.showSidemalExemption && isNorskSubject(subjectEntry.subject)
        ? '   |   Fritak sidemål'
        : ''
      const infoText = `Fravær: ${subjectEntry.percentageAbsence.toFixed(1)}%   |   Karakter: ${subjectEntry.grade ?? '-'}   |   Varsler: ${subjectEntry.warningCount}${sidemalText}`
      const warningLines = doc.splitTextToSize(
        `Varselbrev sendt: ${formatWarningSummary(subjectEntry.warnings)}`,
        usableW - 6
      )
      const warningLineCount = Array.isArray(warningLines) ? warningLines.length : 1
      const sectionHeight = Math.max(36, 6 + headerLineCount * 4 + 5 + warningLineCount * 4 + 3 + 18 + 3)

      ensureSpace(sectionHeight + 6)

      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.2)
      doc.rect(marginX, y, usableW, sectionHeight)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(headerLines, marginX + 3, y + 6)

      const infoY = y + 6 + headerLineCount * 4

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(infoText, marginX + 3, infoY)

      const warningY = infoY + 5
      doc.setFontSize(8.5)
      doc.text(warningLines, marginX + 3, warningY)

      // Stor skriveboks under hvert fag.
      const boxY = warningY + warningLineCount * 4 + 2
      const boxH = y + sectionHeight - boxY - 3
      doc.rect(marginX + 3, boxY, usableW - 6, boxH)
      addMultilineField(
        `oppfolging_${student.className}_${student.navn.replace(/\s+/g, '_')}_${normalizeMatch(subjectEntry.subjectGroup)}`,
        marginX + 3,
        boxY,
        usableW - 6,
        boxH
      )

      y += sectionHeight + 6
    })

    ensureSpace(54)
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.2)
    doc.rect(marginX, y, usableW, 48)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Andre notater', marginX + 3, y + 6)
    const notesBoxY = y + 9
    const notesBoxH = 48 - 12
    doc.rect(marginX + 3, notesBoxY, usableW - 6, notesBoxH)
    addMultilineField(
      `oppfolging_${student.className}_${student.navn.replace(/\s+/g, '_')}_andre_notater`,
      marginX + 3,
      notesBoxY,
      usableW - 6,
      notesBoxH
    )

    doc.save(`oppfolgingsark_${student.className}_${student.navn.replace(/\s+/g, '_')}_${todayDdMmYyyy()}.pdf`)
  }

  const getAllSubjectEntries = (student: StudentAbsenceSummary) => {
    const studentRecords = data.absences.filter(
      r => r.class === student.className && normalizeMatch(r.navn) === normalizeMatch(student.navn)
    )
    const matchedStudentInfo = findStudentInfoInLookup(studentInfoLookup, student.navn, student.className)

    const teacherCountsForStudent = new Map<string, number>()
    studentRecords.forEach(r => {
      const teacher = r.teacher?.trim()
      if (!teacher) return
      teacherCountsForStudent.set(teacher, (teacherCountsForStudent.get(teacher) ?? 0) + 1)
    })
    const kontaktlaerer =
      Array.from(teacherCountsForStudent.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Ukjent'

    const subjectTeacherMap = new Map<string, string>()
    data.grades
      .filter(g => normalizeMatch(g.navn) === normalizeMatch(student.navn))
      .forEach(g => {
        const key = normalizeSubjectGroupKey(g.subjectGroup)
        if (g.subjectTeacher && key && !subjectTeacherMap.has(key)) {
          subjectTeacherMap.set(key, g.subjectTeacher)
        }
      })

    const studentWarningMap = new Map<string, Array<{ warningType: string; sentDate: string }>>()
    data.warnings
      .filter(w => normalizeMatch(w.navn) === normalizeMatch(student.navn))
      .forEach(w => {
        const key = normalizeSubjectGroupKey(w.subjectGroup)
        if (!studentWarningMap.has(key)) studentWarningMap.set(key, [])
        studentWarningMap.get(key)!.push({ warningType: w.warningType, sentDate: w.sentDate })
      })

    const studentGradeMap = new Map<string, string>()
    data.grades
      .filter(g => normalizeMatch(g.navn) === normalizeMatch(student.navn))
      .forEach(g => {
        const halvar = g.halvår.toString().trim().toLowerCase()
        if (halvar === '1' || halvar.includes('1')) {
          const key = normalizeSubjectGroupKey(g.subjectGroup)
          if (!studentGradeMap.has(key)) studentGradeMap.set(key, g.grade)
        }
      })

    const allSubjectsMap = new Map<string, {
      subject: string
      subjectGroup: string
      teacher: string
      percentageAbsence: number
      grade?: string
      warningCount: number
      warnings: Array<{ warningType: string; sentDate: string }>
      showSidemalExemption: boolean
    }>()
    studentRecords.forEach(r => {
      const key = `${normalizeMatch(r.subject)}::${normalizeMatch(r.subjectGroup)}`
      const existing = allSubjectsMap.get(key)
      const warnings = studentWarningMap.get(normalizeSubjectGroupKey(r.subjectGroup)) ?? []
      const warningCount = warnings.length
      const grade = studentGradeMap.get(normalizeSubjectGroupKey(r.subjectGroup))

      const sgKey = normalizeSubjectGroupKey(r.subjectGroup)
      const subjectTeacher = subjectTeacherMap.get(sgKey) ?? r.teacher

      if (!existing || r.percentageAbsence > existing.percentageAbsence) {
        allSubjectsMap.set(key, {
          subject: r.subject,
          subjectGroup: r.subjectGroup,
          teacher: subjectTeacher,
          percentageAbsence: r.percentageAbsence,
          grade,
          warningCount,
          warnings,
          showSidemalExemption: matchedStudentInfo?.sidemalExemption ?? false,
        })
      }
    })

    return {
      kontaktlaerer,
      studentInfo: matchedStudentInfo,
      allSubjectEntries: Array.from(allSubjectsMap.values()).sort((a, b) =>
        a.subject.localeCompare(b.subject, 'nb-NO')
      ),
    }
  }

  const generateOppfolgingsarkDocx = async (student: StudentAbsenceSummary) => {
    const {
      BorderStyle,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    } = await loadDocx()

    const { allSubjectEntries, kontaktlaerer, studentInfo } = getAllSubjectEntries(student)
    const radgiver = ownerForClass(student.className, RADGIVER)
    const displayClassName = getDisplayClassName(student.className, studentInfo?.programArea)

    const sections: Array<any> = [
      new Paragraph({ text: 'Oppfølgingsark', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: `Elev: ${student.navn}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Klasse: ${displayClassName}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Kontaktlærer: ${kontaktlaerer}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Rådgiver: ${radgiver}` })] }),
      new Paragraph({ text: '' }),
    ]

    allSubjectEntries.forEach(subjectEntry => {
      const resolvedTeacherDocx = resolveTeacher(subjectEntry.subject, subjectEntry.teacher)
      const teacherText = resolvedTeacherDocx ? ` (Lærer: ${resolvedTeacherDocx})` : ''
      const sidemalText = subjectEntry.showSidemalExemption && isNorskSubject(subjectEntry.subject)
        ? '   |   Fritak sidemål'
        : ''
      const infoText = `Fravær: ${subjectEntry.percentageAbsence.toFixed(1)}%   |   Karakter: ${subjectEntry.grade ?? '-'}   |   Varsler: ${subjectEntry.warningCount}${sidemalText}`
      const warningText = `Varselbrev sendt: ${formatWarningSummary(subjectEntry.warnings)}`

      sections.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                    left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                    right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  },
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: `${subjectEntry.subject}${teacherText}`, bold: true })],
                    }),
                    new Paragraph({ text: infoText }),
                    new Paragraph({ text: warningText }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                  ],
                }),
              ],
            }),
          ],
        })
      )
    })

    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: 'Andre notater', bold: true })],
                  }),
                  new Paragraph({ text: '' }),
                  new Paragraph({ text: '' }),
                  new Paragraph({ text: '' }),
                  new Paragraph({ text: '' }),
                  new Paragraph({ text: '' }),
                  new Paragraph({ text: '' }),
                ],
              }),
            ],
          }),
        ],
      })
    )

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: 'Calibri',
            },
          },
        },
      },
      sections: [{ children: sections }],
    })

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `oppfolgingsark_${student.className}_${student.navn.replace(/\s+/g, '_')}_${todayDdMmYyyy()}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Print header — only visible when printing */}
      <div className="print-header hidden">
        <h1 className="text-lg font-bold text-slate-900">Oppfølging - Elever</h1>
        <p className="text-xs text-slate-600">
          Klasser: {selectedClasses.join(', ')} &nbsp;|&nbsp; Grense: {threshold.toFixed(1)}% &nbsp;|&nbsp; {atRiskStudents.length} elever &nbsp;|&nbsp; {new Date().toLocaleDateString('nb-NO')}
        </p>
      </div>

      <div className="flex items-center justify-between no-print">
        <h2 className="text-xl font-bold text-slate-900">
          Elever ({atRiskStudents.length})
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">
            Grense: {threshold.toFixed(1)}%
          </span>
          {missingWarningsOnly && (
            <button
              onClick={() => void generateMissingWarningsDocx()}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <FileText className="w-4 h-4" />
              Generer melding om manglende varsler
            </button>
          )}
          <button
            onClick={() => void generateOppfolgingsarkForUtvalg()}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Oppfølgingsark for utvalg
          </button>
          <div className="relative">
            <button
              onClick={() => setShowPdfMenu(prev => !prev)}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Eksporter PDF
            </button>
            {showPdfMenu && (
              <div className="absolute right-0 mt-2 w-52 rounded-lg border border-slate-200 bg-white shadow-lg z-20">
                <button
                  onClick={() => {
                    setShowPdfMenu(false)
                    void generatePDF('combined')
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-t-lg"
                >
                  Samlet oversikt
                </button>
                <button
                  onClick={() => {
                    setShowPdfMenu(false)
                    void generatePDF('per-student')
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-b-lg"
                >
                  Side per elev
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {atRiskStudents.map(student => {
          const kontaktlaerer = getKontaktlaererForStudent(student)
          const cardKey = `${student.className}-${student.navn}`
          const isExpanded = expandedKey === cardKey
          const warningBreakdown = student.subjects.reduce(
            (acc, subjectEntry) => {
              subjectEntry.warnings.forEach(warning => {
                const type = warning.warningType.toLowerCase()
                if (type.includes('frav')) {
                  acc.fravaer += 1
                } else if (type.includes('vurdering') || type.includes('grunnlag')) {
                  acc.grunnlag += 1
                } else {
                  acc.other += 1
                }
              })
              return acc
            },
            { fravaer: 0, grunnlag: 0, other: 0 }
          )
          const warningTypesCount =
            warningBreakdown.fravaer + warningBreakdown.grunnlag + warningBreakdown.other

          return (
            <div key={cardKey} className="student-card-wrapper">
              <div
                className={`student-card card p-4 border-l-4 transition-all ${
                  student.avbrudd
                    ? 'student-card-avbrudd opacity-60 border-l-amber-400 bg-amber-50'
                    : 'border-l-red-500'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={`font-semibold ${
                          student.avbrudd
                            ? 'text-slate-600'
                            : 'text-slate-900'
                        }`}
                      >
                        {student.navn}
                      </h3>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-medium">
                        {student.className}
                      </span>
                      {student.hasTalentProgram && (
                        <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs font-bold">
                          T
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          warningTypesCount > 0
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        Varsler funnet: {warningTypesCount}
                        {warningTypesCount > 0 && (
                          <>
                            {' '}
                            ({warningBreakdown.fravaer}+{warningBreakdown.grunnlag}
                            {warningBreakdown.other > 0 ? `+${warningBreakdown.other}` : ''})
                          </>
                        )}
                      </span>
                      {student.isAdult && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-bold">
                          18+
                        </span>
                      )}
                      {student.avbrudd && (
                        <span className="px-2 py-0.5 bg-amber-200 text-amber-800 rounded text-xs font-medium">
                          Avbrudd
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Kontaktlærer: {kontaktlaerer}
                    </p>

                    <div className="mt-3">
                      <div className="space-y-2">
                        {student.subjects.map(subjectEntry => (
                          <div
                            key={`${subjectEntry.subjectGroup}-${subjectEntry.subject}`}
                            className="flex flex-col gap-1"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="w-fit px-2 py-0.5 rounded text-sm font-medium bg-slate-100 text-slate-700">
                                {subjectEntry.subject}
                              </span>
                              <span
                                className={`w-fit px-2 py-0.5 rounded text-xs font-medium ${
                                  subjectEntry.percentageAbsence > 10
                                    ? 'bg-red-100 text-red-700'
                                    : subjectEntry.percentageAbsence >= 5
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {subjectEntry.percentageAbsence.toFixed(1)}%
                              </span>
                              {subjectEntry.grade && ['1', '2', 'iv'].includes(subjectEntry.grade.toLowerCase()) && (
                                <span className="w-fit px-2 py-0.5 rounded text-xs font-bold bg-orange-200 text-orange-900">
                                  Karakter T1: {subjectEntry.grade}
                                </span>
                              )}
                              {student.sidemalExemption && isNorskSubject(subjectEntry.subject) && (
                                <span className="w-fit px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
                                  Fritak sidemål
                                </span>
                              )}
                            </div>
                            {subjectEntry.teacher && (
                              <span className="text-xs text-slate-500 pl-2">
                                Lærer: {resolveTeacher(subjectEntry.subject, subjectEntry.teacher)}
                              </span>
                            )}
                            {subjectEntry.warnings.length > 0 && (
                              <div className="text-xs text-slate-600 pl-2 space-y-0.5">
                                {groupWarnings(subjectEntry.warnings).map(
                                  ([label, dates]) => (
                                    <div key={label}>
                                      <span className="font-semibold">
                                        {label}:
                                      </span>{' '}
                                      {dates.map((d, i) => (
                                        <span key={i} className={dateColor(d)}>{d}{i < dates.length - 1 ? ', ' : ''}</span>
                                      ))}
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                            {subjectEntry.warnings.length === 0 && subjectEntry.percentageAbsence >= 5 && (
                              <div className="text-xs text-slate-400 pl-2">
                                Ingen varsel funnet for dette faget
                              </div>
                            )}

                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="no-print ml-4 flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => void generateOppfolgingsark(student)}
                      className="px-3 py-2 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200 transition-colors flex items-center space-x-1"
                    >
                      <FileText className="w-4 h-4" />
                      <span className="text-sm font-medium">Oppfølgingsark PDF</span>
                    </button>
                    <button
                      onClick={() => void generateOppfolgingsarkDocx(student)}
                      className="px-3 py-2 bg-indigo-100 text-indigo-800 rounded hover:bg-indigo-200 transition-colors flex items-center space-x-1"
                    >
                      <FileText className="w-4 h-4" />
                      <span className="text-sm font-medium">Oppfølgingsark DOCX</span>
                    </button>
                    <button
                      onClick={() =>
                        setExpandedKey(isExpanded ? null : cardKey)
                      }
                      className="px-3 py-2 bg-sky-100 text-sky-700 rounded hover:bg-sky-200 transition-colors flex items-center space-x-1"
                    >
                      {isExpanded ? (
                        <X className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                      <span className="text-sm font-medium">
                        {isExpanded ? 'Lukk' : 'Detaljer'}
                      </span>
                    </button>
                    {(() => {
                      const intake = formatIntakePoints(student.intakePoints)
                      const toneClasses = intake.empty
                        ? 'bg-green-600 border-green-600 text-transparent'
                        : intake.tone === 'green'
                        ? 'bg-green-100 border-green-200 text-green-800'
                        : 'bg-slate-100 border-slate-200 text-slate-700'

                      return (
                        <div className={`w-full min-h-10 rounded border flex items-center justify-center text-sm font-semibold ${toneClasses}`}>
                          {intake.label || '•'}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="no-print border border-t-0 border-slate-200 rounded-b-lg overflow-hidden">
                  <StudentDetail
                    data={data}
                    selectedClass={student.className}
                    selectedStudent={student.navn}
                    threshold={threshold}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
