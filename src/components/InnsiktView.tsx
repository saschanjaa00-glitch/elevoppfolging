import { useMemo, useState, Fragment } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import type { DataStore } from '../types'
import {
  buildStudentClassKey,
  createAbsenceSubjectClassLookup,
  normalizeMatch,
  resolveClassFromSubjectLookup,
} from '../studentInfoUtils'

interface Props {
  data: DataStore
  threshold: number
}

interface SubjectStats {
  subjectKey: string
  subject: string
  studentCount: number
  totalVarsels: number
  missingWarnings: number
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
  gradesCountsT1: Record<string, number>
  gradesCountsT2: Record<string, number>
}

interface TeacherStats {
  name: string
  studentCount: number
  gradeCount: number
  totalVarsels: number
  missingWarnings: number
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
  gradesCountsT1: Record<string, number>
  gradesCountsT2: Record<string, number>
  subjectStats: SubjectStats[]
}

type SortKey =
  | 'name'
  | 'grades'
  | 'totalVarsels'
  | 'missingWarnings'
  | 'warningsF'
  | 'warningsG'
  | 'gradeIV'
  | 'grade1'
  | 'grade2'
  | 'grade3'
  | 'grade4'
  | 'grade5'
  | 'grade6'
  | 'avgGrade'
  | 'avgDelta'
type SortDirection = 'asc' | 'desc'
type TermMode = 't1' | 't2' | 'compare'

export default function InnsiktView({ data, threshold }: Props) {
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null)
  const [termMode, setTermMode] = useState<TermMode>('t1')
  const absenceSubjectClassLookup = useMemo(
    () => createAbsenceSubjectClassLookup(data.absences),
    [data.absences]
  )

  const normalizedGrades = useMemo(() => {
    return data.grades
      .map(grade => {
        const resolvedClass = grade.class?.trim() || resolveClassFromSubjectLookup(absenceSubjectClassLookup, grade.navn, grade.subjectGroup)
        if (!resolvedClass) return null

        const halvaar = (grade.halvår ?? '').trim()
        const isT1 = halvaar === '1' || halvaar.toLowerCase().includes('1')
        const isT2 = !isT1 && (halvaar === '2' || halvaar.toLowerCase().includes('2'))

        return {
          teacher: grade.subjectTeacher?.trim() ?? '',
          subjectDisplay: grade.subjectGroup?.trim() ?? '',
          subjectNorm: normalizeMatch(grade.subjectGroup),
          studentKey: buildStudentClassKey(grade.navn, resolvedClass),
          gradeValue: grade.grade.toUpperCase().trim(),
          isT1,
          isT2,
        }
      })
      .filter((grade): grade is {
        teacher: string
        subjectDisplay: string
        subjectNorm: string
        studentKey: string
        gradeValue: string
        isT1: boolean
        isT2: boolean
      } => Boolean(grade?.teacher && grade.subjectDisplay))
  }, [data.grades, absenceSubjectClassLookup])

  const normalizedWarnings = useMemo(() => {
    return data.warnings
      .map(warning => ({
        warningType: warning.warningType,
        studentKey: buildStudentClassKey(warning.navn, warning.class),
        subjectDisplay: warning.subjectGroup?.trim() ?? '',
      }))
      .filter(warning => warning.subjectDisplay)
  }, [data.warnings])

  const normalizedAbsences = useMemo(() => {
    return data.absences.map(absence => ({
      percentageAbsence: absence.percentageAbsence,
      studentKey: buildStudentClassKey(absence.navn, absence.class),
      subjectDisplay: absence.subjectGroup,
    }))
  }, [data.absences])

  const subjectNameByNorm = useMemo(() => {
    const nameCounts = new Map<string, Map<string, number>>()

    data.absences.forEach(absence => {
      const subjectNorm = normalizeMatch(absence.subjectGroup)
      const subjectName = absence.subject?.trim() ?? ''
      if (!subjectNorm || !subjectName) return

      if (!nameCounts.has(subjectNorm)) nameCounts.set(subjectNorm, new Map())
      const counts = nameCounts.get(subjectNorm)!
      counts.set(subjectName, (counts.get(subjectName) ?? 0) + 1)
    })

    const result = new Map<string, string>()
    nameCounts.forEach((counts, subjectNorm) => {
      const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
      if (best) result.set(subjectNorm, best)
    })

    return result
  }, [data.absences])

  const teacherStats = useMemo(() => {
    // Build teacher and subject statistics from vurderinger (grades) only.
    const teacherData = new Map<string, TeacherStats>()
    const teacherSubjects = new Map<string, Map<string, SubjectStats>>()
    const teacherStudents = new Map<string, Set<string>>()
    const subjectStudents = new Map<string, Map<string, Set<string>>>()
    const gradeTeachersByStudentSubject = new Map<string, Set<string>>()

    const studentSubjectKey = (studentKey: string, subject: string) => `${studentKey}|||${normalizeMatch(subject)}`

    normalizedGrades.forEach(grade => {
      const teacher = grade.teacher
      const subjectDisplay = grade.subjectDisplay
      const subject = grade.subjectNorm
      const studentKey = grade.studentKey

      if (!teacherData.has(teacher)) {
        teacherData.set(teacher, {
          name: teacher,
          studentCount: 0,
          gradeCount: 0,
          totalVarsels: 0,
          missingWarnings: 0,
          varselsByType: {},
          gradesCounts: {},
          gradesCountsT1: {},
          gradesCountsT2: {},
          subjectStats: [],
        })
      }

      if (!teacherStudents.has(teacher)) {
        teacherStudents.set(teacher, new Set())
      }
      teacherStudents.get(teacher)!.add(studentKey)

      if (!subjectStudents.has(teacher)) {
        subjectStudents.set(teacher, new Map())
      }
      if (!subjectStudents.get(teacher)!.has(subject)) {
        subjectStudents.get(teacher)!.set(subject, new Set())
      }
      subjectStudents.get(teacher)!.get(subject)!.add(studentKey)

      const lookupKey = studentSubjectKey(studentKey, subject)
      if (!gradeTeachersByStudentSubject.has(lookupKey)) {
        gradeTeachersByStudentSubject.set(lookupKey, new Set())
      }
      gradeTeachersByStudentSubject.get(lookupKey)!.add(teacher)

      if (!teacherSubjects.has(teacher)) {
        teacherSubjects.set(teacher, new Map())
      }
      if (!teacherSubjects.get(teacher)!.has(subject)) {
        teacherSubjects.get(teacher)!.set(subject, {
          subjectKey: subject,
          subject: subjectNameByNorm.get(subject) ?? subjectDisplay,
          studentCount: 0,
          totalVarsels: 0,
          missingWarnings: 0,
          varselsByType: {},
          gradesCounts: {},
          gradesCountsT1: {},
          gradesCountsT2: {},
        })
      }

      const stats = teacherData.get(teacher)!
      const gradeValue = grade.gradeValue
      stats.gradeCount += 1
      stats.gradesCounts[gradeValue] = (stats.gradesCounts[gradeValue] ?? 0) + 1
      if (grade.isT1) {
        stats.gradesCountsT1[gradeValue] = (stats.gradesCountsT1[gradeValue] ?? 0) + 1
      } else if (grade.isT2) {
        stats.gradesCountsT2[gradeValue] = (stats.gradesCountsT2[gradeValue] ?? 0) + 1
      }

      const subjectStat = teacherSubjects.get(teacher)!.get(subject)!
      subjectStat.gradesCounts[gradeValue] = (subjectStat.gradesCounts[gradeValue] ?? 0) + 1
      if (grade.isT1) {
        subjectStat.gradesCountsT1[gradeValue] = (subjectStat.gradesCountsT1[gradeValue] ?? 0) + 1
      } else if (grade.isT2) {
        subjectStat.gradesCountsT2[gradeValue] = (subjectStat.gradesCountsT2[gradeValue] ?? 0) + 1
      }
    })

    // Set student counts from vurderinger-derived student sets.
    teacherData.forEach((stats, teacher) => {
      stats.studentCount = teacherStudents.get(teacher)?.size ?? 0
      const subjects = teacherSubjects.get(teacher)
      subjects?.forEach((subjectStat, subjectName) => {
        subjectStat.studentCount = subjectStudents.get(teacher)?.get(subjectName)?.size ?? 0
      })
    })

    const warningLabel = (warningType: string) => {
      const type = warningType.toLowerCase()
      if (type.includes('frav')) return 'F'
      if (type.includes('vurdering') || type.includes('grunnlag')) return 'G'
      return warningType
    }

    // Map warnings to teacher/subject using vurderinger relationships only.
    normalizedWarnings.forEach(warning => {
      const warningStudent = warning.studentKey
      const warningSubject = warning.subjectDisplay

      const matchedTeachers = gradeTeachersByStudentSubject.get(
        studentSubjectKey(warningStudent, warningSubject)
      )
      if (!matchedTeachers || matchedTeachers.size === 0) return

      matchedTeachers.forEach(teacher => {
        const teacherStats = teacherData.get(teacher)
        if (!teacherStats) return

        const label = warningLabel(warning.warningType)
        teacherStats.totalVarsels += 1
        teacherStats.varselsByType[label] = (teacherStats.varselsByType[label] ?? 0) + 1

        const subjectStat = teacherSubjects.get(teacher)?.get(normalizeMatch(warningSubject))
        if (!subjectStat) return
        subjectStat.totalVarsels += 1
        subjectStat.varselsByType[label] = (subjectStat.varselsByType[label] ?? 0) + 1
      })
    })

    // Missing warnings: absence > threshold%, no warning for student+subjectGroup.
    const warningMap = new Map<string, number>()
    normalizedWarnings.forEach(w => {
      const key = studentSubjectKey(w.studentKey, w.subjectDisplay)
      warningMap.set(key, (warningMap.get(key) ?? 0) + 1)
    })

    const checkedCombos = new Set<string>()
    normalizedAbsences.forEach(a => {
      if (a.percentageAbsence <= threshold) return
      const comboKey = studentSubjectKey(a.studentKey, a.subjectDisplay)
      if (checkedCombos.has(comboKey)) return
      checkedCombos.add(comboKey)

      if ((warningMap.get(comboKey) ?? 0) > 0) return

      const matchedTeachers = gradeTeachersByStudentSubject.get(comboKey)
      if (!matchedTeachers || matchedTeachers.size === 0) return

      const subjectKey = normalizeMatch(a.subjectDisplay)
      matchedTeachers.forEach(teacher => {
        const teacherStat = teacherData.get(teacher)
        if (!teacherStat) return
        teacherStat.missingWarnings += 1

        const subjectStat = teacherSubjects.get(teacher)?.get(subjectKey)
        if (!subjectStat) return
        subjectStat.missingWarnings += 1
      })
    })

    // Convert subject stats maps to sorted arrays.
    teacherData.forEach(teacher => {
      const subjects = teacherSubjects.get(teacher.name) || new Map()
      teacher.subjectStats = Array.from(subjects.values()).sort((a, b) =>
        a.subject.localeCompare(b.subject)
      )
    })

    return Array.from(teacherData.values())
  }, [normalizedGrades, normalizedWarnings, normalizedAbsences, subjectNameByNorm, threshold])

  const allGrades = ['IV', '1', '2', '3', '4', '5', '6'] as const

  const gradeSortKeyByGrade: Record<(typeof allGrades)[number], SortKey> = {
    IV: 'gradeIV',
    '1': 'grade1',
    '2': 'grade2',
    '3': 'grade3',
    '4': 'grade4',
    '5': 'grade5',
    '6': 'grade6',
  }
  const sortGradeByKey: Partial<Record<SortKey, (typeof allGrades)[number]>> = {
    gradeIV: 'IV',
    grade1: '1',
    grade2: '2',
    grade3: '3',
    grade4: '4',
    grade5: '5',
    grade6: '6',
  }

  const avgGradeNum = (gradesCounts: Record<string, number>): number | null => {
    const numericGrades = ['1', '2', '3', '4', '5', '6'] as const
    let sum = 0, count = 0
    numericGrades.forEach(g => {
      const n = gradesCounts[g] ?? 0
      sum += Number(g) * n
      count += n
    })
    return count > 0 ? sum / count : null
  }

  const countsForMode = (
    t1: Record<string, number>,
    t2: Record<string, number>,
    all: Record<string, number>
  ): Record<string, number> => {
    if (termMode === 't1') return t1
    if (termMode === 't2') return t2
    return all
  }

  const avgDelta = (t1: Record<string, number>, t2: Record<string, number>): number | null => {
    const a1 = avgGradeNum(t1)
    const a2 = avgGradeNum(t2)
    if (a1 === null || a2 === null) return null
    return a2 - a1
  }

  const filteredAndSorted = useMemo(() => {
    let filtered = teacherStats.filter(t =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const numericSortValue = (row: TeacherStats, key: SortKey): number => {
      const gc = countsForMode(row.gradesCountsT1, row.gradesCountsT2, row.gradesCounts)
      const total = Object.values(gc).reduce((a, b) => a + b, 0)
      if (key === 'grades') return total
      if (key === 'totalVarsels') return row.totalVarsels
      if (key === 'missingWarnings') return row.missingWarnings
      if (key === 'warningsF') return row.varselsByType['F'] ?? 0
      if (key === 'warningsG') return row.varselsByType['G'] ?? 0
      if (key === 'avgGrade') return avgGradeNum(gc) ?? -1
      if (key === 'avgDelta') return avgDelta(row.gradesCountsT1, row.gradesCountsT2) ?? -999
      const gradeKey = sortGradeByKey[key]
      if (gradeKey) {
        if (total === 0) return 0
        return ((gc[gradeKey] ?? 0) / total) * 100
      }
      return 0
    }

    filtered.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        return sortDirection === 'asc' ? cmp : -cmp
      }

      const aVal = numericSortValue(a, sortKey)
      const bVal = numericSortValue(b, sortKey)
      const diff = aVal - bVal
      if (diff !== 0) return sortDirection === 'asc' ? diff : -diff
      return a.name.localeCompare(b.name, 'nb-NO', { sensitivity: 'base' })
    })

    return filtered
  }, [teacherStats, searchTerm, sortKey, sortDirection, termMode])

  const sortedSubjectsForTeacher = (subjects: SubjectStats[]): SubjectStats[] => {
    const numVal = (s: SubjectStats): number => {
      const gc = countsForMode(s.gradesCountsT1, s.gradesCountsT2, s.gradesCounts)
      const total = Object.values(gc).reduce((a, b) => a + b, 0)
      if (sortKey === 'grades') return total
      if (sortKey === 'totalVarsels') return s.totalVarsels
      if (sortKey === 'missingWarnings') return s.missingWarnings
      if (sortKey === 'warningsF') return s.varselsByType['F'] ?? 0
      if (sortKey === 'warningsG') return s.varselsByType['G'] ?? 0
      if (sortKey === 'avgGrade') return avgGradeNum(gc) ?? -1
      if (sortKey === 'avgDelta') return avgDelta(s.gradesCountsT1, s.gradesCountsT2) ?? -999
      const gradeKey = sortGradeByKey[sortKey]
      if (gradeKey) return total === 0 ? 0 : ((gc[gradeKey] ?? 0) / total) * 100
      return 0
    }
    return [...subjects].sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.subject.localeCompare(b.subject, 'nb-NO')
        return sortDirection === 'asc' ? cmp : -cmp
      }
      const diff = numVal(a) - numVal(b)
      if (diff !== 0) return sortDirection === 'asc' ? diff : -diff
      return a.subject.localeCompare(b.subject, 'nb-NO')
    })
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const getSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDirection === 'asc' ? '▲' : '▼'
  }

  const gradePercentLabel = (count: number, total: number): string =>
    `${total > 0 ? ((count / total) * 100).toFixed(0) : '0'}%`

  const formatTeacherDisplay = (teacherName: string) => {
    const splitTeachers = teacherName
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

    if (splitTeachers.length > 3) return 'Flere lærere'
    return teacherName
  }

  const exportTeacherPdf = async (teacher: TeacherStats) => {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const marginX = 28
    const marginTop = 30
    const marginBottom = 30
    const lineHeight = 14
    let y = marginTop

    const gradeOrder = ['IV', '1', '2', '3', '4', '5', '6']

    const tableHeaders = ['Fag', 'Karakterer', 'Varsler', 'Mangl', 'F', 'G', 'IV', '1', '2', '3', '4', '5', '6']
    const tableWidths = [326, 72, 58, 52, 34, 34, 30, 30, 30, 30, 30, 30, 30]
    const tableRowHeight = 24

    const drawSummaryHeader = () => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('Lærerinnsikt', marginX, y)
      y += 20

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(`Lærer: ${teacher.name}`, marginX, y)
      y += lineHeight

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Karakterer satt: ${teacher.gradeCount}`, marginX, y)
      y += lineHeight
      doc.text(`Elever: ${teacher.studentCount}`, marginX, y)
      y += lineHeight
      doc.text(`Varsler totalt: ${teacher.totalVarsels}  |  F: ${teacher.varselsByType['F'] ?? 0}  |  G: ${teacher.varselsByType['G'] ?? 0}`, marginX, y)
      y += lineHeight
      doc.text(`Manglende varsler (>${threshold}%): ${teacher.missingWarnings}`, marginX, y)
      y += 18

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text('Detaljer per fag', marginX, y)
      y += 12
    }

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - marginBottom) {
        doc.addPage()
        y = marginTop
        drawSummaryHeader()
        drawTableHeader()
      }
    }

    const drawCellText = (text: string, x: number, width: number, align: 'left' | 'center' = 'center') => {
      if (align === 'left') {
        doc.text(text, x + 6, y + 12, { baseline: 'alphabetic' })
      } else {
        doc.text(text, x + width / 2, y + 12, { align: 'center', baseline: 'alphabetic' })
      }
    }

    const drawTableHeader = () => {
      doc.setFillColor(248, 250, 252)
      doc.rect(marginX, y, pageWidth - marginX * 2, tableRowHeight, 'F')

      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.6)
      doc.rect(marginX, y, pageWidth - marginX * 2, tableRowHeight)

      let x = marginX
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      tableHeaders.forEach((header, idx) => {
        const w = tableWidths[idx]
        if (idx > 0) {
          doc.line(x, y, x, y + tableRowHeight)
        }
        drawCellText(header, x, w, idx === 0 ? 'left' : 'center')
        x += w
      })

      y += tableRowHeight
    }

    const drawDistributionRow = () => {
      ensureSpace(tableRowHeight)

      doc.setFillColor(248, 250, 252)
      doc.rect(marginX, y, pageWidth - marginX * 2, tableRowHeight, 'F')

      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.6)
      doc.rect(marginX, y, pageWidth - marginX * 2, tableRowHeight)

      let x = marginX
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      tableHeaders.forEach((_header, idx) => {
        const w = tableWidths[idx]
        if (idx > 0) {
          doc.line(x, y, x, y + tableRowHeight)
        }

        if (idx === 0) {
          drawCellText('Karakterfordeling', x, w, 'left')
        } else if (idx >= 6) {
          const gradeKey = gradeOrder[idx - 6]
          const count = teacher.gradesCounts[gradeKey] ?? 0
          const pct = gradePercentLabel(count, teacher.gradeCount)
          doc.text(pct, x + w / 2, y + 10, { align: 'center', baseline: 'alphabetic' })
          doc.setFontSize(7)
          doc.setTextColor(100, 116, 139)
          doc.text(String(count), x + w / 2, y + 18, { align: 'center', baseline: 'alphabetic' })
          doc.setTextColor(15, 23, 42)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
        }

        x += w
      })

      y += tableRowHeight
    }

    drawSummaryHeader()
    drawTableHeader()

    teacher.subjectStats.forEach(subject => {
      ensureSpace(tableRowHeight)

      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.4)
      doc.rect(marginX, y, pageWidth - marginX * 2, tableRowHeight)

      const subjectGradeCount = Object.values(subject.gradesCounts).reduce((sum, count) => sum + count, 0)
      const values = [
        subject.subject,
        String(subjectGradeCount),
        String(subject.totalVarsels),
        String(subject.missingWarnings),
        String(subject.varselsByType['F'] ?? 0),
        String(subject.varselsByType['G'] ?? 0),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]

      let x = marginX
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      values.forEach((value, idx) => {
        const w = tableWidths[idx]
        if (idx > 0) {
          doc.line(x, y, x, y + tableRowHeight)
        }
        if (idx >= 6) {
          const gradeKey = gradeOrder[idx - 6]
          const count = subject.gradesCounts[gradeKey] ?? 0
          const pct = gradePercentLabel(count, subjectGradeCount)
          doc.text(pct, x + w / 2, y + 10, { align: 'center', baseline: 'alphabetic' })
          doc.setFontSize(7)
          doc.setTextColor(100, 116, 139)
          doc.text(String(count), x + w / 2, y + 18, { align: 'center', baseline: 'alphabetic' })
          doc.setTextColor(15, 23, 42)
          doc.setFontSize(9)
        } else {
          const display = idx === 0 && value.length > 52 ? `${value.slice(0, 51)}…` : value
          drawCellText(display, x, w, idx === 0 ? 'left' : 'center')
        }
        x += w
      })

      y += tableRowHeight
    })

    drawDistributionRow()

    const safeName = teacher.name.replace(/[<>:"/\\|?*]+/g, '_')
    doc.save(`innsikt-${safeName}.pdf`)
  }

  const showWarningColumns = termMode !== 'compare'
  const showDeltaColumn = termMode === 'compare'
  const totalColumnCount = 1 + 1 + (showWarningColumns ? 4 : 0) + allGrades.length + 1 + (showDeltaColumn ? 1 : 0) + 1

  const exportToExcel = () => {
    void import('exceljs').then(async exceljs => {
      const workbook = new exceljs.Workbook()
      const skoleårLabel = (data.skoleår ?? 'Ukjent').replace(/[^0-9A-Za-z]/g, '') || 'Ukjent'
      const headers = ['Lærer', 'Fag', 'Elever', 'Karakterer', 'Snitt', 'IV', 'IV%', '1', '1%', '2', '2%', '3', '3%', '4', '4%', '5', '5%', '6', '6%', 'Varsler', 'Manglende', 'F', 'G']
      const colWidths = [24, 28, 12, 12, 12, 9, 11, 9, 11, 9, 11, 9, 11, 9, 11, 9, 11, 9, 11, 12, 12, 9, 9]
      const percentCols = [7, 9, 11, 13, 15, 17, 19]

      const buildRows = (termCounts: (t: TeacherStats | SubjectStats) => Record<string, number>) => {
        const rows: (string | number)[][] = []
        const rowLevels: number[] = []
        filteredAndSorted.forEach(teacher => {
          const gc = termCounts(teacher)
          const total = Object.values(gc).reduce((a, b) => a + b, 0)
          const avg = avgGradeNum(gc)
          rows.push([
            teacher.name, '', teacher.studentCount, total,
            avg !== null ? parseFloat(avg.toFixed(2)) : '',
            gc['IV'] ?? 0, total > 0 ? (gc['IV'] ?? 0) / total : 0,
            gc['1'] ?? 0, total > 0 ? (gc['1'] ?? 0) / total : 0,
            gc['2'] ?? 0, total > 0 ? (gc['2'] ?? 0) / total : 0,
            gc['3'] ?? 0, total > 0 ? (gc['3'] ?? 0) / total : 0,
            gc['4'] ?? 0, total > 0 ? (gc['4'] ?? 0) / total : 0,
            gc['5'] ?? 0, total > 0 ? (gc['5'] ?? 0) / total : 0,
            gc['6'] ?? 0, total > 0 ? (gc['6'] ?? 0) / total : 0,
            teacher.totalVarsels, teacher.missingWarnings,
            teacher.varselsByType['F'] ?? 0, teacher.varselsByType['G'] ?? 0,
          ])
          rowLevels.push(0)

          teacher.subjectStats.forEach(s => {
            const sgc = termCounts(s)
            const stotal = Object.values(sgc).reduce((a, b) => a + b, 0)
            const savg = avgGradeNum(sgc)
            rows.push([
              '', s.subject, s.studentCount, stotal,
              savg !== null ? parseFloat(savg.toFixed(2)) : '',
              sgc['IV'] ?? 0, stotal > 0 ? (sgc['IV'] ?? 0) / stotal : 0,
              sgc['1'] ?? 0, stotal > 0 ? (sgc['1'] ?? 0) / stotal : 0,
              sgc['2'] ?? 0, stotal > 0 ? (sgc['2'] ?? 0) / stotal : 0,
              sgc['3'] ?? 0, stotal > 0 ? (sgc['3'] ?? 0) / stotal : 0,
              sgc['4'] ?? 0, stotal > 0 ? (sgc['4'] ?? 0) / stotal : 0,
              sgc['5'] ?? 0, stotal > 0 ? (sgc['5'] ?? 0) / stotal : 0,
              sgc['6'] ?? 0, stotal > 0 ? (sgc['6'] ?? 0) / stotal : 0,
              s.totalVarsels, s.missingWarnings,
              s.varselsByType['F'] ?? 0, s.varselsByType['G'] ?? 0,
            ])
            rowLevels.push(1)
          })
        })
        return { rows, rowLevels }
      }

      const addSheet = (sheetName: string, termCounts: (t: TeacherStats | SubjectStats) => Record<string, number>) => {
        const worksheet = workbook.addWorksheet(sheetName.slice(0, 31), {
          views: [{ state: 'frozen', ySplit: 1 }],
        })
        worksheet.properties.outlineLevelRow = 1
        worksheet.addRow(headers)
        const built = buildRows(termCounts)
        built.rows.forEach((row, idx) => {
          const level = built.rowLevels[idx]
          const excelRow = worksheet.addRow(row)
          if (level > 0) {
            excelRow.outlineLevel = 1
            excelRow.hidden = true
            excelRow.getCell(2).alignment = { indent: 1, vertical: 'middle' }
          }
        })

        worksheet.columns.forEach((col, idx) => {
          col.width = colWidths[idx]
        })
        worksheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: headers.length },
        }

        const headerRow = worksheet.getRow(1)
        headerRow.height = 22
        headerRow.eachCell(cell => {
          cell.font = { bold: true, color: { argb: 'FF0F172A' } }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          }
        })

        for (let i = 2; i <= worksheet.rowCount; i += 1) {
          const row = worksheet.getRow(i)
          const isChild = (row.outlineLevel ?? 0) > 0
          row.height = 20
          row.eachCell(cell => {
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            }
            if (!isChild) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
            }
          })
          row.getCell(5).numFmt = '0.00'
          percentCols.forEach(col => {
            row.getCell(col).numFmt = '0.0%'
          })
        }
      }

      addSheet(`${skoleårLabel}H1`, t => t.gradesCountsT1)
      addSheet(`${skoleårLabel}H2`, t => t.gradesCountsT2)

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `laererinnsikt-${skoleårLabel}.xlsx`
      link.click()
      URL.revokeObjectURL(link.href)
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Lærere</h2>
          <button
            type="button"
            onClick={exportToExcel}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
          >
            Eksporter til Excel
          </button>
        </div>
        
        <div className="mb-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTermMode('t1')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                termMode === 't1'
                  ? 'bg-sky-100 text-sky-800 border-sky-300'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Halvår 1
            </button>
            <button
              type="button"
              onClick={() => setTermMode('t2')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                termMode === 't2'
                  ? 'bg-sky-100 text-sky-800 border-sky-300'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Halvår 2
            </button>
            <button
              type="button"
              onClick={() => setTermMode('compare')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                termMode === 'compare'
                  ? 'bg-sky-100 text-sky-800 border-sky-300'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Sammenlign
            </button>
          </div>
          <input
            type="text"
            placeholder="Søk etter lærer..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[70vh]">
          <table className={`${termMode === 'compare' ? 'w-max [&_th]:!px-2 [&_th]:!py-2 [&_td]:!px-2 [&_td]:!py-1' : 'w-full'} table-auto text-sm border-separate border-spacing-0`}>
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[160px]">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-slate-700"
                  >
                    <span>Lærer</span>
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">
                      {getSortIndicator('name')}
                    </span>
                  </button>
                </th>
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('grades')}
                    className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                  >
                    <span>Karakterer</span>
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">
                      {getSortIndicator('grades')}
                    </span>
                  </button>
                </th>
                {showWarningColumns && (
                  <>
                    <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('totalVarsels')}
                        className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                      >
                        <span>Varsler totalt</span>
                        <span className="min-w-2 text-[10px] leading-none text-slate-400">
                          {getSortIndicator('totalVarsels')}
                        </span>
                      </button>
                    </th>
                    <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('missingWarnings')}
                        className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                      >
                        <span>Manglende</span>
                        <span className="min-w-2 text-[10px] leading-none text-slate-400">
                          {getSortIndicator('missingWarnings')}
                        </span>
                      </button>
                    </th>
                    <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('warningsF')}
                        className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                      >
                        <span>F</span>
                        <span className="min-w-2 text-[10px] leading-none text-slate-400">
                          {getSortIndicator('warningsF')}
                        </span>
                      </button>
                    </th>
                    <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('warningsG')}
                        className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                      >
                        <span>G</span>
                        <span className="min-w-2 text-[10px] leading-none text-slate-400">
                          {getSortIndicator('warningsG')}
                        </span>
                      </button>
                    </th>
                  </>
                )}
                {allGrades.map(grade => (
                  <th
                    key={grade}
                    className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(gradeSortKeyByGrade[grade])}
                      className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                    >
                      <span>{grade}</span>
                      <span className="min-w-2 text-[10px] leading-none text-slate-400">
                        {getSortIndicator(gradeSortKeyByGrade[grade])}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('avgGrade')}
                    className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                  >
                    <span>Snitt</span>
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">
                      {getSortIndicator('avgGrade')}
                    </span>
                  </button>
                </th>
                {showDeltaColumn && (
                  <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('avgDelta')}
                      className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                    >
                      <span>Endring</span>
                      <span className="min-w-2 text-[10px] leading-none text-slate-400">
                        {getSortIndicator('avgDelta')}
                      </span>
                    </button>
                  </th>
                )}
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  PDF
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map(teacher => {
                const gc = countsForMode(teacher.gradesCountsT1, teacher.gradesCountsT2, teacher.gradesCounts)
                const gcTotal = Object.values(gc).reduce((a, b) => a + b, 0)
                const t1Total = Object.values(teacher.gradesCountsT1).reduce((a, b) => a + b, 0)
                const t2Total = Object.values(teacher.gradesCountsT2).reduce((a, b) => a + b, 0)
                const rowDelta = avgDelta(teacher.gradesCountsT1, teacher.gradesCountsT2)
                return (
                <Fragment key={teacher.name}>
                  <tr
                    onClick={() => setExpandedTeacher(expandedTeacher === teacher.name ? null : teacher.name)}
                    className={`border-b border-slate-100 hover:bg-sky-50/40 cursor-pointer transition-opacity ${
                      expandedTeacher && expandedTeacher !== teacher.name ? 'opacity-35' : 'opacity-100'
                    }`}
                  >
                    <td className="py-2 px-3 font-medium text-slate-900 min-w-[160px]">
                      <div className="flex items-center gap-2">
                        {expandedTeacher === teacher.name ? (
                          <ChevronDown className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 flex-shrink-0" />
                        )}
                        <span>{formatTeacherDisplay(teacher.name)}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {termMode === 'compare' ? `${t1Total} / ${t2Total}` : gcTotal}
                    </td>
                    {showWarningColumns && (
                      <>
                        <td className="py-2 px-3 text-center text-slate-700 font-medium">{teacher.totalVarsels}</td>
                        <td className="py-2 px-3 text-center text-amber-700 font-medium">{teacher.missingWarnings > 0 ? teacher.missingWarnings : '—'}</td>
                        <td className="py-2 px-3 text-center text-slate-700">
                          {teacher.varselsByType['F'] ?? 0}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-700">
                          {teacher.varselsByType['G'] ?? 0}
                        </td>
                      </>
                    )}
                    {allGrades.map(grade => (
                      <td
                        key={grade}
                        className={`py-2 px-3 text-center ${
                          grade === 'IV' || grade === '1'
                            ? 'bg-red-50 text-red-700 font-medium'
                            : grade === '2'
                            ? 'bg-amber-50 text-amber-700 font-medium'
                            : 'text-slate-700'
                        }`}
                      >
                        {termMode === 'compare' ? (
                          <div className="leading-tight">
                            <div className="inline-flex items-center gap-1 whitespace-nowrap text-xs">
                              <span>{gradePercentLabel(teacher.gradesCountsT1[grade] ?? 0, t1Total)} / {gradePercentLabel(teacher.gradesCountsT2[grade] ?? 0, t2Total)}</span>
                              {(() => {
                                const pctT1 = t1Total > 0 ? ((teacher.gradesCountsT1[grade] ?? 0) / t1Total) * 100 : 0
                                const pctT2 = t2Total > 0 ? ((teacher.gradesCountsT2[grade] ?? 0) / t2Total) * 100 : 0
                                if (pctT2 > pctT1) return <ArrowUp className="w-[14px] h-[14px] text-emerald-600" />
                                if (pctT2 < pctT1) return <ArrowDown className="w-[14px] h-[14px] text-red-600" />
                                return null
                              })()}
                            </div>
                            <div className="text-[10px] text-slate-500">({teacher.gradesCountsT1[grade] ?? 0}/{teacher.gradesCountsT2[grade] ?? 0})</div>
                          </div>
                        ) : (
                          <div className="leading-tight">
                            <div>{gradePercentLabel(gc[grade] ?? 0, gcTotal)}</div>
                            <div className="text-[10px] text-slate-500">{gc[grade] ?? 0}</div>
                          </div>
                        )}
                      </td>
                    ))}
                    <td className={`${termMode === 'compare' ? 'text-xs' : ''} py-2 px-3 text-center font-semibold text-slate-800 ${
                      termMode === 'compare' && rowDelta !== null
                        ? rowDelta > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : rowDelta < 0
                            ? 'bg-red-100 text-red-800'
                            : 'bg-slate-100 text-slate-700'
                        : ''
                    }`}>
                      {termMode === 'compare' ? (
                        <div className="inline-flex items-center gap-1 whitespace-nowrap">
                          <span>{avgGradeNum(teacher.gradesCountsT1)?.toFixed(2).replace('.', ',') ?? '—'} / {avgGradeNum(teacher.gradesCountsT2)?.toFixed(2).replace('.', ',') ?? '—'}</span>
                        </div>
                      ) : (
                        <>{avgGradeNum(gc)?.toFixed(2).replace('.', ',') ?? '—'}</>
                      )}
                    </td>
                    {showDeltaColumn && (
                      <td className="text-xs py-2 px-3 text-center font-semibold text-slate-700 whitespace-nowrap">
                        {rowDelta === null
                          ? '—'
                          : `${rowDelta > 0 ? '+' : ''}${rowDelta.toFixed(2).replace('.', ',')}`}
                      </td>
                    )}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          void exportTeacherPdf(teacher)
                        }}
                        className="px-2 py-1 text-xs font-medium rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                      >
                        Skriv ut
                      </button>
                    </td>
                  </tr>
                  {expandedTeacher === teacher.name && (
                    <>
                      {teacher.subjectStats.length > 0 ? (
                        sortedSubjectsForTeacher(teacher.subjectStats).map(subject => {
                          const sgc = countsForMode(subject.gradesCountsT1, subject.gradesCountsT2, subject.gradesCounts)
                          const sgcTotal = Object.values(sgc).reduce((a, b) => a + b, 0)
                          const st1Total = Object.values(subject.gradesCountsT1).reduce((a, b) => a + b, 0)
                          const st2Total = Object.values(subject.gradesCountsT2).reduce((a, b) => a + b, 0)
                          const sDelta = avgDelta(subject.gradesCountsT1, subject.gradesCountsT2)

                          return (
                          <tr key={`${teacher.name}-${subject.subjectKey}`} className="bg-slate-50 border-b border-slate-200">
                            <td className="py-2 px-3 text-left text-slate-700 pl-10">- {subject.subject}</td>
                            <td className="py-2 px-3 text-center text-slate-700">
                              {termMode === 'compare' ? `${st1Total} / ${st2Total}` : sgcTotal}
                            </td>
                            {showWarningColumns && (
                              <>
                                <td className="py-2 px-3 text-center text-slate-700 font-medium">{subject.totalVarsels}</td>
                                <td className="py-2 px-3 text-center text-amber-700 font-medium">{subject.missingWarnings > 0 ? subject.missingWarnings : '—'}</td>
                                <td className="py-2 px-3 text-center text-slate-700">{subject.varselsByType['F'] ?? 0}</td>
                                <td className="py-2 px-3 text-center text-slate-700">{subject.varselsByType['G'] ?? 0}</td>
                              </>
                            )}
                            {allGrades.map(grade => (
                              <td
                                key={grade}
                                className={`py-2 px-3 text-center ${
                                  grade === 'IV' || grade === '1'
                                    ? 'bg-red-100 text-red-700 font-medium'
                                    : grade === '2'
                                    ? 'bg-amber-100 text-amber-700 font-medium'
                                    : 'text-slate-700'
                                }`}
                              >
                                {termMode === 'compare' ? (
                                  <div className="leading-tight">
                                    <div className="inline-flex items-center gap-1 whitespace-nowrap text-xs">
                                      <span>{gradePercentLabel(subject.gradesCountsT1[grade] ?? 0, st1Total)} / {gradePercentLabel(subject.gradesCountsT2[grade] ?? 0, st2Total)}</span>
                                      {(() => {
                                        const pctT1 = st1Total > 0 ? ((subject.gradesCountsT1[grade] ?? 0) / st1Total) * 100 : 0
                                        const pctT2 = st2Total > 0 ? ((subject.gradesCountsT2[grade] ?? 0) / st2Total) * 100 : 0
                                        if (pctT2 > pctT1) return <ArrowUp className="w-[14px] h-[14px] text-emerald-600" />
                                        if (pctT2 < pctT1) return <ArrowDown className="w-[14px] h-[14px] text-red-600" />
                                        return null
                                      })()}
                                    </div>
                                    <div className="text-[10px] text-slate-500">({subject.gradesCountsT1[grade] ?? 0}/{subject.gradesCountsT2[grade] ?? 0})</div>
                                  </div>
                                ) : (
                                  <div className="leading-tight">
                                    <div>{gradePercentLabel(sgc[grade] ?? 0, sgcTotal)}</div>
                                    <div className="text-[10px] text-slate-500">{sgc[grade] ?? 0}</div>
                                  </div>
                                )}
                              </td>
                            ))}
                            <td className={`${termMode === 'compare' ? 'text-xs' : ''} py-2 px-3 text-center font-semibold text-slate-800 ${
                              termMode === 'compare' && sDelta !== null
                                ? sDelta > 0
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : sDelta < 0
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-slate-100 text-slate-700'
                                : ''
                            }`}>
                              {termMode === 'compare' ? (
                                <div className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <span>{avgGradeNum(subject.gradesCountsT1)?.toFixed(2).replace('.', ',') ?? '—'} / {avgGradeNum(subject.gradesCountsT2)?.toFixed(2).replace('.', ',') ?? '—'}</span>
                                </div>
                              ) : (
                                <>{avgGradeNum(sgc)?.toFixed(2).replace('.', ',') ?? '—'}</>
                              )}
                            </td>
                            {showDeltaColumn && (
                              <td className="text-xs py-2 px-3 text-center font-semibold text-slate-700 whitespace-nowrap">
                                {sDelta === null
                                  ? '—'
                                  : `${sDelta > 0 ? '+' : ''}${sDelta.toFixed(2).replace('.', ',')}`}
                              </td>
                            )}
                            <td className="py-2 px-3 text-center text-slate-400">-</td>
                          </tr>
                        )})
                      ) : (
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <td colSpan={totalColumnCount} className="py-3 px-3 text-center text-slate-500 text-sm">
                            Ingen fag med vurderingsdata for denne læreren.
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </Fragment>
                )
              })}
            </tbody>
            {filteredAndSorted.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={totalColumnCount} className="py-6 px-3 text-center text-slate-500">
                    Ingen lærere funnet
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>

        <div className="mt-4 text-xs text-slate-600">
          {filteredAndSorted.length} lærere av {teacherStats.length} totalt
        </div>
      </div>
    </div>
  )
}
