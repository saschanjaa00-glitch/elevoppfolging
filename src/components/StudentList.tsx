import { useMemo, useState } from 'react'
import type { DataStore, StudentAbsenceSummary } from '../types'
import { Eye, X, Printer, FileText } from 'lucide-react'
import StudentDetail from './StudentDetail'
import { jsPDF } from 'jspdf'
import { BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'

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

const KONTAKTANSVARLIG_LAERER: Record<string, string[]> = {
  Anja: ['3STA', '3STB', '3STC', '3STD', '3STE', '3STF'],
  Christin: ['1STA', '1STB', '1STC', '1STD', '1STE', '1STF'],
  Sigurd: ['1STA', '2STA', '3STA', '1TID', '2TID', '3TID', '1TMT', '2TMT', '3TMT'],
  'Jørund': ['1IDA', '1IDB', '2IDA', '2IDB', '3IDA', '3IDB'],
  Siri: ['2STA', '2STB', '2STC', '2STD', '2STE', '2STF'],
}

const RADGIVER: Record<string, string[]> = {
  Lasse: ['1IDA', '1IDB', '2IDA', '2IDB', '3IDA', '3IDB', '1TMT', '2TMT', '3TMT'],
  Trond: ['1TID', '2TID', '3TID', '1STA', '1STB', '1STC', '2STA', '2STB', '3STA', '3STB', '3STC'],
  Trude: ['1STD', '1STE', '1STF', '2STC', '2STD', '2STE', '2STF', '3STD', '3STE', '3STF'],
}

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

  const ownerForClass = (className: string, mapping: Record<string, string[]>) => {
    const found = Object.entries(mapping).find(([, classes]) => classes.includes(className))
    return found?.[0] ?? 'Ukjent'
  }

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
            ? [{ subject: record.subject, subjectGroup: record.subjectGroup, teacher: record.teacher, percentageAbsence: record.percentageAbsence, warnings, grade }]
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
            summary.subjects.push({ subject: record.subject, subjectGroup: record.subjectGroup, teacher: record.teacher, percentageAbsence: record.percentageAbsence, warnings, grade })
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
        const classCompare = a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
        if (classCompare !== 0) return classCompare
        return a.navn.localeCompare(b.navn, 'nb-NO')
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

  const generateOppfolgingsark = (student: StudentAbsenceSummary) => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const pageH = 297
    const marginX = 14
    const usableW = pageW - marginX * 2
    let y = 16

    const kontaktansvarlig = ownerForClass(student.className, KONTAKTANSVARLIG_LAERER)
    const radgiver = ownerForClass(student.className, RADGIVER)
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

    const allSubjectEntries = getAllSubjectEntries(student)

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
    doc.text(`Klasse: ${student.className}`, marginX, y)
    y += 6
    doc.text(`Kontaktansvarlig lærer: ${kontaktansvarlig}`, marginX, y)
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
      ensureSpace(58)

      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.2)
      doc.rect(marginX, y, usableW, 52)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      const teacherText = subjectEntry.teacher ? ` (Lærer: ${subjectEntry.teacher})` : ''
      const headerLines = doc.splitTextToSize(`${subjectEntry.subject}${teacherText}`, usableW - 6)
      doc.text(headerLines, marginX + 3, y + 6)

      const headerLineCount = Array.isArray(headerLines) ? headerLines.length : 1
      const infoY = y + 6 + headerLineCount * 4

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(
        `Fravær: ${subjectEntry.percentageAbsence.toFixed(1)}%   |   Karakter: ${subjectEntry.grade ?? '-'}   |   Varsler: ${subjectEntry.warningCount}`,
        marginX + 3,
        infoY
      )

      // Stor skriveboks under hvert fag.
      const boxY = infoY + 3
      const boxH = y + 52 - boxY - 3
      doc.rect(marginX + 3, boxY, usableW - 6, boxH)
      addMultilineField(
        `oppfolging_${student.className}_${student.navn.replace(/\s+/g, '_')}_${normalizeMatch(subjectEntry.subjectGroup)}`,
        marginX + 3,
        boxY,
        usableW - 6,
        boxH
      )

      y += 58
    })

    doc.save(`oppfolgingsark_${student.className}_${student.navn.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  const getAllSubjectEntries = (student: StudentAbsenceSummary) => {
    const studentRecords = data.absences.filter(
      r => r.class === student.className && normalizeMatch(r.navn) === normalizeMatch(student.navn)
    )

    const studentWarningMap = new Map<string, number>()
    data.warnings
      .filter(w => normalizeMatch(w.navn) === normalizeMatch(student.navn))
      .forEach(w => {
        const key = normalizeMatch(w.subjectGroup)
        studentWarningMap.set(key, (studentWarningMap.get(key) ?? 0) + 1)
      })

    const studentGradeMap = new Map<string, string>()
    data.grades
      .filter(g => normalizeMatch(g.navn) === normalizeMatch(student.navn))
      .forEach(g => {
        const halvar = g.halvår.toString().trim().toLowerCase()
        if (halvar === '1' || halvar.includes('1')) {
          const key = normalizeMatch(g.subjectGroup)
          if (!studentGradeMap.has(key)) studentGradeMap.set(key, g.grade)
        }
      })

    const allSubjectsMap = new Map<string, { subject: string; subjectGroup: string; teacher: string; percentageAbsence: number; grade?: string; warningCount: number }>()
    studentRecords.forEach(r => {
      const key = `${normalizeMatch(r.subject)}::${normalizeMatch(r.subjectGroup)}`
      const existing = allSubjectsMap.get(key)
      const warningCount = studentWarningMap.get(normalizeMatch(r.subjectGroup)) ?? 0
      const grade = studentGradeMap.get(normalizeMatch(r.subjectGroup))

      if (!existing || r.percentageAbsence > existing.percentageAbsence) {
        allSubjectsMap.set(key, {
          subject: r.subject,
          subjectGroup: r.subjectGroup,
          teacher: r.teacher,
          percentageAbsence: r.percentageAbsence,
          grade,
          warningCount,
        })
      }
    })

    return Array.from(allSubjectsMap.values()).sort((a, b) =>
      a.subject.localeCompare(b.subject, 'nb-NO')
    )
  }

  const generateOppfolgingsarkDocx = async (student: StudentAbsenceSummary) => {
    const kontaktansvarlig = ownerForClass(student.className, KONTAKTANSVARLIG_LAERER)
    const radgiver = ownerForClass(student.className, RADGIVER)
    const allSubjectEntries = getAllSubjectEntries(student)

    const sections: Array<Paragraph | Table> = [
      new Paragraph({ text: 'Oppfølgingsark', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: `Elev: ${student.navn}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Klasse: ${student.className}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Kontaktansvarlig lærer: ${kontaktansvarlig}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Rådgiver: ${radgiver}` })] }),
      new Paragraph({ text: '' }),
    ]

    allSubjectEntries.forEach(subjectEntry => {
      const teacherText = subjectEntry.teacher ? ` (Lærer: ${subjectEntry.teacher})` : ''
      const infoText = `Fravær: ${subjectEntry.percentageAbsence.toFixed(1)}%   |   Karakter: ${subjectEntry.grade ?? '-'}   |   Varsler: ${subjectEntry.warningCount}`

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
      sections.push(new Paragraph({ text: '' }))
    })

    const doc = new Document({
      sections: [{ children: sections }],
    })

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `oppfolgingsark_${student.className}_${student.navn.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`
    a.click()
    URL.revokeObjectURL(url)
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
                                  : subjectEntry.percentageAbsence >= 5
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
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
                      onClick={() => generateOppfolgingsark(student)}
                      className="px-3 py-2 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200 transition-colors flex items-center space-x-1"
                    >
                      <FileText className="w-4 h-4" />
                      <span className="text-sm font-medium">Oppfølgingsark</span>
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
