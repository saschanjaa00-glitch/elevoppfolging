import { useMemo } from 'react'
import type { DataStore } from '../types'
import { resolveTeacher } from '../teacherUtils'
import {
  createAbsenceSubjectClassLookup,
  createStudentInfoLookup,
  findStudentInfoInLookup,
  isNorskSubject,
  normalizeMatch,
  normalizeSubjectGroupKey,
  resolveClassFromSubjectLookup,
} from '../studentInfoUtils'
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
  const absenceSubjectClassLookup = useMemo(
    () => createAbsenceSubjectClassLookup(data.absences),
    [data.absences]
  )

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
      if (w.class !== selectedClass) return
      if (normalizeMatch(w.navn) !== normalizedSelectedStudent) return
      const key = normalizeSubjectGroupKey(w.subjectGroup)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ warningType: w.warningType, sentDate: w.sentDate })
    })
    return map
  }, [data.warnings, normalizedSelectedStudent])

  const gradeLookup = useMemo(() => {
    const gradeMap = new Map<string, string>()
    const gradeMapT2 = new Map<string, string>()
    const subjectTeacherMap = new Map<string, string>()

    data.grades.forEach(g => {
      const resolvedClass = g.class?.trim() || resolveClassFromSubjectLookup(absenceSubjectClassLookup, g.navn, g.subjectGroup)
      if (resolvedClass !== selectedClass) return
      if (normalizeMatch(g.navn) !== normalizedSelectedStudent) return
      const key = normalizeSubjectGroupKey(g.subjectGroup)
      if (g.subjectTeacher && !subjectTeacherMap.has(key)) {
        subjectTeacherMap.set(key, g.subjectTeacher)
      }
      const halvar = g.halvår.toString().trim().toLowerCase()
      const isT1 = halvar === '1' || halvar.includes('1')
      const isT2 = !isT1 && (halvar === '2' || halvar.includes('2'))
      if (isT1 && !gradeMap.has(key)) gradeMap.set(key, g.grade)
      if (isT2 && !gradeMapT2.has(key)) gradeMapT2.set(key, g.grade)
    })

    return { gradeMap, gradeMapT2, subjectTeacherMap }
  }, [data.grades, normalizedSelectedStudent, absenceSubjectClassLookup, selectedClass])

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
        const gradeT2 = gradeLookup.gradeMapT2.get(normalizeSubjectGroupKey(topRecord.subjectGroup))
        const teacher = resolveTeacher(subject, gradeLookup.subjectTeacherMap.get(normalizeSubjectGroupKey(topRecord.subjectGroup)) ?? topRecord.teacher)

        return {
          subject,
          records,
          topRecord,
          warnings: subjectWarnings,
          grade,
          gradeT2,
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
        return (gradeLookup.gradeMap.has(key) || gradeLookup.gradeMapT2.has(key)) && !existingSubjectGroupKeys.has(key)
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
          gradeT2: gradeLookup.gradeMapT2.get(subjectGroupKey),
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
      {subjectSummaries.map(({ subject, topRecord: record, warnings, grade, gradeT2, teacher, noAbsenceData, showSidemalExemption }) => {
        const isAtRisk = !noAbsenceData && record.percentageAbsence > threshold
        const isHighRisk = !noAbsenceData && record.percentageAbsence > 10
        const isLowGrade = grade && ['1', '2', 'iv'].includes(grade.toLowerCase())
        const isLowGradeT2 = gradeT2 && ['1', '2', 'iv'].includes(gradeT2.toLowerCase())

        return (
          <div
            key={subject}
            className={`flex items-start justify-between px-4 py-3 gap-4 transition-colors hover:bg-slate-50 ${
              isHighRisk ? 'border-l-2 border-red-400' : isAtRisk ? 'border-l-2 border-amber-400' : 'border-l-2 border-transparent'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 truncate text-sm">{subject}</p>
              {!noAbsenceData && <p className="text-xs text-slate-400 mt-0.5">{teacher}</p>}
              {!noAbsenceData && showSidemalExemption && isNorskSubject(subject) && (
                <div className="mt-1.5">
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                    Fritak sidemål
                  </span>
                </div>
              )}
              {!noAbsenceData && warnings.length > 0 && (
                <div className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                  {groupWarnings(warnings).map(([label, dates]) => (
                    <div key={label}>
                      <span className="font-semibold text-slate-600">{label}:</span>{' '}
                      {dates.map((d, i) => (
                        <span key={i} className={dateColor(d)}>{d}{i < dates.length - 1 ? ', ' : ''}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-1">
              {!noAbsenceData && (
                <>
                  <p className={`text-base font-bold tabular-nums ${isHighRisk ? 'text-red-600' : isAtRisk ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {record.percentageAbsence.toFixed(1)}%
                  </p>
                  <p className="text-xs text-slate-400">{record.hoursAbsence.toFixed(0)}t</p>
                </>
              )}
              <div className="flex flex-wrap gap-1 justify-end">
                {grade && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isLowGrade ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' : 'bg-slate-100 text-slate-500'}`}>
                    T1: {grade}
                  </span>
                )}
                {gradeT2 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isLowGradeT2 ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' : 'bg-slate-100 text-slate-500'}`}>
                    T2: {gradeT2}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
