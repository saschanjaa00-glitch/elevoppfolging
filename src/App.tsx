import { useMemo, useState } from 'react'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { BorderStyle, Document, HeadingLevel, HeightRule, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { resolveTeacher } from './teacherUtils'
import { createStudentInfoLookup, findStudentInfoInLookup, getDisplayClassName, isNorskSubject, normalizeMatch, normalizeSubjectGroupKey } from './studentInfoUtils'
import FileUpload from './components/FileUpload'
import ClassSelector from './components/ClassSelector'
import StudentList from './components/StudentList'
import StatsView from './components/StatsView'
import InnsiktView from './components/InnsiktView'
import type { DataStore } from './types'
import './index.css'

const RADGIVER: Record<string, string[]> = {
  Lasse: ['1IDA', '1IDB', '2IDA', '2IDB', '3IDA', '3IDB', '1TMT', '2TMT', '3TMT'],
  Trond: ['1TID', '2TID', '3TID', '1STA', '1STB', '1STC', '2STA', '2STB', '3STA', '3STB', '3STC'],
  Trude: ['1STD', '1STE', '1STF', '2STC', '2STD', '2STE', '2STF', '3STD', '3STE', '3STF'],
}

function App() {
  const [data, setData] = useState<DataStore>({
    absences: [],
    warnings: [],
    grades: [],
    studentInfo: [],
  })

  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [absenceThreshold, setAbsenceThreshold] = useState<number>(8)
  const [thresholdEnabled, setThresholdEnabled] = useState<boolean>(true)
  const [noFilter, setNoFilter] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<'elever' | 'statistikk' | 'innsikt'>('elever')
  const [studentSearch, setStudentSearch] = useState<string>('')
  const [missingWarningsOnly, setMissingWarningsOnly] = useState<boolean>(false)
  const [lowGradeFilter, setLowGradeFilter] = useState<string[]>(['IV', '1', '2'])
  const [fullRapport, setFullRapport] = useState<boolean>(false)
  const [fullRapportInclude2, setFullRapportInclude2] = useState<boolean>(false)
  const [preOverrideFilters, setPreOverrideFilters] = useState<{
    studentSearch: string
    lowGradeFilter: string[]
    fullRapport: boolean
    fullRapportInclude2: boolean
  } | null>(null)
  const studentInfoLookup = useMemo(() => createStudentInfoLookup(data.studentInfo), [data.studentInfo])

  const handleDataImport = (importedData: DataStore) => {
    setData(importedData)
    const allClasses = Array.from(new Set(importedData.absences.map(a => a.class))).sort()
    setSelectedClasses(allClasses)
  }

  const hasData = data.absences.length > 0

  const ownerForClass = (className: string, mapping: Record<string, string[]>) => {
    const found = Object.entries(mapping).find(([, classes]) => classes.includes(className))
    return found?.[0] ?? 'Ukjent'
  }

  const groupWarnings = (warnings: Array<{ warningType: string; sentDate: string }>) => {
    const parseDMY = (d: string) => {
      const m = d.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/)
      return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0
    }
    const order = (label: string) => (label === 'Fravær' ? 0 : label === 'Grunnlag' ? 1 : 2)
    const grouped = new Map<string, string[]>()

    warnings.forEach(warning => {
      const type = warning.warningType.toLowerCase()
      const label = type.includes('frav') ? 'Fravær' : type.includes('vurdering') || type.includes('grunnlag') ? 'Grunnlag' : warning.warningType
      if (!grouped.has(label)) grouped.set(label, [])
      if (warning.sentDate) grouped.get(label)!.push(warning.sentDate)
    })

    grouped.forEach((dates, label) => {
      grouped.set(label, [...dates].sort((a, b) => parseDMY(a) - parseDMY(b)))
    })

    return Array.from(grouped.entries()).sort(([a], [b]) => order(a) - order(b))
  }

  const formatWarningSummary = (warnings: Array<{ warningType: string; sentDate: string }>) => {
    const grouped = groupWarnings(warnings)
    if (grouped.length === 0) return 'Ingen varsler sendt'
    return grouped
      .map(([label, dates]) => `${label === 'Fravær' ? 'F' : label === 'Grunnlag' ? 'G' : label}: ${dates.join(', ')}`)
      .join('   |   ')
  }

  const getStudentSheetData = (className: string, navn: string) => {
    const studentRecords = data.absences.filter(
      r => r.class === className && normalizeMatch(r.navn) === normalizeMatch(navn)
    )
    const matchedStudentInfo = findStudentInfoInLookup(studentInfoLookup, navn, className)

    const teacherCountsForStudent = new Map<string, number>()
    studentRecords.forEach(record => {
      const teacher = record.teacher?.trim()
      if (!teacher) return
      teacherCountsForStudent.set(teacher, (teacherCountsForStudent.get(teacher) ?? 0) + 1)
    })
    const kontaktlaerer =
      Array.from(teacherCountsForStudent.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Ukjent'

    const subjectTeacherMap = new Map<string, string>()
    const gradeMap = new Map<string, string>()
    data.grades
      .filter(g => normalizeMatch(g.navn) === normalizeMatch(navn))
      .forEach(g => {
        const subjectKey = normalizeSubjectGroupKey(g.subjectGroup)
        if (g.subjectTeacher && subjectKey && !subjectTeacherMap.has(subjectKey)) {
          subjectTeacherMap.set(subjectKey, g.subjectTeacher)
        }
        const halvar = g.halvår.toString().trim().toLowerCase()
        if ((halvar === '1' || halvar.includes('1')) && !gradeMap.has(subjectKey)) {
          gradeMap.set(subjectKey, g.grade)
        }
      })

    const warningMap = new Map<string, Array<{ warningType: string; sentDate: string }>>()
    data.warnings
      .filter(w => normalizeMatch(w.navn) === normalizeMatch(navn))
      .forEach(w => {
        const key = normalizeSubjectGroupKey(w.subjectGroup)
        if (!warningMap.has(key)) warningMap.set(key, [])
        warningMap.get(key)!.push({ warningType: w.warningType, sentDate: w.sentDate })
      })

    const subjectsMap = new Map<string, {
      subject: string
      subjectGroup: string
      teacher: string
      percentageAbsence: number
      grade?: string
      warningCount: number
      warnings: Array<{ warningType: string; sentDate: string }>
      showSidemalExemption: boolean
    }>()

    studentRecords.forEach(record => {
      const key = `${normalizeMatch(record.subject)}::${normalizeMatch(record.subjectGroup)}`
      const subjectGroupKey = normalizeSubjectGroupKey(record.subjectGroup)
      const existing = subjectsMap.get(key)
      const warnings = warningMap.get(subjectGroupKey) ?? []
      if (!existing || record.percentageAbsence > existing.percentageAbsence) {
        subjectsMap.set(key, {
          subject: record.subject,
          subjectGroup: record.subjectGroup,
          teacher: subjectTeacherMap.get(subjectGroupKey) ?? record.teacher,
          percentageAbsence: record.percentageAbsence,
          grade: gradeMap.get(subjectGroupKey),
          warningCount: warnings.length,
          warnings,
          showSidemalExemption: matchedStudentInfo?.sidemalExemption ?? false,
        })
      }
    })

    return {
      kontaktlaerer,
      studentInfo: matchedStudentInfo,
      radgiver: ownerForClass(className, RADGIVER),
      subjects: Array.from(subjectsMap.values()).sort((a, b) =>
        a.subject.localeCompare(b.subject, 'nb-NO')
      ),
    }
  }

  const handleExportClassOppfolgingsark = () => {
    if (selectedClasses.length === 0) return

    const students = Array.from(
      new Map(
        data.absences
          .filter(record => selectedClasses.includes(record.class))
          .map(record => [`${record.class}::${normalizeMatch(record.navn)}`, { className: record.class, navn: record.navn }])
      ).values()
    ).sort((a, b) => {
      const classCompare = a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
      if (classCompare !== 0) return classCompare
      return a.navn.localeCompare(b.navn, 'nb-NO')
    })

    const children: Array<Paragraph | Table> = []

    students.forEach((student, index) => {
      const { kontaktlaerer, radgiver, subjects, studentInfo } = getStudentSheetData(student.className, student.navn)
      const displayClassName = getDisplayClassName(student.className, studentInfo?.programArea)

      children.push(
        new Paragraph({
          text: 'Oppfølgingsark',
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: index > 0,
        }),
        new Paragraph({ children: [new TextRun({ text: `Elev: ${student.navn}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Klasse: ${displayClassName}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Kontaktlærer: ${kontaktlaerer}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Rådgiver: ${radgiver}` })] }),
        new Paragraph({ text: '' })
      )

      subjects.forEach(subject => {
        const teacherText = subject.teacher ? ` (Lærer: ${resolveTeacher(subject.subject, subject.teacher)})` : ''
        const sidemalText = subject.showSidemalExemption && isNorskSubject(subject.subject)
          ? '   |   Fritak sidemål'
          : ''
        const infoText = `Fravær: ${subject.percentageAbsence.toFixed(1)}%   |   Karakter: ${subject.grade ?? '-'}   |   Varsler: ${subject.warningCount}${sidemalText}`
        const warningText = `Varselbrev sendt: ${formatWarningSummary(subject.warnings)}`
        children.push(
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
                      new Paragraph({ children: [new TextRun({ text: `${subject.subject}${teacherText}`, bold: true })] }),
                      new Paragraph({ text: infoText }),
                      new Paragraph({ text: warningText }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        )
      })

      children.push(
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
                    new Paragraph({ children: [new TextRun({ text: 'Andre notater', bold: true })] }),
                    new Paragraph({ text: '' }),
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
    })

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: 'Calibri',
            },
          },
        },
      },
      sections: [{ children }],
    })

    void Packer.toBlob(doc).then(blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `oppfolgingsark_${selectedClasses.join('-')}_${new Date().toISOString().slice(0, 10)}.docx`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const handlePrintClassLists = () => {
    if (selectedClasses.length === 0) return

    const rowsPerPage = 35
    const children: Array<Paragraph | Table> = []
    const orderedClasses = [...selectedClasses].sort((a, b) =>
      a.localeCompare(b, 'nb-NO', { numeric: true })
    )

    let isFirstPage = true

    orderedClasses.forEach(className => {
      const students = Array.from(
        new Map(
          data.absences
            .filter(record => record.class === className)
            .map(record => [normalizeMatch(record.navn), record.navn.trim()])
        ).values()
      ).sort((a, b) => a.localeCompare(b, 'nb-NO'))

      const pageCount = Math.max(1, Math.ceil(students.length / rowsPerPage))

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const pageStudents = students.slice(
          pageIndex * rowsPerPage,
          (pageIndex + 1) * rowsPerPage
        )

        const rowCount = Math.max(1, pageStudents.length)
        const tableAreaTwips = 12600
        const rowHeightTwips = Math.max(340, Math.min(900, Math.floor(tableAreaTwips / rowCount)))

        children.push(
          new Paragraph({
            text:
              pageCount > 1
                ? `Klasseliste ${className} (${pageIndex + 1}/${pageCount})`
                : `Klasseliste ${className}`,
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: !isFirstPage,
            spacing: { after: 120 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: pageStudents.map(name =>
              new TableRow({
                height: {
                  value: rowHeightTwips,
                  rule: HeightRule.EXACT,
                },
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
                        children: [new TextRun({ text: name, size: 22 })],
                        spacing: { before: 0, after: 0 },
                      }),
                    ],
                  }),
                ],
              })
            ),
          })
        )

        isFirstPage = false
      }
    })

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: 'Calibri',
              size: 22,
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 720,
                right: 720,
                bottom: 720,
                left: 720,
              },
            },
          },
          children,
        },
      ],
    })

    void Packer.toBlob(doc).then(blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `klasselister_${orderedClasses.join('-')}_${new Date().toISOString().slice(0, 10)}.docx`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const handleResetFilters = () => {
    setAbsenceThreshold(8)
    setThresholdEnabled(true)
    setNoFilter(false)
    setStudentSearch('')
    setMissingWarningsOnly(false)
    setLowGradeFilter(['IV', '1', '2'])
    setFullRapport(false)
    setFullRapportInclude2(false)
    setPreOverrideFilters(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Header */}
      <header className="no-print border-b border-slate-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-sky-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">Ø</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Oppfølging</h1>
            </div>
            <p className="text-sm text-slate-600">
              Fraværs- og oppfølgingsverktøy for elever
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!hasData ? (
          <FileUpload onDataImport={handleDataImport} />
        ) : (
          <div className="space-y-6">
            {/* Top bar */}
            <div className="flex items-center border-b border-slate-200 pb-2 gap-1">
              <button
                onClick={() => setActiveTab('elever')}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                  activeTab === 'elever'
                    ? 'text-sky-700 border-b-2 border-sky-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Elever
              </button>
              <button
                onClick={() => setActiveTab('statistikk')}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                  activeTab === 'statistikk'
                    ? 'text-sky-700 border-b-2 border-sky-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Statistikk
              </button>
              <button
                onClick={() => setActiveTab('innsikt')}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                  activeTab === 'innsikt'
                    ? 'text-sky-700 border-b-2 border-sky-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Innsikt
              </button>
              <button
                onClick={() => {
                  setData({ absences: [], warnings: [], grades: [], studentInfo: [] })
                  setSelectedClasses([])
                }}
                className="ml-auto px-4 py-2 text-slate-600 hover:text-slate-900 font-medium transition-colors"
              >
                Last opp nye filer
              </button>
            </div>

            {activeTab === 'statistikk' ? (
              <StatsView data={data} />
            ) : activeTab === 'innsikt' ? (
              <InnsiktView data={data} />
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <aside className="lg:col-span-1 no-print">
                  {/* Presets */}
                  <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                      Avdelingsleder
                    </h3>
                    <div className="space-y-2">
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '3STA', '3STB', '3STC', '3STD', '3STE', '3STF',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Anja
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1STA', '1STB', '1STC', '1STD', '1STE', '1STF',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Christin
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1STA', '2STA', '3STA',
                            '1TID', '2TID', '3TID',
                            '1TMT', '2TMT', '3TMT',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Sigurd
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1IDA', '1IDB', '2IDA', '2IDB', '3IDA', '3IDB',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Jørund
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '2STA', '2STB', '2STC', '2STD', '2STE', '2STF',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Siri
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                      Rådgiver
                    </h3>
                    <div className="space-y-2">
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1IDA', '1IDB', '2IDA', '2IDB', '3IDA', '3IDB',
                            '1TMT', '2TMT', '3TMT',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Lasse
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1TID', '2TID', '3TID',
                            '1STA', '1STB', '1STC',
                            '2STA', '2STB',
                            '3STA', '3STB', '3STC',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Trond
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1STD', '1STE', '1STF',
                            '2STC', '2STD', '2STE', '2STF',
                            '3STD', '3STE', '3STF',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Trude
                      </button>
                    </div>
                  </div>

                  <ClassSelector
                    data={data}
                    selectedClasses={selectedClasses}
                    onClassChange={setSelectedClasses}
                    onPrintClassLists={handlePrintClassLists}
                    onExportOppfolgingsark={handleExportClassOppfolgingsark}
                  />
                </aside>

                <section className="lg:col-span-3 space-y-6">
                  <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 space-y-4">
                    {/* Student search */}
                    <div>
                      <label className="block text-sm font-medium text-slate-900 mb-2">
                        Søk elev
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Navn..."
                          value={studentSearch}
                          onChange={e => setStudentSearch(e.target.value)}
                          className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                        />
                        <button
                          onClick={() => setNoFilter(v => !v)}
                          className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                            noFilter
                              ? 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          Ingen filter
                        </button>
                      </div>
                    </div>

                    {/* Absence threshold + Karakter */}
                    <div className="flex flex-wrap items-end gap-6">
                      <div className="min-w-[18rem]">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => setThresholdEnabled(v => !v)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                              thresholdEnabled ? 'bg-sky-600' : 'bg-slate-300'
                            }`}
                            aria-pressed={thresholdEnabled}
                          >
                            <span
                              className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                                thresholdEnabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <div className={`w-full sm:w-72 ${ !thresholdEnabled ? 'opacity-40 pointer-events-none' : '' }`}>
                            <label className="block text-sm font-medium text-slate-900 mb-1">
                              Fraværsgrense (%)
                            </label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="range"
                                min="0"
                                max="20"
                                step="0.5"
                                value={absenceThreshold}
                                onChange={e =>
                                  setAbsenceThreshold(parseFloat(e.target.value))
                                }
                                className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                              />
                              <span className="text-lg font-semibold text-sky-600 min-w-12">
                                {absenceThreshold.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className={data.grades.length === 0 ? 'opacity-40 pointer-events-none' : ''}>
                        <label className={`block text-sm font-medium mb-2 ${fullRapport ? 'text-slate-400' : 'text-slate-900'}`}>
                          Karakter
                          {data.grades.length === 0 && <span className="ml-2 text-xs font-normal text-slate-500">(ingen karakterfil importert)</span>}
                        </label>
                        <div className={`flex gap-2 ${fullRapport ? 'opacity-40 pointer-events-none' : ''}`}>
                          {(['IV', '1', '2', '3', '4', '5', '6'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() =>
                                setLowGradeFilter(prev =>
                                  prev.includes(opt) ? prev.filter(g => g !== opt) : [...prev, opt]
                                )
                              }
                              disabled={data.grades.length === 0 || fullRapport}
                              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                lowGradeFilter.includes(opt)
                                  ? 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="ml-auto self-end">
                        <button
                          onClick={handleResetFilters}
                          className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          Tilbakestill filter
                        </button>
                      </div>
                    </div>

                    {/* Secondary actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                      </div>
                  </div>

                    <div className="border-t border-slate-100 pt-3">
                      <button
                        onClick={() => {
                          setMissingWarningsOnly(prev => {
                            const next = !prev
                            if (next) {
                              setPreOverrideFilters({ studentSearch, lowGradeFilter, fullRapport, fullRapportInclude2 })
                              setStudentSearch('')
                              setLowGradeFilter([])
                              setFullRapport(false)
                              setFullRapportInclude2(false)
                            } else if (preOverrideFilters) {
                              setStudentSearch(preOverrideFilters.studentSearch)
                              setLowGradeFilter(preOverrideFilters.lowGradeFilter)
                              setFullRapport(preOverrideFilters.fullRapport)
                              setFullRapportInclude2(preOverrideFilters.fullRapportInclude2)
                              setPreOverrideFilters(null)
                            }
                            return next
                          })
                        }}
                        className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                          missingWarningsOnly
                            ? 'bg-orange-300 text-orange-900 border-orange-300 hover:bg-orange-400'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle size={15} />
                          {missingWarningsOnly ? 'Vis manglende varsler' : 'Vis manglende varsler'}
                        </span>
                      </button>
                    </div>

                  </div>

                  {selectedClasses.length > 0 && (
                    <StudentList
                      data={data}
                      selectedClasses={selectedClasses}
                      threshold={thresholdEnabled ? absenceThreshold : 0}
                      studentSearch={studentSearch}
                      missingWarningsOnly={missingWarningsOnly}
                      lowGradeFilter={lowGradeFilter}
                      fullRapport={fullRapport}
                      fullRapportInclude2={fullRapportInclude2}
                      noFilter={noFilter}
                    />
                  )}

                  {selectedClasses.length === 0 && (
                    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-12 text-center">
                      <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-slate-600">
                        Velg én eller flere klasser for å vise elevlisten
                      </p>
                    </div>
                  )}
                </section>
              </div>
            )}

          </div>
        )}
      </main>
    </div>
  )
}

export default App
