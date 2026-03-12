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
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
}

interface TeacherStats {
  name: string
  studentCount: number
  totalVarsels: number
  varselsByType: Record<string, number>
  gradesCounts: Record<string, number>
  subjectStats: SubjectStats[]
}

type SortKey = 'name' | 'students' | 'totalVarsels' | 'gradeCount'
type SortDirection = 'asc' | 'desc'

export default function InnsiktView({ data }: Props) {
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null)

  const teacherStats = useMemo(() => {
    // Collect all unique teachers and their data
    const teacherData = new Map<string, TeacherStats>()
    const teacherSubjects = new Map<string, Map<string, SubjectStats>>()

    // Process absences to get teachers, their students, and subject-level data
    const teacherStudents = new Map<string, Set<string>>()
    const subjectStudents = new Map<string, Map<string, Set<string>>>() // teacher -> subject -> students
    
    data.absences.forEach(absence => {
      const teacher = absence.teacher?.trim()
      if (!teacher) return
      
      // Track students per teacher
      if (!teacherStudents.has(teacher)) {
        teacherStudents.set(teacher, new Set())
      }
      teacherStudents.get(teacher)!.add(normalizeMatch(absence.navn))
      
      // Track students per subject
      if (!subjectStudents.has(teacher)) {
        subjectStudents.set(teacher, new Map())
      }
      if (!subjectStudents.get(teacher)!.has(absence.subject)) {
        subjectStudents.get(teacher)!.set(absence.subject, new Set())
      }
      subjectStudents.get(teacher)!.get(absence.subject)!.add(normalizeMatch(absence.navn))
    })

    // Initialize teacher stats from absences
    teacherStudents.forEach((students, teacher) => {
      teacherData.set(teacher, {
        name: teacher,
        studentCount: students.size,
        totalVarsels: 0,
        varselsByType: {},
        gradesCounts: {},
        subjectStats: [],
      })
      
      // Initialize subject stats for this teacher
      const subjects = new Map<string, SubjectStats>()
      subjectStudents.get(teacher)?.forEach((students, subject) => {
        subjects.set(subject, {
          subject,
          studentCount: students.size,
          totalVarsels: 0,
          varselsByType: {},
          gradesCounts: {},
        })
      })
      teacherSubjects.set(teacher, subjects)
    })

    // Process warnings
    const warningsByTeacher = new Map<string, Array<{ type: string; date: string }>>()
    const warningsByTeacherSubject = new Map<string, Map<string, Array<{ type: string; date: string }>>>()
    
    data.warnings.forEach(warning => {
      // Find the teacher(s) for this student in the given subject
      const matching = data.absences.filter(
        a => normalizeMatch(a.navn) === normalizeMatch(warning.navn) && 
             a.subjectGroup === warning.subjectGroup
      )
      
      matching.forEach(absence => {
        const teacher = absence.teacher?.trim()
        if (!teacher) return
        
        // Track warnings per teacher
        if (!warningsByTeacher.has(teacher)) {
          warningsByTeacher.set(teacher, [])
        }
        warningsByTeacher.get(teacher)!.push({
          type: warning.warningType.toLowerCase(),
          date: warning.sentDate,
        })
        
        // Track warnings per subject
        if (!warningsByTeacherSubject.has(teacher)) {
          warningsByTeacherSubject.set(teacher, new Map())
        }
        if (!warningsByTeacherSubject.get(teacher)!.has(absence.subject)) {
          warningsByTeacherSubject.get(teacher)!.set(absence.subject, [])
        }
        warningsByTeacherSubject.get(teacher)!.get(absence.subject)!.push({
          type: warning.warningType.toLowerCase(),
          date: warning.sentDate,
        })
      })
    })

    // Update warning counts for teachers
    warningsByTeacher.forEach((warnings, teacher) => {
      const stats = teacherData.get(teacher)
      if (!stats) return

      stats.totalVarsels = warnings.length

      warnings.forEach(warning => {
        const label = warning.type.includes('frav') 
          ? 'F' 
          : warning.type.includes('vurdering') || warning.type.includes('grunnlag')
          ? 'G'
          : warning.type
        stats.varselsByType[label] = (stats.varselsByType[label] ?? 0) + 1
      })
    })
    
    // Update warning counts for subjects
    warningsByTeacherSubject.forEach((subjectWarnings, teacher) => {
      subjectWarnings.forEach((warnings, subject) => {
        const subjectStat = teacherSubjects.get(teacher)?.get(subject)
        if (!subjectStat) return
        
        subjectStat.totalVarsels = warnings.length
        warnings.forEach(warning => {
          const label = warning.type.includes('frav') 
            ? 'F' 
            : warning.type.includes('vurdering') || warning.type.includes('grunnlag')
            ? 'G'
            : warning.type
          subjectStat.varselsByType[label] = (subjectStat.varselsByType[label] ?? 0) + 1
        })
      })
    })

    // Process grades
    data.grades.forEach(grade => {
      const teacher = grade.subjectTeacher?.trim()
      if (!teacher) return

      // Initialize teacher if not already present
      if (!teacherData.has(teacher)) {
        teacherData.set(teacher, {
          name: teacher,
          studentCount: 0,
          totalVarsels: 0,
          varselsByType: {},
          gradesCounts: {},
          subjectStats: [],
        })
        teacherSubjects.set(teacher, new Map())
      }

      const stats = teacherData.get(teacher)!
      const gradeValue = grade.grade.toUpperCase().trim()
      stats.gradesCounts[gradeValue] = (stats.gradesCounts[gradeValue] ?? 0) + 1
      
      // Add to subject stats
      if (!teacherSubjects.get(teacher)!.has(grade.subjectGroup)) {
        teacherSubjects.get(teacher)!.set(grade.subjectGroup, {
          subject: grade.subjectGroup,
          studentCount: 0,
          totalVarsels: 0,
          varselsByType: {},
          gradesCounts: {},
        })
      }
      
      const subjectStat = teacherSubjects.get(teacher)!.get(grade.subjectGroup)!
      subjectStat.gradesCounts[gradeValue] = (subjectStat.gradesCounts[gradeValue] ?? 0) + 1
    })

    // Convert subject stats maps to arrays
    teacherData.forEach((teacher) => {
      const subjects = teacherSubjects.get(teacher.name) || new Map()
      teacher.subjectStats = Array.from(subjects.values()).sort((a, b) => 
        a.subject.localeCompare(b.subject)
      )
    })

    return Array.from(teacherData.values())
  }, [data])

  const filteredAndSorted = useMemo(() => {
    let filtered = teacherStats.filter(t =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    filtered.sort((a, b) => {
      let aVal: string | number
      let bVal: string | number

      if (sortKey === 'name') {
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
        const cmp = aVal.localeCompare(bVal)
        return sortDirection === 'asc' ? cmp : -cmp
      } else if (sortKey === 'students') {
        aVal = a.studentCount
        bVal = b.studentCount
      } else if (sortKey === 'totalVarsels') {
        aVal = a.totalVarsels
        bVal = b.totalVarsels
      } else {
        // gradeCount
        aVal = Object.values(a.gradesCounts).reduce((sum, v) => sum + v, 0)
        bVal = Object.values(b.gradesCounts).reduce((sum, v) => sum + v, 0)
      }

      const diff = (aVal as number) - (bVal as number)
      return sortDirection === 'asc' ? diff : -diff
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

  const allGrades = ['IV', '1', '2', '3', '4', '5', '6']

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

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="py-3 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
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
                <th className="py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('students')}
                    className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                  >
                    <span>Elever</span>
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">
                      {getSortIndicator('students')}
                    </span>
                  </button>
                </th>
                <th className="py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
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
                <th className="py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('totalVarsels')}
                    className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                  >
                    <span>F</span>
                  </button>
                </th>
                <th className="py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('totalVarsels')}
                    className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center"
                  >
                    <span>G</span>
                  </button>
                </th>
                {allGrades.map(grade => (
                  <th
                    key={grade}
                    className="py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    {grade}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map(teacher => (
                <Fragment key={teacher.name}>
                  <tr
                    onClick={() => setExpandedTeacher(expandedTeacher === teacher.name ? null : teacher.name)}
                    className="border-b border-slate-100 hover:bg-sky-50/40 cursor-pointer"
                  >
                    <td className="py-2 px-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {expandedTeacher === teacher.name ? (
                          <ChevronDown className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 flex-shrink-0" />
                        )}
                        <span>{teacher.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">{teacher.studentCount}</td>
                    <td className="py-2 px-3 text-center text-slate-700 font-medium">{teacher.totalVarsels}</td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {teacher.varselsByType['f'] ?? 0}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {teacher.varselsByType['g'] ?? 0}
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
                  </tr>
                  {expandedTeacher === teacher.name && (
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={12} className="py-4 px-3">
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-slate-700">Per fag:</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-300">
                                  <th className="py-2 px-3 text-left font-semibold text-slate-600">Fag</th>
                                  <th className="py-2 px-3 text-center font-semibold text-slate-600">Elever</th>
                                  <th className="py-2 px-3 text-center font-semibold text-slate-600">Varsler</th>
                                  <th className="py-2 px-3 text-center font-semibold text-slate-600">F</th>
                                  <th className="py-2 px-3 text-center font-semibold text-slate-600">G</th>
                                  {allGrades.map(grade => (
                                    <th key={grade} className="py-2 px-3 text-center font-semibold text-slate-600">
                                      {grade}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {teacher.subjectStats.map(subject => (
                                  <tr key={subject.subject} className="border-b border-slate-200 hover:bg-white/50">
                                    <td className="py-2 px-3 text-left text-slate-700">{subject.subject}</td>
                                    <td className="py-2 px-3 text-center text-slate-700">{subject.studentCount}</td>
                                    <td className="py-2 px-3 text-center text-slate-700 font-medium">{subject.totalVarsels}</td>
                                    <td className="py-2 px-3 text-center text-slate-700">{subject.varselsByType['f'] ?? 0}</td>
                                    <td className="py-2 px-3 text-center text-slate-700">{subject.varselsByType['g'] ?? 0}</td>
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
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            {filteredAndSorted.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={12} className="py-6 px-3 text-center text-slate-500">
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
