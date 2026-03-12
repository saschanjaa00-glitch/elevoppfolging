import { useMemo } from 'react'
import type { DataStore } from '../types'
import { resolveTeacher } from '../teacherUtils'
import { createStudentInfoLookup, findStudentInfoInLookup, isNorskSubject, normalizeMatch } from '../studentInfoUtils'

interface StudentDetailProps {
  data: DataStore
  selectedClass: string
  selectedStudent: string
  threshold: number
}

export default function StudentDetail({
  data,
  selectedClass,
  selectedStudent,
  threshold,
}: StudentDetailProps) {
  const studentInfoLookup = useMemo(() => createStudentInfoLookup(data.studentInfo), [data.studentInfo])

  const dateColor = (dateStr: string): string => {
    const m = dateStr.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-]\d{4}$/)
    if (!m) return ''
    const month = parseInt(m[2])
    if (month >= 8 && month <= 12) return 'text-blue-600 font-semibold'
    if (month >= 1 && month <= 4) return 'text-green-600 font-semibold'
    if (month >= 5 && month <= 6) return 'text-orange-500 font-semibold'
    return ''
  }

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

  const studentData = useMemo(() => {
    const records = data.absences.filter(
      a => a.class === selectedClass && a.navn === selectedStudent
    )

    const warnings = data.warnings.filter(
      w => normalizeMatch(w.navn) === normalizeMatch(selectedStudent)
    )

    // Term 1 grades and subject teachers keyed by subjectGroup
    const gradeMap = new Map<string, string>()
    const subjectTeacherMap = new Map<string, string>()
    data.grades.forEach(g => {
      if (normalizeMatch(g.navn) !== normalizeMatch(selectedStudent)) return
      const key = normalizeMatch(g.subjectGroup)
      if (g.subjectTeacher && !subjectTeacherMap.has(key)) {
        subjectTeacherMap.set(key, g.subjectTeacher)
      }
      const halvar = g.halvår.toString().trim()
      if ((halvar === '1' || halvar.toLowerCase().includes('1')) && !gradeMap.has(key)) {
        gradeMap.set(key, g.grade)
      }
    })

    const studentInfo = findStudentInfoInLookup(studentInfoLookup, selectedStudent, selectedClass)

    return { records, warnings, gradeMap, subjectTeacherMap, studentInfo }
  }, [data, selectedClass, selectedStudent, studentInfoLookup])

  if (studentData.records.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-600">Fant ikke elevdata</p>
      </div>
    )
  }

  const subjectGroups = new Map<string, typeof studentData.records>()
  studentData.records.forEach(record => {
    if (!subjectGroups.has(record.subject)) {
      subjectGroups.set(record.subject, [])
    }
    subjectGroups.get(record.subject)!.push(record)
  })

  const subjectSummaries = Array.from(subjectGroups.entries())
    .map(([subject, records]) => {
      const topRecord = records.reduce((max, current) =>
        current.percentageAbsence > max.percentageAbsence ? current : max
      )

      const subjectWarnings = studentData.warnings
        .filter(w => normalizeMatch(w.subjectGroup) === normalizeMatch(topRecord.subjectGroup))
        .map(w => ({ warningType: w.warningType, sentDate: w.sentDate }))

      const grade = studentData.gradeMap.get(normalizeMatch(topRecord.subjectGroup))
      const teacher = resolveTeacher(subject, studentData.subjectTeacherMap.get(normalizeMatch(topRecord.subjectGroup)) ?? topRecord.teacher)

      return {
        subject,
        records,
        topRecord,
        warnings: subjectWarnings,
        grade,
        teacher,
        showSidemalExemption: studentData.studentInfo?.sidemalExemption ?? false,
      }
    })
    .sort((a, b) => b.topRecord.percentageAbsence - a.topRecord.percentageAbsence)

  return (
    <div className="bg-white divide-y divide-slate-100 py-1">
      {subjectSummaries.map(({ subject, topRecord: record, warnings, grade, teacher, showSidemalExemption }) => {
        const isAtRisk = record.percentageAbsence > threshold
        const isHighRisk = record.percentageAbsence > 10
        const isLowGrade = grade && ['1', '2', 'iv'].includes(grade.toLowerCase())

        return (
          <div key={subject} className="flex items-start justify-between px-4 py-3 gap-4 transition-colors hover:bg-slate-100">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900 truncate">{subject}</p>
              <p className="text-xs text-slate-500">{teacher}</p>
              {showSidemalExemption && isNorskSubject(subject) && (
                <div className="mt-1">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
                    Fritak sidemål
                  </span>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                  {groupWarnings(warnings).map(([label, dates]) => (
                    <div key={label}>
                      <span className="font-semibold">{label}:</span>{' '}
                      {dates.map((d, i) => (
                        <span key={i} className={dateColor(d)}>{d}{i < dates.length - 1 ? ', ' : ''}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="text-right shrink-0 space-y-1">
              <p className={`text-base font-bold ${isHighRisk ? 'text-red-600' : isAtRisk ? 'text-amber-600' : 'text-green-600'}`}>
                {record.percentageAbsence.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500">{record.hoursAbsence.toFixed(0)}h</p>
              {grade && (
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${isLowGrade ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-600'}`}>
                  T1: {grade}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
