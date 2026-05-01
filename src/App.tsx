import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { resolveTeacher } from './teacherUtils'
import {
  buildStudentSubjectKey,
  createAbsenceSubjectClassLookup,
  createStudentInfoLookup,
  findStudentInfoInLookup,
  getDisplayClassName,
  isNorskSubject,
  normalizeMatch,
  normalizeSubjectGroupKey,
  resolveClassFromSubjectLookup,
} from './studentInfoUtils'
import { compareDateStrings, formatDateDdMmYyyy, parseFlexibleDate, todayDdMmYyyy } from './dateUtils'
import DatePicker, { registerLocale } from 'react-datepicker'
import { nb } from 'date-fns/locale/nb'
import 'react-datepicker/dist/react-datepicker.css'
registerLocale('nb', nb)
import FileUpload from './components/FileUpload'
import ClassSelector from './components/ClassSelector'
import StudentList from './components/StudentList'
import type { DataStore, PresetRecord } from './types'
import './index.css'

const loadStatsView = () => import('./components/StatsView')
const loadInnsiktView = () => import('./components/InnsiktView')
const loadFaginnsiktView = () => import('./components/FaginnsiktView')

const StatsView = lazy(loadStatsView)
const InnsiktView = lazy(loadInnsiktView)
const FaginnsiktView = lazy(loadFaginnsiktView)

type AppTab = 'elever' | 'statistikk' | 'faginnsikt' | 'innsikt'

const IDLE_TIMEOUT_MS = 45 * 60 * 1000

const TAB_PREFETCH_ORDER: Record<AppTab, Array<{ key: string; load: () => Promise<unknown> }>> = {
  elever: [
    { key: 'statistikk', load: loadStatsView },
    { key: 'faginnsikt', load: loadFaginnsiktView },
    { key: 'innsikt', load: loadInnsiktView },
  ],
  statistikk: [
    { key: 'faginnsikt', load: loadFaginnsiktView },
    { key: 'innsikt', load: loadInnsiktView },
  ],
  faginnsikt: [
    { key: 'statistikk', load: loadStatsView },
    { key: 'innsikt', load: loadInnsiktView },
  ],
  innsikt: [
    { key: 'statistikk', load: loadStatsView },
    { key: 'faginnsikt', load: loadFaginnsiktView },
  ],
}

function App() {
  const [data, setData] = useState<DataStore>({
    absences: [],
    warnings: [],
    grades: [],
    studentInfo: [],
  })

  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [presets, setPresets] = useState<PresetRecord[]>([])
  const [absenceThreshold, setAbsenceThreshold] = useState<number>(5)
  const [thresholdEnabled, setThresholdEnabled] = useState<boolean>(true)
  const [noFilter, setNoFilter] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<AppTab>('elever')
  const [studentSearch, setStudentSearch] = useState<string>('')
  const [kontaktlaererSearch, setKontaktlaererSearch] = useState<string>('')
  const [faglaererSearch, setFaglaererSearch] = useState<string>('')
  const [missingWarningsOnly, setMissingWarningsOnly] = useState<boolean>(false)
  const [warnedOnVurdering, setWarnedOnVurdering] = useState<boolean>(false)
  const [vurderingFromDate, setVurderingFromDate] = useState<string>('')
  const [oversiktModalOpen, setOversiktModalOpen] = useState<boolean>(false)
  const [lowGradeFilter, setLowGradeFilter] = useState<string[]>(['IV', '1', '2'])
  const [filterLogic, setFilterLogic] = useState<'og' | 'eller'>('eller')
  const [fullRapport, setFullRapport] = useState<boolean>(false)
  const [fullRapportInclude2, setFullRapportInclude2] = useState<boolean>(false)
  const [idleRemainingMs, setIdleRemainingMs] = useState<number>(IDLE_TIMEOUT_MS)
  const [preOverrideFilters, setPreOverrideFilters] = useState<{
    studentSearch: string
    lowGradeFilter: string[]
    fullRapport: boolean
    fullRapportInclude2: boolean
  } | null>(null)
  const studentInfoLookup = useMemo(() => createStudentInfoLookup(data.studentInfo), [data.studentInfo])
  const absenceSubjectClassLookup = useMemo(
    () => createAbsenceSubjectClassLookup(data.absences),
    [data.absences]
  )
  const idleDeadlineRef = useRef<number | null>(null)

  const clearImportedData = () => {
    setData({ absences: [], warnings: [], grades: [], studentInfo: [] })
    setSelectedClasses([])
    setActiveTab('elever')
    setStudentSearch('')
    setKontaktlaererSearch('')
    setFaglaererSearch('')
    setMissingWarningsOnly(false)
    setWarnedOnVurdering(false)
    setVurderingFromDate('')
    setPreOverrideFilters(null)
    setIdleRemainingMs(IDLE_TIMEOUT_MS)
    idleDeadlineRef.current = null
  }

  const handleDataImport = (importedData: DataStore) => {
    setData(importedData)
    const allClasses = Array.from(new Set(importedData.absences.map(a => a.class))).sort()
    setSelectedClasses(allClasses)
  }

  const hasData = data.absences.length > 0
  const isNameSearchActive = studentSearch.trim().length > 0
  const filtersDisabled = isNameSearchActive || noFilter
  const prefetchedChunks = useRef<Set<string>>(new Set())
  const idleCountdownLabel = useMemo(() => {
    const totalSeconds = Math.max(0, Math.ceil(idleRemainingMs / 1000))
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
    const seconds = String(totalSeconds % 60).padStart(2, '0')
    return `${minutes}:${seconds}`
  }, [idleRemainingMs])

  const effectiveThreshold = isNameSearchActive ? 0 : (thresholdEnabled ? absenceThreshold : 0)

  const missingWarningsStats = useMemo(() => {
    if (selectedClasses.length === 0) return { count: 0, teacherCount: 0 }
    const selectedSet = new Set(selectedClasses)
    const warningMap = new Map<string, number>()
    data.warnings.forEach(w => {
      const key = buildStudentSubjectKey(w.navn, w.class, w.subjectGroup)
      warningMap.set(key, (warningMap.get(key) ?? 0) + 1)
    })
    let count = 0
    const teachers = new Set<string>()
    const seen = new Set<string>()
    data.absences.forEach(r => {
      if (!selectedSet.has(r.class)) return
      const comboKey = buildStudentSubjectKey(r.navn, r.class, r.subjectGroup)
      if (seen.has(comboKey)) return
      seen.add(comboKey)
      if (r.percentageAbsence > effectiveThreshold && !(warningMap.get(comboKey) ?? 0)) {
        count++
        const teacherField = r.teacher?.trim()
        const kl = r.kontaktlaerer?.trim()
        const klNorm = kl ? normalizeMatch(kl) : ''
        if (teacherField) {
          const primaryTeacher = teacherField.split(',')[0].trim()
          if (primaryTeacher) {
            const norm = normalizeMatch(primaryTeacher)
            if (norm && norm !== klNorm) teachers.add(norm)
          }
        }
      }
    })
    return { count, teacherCount: teachers.size }
  }, [data.absences, data.warnings, selectedClasses, effectiveThreshold])

  const normalizeTeacherSearch = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const matchesTeacherNameSearch = (teacherName: string, query: string): boolean => {
    const normalizedQuery = normalizeTeacherSearch(query)
    if (!normalizedQuery) return true

    const queryTokens = normalizedQuery.split(' ').filter(Boolean)
    if (queryTokens.length === 0) return true

    const candidateTokens = normalizeTeacherSearch(teacherName).split(' ').filter(Boolean)
    return queryTokens.every(token => candidateTokens.some(candidate => candidate.includes(token)))
  }

  const kontaktlaererNames = useMemo(
    () =>
      Array.from(
        new Set(
          data.absences
            .map(a => a.kontaktlaerer?.trim())
            .filter((name): name is string => Boolean(name))
        )
      ).sort((a, b) => a.localeCompare(b, 'nb-NO')),
    [data.absences]
  )

  const faglaererNames = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...data.grades.map(g => g.subjectTeacher?.trim()),
            ...data.absences.map(a => a.teacher?.trim()),
          ].filter((name): name is string => Boolean(name))
        )
      ).sort((a, b) => a.localeCompare(b, 'nb-NO')),
    [data.grades, data.absences]
  )

  const kontaktlaererSuggestions = useMemo(() => {
    const query = kontaktlaererSearch.trim()
    if (!query) return []
    const matches = kontaktlaererNames.filter(name => matchesTeacherNameSearch(name, query))
    return matches.slice(0, 8)
  }, [kontaktlaererNames, kontaktlaererSearch])

  const faglaererSuggestions = useMemo(() => {
    const query = faglaererSearch.trim()
    if (!query) return []
    const matches = faglaererNames.filter(name => matchesTeacherNameSearch(name, query))
    return matches.slice(0, 8)
  }, [faglaererNames, faglaererSearch])

  useEffect(() => {
    if (!hasData) return

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const pending = TAB_PREFETCH_ORDER[activeTab].filter(({ key }) => !prefetchedChunks.current.has(key))
    if (pending.length === 0) return

    let timeoutId: number | null = null
    let idleId: number | null = null

    const prefetch = () => {
      pending.forEach(({ key, load }) => {
        prefetchedChunks.current.add(key)
        void load()
      })
    }

    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleId = idleWindow.requestIdleCallback(prefetch, { timeout: 1200 })
    } else {
      timeoutId = window.setTimeout(prefetch, 250)
    }

    return () => {
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleId)
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [activeTab, hasData])

  useEffect(() => {
    if (!hasData) {
      idleDeadlineRef.current = null
      setIdleRemainingMs(IDLE_TIMEOUT_MS)
      return
    }

    const resetIdleDeadline = () => {
      idleDeadlineRef.current = Date.now() + IDLE_TIMEOUT_MS
    }

    const updateRemaining = () => {
      const deadline = idleDeadlineRef.current
      if (!deadline) return

      const remaining = Math.max(0, deadline - Date.now())
      setIdleRemainingMs(remaining)

      if (remaining === 0) {
        clearImportedData()
      }
    }

    resetIdleDeadline()
    setIdleRemainingMs(IDLE_TIMEOUT_MS)

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'scroll',
      'touchstart',
      'mousemove',
    ]

    activityEvents.forEach(eventName => {
      window.addEventListener(eventName, resetIdleDeadline, { passive: true })
    })

    const intervalId = window.setInterval(updateRemaining, 1000)

    return () => {
      activityEvents.forEach(eventName => {
        window.removeEventListener(eventName, resetIdleDeadline)
      })
      window.clearInterval(intervalId)
    }
  }, [hasData])

  const ownerForClass = (className: string, mapping: Record<string, string[]>) => {
    const found = Object.entries(mapping).find(([, classes]) => classes.includes(className))
    return found?.[0] ?? 'Ukjent'
  }

  const presetRoleMappings = useMemo(() => {
    const result: Record<string, Record<string, string[]>> = {}
    presets.forEach(p => {
      if (!result[p.rolle]) result[p.rolle] = {}
      result[p.rolle][p.navn] = p.klasser
    })
    return result
  }, [presets])

  const ownerForClassByRole = (className: string, role: string) => {
    const mapping = presetRoleMappings[role]
    if (!mapping) return 'Ukjent'
    return ownerForClass(className, mapping)
  }

  const groupWarnings = (warnings: Array<{ warningType: string; sentDate: string }>) => {
    const order = (label: string) => (label === 'Fravær' ? 0 : label === 'Grunnlag' ? 1 : 2)
    const grouped = new Map<string, string[]>()

    warnings.forEach(warning => {
      const type = warning.warningType.toLowerCase()
      const label = type.includes('frav') ? 'Fravær' : type.includes('vurdering') || type.includes('grunnlag') ? 'Grunnlag' : warning.warningType
      if (!grouped.has(label)) grouped.set(label, [])
      if (warning.sentDate) grouped.get(label)!.push(formatDateDdMmYyyy(warning.sentDate))
    })

    grouped.forEach((dates, label) => {
      grouped.set(label, [...dates].sort((a, b) => compareDateStrings(a, b)))
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

    const explicitKontaktlaerer = studentRecords.find(r => r.kontaktlaerer?.trim())?.kontaktlaerer?.trim()
    const teacherCountsForStudent = new Map<string, number>()
    studentRecords.forEach(record => {
      const teacher = record.teacher?.trim()
      if (!teacher) return
      teacherCountsForStudent.set(teacher, (teacherCountsForStudent.get(teacher) ?? 0) + 1)
    })
    const kontaktlaerer = explicitKontaktlaerer ??
      Array.from(teacherCountsForStudent.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Ukjent'

    const subjectTeacherMap = new Map<string, string>()
    const gradeMap = new Map<string, string>()
    const gradeMapT2 = new Map<string, string>()
    data.grades
      .filter(g => normalizeMatch(g.navn) === normalizeMatch(navn))
      .forEach(g => {
        const resolvedClass = g.class?.trim() || resolveClassFromSubjectLookup(absenceSubjectClassLookup, g.navn, g.subjectGroup)
        if (resolvedClass !== className) return
        const subjectKey = normalizeSubjectGroupKey(g.subjectGroup)
        if (g.subjectTeacher && subjectKey && !subjectTeacherMap.has(subjectKey)) {
          subjectTeacherMap.set(subjectKey, g.subjectTeacher)
        }
        const halvar = g.halvår.toString().trim().toLowerCase()
        const isT1 = halvar === '1' || halvar.includes('1')
        const isT2 = !isT1 && (halvar === '2' || halvar.includes('2'))
        if (isT1 && !gradeMap.has(subjectKey)) gradeMap.set(subjectKey, g.grade)
        if (isT2 && !gradeMapT2.has(subjectKey)) gradeMapT2.set(subjectKey, g.grade)
      })

    const warningMap = new Map<string, Array<{ warningType: string; sentDate: string }>>()
    data.warnings
      .filter(w => normalizeMatch(w.navn) === normalizeMatch(navn) && w.class === className)
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
      gradeT2?: string
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
          gradeT2: gradeMapT2.get(subjectGroupKey),
          warningCount: warnings.length,
          warnings,
          showSidemalExemption: matchedStudentInfo?.sidemalExemption ?? false,
        })
      }
    })

    return {
      kontaktlaerer,
      studentInfo: matchedStudentInfo,
      radgiver: ownerForClassByRole(className, 'Rådgiver'),
      subjects: Array.from(subjectsMap.values()).sort((a, b) =>
        a.subject.localeCompare(b.subject, 'nb-NO')
      ),
    }
  }

  const handleExportClassOppfolgingsark = async () => {
    if (selectedClasses.length === 0) return

    const {
      BorderStyle,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    } = await import('docx')

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

    const children: Array<any> = []

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
        const gradeText = `T1: ${subject.grade ?? '-'}${subject.gradeT2 ? `   |   T2: ${subject.gradeT2}` : ''}`
        const infoText = `Fravær: ${subject.percentageAbsence.toFixed(1)}%   |   Karakter: ${gradeText}   |   Varsler: ${subject.warningCount}${sidemalText}`
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

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `oppfolgingsark_${selectedClasses.join('-')}_${todayDdMmYyyy()}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handlePrintClassLists = async () => {
    if (selectedClasses.length === 0) return

    const {
      BorderStyle,
      Document,
      HeadingLevel,
      HeightRule,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    } = await import('docx')

    const rowsPerPage = 35
    const children: Array<any> = []
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

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `klasselister_${orderedClasses.join('-')}_${todayDdMmYyyy()}.docx`
    a.click()
    URL.revokeObjectURL(url)
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
            <div className="text-right">
              <p className="text-sm text-slate-600">
                Fraværs- og oppfølgingsverktøy for elever
              </p>
              {hasData && (
                <p className="text-xs font-medium text-slate-500 mt-1">
                  Autotømmer ved inaktivitet om {idleCountdownLabel}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!hasData ? (
          <FileUpload onDataImport={handleDataImport} onPresetImport={setPresets} />
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
                onClick={() => setActiveTab('faginnsikt')}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                  activeTab === 'faginnsikt'
                    ? 'text-sky-700 border-b-2 border-sky-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Faginnsikt
              </button>
              <button
                onClick={() => setActiveTab('innsikt')}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                  activeTab === 'innsikt'
                    ? 'text-sky-700 border-b-2 border-sky-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Lærerinnsikt
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setOversiktModalOpen(true)}
                  className="px-4 py-2 text-sm font-medium text-emerald-700 hover:text-emerald-900 transition-colors"
                >
                  Generer oppfølgingsoversikt
                </button>
                <button
                  onClick={clearImportedData}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 font-medium transition-colors"
                >
                  Last opp nye filer
                </button>
              </div>
            </div>

            {activeTab === 'statistikk' && (
              <Suspense fallback={<div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 text-slate-600">Laster statistikk...</div>}>
                <StatsView data={data} threshold={thresholdEnabled ? absenceThreshold : 0} />
              </Suspense>
            )}
            {activeTab === 'faginnsikt' && (
              <Suspense fallback={<div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 text-slate-600">Laster faginnsikt...</div>}>
                <FaginnsiktView data={data} />
              </Suspense>
            )}
            {activeTab === 'innsikt' && (
              <Suspense fallback={<div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 text-slate-600">Laster laererinnsikt...</div>}>
                <InnsiktView data={data} threshold={thresholdEnabled ? absenceThreshold : 0} />
              </Suspense>
            )}
            {activeTab === 'elever' && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <aside className="lg:col-span-1 no-print">
                  {/* Presets */}
                  {/* Dynamic preset buttons grouped by role */}
                  {presets.length > 0 && Object.entries(presetRoleMappings).map(([role, nameMap]) => (
                    <div key={role} className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 mb-4">
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">{role}</h3>
                      <div className="space-y-2">
                        {Object.entries(nameMap)
                          .sort(([a], [b]) => a.localeCompare(b, 'nb-NO'))
                          .map(([name, klasser]) => (
                          <button
                            key={`${name}-${role}`}
                            onClick={() => setSelectedClasses(klasser)}
                            className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-900 mb-2">
                          Kontaktlærer
                        </label>
                        <input
                          type="text"
                          placeholder="Søk navn..."
                          value={kontaktlaererSearch}
                          onChange={e => setKontaktlaererSearch(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                        />
                        {kontaktlaererSuggestions.length > 0 && (
                          <div className="mt-1.5 border border-emerald-100 rounded-lg bg-emerald-50 max-h-36 overflow-auto">
                            {kontaktlaererSuggestions.map(name => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => setKontaktlaererSearch(name)}
                                className="w-full text-left px-2.5 py-1.5 text-xs text-emerald-900 hover:bg-emerald-100"
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-900 mb-2">
                          Faglærer
                        </label>
                        <input
                          type="text"
                          placeholder="Søk navn..."
                          value={faglaererSearch}
                          onChange={e => setFaglaererSearch(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                        />
                        {faglaererSuggestions.length > 0 && (
                          <div className="mt-1.5 border border-emerald-100 rounded-lg bg-emerald-50 max-h-36 overflow-auto">
                            {faglaererSuggestions.map(name => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => setFaglaererSearch(name)}
                                className="w-full text-left px-2.5 py-1.5 text-xs text-emerald-900 hover:bg-emerald-100"
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Absence threshold + Karakter */}
                    <div className="flex flex-wrap items-end gap-6">
                      <div className="min-w-[18rem]">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => setThresholdEnabled(v => !v)}
                            disabled={filtersDisabled}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                              thresholdEnabled ? 'bg-sky-600' : 'bg-slate-300'
                            } ${filtersDisabled ? 'opacity-40 pointer-events-none' : ''}`}
                            aria-pressed={thresholdEnabled}
                          >
                            <span
                              className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                                thresholdEnabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <div className={`w-full sm:w-72 ${!thresholdEnabled || filtersDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
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
                                disabled={filtersDisabled}
                                className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                              />
                              <span className="text-lg font-semibold text-sky-600 min-w-12">
                                {absenceThreshold.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className={data.grades.length === 0 || filtersDisabled ? 'opacity-40 pointer-events-none' : ''}>
                        <label className="block text-sm font-medium text-slate-900 mb-2">
                          Filterlogikk
                        </label>
                        <div className={`flex rounded-lg border border-slate-300 overflow-hidden text-sm font-medium ${!thresholdEnabled || lowGradeFilter.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
                          <button
                            type="button"
                            onClick={() => setFilterLogic('eller')}
                            disabled={data.grades.length === 0 || filtersDisabled}
                            className={`px-3 py-2 transition-colors ${filterLogic === 'eller' ? 'bg-sky-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                          >
                            ELLER
                          </button>
                          <button
                            type="button"
                            onClick={() => setFilterLogic('og')}
                            disabled={data.grades.length === 0 || filtersDisabled}
                            className={`px-3 py-2 border-l border-slate-300 transition-colors ${filterLogic === 'og' ? 'bg-sky-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                          >
                            OG
                          </button>
                        </div>
                      </div>

                      <div className={data.grades.length === 0 || filtersDisabled ? 'opacity-40 pointer-events-none' : ''}>
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
                              disabled={data.grades.length === 0 || fullRapport || filtersDisabled}
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
                    </div>

                    {/* Secondary actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                      </div>
                  </div>

                    <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center gap-3 justify-between">
                      <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => {
                          const next = !missingWarningsOnly
                          if (next) {
                            setWarnedOnVurdering(false)
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
                          setMissingWarningsOnly(next)
                        }}
                        disabled={filtersDisabled}
                        className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                          missingWarningsOnly
                            ? 'bg-orange-300 text-orange-900 border-orange-300 hover:bg-orange-400'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        } ${filtersDisabled ? 'opacity-40 pointer-events-none' : ''}`}
                      >
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle size={15} />
                          Vis manglende varsler
                          {missingWarningsOnly && missingWarningsStats.count > 0 && (
                            <span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold rounded-full bg-orange-500 text-white">
                              {missingWarningsStats.count}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          const next = !warnedOnVurdering
                          if (next) {
                            setMissingWarningsOnly(false)
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
                          setWarnedOnVurdering(next)
                        }}
                        disabled={filtersDisabled}
                        className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                          warnedOnVurdering
                            ? 'bg-orange-300 text-orange-900 border-orange-300 hover:bg-orange-400'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        } ${filtersDisabled ? 'opacity-40 pointer-events-none' : ''}`}
                      >
                        <span className="flex items-center gap-1.5">
                          Varslet på vurderingsgrunnlag
                        </span>
                      </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-600">Varsel sendt etter:</span>
                        <DatePicker
                          selected={vurderingFromDate ? parseFlexibleDate(vurderingFromDate) : null}
                          onChange={(date: Date | null) => setVurderingFromDate(date ? date.toISOString().split('T')[0] : '')}
                          dateFormat="dd.MM.yyyy"
                          placeholderText="dd.mm.åååå"
                          locale="nb"
                          isClearable
                          className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                    </div>

                  </div>

                  {selectedClasses.length > 0 && (
                    <StudentList
                      data={data}
                      selectedClasses={selectedClasses}
                      threshold={isNameSearchActive ? 0 : (thresholdEnabled ? absenceThreshold : 0)}
                      studentSearch={studentSearch}
                      kontaktlaererSearch={kontaktlaererSearch}
                      faglaererSearch={faglaererSearch}
                      missingWarningsOnly={isNameSearchActive ? false : missingWarningsOnly}
                      warnedOnVurdering={isNameSearchActive ? false : warnedOnVurdering}
                      vurderingFromDate={vurderingFromDate}
                      lowGradeFilter={isNameSearchActive ? [] : lowGradeFilter}
                      filterLogic={filterLogic}
                      fullRapport={isNameSearchActive ? false : fullRapport}
                      fullRapportInclude2={isNameSearchActive ? false : fullRapportInclude2}
                      noFilter={isNameSearchActive ? true : noFilter}
                      presets={presets}
                      oversiktModalOpen={oversiktModalOpen}
                      onOversiktModalClose={() => setOversiktModalOpen(false)}
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
