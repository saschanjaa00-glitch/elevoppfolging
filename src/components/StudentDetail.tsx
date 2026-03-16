import { useMemo } from 'react'
import type { DataStore } from '../types'
import { resolveTeacher } from '../teacherUtils'
import { createStudentInfoLookup, findStudentInfoInLookup, isNorskSubject, normalizeMatch, normalizeSubjectGroupKey } from '../studentInfoUtils'
import { compareDateStrings, formatDateDdMmYyyy, warningDateColorClass } from '../dateUtils'

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
  const normalizedSelectedStudent = useMemo(() => normalizeMatch(selectedStudent), [selectedStudent])
  const studentInfoLookup = useMemo(() => createStudentInfoLookup(data.studentInfo), [data.studentInfo])

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

  const studentRecords = useMemo(
    () => data.absences.filter(a => a.class === selectedClass && a.navn === selectedStudent),
    [data.absences, selectedClass, selectedStudent]
  )

  const warningsBySubjectGroup = useMemo(() => {
    const map = new Map<string, Array<{ warningType: string; sentDate: string }>>()
    data.warnings.forEach(w => {
      if (normalizeMatch(w.navn) !== normalizedSelectedStudent) return
      const key = normalizeSubjectGroupKey(w.subjectGroup)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ warningType: w.warningType, sentDate: w.sentDate })
    })
    return map
  }, [data.warnings, normalizedSelectedStudent])

  const gradeLookup = useMemo(() => {
    const gradeMap = new Map<string, string>()
    const subjectTeacherMap = new Map<string, string>()

    data.grades.forEach(g => {
      if (normalizeMatch(g.navn) !== normalizedSelectedStudent) return
      const key = normalizeSubjectGroupKey(g.subjectGroup)
      if (g.subjectTeacher && !subjectTeacherMap.has(key)) {
        subjectTeacherMap.set(key, g.subjectTeacher)
      }
      const halvar = g.halvår.toString().trim()
      if ((halvar === '1' || halvar.toLowerCase().includes('1')) && !gradeMap.has(key)) {
        gradeMap.set(key, g.grade)
      }
    })

    return { gradeMap, subjectTeacherMap }
  }, [data.grades, normalizedSelectedStudent])

  const studentInfo = useMemo(
    () => findStudentInfoInLookup(studentInfoLookup, selectedStudent, selectedClass),
    [studentInfoLookup, selectedStudent, selectedClass]
  )

  const subjectSummaries = useMemo(() => {
    if (studentRecords.length === 0) return []

    const subjectGroups = new Map<string, typeof studentRecords>()
    studentRecords.forEach(record => {
      if (!subjectGroups.has(record.subject)) {
        subjectGroups.set(record.subject, [])
      }
      subjectGroups.get(record.subject)!.push(record)
    })

    const summaries = Array.from(subjectGroups.entries())
      .map(([subject, records]) => {
        const topRecord = records.reduce((max, current) =>
          current.percentageAbsence > max.percentageAbsence ? current : max
        )

        const subjectWarnings = warningsBySubjectGroup.get(normalizeSubjectGroupKey(topRecord.subjectGroup)) ?? []
        const grade = gradeLookup.gradeMap.get(normalizeSubjectGroupKey(topRecord.subjectGroup))
        const teacher = resolveTeacher(subject, gradeLookup.subjectTeacherMap.get(normalizeSubjectGroupKey(topRecord.subjectGroup)) ?? topRecord.teacher)

        return {
          subject,
          records,
          topRecord,
          warnings: subjectWarnings,
          grade,
          teacher,
          noAbsenceData: false,
          showSidemalExemption: studentInfo?.sidemalExemption ?? false,
        }
      })
      .sort((a, b) => b.topRecord.percentageAbsence - a.topRecord.percentageAbsence)

    // Add Norwegian codes from vurderinger even when no fravær rows exist.
    const requiredNorskCodes = ['NOR1268', 'NOR1269']
    const norskDisplayNames: Record<string, string> = {
      NOR1268: 'Norsk sidemål',
      NOR1269: 'Norsk muntlig',
    }
    const existingSubjectGroupKeys = new Set(
      summaries.map(s => normalizeSubjectGroupKey(s.topRecord.subjectGroup))
    )

    const nor1267Record =
      studentRecords.find(r =>
        normalizeSubjectGroupKey(r.subjectGroup) === normalizeSubjectGroupKey('NOR1267')
      ) ??
      studentRecords.find(r =>
        normalizeMatch(r.subject).includes('norsk') && normalizeMatch(r.subject).includes('hoved')
      )

    const norskSupplement = requiredNorskCodes
      .filter(code => {
        const key = normalizeSubjectGroupKey(code)
        return gradeLookup.gradeMap.has(key) && !existingSubjectGroupKeys.has(key)
      })
      .map(code => {
        const subjectGroupKey = normalizeSubjectGroupKey(code)
        const displayName = norskDisplayNames[code] ?? code
        const teacher = resolveTeacher(
          code,
          gradeLookup.subjectTeacherMap.get(subjectGroupKey) ?? ''
        )
        const warnings = warningsBySubjectGroup.get(subjectGroupKey) ?? []

        const inheritedAbsence = nor1267Record?.percentageAbsence ?? 0
        const inheritedHours = nor1267Record?.hoursAbsence ?? 0
        const hasAbsenceData = nor1267Record !== undefined

        return {
          subject: displayName,
          records: [] as typeof studentRecords,
          topRecord: {
            navn: selectedStudent,
            class: selectedClass,
            subject: displayName,
            subjectGroup: code,
            percentageAbsence: inheritedAbsence,
            hoursAbsence: inheritedHours,
            teacher,
            avbrudd: false,
          },
          warnings,
          grade: gradeLookup.gradeMap.get(subjectGroupKey),
          teacher,
          noAbsenceData: !hasAbsenceData,
          showSidemalExemption: studentInfo?.sidemalExemption ?? false,
        }
      })

    if (norskSupplement.length > 0) {
      const insertAfterIndex = summaries.findIndex(s => {
        const lower = s.subject.toLowerCase()
        return lower.includes('norsk') && lower.includes('hoved')
      })

      if (insertAfterIndex >= 0) {
        summaries.splice(insertAfterIndex + 1, 0, ...norskSupplement)
      } else {
        const firstNorskIndex = summaries.findIndex(s => isNorskSubject(s.subject))
        if (firstNorskIndex >= 0) summaries.splice(firstNorskIndex + 1, 0, ...norskSupplement)
        else summaries.push(...norskSupplement)
      }
    }

    return summaries
  }, [studentRecords, warningsBySubjectGroup, gradeLookup, studentInfo, selectedStudent, selectedClass])

  if (studentRecords.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-600">Fant ikke elevdata</p>
      </div>
    )
  }

  return (
    <div className="bg-white divide-y divide-slate-100 py-1">
      {subjectSummaries.map(({ subject, topRecord: record, warnings, grade, teacher, noAbsenceData, showSidemalExemption }) => {
        const isAtRisk = !noAbsenceData && record.percentageAbsence > threshold
        const isHighRisk = !noAbsenceData && record.percentageAbsence > 10
        const isLowGrade = grade && ['1', '2', 'iv'].includes(grade.toLowerCase())

        return (
          <div key={subject} className="flex items-start justify-between px-4 py-3 gap-4 transition-colors hover:bg-slate-100">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900 truncate">{subject}</p>
              {!noAbsenceData && <p className="text-xs text-slate-500">{teacher}</p>}
              {!noAbsenceData && showSidemalExemption && isNorskSubject(subject) && (
                <div className="mt-1">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
                    Fritak sidemål
                  </span>
                </div>
              )}
              {!noAbsenceData && warnings.length > 0 && (
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
              {!noAbsenceData && (
                <>
                  <p className={`text-base font-bold ${isHighRisk ? 'text-red-600' : isAtRisk ? 'text-amber-600' : 'text-green-600'}`}>
                    {record.percentageAbsence.toFixed(1)}%
                  </p>
                  <p className="text-xs text-slate-500">{record.hoursAbsence.toFixed(0)}h</p>
                </>
              )}
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
