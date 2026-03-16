import { useMemo, useState, Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DataStore } from '../types'
import { normalizeMatch } from '../studentInfoUtils'

interface Props {
  data: DataStore
}

interface SubjectStats {
  subject: string
  studentCount: number
  totalVarsels: number
  missingWarnings: number
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
}

interface TeacherStats {
  name: string
  studentCount: number
  gradeCount: number
  totalVarsels: number
  missingWarnings: number
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
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
type SortDirection = 'asc' | 'desc'

export default function InnsiktView({ data }: Props) {
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null)

  const normalizedGrades = useMemo(() => {
    return data.grades
      .map(grade => ({
        teacher: grade.subjectTeacher?.trim() ?? '',
        subjectDisplay: grade.subjectGroup?.trim() ?? '',
        subjectNorm: normalizeMatch(grade.subjectGroup),
        studentNorm: normalizeMatch(grade.navn),
        gradeValue: grade.grade.toUpperCase().trim(),
      }))
      .filter(grade => grade.teacher && grade.subjectDisplay)
  }, [data.grades])

  const normalizedWarnings = useMemo(() => {
    return data.warnings
      .map(warning => ({
        warningType: warning.warningType,
        studentNorm: normalizeMatch(warning.navn),
        subjectDisplay: warning.subjectGroup?.trim() ?? '',
      }))
      .filter(warning => warning.subjectDisplay)
  }, [data.warnings])

  const normalizedAbsences = useMemo(() => {
    return data.absences.map(absence => ({
      percentageAbsence: absence.percentageAbsence,
      studentNorm: normalizeMatch(absence.navn),
      subjectDisplay: absence.subjectGroup,
    }))
  }, [data.absences])

  const teacherStats = useMemo(() => {
    // Build teacher and subject statistics from vurderinger (grades) only.
    const teacherData = new Map<string, TeacherStats>()
    const teacherSubjects = new Map<string, Map<string, SubjectStats>>()
    const teacherStudents = new Map<string, Set<string>>()
    const subjectStudents = new Map<string, Map<string, Set<string>>>()
    const gradeTeachersByStudentSubject = new Map<string, Set<string>>()

    const studentSubjectKey = (student: string, subject: string) => `${student}|||${normalizeMatch(subject)}`

    normalizedGrades.forEach(grade => {
      const teacher = grade.teacher
      const subjectDisplay = grade.subjectDisplay
      const subject = grade.subjectNorm
      const normStudent = grade.studentNorm

      if (!teacherData.has(teacher)) {
        teacherData.set(teacher, {
          name: teacher,
          studentCount: 0,
          gradeCount: 0,
          totalVarsels: 0,
          missingWarnings: 0,
          varselsByType: {},
          gradesCounts: {},
          subjectStats: [],
        })
      }

      if (!teacherStudents.has(teacher)) {
        teacherStudents.set(teacher, new Set())
      }
      teacherStudents.get(teacher)!.add(normStudent)

      if (!subjectStudents.has(teacher)) {
        subjectStudents.set(teacher, new Map())
      }
      if (!subjectStudents.get(teacher)!.has(subject)) {
        subjectStudents.get(teacher)!.set(subject, new Set())
      }
      subjectStudents.get(teacher)!.get(subject)!.add(normStudent)

      const lookupKey = studentSubjectKey(normStudent, subject)
      if (!gradeTeachersByStudentSubject.has(lookupKey)) {
        gradeTeachersByStudentSubject.set(lookupKey, new Set())
      }
      gradeTeachersByStudentSubject.get(lookupKey)!.add(teacher)

      if (!teacherSubjects.has(teacher)) {
        teacherSubjects.set(teacher, new Map())
      }
      if (!teacherSubjects.get(teacher)!.has(subject)) {
        teacherSubjects.get(teacher)!.set(subject, {
          subject: subjectDisplay,
          studentCount: 0,
          totalVarsels: 0,
          missingWarnings: 0,
          varselsByType: {},
          gradesCounts: {},
        })
      }

      const stats = teacherData.get(teacher)!
      const gradeValue = grade.gradeValue
      stats.gradeCount += 1
      stats.gradesCounts[gradeValue] = (stats.gradesCounts[gradeValue] ?? 0) + 1

      const subjectStat = teacherSubjects.get(teacher)!.get(subject)!
      subjectStat.gradesCounts[gradeValue] = (subjectStat.gradesCounts[gradeValue] ?? 0) + 1
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
      const warningStudent = warning.studentNorm
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

    // Missing warnings: absence > 8%, no warning for student+subjectGroup.
    const warningMap = new Map<string, number>()
    normalizedWarnings.forEach(w => {
      const key = studentSubjectKey(w.studentNorm, w.subjectDisplay)
      warningMap.set(key, (warningMap.get(key) ?? 0) + 1)
    })

    const checkedCombos = new Set<string>()
    normalizedAbsences.forEach(a => {
      if (a.percentageAbsence <= 8) return
      const comboKey = studentSubjectKey(a.studentNorm, a.subjectDisplay)
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
  }, [normalizedGrades, normalizedWarnings, normalizedAbsences])

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

  const filteredAndSorted = useMemo(() => {
    let filtered = teacherStats.filter(t =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const numericSortValue = (row: TeacherStats, key: SortKey): number => {
      if (key === 'grades') return row.gradeCount
      if (key === 'totalVarsels') return row.totalVarsels
      if (key === 'missingWarnings') return row.missingWarnings
      if (key === 'warningsF') return row.varselsByType['F'] ?? 0
      if (key === 'warningsG') return row.varselsByType['G'] ?? 0
      if (key === 'gradeIV') return row.gradesCounts['IV'] ?? 0
      if (key === 'grade1') return row.gradesCounts['1'] ?? 0
      if (key === 'grade2') return row.gradesCounts['2'] ?? 0
      if (key === 'grade3') return row.gradesCounts['3'] ?? 0
      if (key === 'grade4') return row.gradesCounts['4'] ?? 0
      if (key === 'grade5') return row.gradesCounts['5'] ?? 0
      if (key === 'grade6') return row.gradesCounts['6'] ?? 0
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
  }, [teacherStats, searchTerm, sortKey, sortDirection])

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
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageHeight = doc.internal.pageSize.getHeight()
    const marginLeft = 36
    const marginTop = 42
    const lineHeight = 14
    let y = marginTop

    const ensureSpace = (needed = lineHeight) => {
      if (y + needed > pageHeight - 36) {
        doc.addPage()
        y = marginTop
      }
    }

    const writeLine = (text: string, bold = false, size = 10) => {
      ensureSpace(lineHeight)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      doc.text(text, marginLeft, y)
      y += lineHeight
    }

    const gradeOrder = ['IV', '1', '2', '3', '4', '5', '6']
    const gradesSummary = gradeOrder.map(g => `${g}: ${teacher.gradesCounts[g] ?? 0}`).join('  |  ')

    writeLine('Lærerinnsikt', true, 14)
    y += 4
    writeLine(`Lærer: ${teacher.name}`, true, 11)
    writeLine(`Elever: ${teacher.studentCount}`)
    writeLine(`Varsler totalt: ${teacher.totalVarsels}  |  F: ${teacher.varselsByType['F'] ?? 0}  |  G: ${teacher.varselsByType['G'] ?? 0}`)
    writeLine(`Manglende varsler (>8%): ${teacher.missingWarnings}`)
    writeLine(`Karakterer: ${gradesSummary}`)
    y += 6

    writeLine('Detaljer per fag', true, 11)
    doc.setFont('courier', 'bold')
    doc.setFontSize(9)
    ensureSpace()
    doc.text('Fag                         Elever Varsler Mangl  F  G  IV  1  2  3  4  5  6', marginLeft, y)
    y += lineHeight

    doc.setFont('courier', 'normal')
    teacher.subjectStats.forEach(subject => {
      const subjectName = subject.subject.length > 26 ? `${subject.subject.slice(0, 25)}.` : subject.subject
      const row = [
        subjectName.padEnd(26, ' '),
        String(subject.studentCount).padStart(6, ' '),
        String(subject.totalVarsels).padStart(7, ' '),
        String(subject.missingWarnings).padStart(6, ' '),
        String(subject.varselsByType['F'] ?? 0).padStart(3, ' '),
        String(subject.varselsByType['G'] ?? 0).padStart(3, ' '),
        String(subject.gradesCounts['IV'] ?? 0).padStart(4, ' '),
        String(subject.gradesCounts['1'] ?? 0).padStart(3, ' '),
        String(subject.gradesCounts['2'] ?? 0).padStart(3, ' '),
        String(subject.gradesCounts['3'] ?? 0).padStart(3, ' '),
        String(subject.gradesCounts['4'] ?? 0).padStart(3, ' '),
        String(subject.gradesCounts['5'] ?? 0).padStart(3, ' '),
        String(subject.gradesCounts['6'] ?? 0).padStart(3, ' '),
      ].join(' ')

      ensureSpace()
      doc.text(row, marginLeft, y)
      y += lineHeight
    })

    const safeName = teacher.name.replace(/[<>:"/\\|?*]+/g, '_')
    doc.save(`innsikt-${safeName}.pdf`)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Lærere</h2>
        
        <div className="mb-4">
          <input
            type="text"
            placeholder="Søk etter lærer..."
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
                  PDF
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map(teacher => (
                <Fragment key={teacher.name}>
                  <tr
                    onClick={() => setExpandedTeacher(expandedTeacher === teacher.name ? null : teacher.name)}
                    className={`border-b border-slate-100 hover:bg-sky-50/40 cursor-pointer transition-opacity ${
                      expandedTeacher && expandedTeacher !== teacher.name ? 'opacity-35' : 'opacity-100'
                    }`}
                  >
                    <td className="py-2 px-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {expandedTeacher === teacher.name ? (
                          <ChevronDown className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 flex-shrink-0" />
                        )}
                        <span>{formatTeacherDisplay(teacher.name)}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">{teacher.gradeCount}</td>
                    <td className="py-2 px-3 text-center text-slate-700 font-medium">{teacher.totalVarsels}</td>
                    <td className="py-2 px-3 text-center text-amber-700 font-medium">{teacher.missingWarnings > 0 ? teacher.missingWarnings : '—'}</td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {teacher.varselsByType['F'] ?? 0}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {teacher.varselsByType['G'] ?? 0}
                    </td>
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
                        {teacher.gradesCounts[grade] ?? 0}
                      </td>
                    ))}
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
                        teacher.subjectStats.map(subject => (
                          <tr key={`${teacher.name}-${subject.subject}`} className="bg-slate-50 border-b border-slate-200">
                            <td className="py-2 px-3 text-left text-slate-700 pl-10">- {subject.subject}</td>
                            <td className="py-2 px-3 text-center text-slate-700">{Object.values(subject.gradesCounts).reduce((sum, count) => sum + count, 0)}</td>
                            <td className="py-2 px-3 text-center text-slate-700 font-medium">{subject.totalVarsels}</td>
                            <td className="py-2 px-3 text-center text-amber-700 font-medium">{subject.missingWarnings > 0 ? subject.missingWarnings : '—'}</td>
                            <td className="py-2 px-3 text-center text-slate-700">{subject.varselsByType['F'] ?? 0}</td>
                            <td className="py-2 px-3 text-center text-slate-700">{subject.varselsByType['G'] ?? 0}</td>
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
                                {subject.gradesCounts[grade] ?? 0}
                              </td>
                            ))}
                            <td className="py-2 px-3 text-center text-slate-400">-</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <td colSpan={14} className="py-3 px-3 text-center text-slate-500 text-sm">
                            Ingen fag med vurderingsdata for denne læreren.
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </Fragment>
              ))}
            </tbody>
            {filteredAndSorted.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={14} className="py-6 px-3 text-center text-slate-500">
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
