import { useMemo, useState } from 'react'
import type { DataStore, StudentAbsenceSummary } from '../types'
import { Eye, X } from 'lucide-react'
import StudentDetail from './StudentDetail'

interface StudentListProps {
  data: DataStore
  selectedClasses: string[]
  threshold: number
}

export default function StudentList({
  data,
  selectedClasses,
  threshold,
}: StudentListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const normalizeMatch = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')

  const groupWarnings = (warnings: Array<{ warningType: string; sentDate: string }>) => {
    const parseDMY = (d: string) => {
      const m = d.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/)
      return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0
    }
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
      if (w.sentDate) grouped.get(label)!.push(w.sentDate)
    })
    grouped.forEach((dates, label) =>
      grouped.set(
        label,
        [...dates].sort((a, b) => parseDMY(a) - parseDMY(b))
      )
    )
    return Array.from(grouped.entries()).sort(
      ([a], [b]) => labelOrder(a) - labelOrder(b)
    )
  }

  const studentSummaries = useMemo(() => {
    const selectedClassSet = new Set(selectedClasses)
    const classData = data.absences.filter(a => selectedClassSet.has(a.class))

    const warningMap = new Map<
      string,
      Array<{ warningType: string; sentDate: string }>
    >()
    const studentDobMap = new Map<string, string>()
    data.warnings.forEach(warning => {
      const key = `${normalizeMatch(warning.navn)}::${normalizeMatch(
        warning.subjectGroup
      )}`
      if (!warningMap.has(key)) warningMap.set(key, [])
      warningMap.get(key)!.push({
        warningType: warning.warningType,
        sentDate: warning.sentDate,
      })
      if (warning.dateOfBirth)
        studentDobMap.set(normalizeMatch(warning.navn), warning.dateOfBirth)
    })

    const isOver18 = (dobStr: string): boolean => {
      if (!dobStr) return false
      const match = dobStr.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/)
      if (!match) return false
      const dob = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]))
      if (isNaN(dob.getTime())) return false
      const now = new Date()
      return now >= new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate())
    }

    const summaryMap = new Map<string, StudentAbsenceSummary>()

    classData.forEach(record => {
      const key = `${record.class}::${record.navn}`
      const warningKey = `${normalizeMatch(record.navn)}::${normalizeMatch(
        record.subjectGroup
      )}`
      const warnings = warningMap.get(warningKey) ?? []
      const hasSubjectWarning = warnings.length > 0
      const dobStr = studentDobMap.get(normalizeMatch(record.navn)) ?? ''

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          navn: record.navn,
          className: record.class,
          maxPercentage: record.percentageAbsence,
          totalHours: record.hoursAbsence,
          subjects:
            record.percentageAbsence > threshold
              ? [
                  {
                    subject: record.subject,
                    subjectGroup: record.subjectGroup,
                    percentageAbsence: record.percentageAbsence,
                    warnings,
                  },
                ]
              : [],
          avbrudd: record.avbrudd,
          hasWarnings:
            record.percentageAbsence > threshold ? hasSubjectWarning : false,
          isAdult: isOver18(dobStr),
        })
      } else {
        const summary = summaryMap.get(key)!
        summary.maxPercentage = Math.max(
          summary.maxPercentage,
          record.percentageAbsence
        )
        summary.totalHours += record.hoursAbsence

        if (record.percentageAbsence > threshold) {
          const subjectExists = summary.subjects.some(
            s =>
              s.subjectGroup === record.subjectGroup &&
              s.subject === record.subject
          )
          if (!subjectExists) {
            summary.subjects.push({
              subject: record.subject,
              subjectGroup: record.subjectGroup,
              percentageAbsence: record.percentageAbsence,
              warnings,
            })
          }
          if (hasSubjectWarning) summary.hasWarnings = true
        }

        summary.avbrudd = summary.avbrudd || record.avbrudd
        if (!summary.isAdult && dobStr) summary.isAdult = isOver18(dobStr)
      }
    })

    return Array.from(summaryMap.values())
  }, [data, selectedClasses, threshold])

  const atRiskStudents = useMemo(() => {
    return studentSummaries
      .filter(s => s.subjects.length > 0)
      .sort((a, b) => {
        if (a.avbrudd !== b.avbrudd) return a.avbrudd ? 1 : -1
        return b.maxPercentage - a.maxPercentage
      })
  }, [studentSummaries])

  if (atRiskStudents.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
            <span className="text-2xl">✓</span>
          </div>
        </div>
        <p className="text-slate-600 text-lg font-medium">Great news!</p>
        <p className="text-slate-500">
          No students exceed the {threshold.toFixed(1)}% absence threshold
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">
          At-Risk Students ({atRiskStudents.length})
        </h2>
        <span className="text-sm text-slate-600">
          Threshold: {threshold.toFixed(1)}%
        </span>
      </div>

      <div className="space-y-3">
        {atRiskStudents.map(student => {
          const cardKey = `${student.className}-${student.navn}`
          const isExpanded = expandedKey === cardKey
          const warningTypesCount = student.subjects.reduce(
            (count, subjectEntry) => count + subjectEntry.warnings.length,
            0
          )

          return (
            <div key={cardKey}>
              <div
                className={`card p-4 border-l-4 transition-all ${
                  student.avbrudd
                    ? 'opacity-60 border-l-amber-400 bg-amber-50'
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
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          warningTypesCount > 0
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        Warnings found: {warningTypesCount}
                      </span>
                      {warningTypesCount > 0 && student.isAdult && (
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

                    <div className="mt-3">
                      <div className="space-y-2">
                        {student.subjects.map(subjectEntry => (
                          <div
                            key={`${subjectEntry.subjectGroup}-${subjectEntry.subject}`}
                            className="flex flex-col gap-1"
                          >
                            <span
                              className={`w-fit px-2 py-0.5 rounded text-xs font-medium ${
                                subjectEntry.percentageAbsence > 10
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {subjectEntry.subject} —{' '}
                              {subjectEntry.percentageAbsence.toFixed(1)}%
                            </span>
                            {subjectEntry.warnings.length > 0 && (
                              <div className="text-xs text-slate-600 pl-2 space-y-0.5">
                                {groupWarnings(subjectEntry.warnings).map(
                                  ([label, dates]) => (
                                    <div key={label}>
                                      <span className="font-semibold">
                                        {label}:
                                      </span>{' '}
                                      {dates.join(', ')}
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                            {subjectEntry.warnings.length === 0 && (
                              <div className="text-xs text-slate-400 pl-2">
                                No warning found for this subject
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      setExpandedKey(isExpanded ? null : cardKey)
                    }
                    className="ml-4 px-3 py-2 bg-sky-100 text-sky-700 rounded hover:bg-sky-200 transition-colors flex items-center space-x-1 shrink-0"
                  >
                    {isExpanded ? (
                      <X className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                    <span className="text-sm font-medium">
                      {isExpanded ? 'Close' : 'Details'}
                    </span>
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="border border-t-0 border-slate-200 rounded-b-lg overflow-hidden">
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
