import { useMemo, useState, Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DataStore } from '../types'
import { normalizeMatch } from '../studentInfoUtils'

// Strip trailing group suffix like -1, -2 from subject codes (MAT1023-1 → MAT1023)
const subjectMergeKey = (value: string): string => {
  const tail = (value ?? '').trim().split('/').pop()?.trim() ?? ''
  return normalizeMatch(tail.replace(/-[A-Za-z0-9]+$/, ''))
}

const subjectDisplayCode = (value: string): string => {
  const code = (value.split('/').pop() ?? value).trim()
  return code.replace(/-[A-Za-z0-9]+$/, '')
}

interface Props {
  data: DataStore
}

interface TeacherInSubject {
  name: string
  studentCount: number
  totalVarsels: number
  missingWarnings: number
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
}

interface SubjectRow {
  subjectKey: string
  subject: string
  studentCount: number
  totalVarsels: number
  missingWarnings: number
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
  teachers: TeacherInSubject[]
}

type SortKey =
  | 'name'
  | 'students'
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
type SortDirection = 'asc' | 'desc'

const allGrades = ['IV', '1', '2', '3', '4', '5', '6'] as const
const gradeSortKey: Record<(typeof allGrades)[number], SortKey> = {
  IV: 'gradeIV', '1': 'grade1', '2': 'grade2', '3': 'grade3',
  '4': 'grade4', '5': 'grade5', '6': 'grade6',
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

const totalGrades = (gradesCounts: Record<string, number>): number =>
  allGrades.reduce((sum, grade) => sum + (gradesCounts[grade] ?? 0), 0)

const gradePercentLabel = (count: number, total: number): string =>
  `${total > 0 ? ((count / total) * 100).toFixed(0) : '0'}%`

export default function FaginnsiktView({ data }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null)
  const [subjectForPdfPrompt, setSubjectForPdfPrompt] = useState<SubjectRow | null>(null)
  const [anonymizedTeacherNames, setAnonymizedTeacherNames] = useState<string[]>([])

  const normalizedGrades = useMemo(() => {
    return data.grades
      .map(grade => {
        const teacher = grade.subjectTeacher?.trim() ?? ''
        const subjectDisplay = grade.subjectGroup?.trim() ?? ''
        const subjectNorm = subjectMergeKey(subjectDisplay)
        return {
          teacher,
          subjectDisplay,
          subjectNorm,
          subjectCode: subjectDisplayCode(subjectDisplay),
          normStudent: normalizeMatch(grade.navn),
          gradeValue: grade.grade.toUpperCase().trim(),
        }
      })
      .filter(grade => grade.teacher && grade.subjectDisplay)
  }, [data.grades])

  const normalizedWarnings = useMemo(() => {
    return data.warnings
      .map(warning => ({
        warningType: warning.warningType,
        normStudent: normalizeMatch(warning.navn),
        subjectDisplay: warning.subjectGroup?.trim() ?? '',
      }))
      .filter(warning => warning.subjectDisplay)
  }, [data.warnings])

  const normalizedAbsences = useMemo(() => {
    return data.absences.map(absence => ({
      percentageAbsence: absence.percentageAbsence,
      normStudent: normalizeMatch(absence.navn),
      subjectDisplay: absence.subjectGroup,
    }))
  }, [data.absences])

  const subjectNameByNorm = useMemo(() => {
    const nameCounts = new Map<string, Map<string, number>>()

    data.absences.forEach(absence => {
      const subjectNorm = subjectMergeKey(absence.subjectGroup)
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

  const subjectRows = useMemo(() => {
    const subjectMap = new Map<string, SubjectRow>()
    // subject(norm) -> teacher -> TeacherInSubject
    const teacherDataBySubject = new Map<string, Map<string, TeacherInSubject>>()
    // subject(norm) -> Set<student>
    const subjectStudents = new Map<string, Set<string>>()
    // subject(norm) -> teacher -> Set<student>
    const teacherStudentsBySubject = new Map<string, Map<string, Set<string>>>()

    const studentSubjectKey = (student: string, subject: string) => `${student}|||${normalizeMatch(subject)}`
    // (normStudent, normSubject) -> Set<teacher>
    const gradeTeachers = new Map<string, Set<string>>()

    const warningLabel = (warningType: string) => {
      const t = warningType.toLowerCase()
      if (t.includes('frav')) return 'F'
      if (t.includes('vurdering') || t.includes('grunnlag')) return 'G'
      return warningType
    }

    normalizedGrades.forEach(grade => {
      const teacher = grade.teacher
      const subjectDisplay = grade.subjectDisplay
      const subjectNorm = grade.subjectNorm
      const subjectCode = grade.subjectCode
      const normStudent = grade.normStudent
      const gradeValue = grade.gradeValue

      // Ensure subject row
      if (!subjectMap.has(subjectNorm)) {
        subjectMap.set(subjectNorm, {
          subjectKey: subjectNorm,
          subject: subjectNameByNorm.get(subjectNorm) ?? subjectCode,
          studentCount: 0,
          totalVarsels: 0,
          missingWarnings: 0,
          varselsByType: {},
          gradesCounts: {},
          teachers: [],
        })
      }
      // Ensure teacher data for subject
      if (!teacherDataBySubject.has(subjectNorm)) teacherDataBySubject.set(subjectNorm, new Map())
      if (!teacherDataBySubject.get(subjectNorm)!.has(teacher)) {
        teacherDataBySubject.get(subjectNorm)!.set(teacher, {
          name: teacher,
          studentCount: 0,
          totalVarsels: 0,
          missingWarnings: 0,
          varselsByType: {},
          gradesCounts: {},
        })
      }
      // Ensure student sets
      if (!subjectStudents.has(subjectNorm)) subjectStudents.set(subjectNorm, new Set())
      subjectStudents.get(subjectNorm)!.add(normStudent)

      if (!teacherStudentsBySubject.has(subjectNorm)) teacherStudentsBySubject.set(subjectNorm, new Map())
      if (!teacherStudentsBySubject.get(subjectNorm)!.has(teacher)) {
        teacherStudentsBySubject.get(subjectNorm)!.set(teacher, new Set())
      }
      teacherStudentsBySubject.get(subjectNorm)!.get(teacher)!.add(normStudent)

      // Track grade teachers for warning/absence join
      const key = studentSubjectKey(normStudent, subjectDisplay)
      if (!gradeTeachers.has(key)) gradeTeachers.set(key, new Set())
      gradeTeachers.get(key)!.add(teacher)

      // Accumulate grade counts
      const row = subjectMap.get(subjectNorm)!
      row.gradesCounts[gradeValue] = (row.gradesCounts[gradeValue] ?? 0) + 1
      const teacherStats = teacherDataBySubject.get(subjectNorm)!.get(teacher)!
      teacherStats.gradesCounts[gradeValue] = (teacherStats.gradesCounts[gradeValue] ?? 0) + 1
    })

    // Set student counts
    subjectMap.forEach((row, subjectNorm) => {
      row.studentCount = subjectStudents.get(subjectNorm)?.size ?? 0
      const teacherMap = teacherDataBySubject.get(subjectNorm)
      teacherMap?.forEach((teacherStats, teacher) => {
        teacherStats.studentCount = teacherStudentsBySubject.get(subjectNorm)?.get(teacher)?.size ?? 0
      })
    })

    // Warnings
    normalizedWarnings.forEach(warning => {
      const normStudent = warning.normStudent
      const subjectDisplay = warning.subjectDisplay
      const subjectNorm = subjectMergeKey(subjectDisplay)
      const key = studentSubjectKey(normStudent, subjectDisplay)
      const label = warningLabel(warning.warningType)

      const row = subjectMap.get(subjectNorm)
      if (row) {
        row.totalVarsels += 1
        row.varselsByType[label] = (row.varselsByType[label] ?? 0) + 1
      }

      const teachers = gradeTeachers.get(key)
      teachers?.forEach(teacher => {
        const teacherStats = teacherDataBySubject.get(subjectNorm)?.get(teacher)
        if (!teacherStats) return
        teacherStats.totalVarsels += 1
        teacherStats.varselsByType[label] = (teacherStats.varselsByType[label] ?? 0) + 1
      })
    })

    // Missing warnings
    const warningMap = new Map<string, number>()
    normalizedWarnings.forEach(w => {
      const key = studentSubjectKey(w.normStudent, w.subjectDisplay)
      warningMap.set(key, (warningMap.get(key) ?? 0) + 1)
    })

    const checkedCombos = new Set<string>()
    normalizedAbsences.forEach(a => {
      if (a.percentageAbsence <= 8) return
      const comboKey = studentSubjectKey(a.normStudent, a.subjectDisplay)
      if (checkedCombos.has(comboKey)) return
      checkedCombos.add(comboKey)
      if ((warningMap.get(comboKey) ?? 0) > 0) return

      const subjectNorm = subjectMergeKey(a.subjectDisplay)
      const row = subjectMap.get(subjectNorm)
      if (row) row.missingWarnings += 1

      const teachers = gradeTeachers.get(comboKey)
      teachers?.forEach(teacher => {
        const teacherStats = teacherDataBySubject.get(subjectNorm)?.get(teacher)
        if (!teacherStats) return
        teacherStats.missingWarnings += 1
      })
    })

    // Attach sorted teacher arrays
    subjectMap.forEach((row, subjectNorm) => {
      const teacherMap = teacherDataBySubject.get(subjectNorm)
      row.teachers = teacherMap
        ? Array.from(teacherMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'nb-NO'))
        : []
    })

    return Array.from(subjectMap.values())
  }, [normalizedGrades, normalizedWarnings, normalizedAbsences, subjectNameByNorm])

  const filteredAndSorted = useMemo(() => {
    const filtered = subjectRows.filter(r =>
      r.subject.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const numVal = (row: SubjectRow, key: SortKey): number => {
      if (key === 'students') return row.studentCount
      if (key === 'totalVarsels') return row.totalVarsels
      if (key === 'missingWarnings') return row.missingWarnings
      if (key === 'warningsF') return row.varselsByType['F'] ?? 0
      if (key === 'warningsG') return row.varselsByType['G'] ?? 0
      const gradeKey = sortGradeByKey[key]
      if (gradeKey) {
        const total = totalGrades(row.gradesCounts)
        if (total === 0) return 0
        return ((row.gradesCounts[gradeKey] ?? 0) / total) * 100
      }
      return 0
    }

    filtered.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.subject.localeCompare(b.subject, 'nb-NO', { numeric: true })
        return sortDirection === 'asc' ? cmp : -cmp
      }
      const diff = numVal(a, sortKey) - numVal(b, sortKey)
      if (diff !== 0) return sortDirection === 'asc' ? diff : -diff
      return a.subject.localeCompare(b.subject, 'nb-NO', { numeric: true })
    })

    return filtered
  }, [subjectRows, searchTerm, sortKey, sortDirection])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const indicator = (key: SortKey) => sortKey === key ? (sortDirection === 'asc' ? '▲' : '▼') : ''

  const exportSubjectPdf = async (row: SubjectRow, anonymizedTeacherNameSet: Set<string>) => {
    const { default: jsPDF } = await import('jspdf')
    const teacherDisplay = (name: string) => (anonymizedTeacherNameSet.has(name) ? '*** ***' : name)

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const marginX = 28
    const marginTop = 30
    const marginBottom = 30
    const lineHeight = 14
    let y = marginTop

    const gradeOrder = ['IV', '1', '2', '3', '4', '5', '6']
    const rowGradeTotal = totalGrades(row.gradesCounts)
    const tableHeaders = ['Lærer', 'Elever', 'Varsler', 'Mangl', 'F', 'G', 'IV', '1', '2', '3', '4', '5', '6']
    const tableWidths = [330, 68, 58, 52, 34, 34, 30, 30, 30, 30, 30, 30, 30]
    const tableRowHeight = 24

    const drawSectionHeader = () => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('Faginnsikt', marginX, y)
      y += 20

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(`Fag: ${row.subject}`, marginX, y)
      y += lineHeight

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Elever: ${row.studentCount}`, marginX, y)
      y += lineHeight
      doc.text(`Varsler totalt: ${row.totalVarsels}  |  F: ${row.varselsByType['F'] ?? 0}  |  G: ${row.varselsByType['G'] ?? 0}`, marginX, y)
      y += lineHeight
      doc.text(`Manglende varsler (>8%): ${row.missingWarnings}`, marginX, y)
      y += 18

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text('Detaljer per lærer', marginX, y)
      y += 12
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
        if (idx > 0) doc.line(x, y, x, y + tableRowHeight)
        drawCellText(header, x, w, idx === 0 ? 'left' : 'center')
        x += w
      })

      y += tableRowHeight
    }

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - marginBottom) {
        doc.addPage()
        y = marginTop
        drawSectionHeader()
        drawTableHeader()
      }
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
        if (idx > 0) doc.line(x, y, x, y + tableRowHeight)

        if (idx === 0) {
          drawCellText('Karakterfordeling', x, w, 'left')
        } else if (idx >= 6) {
          const gradeKey = gradeOrder[idx - 6]
          const count = row.gradesCounts[gradeKey] ?? 0
          const pct = gradePercentLabel(count, rowGradeTotal)
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

    drawSectionHeader()
    drawTableHeader()

    row.teachers.forEach(teacher => {
      ensureSpace(tableRowHeight)

      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.4)
      doc.rect(marginX, y, pageWidth - marginX * 2, tableRowHeight)

      const values = [
        teacherDisplay(teacher.name),
        String(teacher.studentCount),
        String(teacher.totalVarsels),
        String(teacher.missingWarnings),
        String(teacher.varselsByType['F'] ?? 0),
        String(teacher.varselsByType['G'] ?? 0),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]
      const teacherGradeTotal = totalGrades(teacher.gradesCounts)

      let x = marginX
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      values.forEach((value, idx) => {
        const w = tableWidths[idx]
        if (idx > 0) doc.line(x, y, x, y + tableRowHeight)
        if (idx >= 6) {
          const gradeKey = gradeOrder[idx - 6]
          const count = teacher.gradesCounts[gradeKey] ?? 0
          const pct = gradePercentLabel(count, teacherGradeTotal)
          doc.text(pct, x + w / 2, y + 10, { align: 'center', baseline: 'alphabetic' })
          doc.setFontSize(7)
          doc.setTextColor(100, 116, 139)
          doc.text(String(count), x + w / 2, y + 18, { align: 'center', baseline: 'alphabetic' })
          doc.setTextColor(15, 23, 42)
          doc.setFontSize(9)
        } else {
          const display = idx === 0 && value.length > 56 ? `${value.slice(0, 55)}…` : value
          drawCellText(display, x, w, idx === 0 ? 'left' : 'center')
        }
        x += w
      })

      y += tableRowHeight
    })

    drawDistributionRow()

    const safeName = row.subject.replace(/[<>:"/\\|?*]+/g, '_')
    doc.save(`faginnsikt-${safeName}.pdf`)
  }

  const SortTh = ({ label, sk, className = '' }: { label: string; sk: SortKey; className?: string }) => (
    <th className={`sticky top-0 z-10 bg-white py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${className}`}>
      <button
        type="button"
        onClick={() => toggleSort(sk)}
        className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
      >
        <span>{label}</span>
        <span className="min-w-2 text-[10px] leading-none text-slate-400">{indicator(sk)}</span>
      </button>
    </th>
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Fag</h2>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Søk etter fag..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[70vh]">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-slate-700"
                  >
                    <span>Fag</span>
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">{indicator('name')}</span>
                  </button>
                </th>
                <SortTh label="Elever" sk="students" className="text-center" />
                <SortTh label="Varsler totalt" sk="totalVarsels" className="text-center" />
                <SortTh label="Manglende" sk="missingWarnings" className="text-center" />
                <SortTh label="F" sk="warningsF" className="text-center" />
                <SortTh label="G" sk="warningsG" className="text-center" />
                {allGrades.map(grade => (
                  <SortTh key={grade} label={grade} sk={gradeSortKey[grade]} className="text-center" />
                ))}
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  PDF
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map(row => {
                const rowGradeTotal = totalGrades(row.gradesCounts)

                return (
                <Fragment key={row.subjectKey}>
                  <tr
                    onClick={() => setExpandedSubject(expandedSubject === row.subjectKey ? null : row.subjectKey)}
                    className={`border-b border-slate-100 hover:bg-sky-50/40 cursor-pointer transition-opacity ${
                      expandedSubject && expandedSubject !== row.subjectKey ? 'opacity-35' : 'opacity-100'
                    }`}
                  >
                    <td className="py-2 px-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {expandedSubject === row.subjectKey ? (
                          <ChevronDown className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 flex-shrink-0" />
                        )}
                        <span>{row.subject}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">{row.studentCount}</td>
                    <td className="py-2 px-3 text-center text-slate-700 font-medium">{row.totalVarsels}</td>
                    <td className="py-2 px-3 text-center text-amber-700 font-medium">{row.missingWarnings > 0 ? row.missingWarnings : '—'}</td>
                    <td className="py-2 px-3 text-center text-slate-700">{row.varselsByType['F'] ?? 0}</td>
                    <td className="py-2 px-3 text-center text-slate-700">{row.varselsByType['G'] ?? 0}</td>
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
                        <div className="leading-tight">
                          <div>{gradePercentLabel(row.gradesCounts[grade] ?? 0, rowGradeTotal)}</div>
                          <div className="text-[10px] text-slate-500">{row.gradesCounts[grade] ?? 0}</div>
                        </div>
                      </td>
                    ))}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setSubjectForPdfPrompt(row)
                          setAnonymizedTeacherNames([])
                        }}
                        className="px-2 py-1 text-xs font-medium rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                      >
                        Skriv ut
                      </button>
                    </td>
                  </tr>
                  {expandedSubject === row.subjectKey && (
                    <>
                      {row.teachers.length > 0 ? (
                        row.teachers.map(teacher => {
                          const teacherGradeTotal = totalGrades(teacher.gradesCounts)

                          return (
                          <tr key={`${row.subjectKey}-${teacher.name}`} className="bg-slate-50 border-b border-slate-200">
                            <td className="py-2 px-3 text-left text-slate-700 pl-10">- {teacher.name}</td>
                            <td className="py-2 px-3 text-center text-slate-700">{teacher.studentCount}</td>
                            <td className="py-2 px-3 text-center text-slate-700 font-medium">{teacher.totalVarsels}</td>
                            <td className="py-2 px-3 text-center text-amber-700 font-medium">{teacher.missingWarnings > 0 ? teacher.missingWarnings : '—'}</td>
                            <td className="py-2 px-3 text-center text-slate-700">{teacher.varselsByType['F'] ?? 0}</td>
                            <td className="py-2 px-3 text-center text-slate-700">{teacher.varselsByType['G'] ?? 0}</td>
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
                                <div className="leading-tight">
                                  <div>{gradePercentLabel(teacher.gradesCounts[grade] ?? 0, teacherGradeTotal)}</div>
                                  <div className="text-[10px] text-slate-500">{teacher.gradesCounts[grade] ?? 0}</div>
                                </div>
                              </td>
                            ))}
                            <td className="py-2 px-3 text-center text-slate-400">-</td>
                          </tr>
                        )})
                      ) : (
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <td colSpan={14} className="py-3 px-3 text-center text-slate-500 text-sm">
                            Ingen lærere med vurderingsdata for dette faget.
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </Fragment>
              )})}
            </tbody>
            {filteredAndSorted.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={14} className="py-6 px-3 text-center text-slate-500">
                    Ingen fag funnet
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>

        <div className="mt-4 text-xs text-slate-600">
          {filteredAndSorted.length} fag av {subjectRows.length} totalt
        </div>
      </div>

      {subjectForPdfPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-slate-900/35"
            onClick={() => setSubjectForPdfPrompt(null)}
          />
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl p-5">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Anonymisering</h3>
            <p className="text-sm text-slate-700 mb-5">
              Velg hvilke lærernavn som skal anonymiseres i utskriften.
            </p>
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAnonymizedTeacherNames(subjectForPdfPrompt.teachers.map(t => t.name))}
                className="px-2.5 py-1.5 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Velg alle
              </button>
              <button
                type="button"
                onClick={() => setAnonymizedTeacherNames([])}
                className="px-2.5 py-1.5 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Tøm alle
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 mb-5">
              {subjectForPdfPrompt.teachers.map(teacher => {
                const selected = anonymizedTeacherNames.includes(teacher.name)
                return (
                  <label key={teacher.name} className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer">
                    <span className="text-sm text-slate-800">{teacher.name}</span>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        setAnonymizedTeacherNames(prev =>
                          prev.includes(teacher.name)
                            ? prev.filter(name => name !== teacher.name)
                            : [...prev, teacher.name]
                        )
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600"
                    />
                  </label>
                )
              })}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubjectForPdfPrompt(null)}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => {
                  const row = subjectForPdfPrompt
                  setSubjectForPdfPrompt(null)
                  if (row) void exportSubjectPdf(row, new Set(anonymizedTeacherNames))
                }}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-sky-600 text-white hover:bg-sky-700"
              >
                Generer PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
