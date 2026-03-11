import { useMemo, useState } from 'react'
import type { DataStore, StudentAbsenceSummary } from '../types'
import { Eye, X, Printer } from 'lucide-react'
import StudentDetail from './StudentDetail'
import { jsPDF } from 'jspdf'

interface StudentListProps {
  data: DataStore
  selectedClasses: string[]
  threshold: number
  studentSearch: string
  missingWarningsOnly: boolean
  lowGradeFilter: string[]
  fullRapport: boolean
  fullRapportInclude2: boolean
}

const LOW_GRADES = ['IV', '1', '2']

export default function StudentList({
  data,
  selectedClasses,
  threshold,
  studentSearch,
  missingWarningsOnly,
  lowGradeFilter,
  fullRapport,
  fullRapportInclude2,
}: StudentListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const normalizeMatch = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')

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

  const studentSummaries = useMemo(() => {
    const selectedClassSet = new Set(selectedClasses)
    const classData = data.absences.filter(a => selectedClassSet.has(a.class))

    const warningMap = new Map<string, Array<{ warningType: string; sentDate: string }>>()
    const studentDobMap = new Map<string, string>()
    data.warnings.forEach(warning => {
      const key = `${normalizeMatch(warning.navn)}::${normalizeMatch(warning.subjectGroup)}`
      if (!warningMap.has(key)) warningMap.set(key, [])
      warningMap.get(key)!.push({ warningType: warning.warningType, sentDate: warning.sentDate })
      if (warning.dateOfBirth)
        studentDobMap.set(normalizeMatch(warning.navn), warning.dateOfBirth)
    })

    // Grade map: student+subjectGroup -> term 1 grade
    const gradeMap = new Map<string, string>()
    data.grades.forEach(g => {
      const halvar = g.halvår.toString().trim()
      if (halvar === '1' || halvar.toLowerCase().includes('1')) {
        const key = `${normalizeMatch(g.navn)}::${normalizeMatch(g.subjectGroup)}`
        if (!gradeMap.has(key)) gradeMap.set(key, g.grade)
      }
    })

    const effectiveLowGrades = fullRapport
      ? (fullRapportInclude2 ? ['IV', '1', '2'] : ['IV', '1'])
      : LOW_GRADES

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
      const warningKey = `${normalizeMatch(record.navn)}::${normalizeMatch(record.subjectGroup)}`
      const warnings = warningMap.get(warningKey) ?? []
      const hasSubjectWarning = warnings.length > 0
      const dobStr = studentDobMap.get(normalizeMatch(record.navn)) ?? ''
      const grade = gradeMap.get(warningKey)

      if (!summaryMap.has(key)) {
        const includeSubject = record.percentageAbsence > threshold ||
          (fullRapport && grade !== undefined && effectiveLowGrades.includes(grade))
        summaryMap.set(key, {
          navn: record.navn,
          className: record.class,
          maxPercentage: record.percentageAbsence,
          totalHours: record.hoursAbsence,
          subjects: includeSubject
            ? [{ subject: record.subject, subjectGroup: record.subjectGroup, percentageAbsence: record.percentageAbsence, warnings, grade }]
            : [],
          avbrudd: record.avbrudd,
          hasWarnings: includeSubject ? hasSubjectWarning : false,
          isAdult: isOver18(dobStr),
        })
      } else {
        const summary = summaryMap.get(key)!
        summary.maxPercentage = Math.max(summary.maxPercentage, record.percentageAbsence)
        summary.totalHours += record.hoursAbsence

        const includeSubject = record.percentageAbsence > threshold ||
          (fullRapport && grade !== undefined && effectiveLowGrades.includes(grade))
        if (includeSubject) {
          const subjectExists = summary.subjects.some(
            s => s.subjectGroup === record.subjectGroup && s.subject === record.subject
          )
          if (!subjectExists) {
            summary.subjects.push({ subject: record.subject, subjectGroup: record.subjectGroup, percentageAbsence: record.percentageAbsence, warnings, grade })
          }
          if (hasSubjectWarning) summary.hasWarnings = true
        }

        summary.avbrudd = summary.avbrudd || record.avbrudd
        if (!summary.isAdult && dobStr) summary.isAdult = isOver18(dobStr)
      }
    })

    return Array.from(summaryMap.values())
  }, [data, selectedClasses, threshold, fullRapport, fullRapportInclude2])

  const atRiskStudents = useMemo(() => {
    const searchNorm = studentSearch.toLowerCase().trim()
    return studentSummaries
      .filter(s => s.subjects.length > 0)
      .filter(s => !searchNorm || s.navn.toLowerCase().includes(searchNorm))
      .map(s => {
        if (fullRapport) return s
        let subjects = s.subjects
        if (missingWarningsOnly) subjects = subjects.filter(sub => sub.warnings.length === 0)
        if (lowGradeFilter.length > 0) subjects = subjects.filter(sub => sub.grade !== undefined && lowGradeFilter.includes(sub.grade))
        return { ...s, subjects }
      })
      .filter(s => {
        if (fullRapport) return true
        if (missingWarningsOnly && s.subjects.length === 0) return false
        if (lowGradeFilter.length > 0 && s.subjects.length === 0) return false
        return true
      })
      .sort((a, b) => {
        if (a.avbrudd !== b.avbrudd) return a.avbrudd ? 1 : -1
        return b.maxPercentage - a.maxPercentage
      })
  }, [studentSummaries, studentSearch, missingWarningsOnly, lowGradeFilter, fullRapport, fullRapportInclude2])

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

  const generatePDF = () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const pageH = 297
    const marginX = 14
    const usableW = pageW - marginX * 2
    let y = 14

    const checkPageBreak = (needed: number) => {
      if (y + needed > pageH - 14) {
        doc.addPage()
        y = 14
      }
    }

    // Header
    doc.setFillColor(2, 132, 199)
    doc.rect(0, 0, pageW, 18, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(255, 255, 255)
    doc.text('Oppfølging - Risikoutsatte elever', marginX, 11)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(
      `Klasser: ${selectedClasses.join(', ')}   |   Grense: ${threshold.toFixed(1)}%   |   ${atRiskStudents.length} elever   |   ${new Date().toLocaleDateString('nb-NO')}`,
      marginX, 16
    )
    y = 24
    doc.setTextColor(0, 0, 0)

    atRiskStudents.forEach(student => {
      const subjectLines = student.subjects.reduce((acc, s) => {
        return acc + 1 + groupWarnings(s.warnings).length
      }, 0)
      const cardHeight = 10 + subjectLines * 5 + 4

      checkPageBreak(cardHeight + 3)

      const cardY = y
      const isAvbrudd = student.avbrudd

      // Card background + left stripe
      doc.setFillColor(isAvbrudd ? 255 : 255, isAvbrudd ? 251 : 255, isAvbrudd ? 235 : 255)
      doc.rect(marginX, cardY, usableW, cardHeight, 'F')
      doc.setFillColor(isAvbrudd ? 245 : 239, isAvbrudd ? 158 : 68, isAvbrudd ? 11 : 68)
      doc.rect(marginX, cardY, 2.5, cardHeight, 'F')
      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.2)
      doc.rect(marginX, cardY, usableW, cardHeight)

      // Student name
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(15, 23, 42)
      doc.text(student.navn, marginX + 5, cardY + 6)

      // Class badge
      let badgeX = marginX + 5 + doc.getTextWidth(student.navn) + 3
      doc.setFillColor(241, 245, 249)
      doc.roundedRect(badgeX, cardY + 2, doc.getTextWidth(student.className) + 4, 5, 1, 1, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(71, 85, 105)
      doc.text(student.className, badgeX + 2, cardY + 5.8)
      badgeX += doc.getTextWidth(student.className) + 8

      // Warning count badge
      const warningCount = student.subjects.reduce((c, s) => c + s.warnings.length, 0)
      if (warningCount > 0) {
        const wLabel = `Varsler: ${warningCount}`
        doc.setFillColor(254, 226, 226)
        doc.roundedRect(badgeX, cardY + 2, doc.getTextWidth(wLabel) + 4, 5, 1, 1, 'F')
        doc.setTextColor(185, 28, 28)
        doc.text(wLabel, badgeX + 2, cardY + 5.8)
        badgeX += doc.getTextWidth(wLabel) + 8
      }

      // 18+ badge
      if (student.isAdult && warningCount > 0) {
        doc.setFillColor(237, 233, 254)
        doc.roundedRect(badgeX, cardY + 2, 12, 5, 1, 1, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(109, 40, 217)
        doc.text('18+', badgeX + 2, cardY + 5.8)
        badgeX += 15
      }

      // Avbrudd badge
      if (isAvbrudd) {
        const abLabel = 'Avbrudd'
        doc.setFillColor(254, 215, 170)
        doc.roundedRect(badgeX, cardY + 2, doc.getTextWidth(abLabel) + 4, 5, 1, 1, 'F')
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(120, 53, 15)
        doc.text(abLabel, badgeX + 2, cardY + 5.8)
      }

      // Subjects
      let subY = cardY + 11
      student.subjects.forEach(subjectEntry => {
        const isHighRisk = subjectEntry.percentageAbsence > 10
        const subjectLabel = `${subjectEntry.subject} — ${subjectEntry.percentageAbsence.toFixed(1)}%`
        const maxLabelW = usableW - 14
        const truncated = doc.splitTextToSize(subjectLabel, maxLabelW)[0]
        const labelW = Math.min(doc.getTextWidth(subjectLabel) + 4, maxLabelW + 4)

        doc.setFontSize(8)
        doc.setFillColor(isHighRisk ? 254 : 255, isHighRisk ? 226 : 251, isHighRisk ? 226 : 235)
        doc.roundedRect(marginX + 5, subY - 3.5, labelW, 5, 1, 1, 'F')
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(isHighRisk ? 185 : 146, isHighRisk ? 28 : 64, isHighRisk ? 28 : 14)
        doc.text(truncated, marginX + 7, subY)
        subY += 5

        groupWarnings(subjectEntry.warnings).forEach(([label, dates]) => {
          doc.setFontSize(7.5)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(100, 116, 139)
          doc.text(`${label}: ${dates.join(', ')}`, marginX + 10, subY)
          subY += 4.5
        })
      })

      y = cardY + cardHeight + 3
    })

    doc.save(`oppfolging_${selectedClasses.join('-')}_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <div className="space-y-4">
      {/* Print header — only visible when printing */}
      <div className="print-header hidden">
        <h1 className="text-lg font-bold text-slate-900">Oppfølging - Risikoutsatte elever</h1>
        <p className="text-xs text-slate-600">
          Klasser: {selectedClasses.join(', ')} &nbsp;|&nbsp; Grense: {threshold.toFixed(1)}% &nbsp;|&nbsp; {atRiskStudents.length} elever &nbsp;|&nbsp; {new Date().toLocaleDateString('nb-NO')}
        </p>
      </div>

      <div className="flex items-center justify-between no-print">
        <h2 className="text-xl font-bold text-slate-900">
          Risikoutsatte elever ({atRiskStudents.length})
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">
            Grense: {threshold.toFixed(1)}%
          </span>
          <button
            onClick={generatePDF}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Eksporter PDF
          </button>
        </div>
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
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          warningTypesCount > 0
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        Varsler funnet: {warningTypesCount}
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
                            {subjectEntry.grade && ['1', '2', 'iv'].includes(subjectEntry.grade.toLowerCase()) && (
                              <span className="w-fit px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-800">
                                Karakter T1: {subjectEntry.grade}
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
                            {subjectEntry.warnings.length === 0 && (
                              <div className="text-xs text-slate-400 pl-2">
                                Ingen varsel funnet for dette faget
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
                    className="no-print ml-4 px-3 py-2 bg-sky-100 text-sky-700 rounded hover:bg-sky-200 transition-colors flex items-center space-x-1 shrink-0"
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
