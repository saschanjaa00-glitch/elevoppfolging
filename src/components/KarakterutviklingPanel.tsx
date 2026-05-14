import { useMemo, useRef, useState, type RefObject } from 'react'
import * as XLSX from 'xlsx'
import { ChevronDown, ChevronRight, Upload, X, Expand } from 'lucide-react'
import type { AbsenceRecord, GradeRecord, StudentGender, StudentInfoRecord } from '../types'
import { getFagnavn } from '../fagkodeLookup'
import {
  buildStudentClassKey,
  createAbsenceSubjectClassLookup,
  createStudentInfoLookup,
  resolveClassFromSubjectLookup,
} from '../studentInfoUtils'

type ViewMode = 'subject' | 'teacher'

interface Props {
  baseGrades: GradeRecord[]
  studentInfo: StudentInfoRecord[]
  absences: AbsenceRecord[]
}

interface TrendRow {
  key: string
  label: string
  yearly: Record<string, { avg: number; count: number }>
  yearlyH1: Record<string, { avg: number; count: number }>
  yearlyH2: Record<string, { avg: number; count: number }>
  termSeries: Record<string, { avg: number; count: number }>
}

interface SubjectTeacherRow extends TrendRow {
  teacher: string
}

interface GraphSeries {
  name: string
  values: Record<string, { avg: number; count: number }>
  color: string
  isMainLine?: boolean
  dashed?: boolean
  connectTo?: string
  excludeFromRangeBand?: boolean
}

const TEACHER_SERIES_COLORS = ['#f97316', '#16a34a', '#a855f7', '#e11d48', '#14b8a6', '#f59e0b', '#7c3aed', '#65a30d']
const GENDER_SERIES: Record<StudentGender, { label: string; color: string }> = {
  girl: { label: 'Jenter', color: '#e11d48' },
  boy: { label: 'Gutter', color: '#0284c7' },
}

const normalizeHeader = (header: string): string =>
  header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')

const getRowValue = (row: Record<string, unknown>, aliases: string[]): string => {
  const headers = Object.keys(row)
  const normalizedAliases = aliases.map(a => normalizeHeader(a))
  const header = headers.find(h => normalizedAliases.includes(normalizeHeader(h)))
  const value = header ? row[header] : ''
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

const parseGradeFile = async (file: File): Promise<GradeRecord[]> => {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer)
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]) as Record<string, unknown>[]

  const parsed = sheet
    .map(row => ({
      navn: getRowValue(row, ['elev', 'navn', 'student']),
      class: getRowValue(row, ['klasse', 'klassegruppe', 'class']) || undefined,
      subjectGroup: getRowValue(row, ['gruppe', 'group', 'faggruppe']),
      fagkode: getRowValue(row, ['fagkode']),
      grade: getRowValue(row, ['grade', 'karakter']).toUpperCase(),
      subjectTeacher: getRowValue(row, ['subject teacher', 'faglærer', 'faglaerer', 'lærer', 'larer', 'teacher']) || undefined,
      halvår: getRowValue(row, ['halvår', 'halvar', 'termin', 'term']),
      skoleår: getRowValue(row, ['skoleår', 'skolear', 'school year', 'schoolyear']) || undefined,
    }))
    .filter(r => r.navn && r.fagkode && r.grade)

  const topSkoleår = parsed
    .map(r => r.skoleår?.replace(/[^0-9A-Za-z]/g, '') ?? '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))[0]

  return parsed.map(r => ({
    ...r,
    skoleår: (r.skoleår?.replace(/[^0-9A-Za-z]/g, '') || topSkoleår || undefined),
  }))
}

const gradeToNumeric = (grade: string): number | null => {
  const normalized = grade.trim().toUpperCase()
  if (normalized === 'IV') return null
  const num = Number(normalized.replace(',', '.'))
  if (!Number.isFinite(num)) return null
  if (num < 1 || num > 6) return null
  return num
}

const sortSchoolYears = (years: string[]): string[] =>
  [...years].sort((a, b) => {
    const aNum = Number(a.slice(0, 4))
    const bNum = Number(b.slice(0, 4))
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum
    return a.localeCompare(b, 'nb-NO')
  })

const formatSchoolYearLabel = (year: string): string => {
  const digits = year.replace(/[^0-9]/g, '')
  if (digits.length >= 8) {
    return `${digits.slice(2, 4)}-${digits.slice(6, 8)}`
  }
  return year
}

const formatCompactSchoolYearLabel = (year: string): string => {
  const digits = year.replace(/[^0-9]/g, '')
  if (digits.length >= 8) {
    return `${digits.slice(2, 4)}-${digits.slice(6, 8)}`
  }
  if (digits.length === 6) {
    return `${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  }
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}`
  }
  return formatSchoolYearLabel(year)
}

const normalizeHalvaar = (value: string | undefined): 'H1' | 'H2' | null => {
  const normalized = normalizeHeader(value ?? '')
  if (!normalized) return null
  if (normalized === 'h1' || normalized === '1' || normalized.includes('halvar1') || normalized.includes('termin1') || normalized.includes('t1')) return 'H1'
  if (normalized === 'h2' || normalized === '2' || normalized.includes('halvar2') || normalized.includes('termin2') || normalized.includes('t2')) return 'H2'
  return null
}

const addAggregate = (
  bucket: Record<string, { avg: number; count: number }>,
  key: string,
  numeric: number
) => {
  const existing = bucket[key]
  if (!existing) {
    bucket[key] = { avg: numeric, count: 1 }
    return
  }
  const total = existing.avg * existing.count + numeric
  const count = existing.count + 1
  bucket[key] = { avg: total / count, count }
}

function TrendGraph({
  labels,
  series,
  width = 560,
  height = 180,
  svgRef,
  labelMap,
  xAxisLabelFilter,
}: {
  labels: string[]
  series: GraphSeries[]
  width?: number
  height?: number
  svgRef?: RefObject<SVGSVGElement | null>
  labelMap?: Record<string, string>
  xAxisLabelFilter?: (label: string) => boolean
}) {
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null)
  const [pinnedSeries, setPinnedSeries] = useState<Set<string>>(new Set())
  const padX = 42
  const padY = 24

  // Compute y-axis range from actual data
  const allAvgs = series.flatMap(s => Object.values(s.values).map(v => v.avg))
  const dataMin = allAvgs.length > 0 ? Math.min(...allAvgs) : 1
  const dataMax = allAvgs.length > 0 ? Math.max(...allAvgs) : 6
  const yMin = Math.max(1, Math.floor((dataMin - 1.5) * 2) / 2)
  const yMax = Math.min(6, Math.ceil(dataMax + 0.5))
  const yRange = yMax - yMin || 1

  // Generate grid tick values at 0.5 intervals within range
  const yTicks: number[] = []
  for (let v = yMin; v <= yMax + 0.001; v += 0.5) {
    yTicks.push(Math.round(v * 10) / 10)
  }

  const toY = (avg: number) => padY + ((yMax - avg) / yRange) * (height - padY * 2)

  const seriesPoints = series.map(s => ({
    ...s,
    points: labels
      .map((label, idx) => {
        const avg = s.values[label]?.avg
        if (avg === undefined) return null
        const x = padX + (idx * (width - padX * 2)) / Math.max(1, labels.length - 1)
        const y = toY(avg)
        return { x, y, label, avg }
      })
      .filter((p): p is { x: number; y: number; label: string; avg: number } => Boolean(p)),
  }))

  if (seriesPoints.every(s => s.points.length === 0)) {
    return <div className="text-sm text-slate-500">Ingen grafdata for denne raden.</div>
  }

  // Per-label highest and lowest avg across non-main-line series (teacher overlays only)
  const teacherSeriesPoints = seriesPoints.filter(s => !s.isMainLine && !s.excludeFromRangeBand)
  const perLabelExtremes = new Map<string, { maxAvg: number; minAvg: number }>()
  teacherSeriesPoints.forEach(s => {
    s.points.forEach(p => {
      const cur = perLabelExtremes.get(p.label)
      if (!cur) {
        perLabelExtremes.set(p.label, { maxAvg: p.avg, minAvg: p.avg })
      } else {
        perLabelExtremes.set(p.label, {
          maxAvg: Math.max(cur.maxAvg, p.avg),
          minAvg: Math.min(cur.minAvg, p.avg),
        })
      }
    })
  })

  return (
    <div className="w-full overflow-x-auto">
      <svg ref={svgRef} width={width} height={height} className="bg-slate-50 rounded border border-slate-200">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#94a3b8" strokeWidth="1" />
        <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="#94a3b8" strokeWidth="1" />
        {yTicks.map(tick => {
          const y = toY(tick)
          const isWhole = Number.isInteger(tick)
          return (
            <g key={tick}>
              <line x1={padX} y1={y} x2={width - padX} y2={y} stroke={isWhole ? '#cbd5e1' : '#e2e8f0'} strokeWidth="1" />
              <text x={padX - 5} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                {tick % 1 === 0 ? tick.toFixed(0) : tick.toFixed(1)}
              </text>
            </g>
          )
        })}
        {seriesPoints.map((s) => {
          if (!s.connectTo || s.points.length === 0) return null
          const target = seriesPoints.find(t => t.name === s.connectTo)
          if (!target || target.points.length === 0) return null
          const labelIdx = (label: string) => labels.indexOf(label)
          const sLast = s.points[s.points.length - 1]
          const sFirst = s.points[0]
          const tLast = target.points[target.points.length - 1]
          const tFirst = target.points[0]
          // s ends before t starts
          if (labelIdx(sLast.label) < labelIdx(tFirst.label)) {
            return <line key={`bridge::${s.name}`} x1={sLast.x} y1={sLast.y} x2={tFirst.x} y2={tFirst.y} stroke="#64748b" strokeWidth="1.5" strokeDasharray="3 3" />
          }
          // t ends before s starts
          if (labelIdx(tLast.label) < labelIdx(sFirst.label)) {
            return <line key={`bridge::${s.name}`} x1={tLast.x} y1={tLast.y} x2={sFirst.x} y2={sFirst.y} stroke="#64748b" strokeWidth="1.5" strokeDasharray="3 3" />
          }
          return null
        })}
        {seriesPoints.map((s, seriesIdx) => {
          const isPinned = pinnedSeries.has(s.name)
          const isHovered = hoveredSeries === s.name
          const anyPinned = pinnedSeries.size > 0
          const anyHovered = hoveredSeries !== null
          const isActive = isPinned || isHovered
          const baseWidth = s.isMainLine ? 2.75 : 1.5
          const strokeWidth = isActive ? baseWidth + 2 : (anyPinned || anyHovered) ? baseWidth * 0.45 : baseWidth
          const opacity = (anyPinned || anyHovered) && !isActive ? 0.25 : 1
          return (
          <g key={s.name} style={{ opacity }}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={String(strokeWidth)}
              strokeDasharray={s.isMainLine && seriesIdx > 0 ? '6 3' : s.dashed ? '4 2' : undefined}
              points={s.points.map(p => `${p.x},${p.y}`).join(' ')}
            />
            {s.points.map(p => {
              const extremes = !s.isMainLine ? perLabelExtremes.get(p.label) : undefined
              const isHighest = extremes !== undefined && p.avg === extremes.maxAvg
              const isLowest = extremes !== undefined && p.avg === extremes.minAvg
              const showLabel = s.isMainLine || isHighest || isLowest
              const labelY = s.isMainLine
                ? p.y - 8
                : isLowest
                  ? p.y + 16
                  : p.y - 8
              return (
                <g key={`${s.name}::${p.label}`}>
                  <circle cx={p.x} cy={p.y} r={s.isMainLine ? '4' : '2.5'} fill={s.color} />
                  {showLabel && (
                    <text
                      x={p.x}
                      y={labelY}
                      textAnchor="middle"
                      fontSize={s.isMainLine ? '11' : '10'}
                      fill={s.isMainLine ? s.color : s.color}
                      fontWeight={s.isMainLine ? 'bold' : 'normal'}
                    >
                      {p.avg.toFixed(2).replace('.', ',')}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
          )
        })}
        {labels.map((label, idx) => {
          const x = padX + (idx * (width - padX * 2)) / Math.max(1, labels.length - 1)
          const showLabel = !xAxisLabelFilter || xAxisLabelFilter(label)
          const showDivider = !!xAxisLabelFilter && xAxisLabelFilter(label)
          const [yearPart, termPart] = label.split(' ')
          const displayLabel = xAxisLabelFilter
            ? `${formatCompactSchoolYearLabel(yearPart ?? label)}${termPart ? ` ${termPart}` : ''}`
            : (labelMap?.[label] ?? label)
          return (
            <g key={`xlabel::${label}`}>
              {showDivider && (
                <line x1={x} y1={padY} x2={x} y2={height - padY} stroke="#e2e8f0" strokeWidth="1" />
              )}
              {showLabel && (
                <text x={x} y={height - 8} textAnchor="middle" fontSize="11" fill="#334155">
                  {displayLabel}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        {series.map(s => {
          const isPinned = pinnedSeries.has(s.name)
          const isHovered = hoveredSeries === s.name
          const anyPinned = pinnedSeries.size > 0
          const anyHovered = hoveredSeries !== null
          const isActive = isPinned || isHovered
          const dimmed = (anyPinned || anyHovered) && !isActive
          return (
          <div
            key={`legend-${s.name}`}
            className={`inline-flex items-center gap-1.5 cursor-pointer select-none rounded px-1 py-0.5 ${isPinned ? 'ring-1 ring-current' : ''}`}
            style={{
              opacity: dimmed ? 0.35 : 1,
              fontWeight: isActive ? 700 : undefined,
              color: isPinned ? s.color : undefined,
            }}
            onClick={() => setPinnedSeries(prev => {
              const next = new Set(prev)
              if (next.has(s.name)) next.delete(s.name)
              else next.add(s.name)
              return next
            })}
            onMouseEnter={() => setHoveredSeries(s.name)}
            onMouseLeave={() => setHoveredSeries(null)}
          >
            {s.isMainLine && !!s.connectTo ? (
              <svg width="16" height="8" aria-hidden="true" className="block">
                <line x1="0" y1="4" x2="16" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray="4 3" />
              </svg>
            ) : (
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            )}
            {s.name}
          </div>
          )
        })}
        {pinnedSeries.size > 0 && (
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-600 underline"
            onClick={() => setPinnedSeries(new Set())}
          >
            Nullstill
          </button>
        )}
      </div>
    </div>
  )
}

export default function KarakterutviklingPanel({ baseGrades, studentInfo, absences }: Props) {
  const [uploadedGrades, setUploadedGrades] = useState<GradeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('subject')
  const [filterText, setFilterText] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [selectedTeacherKeysBySubject, setSelectedTeacherKeysBySubject] = useState<Record<string, string[]>>({})
  const [anonymizeTeachers, setAnonymizeTeachers] = useState(false)
  const [linkedSubjectsByKey, setLinkedSubjectsByKey] = useState<Record<string, string[]>>({})
  const [linkedSubjectColors, setLinkedSubjectColors] = useState<Record<string, string>>({})
  const [collapsedLinkPanels, setCollapsedLinkPanels] = useState<Record<string, boolean>>({})
  const [teacherSubjectBreakdownByKey, setTeacherSubjectBreakdownByKey] = useState<Record<string, boolean>>({})
  const [tableSortKey, setTableSortKey] = useState<string | null>(null)
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('asc')
  const [visibleGenderSeries, setVisibleGenderSeries] = useState<Record<StudentGender, boolean>>({ girl: false, boy: false })
  const [expandedGraph, setExpandedGraph] = useState<null | {
    title: string
    labels: string[]
    series: GraphSeries[]
    fileBase: string
    xAxisLabelFilter?: (label: string) => boolean
  }>(null)
  const modalSvgRef = useRef<SVGSVGElement | null>(null)

  const allGrades = useMemo(() => [...baseGrades, ...uploadedGrades], [baseGrades, uploadedGrades])
  const absenceSubjectClassLookup = useMemo(() => createAbsenceSubjectClassLookup(absences), [absences])
  const studentInfoLookup = useMemo(() => createStudentInfoLookup(studentInfo), [studentInfo])

  const allGradesWithGender = useMemo(() => {
    return allGrades.map(grade => {
      const resolvedClass = grade.class?.trim() || resolveClassFromSubjectLookup(absenceSubjectClassLookup, grade.navn, grade.subjectGroup)
      const studentKey = resolvedClass ? buildStudentClassKey(grade.navn, resolvedClass) : null
      const gender = studentKey ? (studentInfoLookup.get(studentKey)?.gender ?? null) : null
      return { ...grade, gender }
    })
  }, [allGrades, absenceSubjectClassLookup, studentInfoLookup])

  const toggleGenderSeries = (gender: StudentGender) => {
    setVisibleGenderSeries(current => ({
      ...current,
      [gender]: !current[gender],
    }))
  }

  const rows = useMemo(() => {
    const source = allGradesWithGender.filter(g => g.skoleår)
    const map = new Map<string, TrendRow>()

    source.forEach(g => {
      const schoolYear = g.skoleår?.replace(/[^0-9A-Za-z]/g, '')
      if (!schoolYear) return

      const numeric = gradeToNumeric(g.grade)
      if (numeric === null) return

      const key = viewMode === 'subject'
        ? (g.fagkode?.trim() || 'Ukjent fagkode')
        : (g.subjectTeacher?.trim() || 'Ukjent lærer')
      const safeKey = `${viewMode}::${key}`

      if (!map.has(safeKey)) {
        map.set(safeKey, {
          key: safeKey,
          label: key,
          yearly: {},
          yearlyH1: {},
          yearlyH2: {},
          termSeries: {},
        })
      }

      const row = map.get(safeKey)!
      addAggregate(row.yearly, schoolYear, numeric)

      const term = normalizeHalvaar(g.halvår)
      if (term === 'H1') {
        addAggregate(row.yearlyH1, schoolYear, numeric)
      }
      if (term === 'H2') {
        addAggregate(row.yearlyH2, schoolYear, numeric)
      }
      if (term) {
        addAggregate(row.termSeries, `${schoolYear} ${term}`, numeric)
      }
    })

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'nb-NO'))
  }, [allGradesWithGender, viewMode])

  const teacherRowsBySubject = useMemo(() => {
    const source = allGradesWithGender.filter(g => g.skoleår)
    const subjectMap = new Map<string, Map<string, SubjectTeacherRow>>()

    source.forEach(g => {
      const schoolYear = g.skoleår?.replace(/[^0-9A-Za-z]/g, '')
      if (!schoolYear) return

      const numeric = gradeToNumeric(g.grade)
      if (numeric === null) return

      const subjectKey = g.fagkode?.trim() || 'Ukjent fagkode'
      const teacher = g.subjectTeacher?.trim() || 'Ukjent lærer'
      const teacherSafeKey = `subject-teacher::${subjectKey}::${teacher}`

      if (!subjectMap.has(subjectKey)) {
        subjectMap.set(subjectKey, new Map<string, SubjectTeacherRow>())
      }
      const byTeacher = subjectMap.get(subjectKey)!

      if (!byTeacher.has(teacherSafeKey)) {
        byTeacher.set(teacherSafeKey, {
          key: teacherSafeKey,
          label: teacher,
          teacher,
          yearly: {},
          yearlyH1: {},
          yearlyH2: {},
          termSeries: {},
        })
      }

      const row = byTeacher.get(teacherSafeKey)!
      addAggregate(row.yearly, schoolYear, numeric)

      const term = normalizeHalvaar(g.halvår)
      if (term === 'H1') {
        addAggregate(row.yearlyH1, schoolYear, numeric)
      }
      if (term === 'H2') {
        addAggregate(row.yearlyH2, schoolYear, numeric)
      }
      if (term) {
        addAggregate(row.termSeries, `${schoolYear} ${term}`, numeric)
      }
    })

    const sorted = new Map<string, SubjectTeacherRow[]>()
    subjectMap.forEach((teacherMap, subjectKey) => {
      sorted.set(
        subjectKey,
        Array.from(teacherMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'nb-NO'))
      )
    })

    return sorted
  }, [allGradesWithGender])

  const subjectRowsByTeacher = useMemo(() => {
    const source = allGradesWithGender.filter(g => g.skoleår)
    const teacherMap = new Map<string, Map<string, TrendRow>>()

    source.forEach(g => {
      const schoolYear = g.skoleår?.replace(/[^0-9A-Za-z]/g, '')
      if (!schoolYear) return
      const numeric = gradeToNumeric(g.grade)
      if (numeric === null) return
      const teacher = g.subjectTeacher?.trim() || 'Ukjent lærer'
      const subject = g.fagkode?.trim() || 'Ukjent fagkode'
      const subjectSafeKey = `teacher-subject::${teacher}::${subject}`

      if (!teacherMap.has(teacher)) teacherMap.set(teacher, new Map())
      const bySubject = teacherMap.get(teacher)!

      if (!bySubject.has(subjectSafeKey)) {
        bySubject.set(subjectSafeKey, {
          key: subjectSafeKey,
          label: subject,
          yearly: {},
          yearlyH1: {},
          yearlyH2: {},
          termSeries: {},
        })
      }

      const row = bySubject.get(subjectSafeKey)!
      addAggregate(row.yearly, schoolYear, numeric)
      const term = normalizeHalvaar(g.halvår)
      if (term === 'H1') addAggregate(row.yearlyH1, schoolYear, numeric)
      if (term === 'H2') addAggregate(row.yearlyH2, schoolYear, numeric)
      if (term) addAggregate(row.termSeries, `${schoolYear} ${term}`, numeric)
    })

    const sorted = new Map<string, TrendRow[]>()
    teacherMap.forEach((subjectMap, teacher) => {
      sorted.set(teacher, Array.from(subjectMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'nb-NO')))
    })
    return sorted
  }, [allGradesWithGender])

  const genderRowsBySubject = useMemo(() => {
    const subjectMap = new Map<string, Map<StudentGender, TrendRow>>()

    allGradesWithGender.forEach(grade => {
      if (!grade.skoleår || !grade.gender) return
      const schoolYear = grade.skoleår.replace(/[^0-9A-Za-z]/g, '')
      if (!schoolYear) return

      const numeric = gradeToNumeric(grade.grade)
      if (numeric === null) return

      const subjectKey = grade.fagkode?.trim() || 'Ukjent fagkode'
      if (!subjectMap.has(subjectKey)) subjectMap.set(subjectKey, new Map())
      const byGender = subjectMap.get(subjectKey)!

      if (!byGender.has(grade.gender)) {
        byGender.set(grade.gender, {
          key: `subject-gender::${subjectKey}::${grade.gender}`,
          label: GENDER_SERIES[grade.gender].label,
          yearly: {},
          yearlyH1: {},
          yearlyH2: {},
          termSeries: {},
        })
      }

      const row = byGender.get(grade.gender)!
      addAggregate(row.yearly, schoolYear, numeric)

      const term = normalizeHalvaar(grade.halvår)
      if (term === 'H1') addAggregate(row.yearlyH1, schoolYear, numeric)
      if (term === 'H2') addAggregate(row.yearlyH2, schoolYear, numeric)
      if (term) addAggregate(row.termSeries, `${schoolYear} ${term}`, numeric)
    })

    return subjectMap
  }, [allGradesWithGender])

  const genderRowsByTeacher = useMemo(() => {
    const teacherMap = new Map<string, Map<StudentGender, TrendRow>>()

    allGradesWithGender.forEach(grade => {
      if (!grade.skoleår || !grade.gender) return
      const schoolYear = grade.skoleår.replace(/[^0-9A-Za-z]/g, '')
      if (!schoolYear) return

      const numeric = gradeToNumeric(grade.grade)
      if (numeric === null) return

      const teacher = grade.subjectTeacher?.trim() || 'Ukjent lærer'
      if (!teacherMap.has(teacher)) teacherMap.set(teacher, new Map())
      const byGender = teacherMap.get(teacher)!

      if (!byGender.has(grade.gender)) {
        byGender.set(grade.gender, {
          key: `teacher-gender::${teacher}::${grade.gender}`,
          label: GENDER_SERIES[grade.gender].label,
          yearly: {},
          yearlyH1: {},
          yearlyH2: {},
          termSeries: {},
        })
      }

      const row = byGender.get(grade.gender)!
      addAggregate(row.yearly, schoolYear, numeric)

      const term = normalizeHalvaar(grade.halvår)
      if (term === 'H1') addAggregate(row.yearlyH1, schoolYear, numeric)
      if (term === 'H2') addAggregate(row.yearlyH2, schoolYear, numeric)
      if (term) addAggregate(row.termSeries, `${schoolYear} ${term}`, numeric)
    })

    return teacherMap
  }, [allGradesWithGender])

  const hasGenderSeriesData = useMemo(
    () => allGradesWithGender.some(grade => grade.gender !== null),
    [allGradesWithGender]
  )

  const schoolYears = useMemo(
    () => sortSchoolYears(Array.from(new Set(rows.flatMap(r => Object.keys(r.yearly))))),
    [rows]
  )

  const termTimelineLabels = useMemo(
    () => schoolYears.flatMap(year => [`${year} H1`, `${year} H2`]),
    [schoolYears]
  )

  const schoolYearDisplayMap = useMemo(
    () => Object.fromEntries(schoolYears.map(year => [year, formatSchoolYearLabel(year)])),
    [schoolYears]
  )

  const termTimelineDisplayMap = useMemo(
    () => Object.fromEntries(termTimelineLabels.map(label => {
      const [year, term] = label.split(' ')
      const yearLabel = formatSchoolYearLabel(year ?? label)
      return [label, `${yearLabel} ${term ?? ''}`.trim()]
    })),
    [termTimelineLabels]
  )

  const termH2DisplayMap = useMemo(
    () => Object.fromEntries(schoolYears.map(year => [`${year} H2`, formatCompactSchoolYearLabel(year)])),
    [schoolYears]
  )

  const normalizedFilter = useMemo(
    () => normalizeHeader(filterText),
    [filterText]
  )

  const filteredRows = useMemo(() => {
    if (!normalizedFilter) return rows
    return rows.filter(row =>
      normalizeHeader(row.label).includes(normalizedFilter) ||
      normalizeHeader(getFagnavn(row.label)).includes(normalizedFilter)
    )
  }, [rows, normalizedFilter])

  const sortedFilteredRows = useMemo(() => {
    const lastYear = schoolYears[schoolYears.length - 1]
    const firstYear = schoolYears[0]
    if (!tableSortKey) {
      return [...filteredRows].sort((a, b) =>
        getFagnavn(a.label).localeCompare(getFagnavn(b.label), 'nb-NO')
      )
    }
    return [...filteredRows].sort((a, b) => {
      let av: number
      let bv: number
      if (tableSortKey === 'label') {
        const cmp = getFagnavn(a.label).localeCompare(getFagnavn(b.label), 'nb-NO')
        return tableSortDir === 'asc' ? cmp : -cmp
      } else if (tableSortKey === 'endring') {
        const deltaA = firstYear && lastYear ? (a.yearlyH2[lastYear]?.avg ?? NaN) - (a.yearlyH2[firstYear]?.avg ?? NaN) : NaN
        const deltaB = firstYear && lastYear ? (b.yearlyH2[lastYear]?.avg ?? NaN) - (b.yearlyH2[firstYear]?.avg ?? NaN) : NaN
        av = isNaN(deltaA) ? (tableSortDir === 'asc' ? Infinity : -Infinity) : deltaA
        bv = isNaN(deltaB) ? (tableSortDir === 'asc' ? Infinity : -Infinity) : deltaB
      } else if (tableSortKey === 'spread') {
        const calcMetric = (row: TrendRow) => {
          if (viewMode === 'subject') {
            const tRows = teacherRowsBySubject.get(row.label) ?? []
            const vals = schoolYears.map(y => {
              const avgs = tRows.map(tr => tr.yearlyH2[y]?.avg).filter((v): v is number => v !== undefined)
              return avgs.length >= 2 ? Math.max(...avgs) - Math.min(...avgs) : null
            }).filter((v): v is number => v !== null)
            return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
          } else {
            const sRows = subjectRowsByTeacher.get(row.label) ?? []
            const devs = sRows.flatMap(sr => schoolYears.map(y => {
              const teacherAvg = sr.yearlyH2[y]?.avg
              const allAvgs = (teacherRowsBySubject.get(sr.label) ?? []).map(tr => tr.yearlyH2[y]?.avg).filter((v): v is number => v !== undefined)
              if (teacherAvg === undefined || allAvgs.length < 2) return null
              return teacherAvg - (allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length)
            }).filter((v): v is number => v !== null))
            return devs.length > 0 ? devs.reduce((a, b) => a + b, 0) / devs.length : NaN
          }
        }
        av = calcMetric(a)
        bv = calcMetric(b)
        if (isNaN(av)) av = tableSortDir === 'asc' ? Infinity : -Infinity
        if (isNaN(bv)) bv = tableSortDir === 'asc' ? Infinity : -Infinity
      } else {
        // tableSortKey is a schoolYear string
        av = a.yearlyH2[tableSortKey]?.avg ?? (tableSortDir === 'asc' ? Infinity : -Infinity)
        bv = b.yearlyH2[tableSortKey]?.avg ?? (tableSortDir === 'asc' ? Infinity : -Infinity)
      }
      return tableSortDir === 'asc' ? av - bv : bv - av
    })
  }, [filteredRows, tableSortKey, tableSortDir, schoolYears])

  const toggleTableSort = (key: string) => {
    if (tableSortKey === key) {
      setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setTableSortKey(key)
      setTableSortDir('asc')
    }
  }

  const maskTeacher = (name: string, idx?: number): string =>
    anonymizeTeachers ? (idx !== undefined ? `Lærer ${idx + 1}` : '**********') : name

  const exportFilteredToExcel = () => {
    void import('exceljs').then(async exceljs => {
      const workbook = new exceljs.Workbook()
      const worksheet = workbook.addWorksheet('Karakterutvikling', {
        views: [{ state: 'frozen', ySplit: 1 }],
      })
      worksheet.properties.outlineLevelRow = 1

      const headers = [
        viewMode === 'subject' ? 'Fag' : 'Lærer',
        ...schoolYears.flatMap(year => [`${formatSchoolYearLabel(year)} H2`, `${formatSchoolYearLabel(year)} (H1)`]),
        'Endring H2',
        '(H1)',
        viewMode === 'subject' ? 'Spredning (snitt)' : 'Avvik (snitt)',
      ]
      worksheet.addRow(headers)

      const addRowForTrend = (label: string, row: TrendRow, level = 0) => {
        const firstYear = schoolYears[0]
        const lastYear = schoolYears[schoolYears.length - 1]
        const startH2 = firstYear ? row.yearlyH2[firstYear]?.avg : undefined
        const endH2 = lastYear ? row.yearlyH2[lastYear]?.avg : undefined
        const deltaH2 = startH2 !== undefined && endH2 !== undefined ? endH2 - startH2 : null
        const startH1 = firstYear ? row.yearlyH1[firstYear]?.avg : undefined
        const endH1 = lastYear ? row.yearlyH1[lastYear]?.avg : undefined
        const deltaH1 = startH1 !== undefined && endH1 !== undefined ? endH1 - startH1 : null

        const excelRow = worksheet.addRow([
          label,
          ...schoolYears.flatMap(year => {
            const h2 = row.yearlyH2[year]
            const h1 = row.yearlyH1[year]
            return [
              h2 ? Number(h2.avg.toFixed(2)) : '',
              h1 ? Number(h1.avg.toFixed(2)) : '',
            ]
          }),
          deltaH2 === null ? '' : Number(deltaH2.toFixed(2)),
          deltaH1 === null ? '' : Number(deltaH1.toFixed(2)),
          (() => {
            if (viewMode === 'subject' && level === 0) {
              const tRows = teacherRowsBySubject.get(row.label) ?? []
              const perYear = schoolYears.map(y => {
                const avgs = tRows.map(tr => tr.yearlyH2[y]?.avg).filter((v): v is number => v !== undefined)
                return avgs.length >= 2 ? Math.max(...avgs) - Math.min(...avgs) : null
              }).filter((v): v is number => v !== null)
              const avg = perYear.length > 0 ? perYear.reduce((a, b) => a + b, 0) / perYear.length : null
              return avg === null ? '' : Number(avg.toFixed(2))
            } else if (viewMode === 'teacher') {
              const sRows = subjectRowsByTeacher.get(row.label) ?? []
              const devs = sRows.flatMap(sr => schoolYears.map(y => {
                const teacherAvg = sr.yearlyH2[y]?.avg
                const allAvgs = (teacherRowsBySubject.get(sr.label) ?? []).map(tr => tr.yearlyH2[y]?.avg).filter((v): v is number => v !== undefined)
                if (teacherAvg === undefined || allAvgs.length < 2) return null
                return teacherAvg - (allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length)
              }).filter((v): v is number => v !== null))
              const avg = devs.length > 0 ? devs.reduce((a, b) => a + b, 0) / devs.length : null
              return avg === null ? '' : Number(avg.toFixed(2))
            }
            return ''
          })(),
        ])

        if (level > 0) {
          excelRow.outlineLevel = 1
          excelRow.hidden = true
          excelRow.getCell(1).alignment = { indent: 1, vertical: 'middle', horizontal: 'left' }
        }
      }

      sortedFilteredRows.forEach((row, rowIdx) => {
        addRowForTrend(viewMode === 'teacher' ? maskTeacher(row.label, rowIdx) : row.label, row)
        if (viewMode === 'subject') {
          const teacherRows = teacherRowsBySubject.get(row.label) ?? []
          teacherRows.forEach((teacherRow, teacherIdx) => {
            addRowForTrend(maskTeacher(teacherRow.label, teacherIdx), teacherRow, 1)
          })
        }
      })

      worksheet.columns.forEach((col, idx) => {
        col.width = idx === 0 ? 28 : 12
      })

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      }

      const headerRow = worksheet.getRow(1)
      headerRow.height = 22
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF0F172A' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        }
      })

      for (let i = 2; i <= worksheet.rowCount; i += 1) {
        const row = worksheet.getRow(i)
        const isChild = (row.outlineLevel ?? 0) > 0
        row.height = 20
        row.eachCell(cell => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          }
          if (!isChild) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
          }
        })
        if (!isChild) {
          row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
        }
        for (let col = 2; col <= headers.length; col += 1) {
          row.getCell(col).numFmt = '0.00'
        }
      }

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `karakterutvikling-${viewMode}-${normalizedFilter || 'alle'}.xlsx`
      link.click()
      URL.revokeObjectURL(link.href)
    })
  }

  const downloadExpandedGraphAsPng = async () => {
    if (!expandedGraph || !modalSvgRef.current) return
    const svgEl = modalSvgRef.current
    const serializer = new XMLSerializer()
    const svgText = serializer.serializeToString(svgEl)
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Kunne ikke lese graf som bilde.'))
        img.src = svgUrl
      })

      const title = expandedGraph.title
      const headerHeight = 60
      const legendItemHeight = 28
      const legendRows = Math.ceil(expandedGraph.series.length / 4)
      const legendHeight = legendRows * legendItemHeight + 16
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height + headerHeight + legendHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Kunne ikke opprette tegneflate for eksport.')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Title
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 22px Segoe UI, Arial, sans-serif'
      ctx.fillText(title, 20, 36)

      // Graph
      ctx.drawImage(image, 0, headerHeight)

      // Legend below graph
      const legendTop = headerHeight + image.height + 12
      const dotR = 7
      const itemSpacing = Math.floor(canvas.width / Math.min(4, expandedGraph.series.length))
      expandedGraph.series.forEach((s, i) => {
        const col = i % 4
        const row = Math.floor(i / 4)
        const lx = 20 + col * itemSpacing
        const ly = legendTop + row * legendItemHeight
        ctx.beginPath()
        ctx.arc(lx + dotR, ly + dotR, dotR, 0, Math.PI * 2)
        ctx.fillStyle = s.color
        ctx.fill()
        ctx.fillStyle = '#334155'
        ctx.font = '14px Segoe UI, Arial, sans-serif'
        ctx.fillText(s.name, lx + dotR * 2 + 6, ly + dotR + 5)
      })

      const pngBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!pngBlob) throw new Error('Kunne ikke lage PNG-fil.')

      const link = document.createElement('a')
      link.href = URL.createObjectURL(pngBlob)
      link.download = `${expandedGraph.fileBase}.png`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke laste ned graf som PNG.')
    } finally {
      URL.revokeObjectURL(svgUrl)
    }
  }

  const downloadExpandedGraphAsSvg = () => {
    if (!expandedGraph || !modalSvgRef.current) return
    const svgEl = modalSvgRef.current
    const graphW = svgEl.width.baseVal.value || 1000
    const graphH = svgEl.height.baseVal.value || 420
    const headerHeight = 52
    const legendItemH = 26
    const cols = Math.min(4, expandedGraph.series.length)
    const legendRows = Math.ceil(expandedGraph.series.length / cols)
    const legendHeight = legendRows * legendItemH + 16
    const totalH = headerHeight + graphH + legendHeight

    const serializer = new XMLSerializer()
    const innerSvg = serializer.serializeToString(svgEl)
    // Strip the outer <svg …> wrapper so we can embed the content via <g>
    const innerContent = innerSvg.replace(/<svg[^>]*>/, '').replace(/<\/svg>$/, '')

    const colW = graphW / Math.max(1, cols)
    const legendItems = expandedGraph.series.map((s, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const lx = 16 + col * colW
      const ly = headerHeight + graphH + 16 + row * legendItemH
      return `<circle cx="${lx + 8}" cy="${ly + 8}" r="7" fill="${s.color}"/>` +
        `<text x="${lx + 22}" y="${ly + 13}" font-family="Segoe UI,Arial,sans-serif" font-size="13" fill="#334155">${s.name}</text>`
    }).join('\n    ')

    const compositeSvg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${graphW}" height="${totalH}">
  <rect width="${graphW}" height="${totalH}" fill="#ffffff"/>
  <text x="16" y="34" font-family="Segoe UI,Arial,sans-serif" font-size="20" font-weight="bold" fill="#0f172a">${expandedGraph.title}</text>
  <g transform="translate(0,${headerHeight})">${innerContent}</g>
  ${legendItems}
</svg>`

    const blob = new Blob([compositeSvg], { type: 'image/svg+xml;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${expandedGraph.fileBase}.svg`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const handleFileImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const parsedSets = await Promise.all(Array.from(files).map(parseGradeFile))
      setUploadedGrades(prev => [...prev, ...parsedSets.flat()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke lese karakterfilene.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Karakterutvikling</h2>
          <p className="text-sm text-slate-600">Last opp flere karakterfiler med skoleår for å sammenligne utvikling over tid.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setViewMode('subject'); setTableSortKey(null) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              viewMode === 'subject'
                ? 'bg-sky-100 text-sky-800 border-sky-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Per fag
          </button>
          <button
            type="button"
            onClick={() => { setViewMode('teacher'); setTableSortKey(null) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              viewMode === 'teacher'
                ? 'bg-sky-100 text-sky-800 border-sky-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Per lærer
          </button>
          {hasGenderSeriesData && (
            <div className="ml-2 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              <span className="px-2 text-xs font-medium text-slate-500">Kjønnssnitt</span>
              {(Object.keys(GENDER_SERIES) as StudentGender[]).map(gender => (
                <button
                  key={gender}
                  type="button"
                  onClick={() => toggleGenderSeries(gender)}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    visibleGenderSeries[gender]
                      ? 'bg-sky-100 text-sky-800'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {GENDER_SERIES[gender].label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div
          className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-sky-400 hover:bg-sky-50 transition-colors cursor-pointer"
          onDragOver={e => {
            e.preventDefault()
            e.currentTarget.classList.add('border-sky-400', 'bg-sky-50')
          }}
          onDragLeave={e => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-sky-400', 'bg-sky-50')
          }}
          onDrop={e => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-sky-400', 'bg-sky-50')
            handleFileImport(e.dataTransfer.files)
          }}
        >
          <input
            id="karakterutvikling-upload"
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            onChange={e => handleFileImport(e.currentTarget.files)}
            className="hidden"
          />
          <label htmlFor="karakterutvikling-upload" className="cursor-pointer inline-flex flex-col items-center">
            <Upload className="w-6 h-6 text-sky-600 mb-2" />
            <p className="font-medium text-slate-900">
              {loading ? 'Laster opp...' : 'Klikk for å velge karakterfiler eller dra dem hit'}
            </p>
            <p className="text-sm text-slate-600 mt-1">XLSX-, XLS- eller CSV-filer</p>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUploadedGrades([])
              setFilterText('')
              setExpandedKey(null)
              setSelectedTeacherKeysBySubject({})
              setLinkedSubjectsByKey({})
            }}
            className="px-3 py-2 rounded-lg text-sm font-medium border bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          >
            Tøm opplastede filer
          </button>
          <input
            type="text"
            value={filterText}
            onChange={e => {
              setFilterText(e.currentTarget.value)
              setExpandedKey(null)
            }}
            placeholder={viewMode === 'subject' ? 'Filtrer på fagkode...' : 'Filtrer på lærer...'}
            className="px-3 py-2 rounded-lg text-sm border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 min-w-56"
          />
          <button
            type="button"
            onClick={exportFilteredToExcel}
            disabled={filteredRows.length === 0}
            className="px-3 py-2 rounded-lg text-sm font-medium border bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Eksporter filtrert til Excel
          </button>
          <button
            type="button"
            onClick={() => setAnonymizeTeachers(prev => !prev)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${
              anonymizeTeachers
                ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {anonymizeTeachers ? 'Anonymisert ✓' : 'Anonymiser lærere'}
          </button>
          <span className="text-xs text-slate-500">
            Datagrunnlag: {allGrades.length} karakterrader ({uploadedGrades.length} fra opplasting). Viser {filteredRows.length} av {rows.length} linjer.
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {rows.length === 0 ? (
        <div className="p-6 text-center text-slate-500 border border-slate-200 rounded-lg bg-slate-50">
          Ingen data ennå. Last opp karakterfiler med skoleår-kolonne for å se utvikling.
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="p-6 text-center text-slate-500 border border-slate-200 rounded-lg bg-slate-50">
          Ingen treff for gjeldende filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button type="button" onClick={() => toggleTableSort('label')} className="inline-flex items-center gap-1 hover:text-slate-700">
                    {viewMode === 'subject' ? 'Fag' : 'Lærer'}
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">
                      {tableSortKey === 'label' ? (tableSortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                {schoolYears.map(year => (
                  <th
                    key={year}
                    className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    <button type="button" onClick={() => toggleTableSort(year)} className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center">
                      {schoolYearDisplayMap[year] ?? year}
                      <span className="min-w-2 text-[10px] leading-none text-slate-400">
                        {tableSortKey === year ? (tableSortDir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  <button type="button" onClick={() => toggleTableSort('endring')} className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center">
                    Endring
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">
                      {tableSortKey === 'endring' ? (tableSortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th
                  className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  title={viewMode === 'subject' ? 'Spredning mellom høyeste og laveste lærersnitt per år (H2)' : 'Gjennomsnittlig avvik fra fagsnitt (H2)'}
                >
                  <button type="button" onClick={() => toggleTableSort('spread')} className="inline-flex items-center gap-1 hover:text-slate-700 w-full justify-center">
                    {viewMode === 'subject' ? 'Spredning' : 'Avvik'}
                    <span className="min-w-2 text-[10px] leading-none text-slate-400">
                      {tableSortKey === 'spread' ? (tableSortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedFilteredRows.map((row, rowIdx) => {
                const displayRowLabel = viewMode === 'teacher' ? maskTeacher(row.label, rowIdx) : row.label
                const firstYear = schoolYears[0]
                const lastYear = schoolYears[schoolYears.length - 1]
                const startH2 = firstYear ? row.yearlyH2[firstYear]?.avg : undefined
                const endH2 = lastYear ? row.yearlyH2[lastYear]?.avg : undefined
                const deltaH2 = startH2 !== undefined && endH2 !== undefined ? endH2 - startH2 : null
                const startH1 = firstYear ? row.yearlyH1[firstYear]?.avg : undefined
                const endH1 = lastYear ? row.yearlyH1[lastYear]?.avg : undefined
                const deltaH1 = startH1 !== undefined && endH1 !== undefined ? endH1 - startH1 : null
                const isExpanded = expandedKey === row.key
                const subjectTeacherRows = viewMode === 'subject' ? (teacherRowsBySubject.get(row.label) ?? []) : []
                const selectedTeacherKeys = selectedTeacherKeysBySubject[row.label] ?? []
                const selectedTeacherRows = subjectTeacherRows.filter(teacherRow => selectedTeacherKeys.includes(teacherRow.key))
                const linkedKeys = linkedSubjectsByKey[row.key] ?? []
                const linkedRows = filteredRows.filter(r => r.key !== row.key && linkedKeys.includes(r.key))
                const getLinkedColor = (key: string) => linkedSubjectColors[key] ?? '#0284c7'
                const teacherSubjectRows = viewMode === 'teacher' ? (subjectRowsByTeacher.get(row.label) ?? []) : []
                const showSubjectBreakdown = viewMode === 'teacher' && !!teacherSubjectBreakdownByKey[row.key]
                const genderRows = viewMode === 'subject' ? genderRowsBySubject.get(row.label) : genderRowsByTeacher.get(row.label)
                const genderSeriesH2: GraphSeries[] = (Object.keys(GENDER_SERIES) as StudentGender[])
                  .filter(gender => visibleGenderSeries[gender] && genderRows?.get(gender))
                  .map(gender => ({
                    name: `${GENDER_SERIES[gender].label} (snitt)`,
                    values: genderRows!.get(gender)!.yearlyH2,
                    color: GENDER_SERIES[gender].color,
                    dashed: true,
                    excludeFromRangeBand: true,
                  }))
                const genderTermSeries: GraphSeries[] = (Object.keys(GENDER_SERIES) as StudentGender[])
                  .filter(gender => visibleGenderSeries[gender] && genderRows?.get(gender))
                  .map(gender => ({
                    name: `${GENDER_SERIES[gender].label} (snitt)`,
                    values: genderRows!.get(gender)!.termSeries,
                    color: GENDER_SERIES[gender].color,
                    dashed: true,
                    excludeFromRangeBand: true,
                  }))
                const h2Series: GraphSeries[] = [
                  { name: row.label, values: row.yearlyH2, color: '#0284c7', isMainLine: true },
                  ...genderSeriesH2,
                  ...linkedRows.map((linkedRow) => ({
                    name: linkedRow.label,
                    values: linkedRow.yearlyH2,
                    color: getLinkedColor(linkedRow.key),
                    isMainLine: true as const,
                    connectTo: row.label,
                  })),
                  ...(showSubjectBreakdown ? teacherSubjectRows.map((subjectRow, i) => ({
                    name: getFagnavn(subjectRow.label),
                    values: subjectRow.yearlyH2,
                    color: TEACHER_SERIES_COLORS[i % TEACHER_SERIES_COLORS.length],
                  })) : []),
                  ...selectedTeacherRows.flatMap((teacherRow) => {
                    const stableIdx = subjectTeacherRows.indexOf(teacherRow)
                    const color = TEACHER_SERIES_COLORS[stableIdx % TEACHER_SERIES_COLORS.length]
                    const teacherName = maskTeacher(teacherRow.label, stableIdx)
                    const linkedTeacher: GraphSeries[] = linkedRows.flatMap((linkedRow) => {
                      const match = (teacherRowsBySubject.get(linkedRow.label) ?? []).find(tr => tr.label === teacherRow.label)
                      if (!match) return []
                      return [{ name: `${teacherName} (${linkedRow.label})`, values: match.yearlyH2, color, dashed: true, connectTo: teacherName }]
                    })
                    return [
                      { name: teacherName, values: teacherRow.yearlyH2, color },
                      ...linkedTeacher,
                    ]
                  }),
                ]
                const termSeries: GraphSeries[] = [
                  { name: row.label, values: row.termSeries, color: '#0284c7', isMainLine: true },
                  ...genderTermSeries,
                  ...linkedRows.map((linkedRow) => ({
                    name: linkedRow.label,
                    values: linkedRow.termSeries,
                    color: getLinkedColor(linkedRow.key),
                    isMainLine: true as const,
                    connectTo: row.label,
                  })),
                  ...(showSubjectBreakdown ? teacherSubjectRows.map((subjectRow, i) => ({
                    name: getFagnavn(subjectRow.label),
                    values: subjectRow.termSeries,
                    color: TEACHER_SERIES_COLORS[i % TEACHER_SERIES_COLORS.length],
                  })) : []),
                  ...selectedTeacherRows.flatMap((teacherRow) => {
                    const stableIdx = subjectTeacherRows.indexOf(teacherRow)
                    const color = TEACHER_SERIES_COLORS[stableIdx % TEACHER_SERIES_COLORS.length]
                    const teacherName = maskTeacher(teacherRow.label, stableIdx)
                    const linkedTeacher: GraphSeries[] = linkedRows.flatMap((linkedRow) => {
                      const match = (teacherRowsBySubject.get(linkedRow.label) ?? []).find(tr => tr.label === teacherRow.label)
                      if (!match) return []
                      return [{ name: `${teacherName} (${linkedRow.label})`, values: match.termSeries, color, dashed: true, connectTo: teacherName }]
                    })
                    return [
                      { name: teacherName, values: teacherRow.termSeries, color },
                      ...linkedTeacher,
                    ]
                  }),
                ]

                const h2Labels = schoolYears.filter(y => h2Series.some(s => y in s.values))
                const termLabels = termTimelineLabels.filter(y => termSeries.some(s => y in s.values))

                return (
                  <>
                    <tr
                      key={row.key}
                      className="border-b border-slate-100 hover:bg-sky-50/40 cursor-pointer"
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedKey(null)
                        } else {
                          setExpandedKey(row.key)
                        }
                      }}
                    >
                      <td className="py-2 px-3 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          {viewMode === 'subject' ? (() => {
                            const fagnavn = getFagnavn(displayRowLabel)
                            const short = fagnavn.length > 25 ? fagnavn.slice(0, 25) + '…' : fagnavn
                            return (
                              <div className="leading-tight" title={fagnavn}>
                                <div>{short}</div>
                                {fagnavn !== displayRowLabel && (
                                  <div className="text-[11px] text-slate-400 font-normal">{displayRowLabel}</div>
                                )}
                              </div>
                            )
                          })() : displayRowLabel}
                        </div>
                      </td>
                      {schoolYears.map(year => {
                        const h2 = row.yearlyH2[year]
                        const h1 = row.yearlyH1[year]
                        return (
                          <td key={year} className="py-2 px-3 text-center text-slate-700">
                            {h2 || h1 ? (
                              <div className="leading-tight">
                                <div className="font-medium">{h2 ? h2.avg.toFixed(2).replace('.', ',') : '—'}</div>
                                <div className="text-[10px] text-slate-500">({h1 ? h1.avg.toFixed(2).replace('.', ',') : '—'})</div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                        )
                      })}
                      <td
                        className={`py-2 px-3 text-center font-semibold ${
                          deltaH2 === null
                            ? 'text-slate-500'
                            : deltaH2 > 0
                              ? 'text-emerald-700'
                              : deltaH2 < 0
                                ? 'text-red-700'
                                : 'text-slate-700'
                        }`}
                      >
                        {deltaH2 === null ? '—' : `${deltaH2 > 0 ? '+' : ''}${deltaH2.toFixed(2).replace('.', ',')}`}
                        <div className="text-[10px] font-normal text-slate-500">
                          ({deltaH1 === null ? '—' : `${deltaH1 > 0 ? '+' : ''}${deltaH1.toFixed(2).replace('.', ',')}`})
                        </div>
                      </td>
                      {(() => {
                        if (viewMode === 'subject') {
                          const tRows = teacherRowsBySubject.get(row.label) ?? []
                          const perYear = schoolYears.map(y => {
                            const avgs = tRows.map(tr => tr.yearlyH2[y]?.avg).filter((v): v is number => v !== undefined)
                            return avgs.length >= 2 ? Math.max(...avgs) - Math.min(...avgs) : null
                          }).filter((v): v is number => v !== null)
                          const avgSpread = perYear.length > 0
                            ? perYear.reduce((s, v) => s + v, 0) / perYear.length
                            : null
                          return (
                            <td className="py-2 px-3 text-center align-middle">
                              {avgSpread === null ? (
                                <span className="text-slate-300 text-xs">—</span>
                              ) : (
                                <div className={`text-[11px] font-semibold ${
                                  avgSpread >= 1.5 ? 'text-red-600' : avgSpread >= 0.75 ? 'text-amber-500' : 'text-emerald-600'
                                }`}>
                                  {avgSpread.toFixed(2).replace('.', ',')}
                                </div>
                              )}
                            </td>
                          )
                        } else {
                          const sRows = subjectRowsByTeacher.get(row.label) ?? []
                          const devs = sRows.flatMap(sr => schoolYears.map(y => {
                            const teacherAvg = sr.yearlyH2[y]?.avg
                            const allAvgs = (teacherRowsBySubject.get(sr.label) ?? []).map(tr => tr.yearlyH2[y]?.avg).filter((v): v is number => v !== undefined)
                            if (teacherAvg === undefined || allAvgs.length < 2) return null
                            return teacherAvg - (allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length)
                          }).filter((v): v is number => v !== null))
                          const avgDev = devs.length > 0 ? devs.reduce((a, b) => a + b, 0) / devs.length : null
                          return (
                            <td className="py-2 px-3 text-center align-middle">
                              {avgDev === null ? (
                                <span className="text-slate-300 text-xs">—</span>
                              ) : (
                                <div className={`text-[11px] font-semibold ${
                                  Math.abs(avgDev) < 0.1 ? 'text-slate-500'
                                  : avgDev > 0 ? 'text-emerald-600'
                                  : 'text-rose-600'
                                }`}>
                                  {avgDev > 0 ? '+' : ''}{avgDev.toFixed(2).replace('.', ',')}
                                </div>
                              )}
                            </td>
                          )
                        }
                      })()}
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <td colSpan={schoolYears.length + 3} className="py-3 px-3 space-y-3">
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Halvår 2</div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedGraph({
                                    title: `${displayRowLabel} - Halvår 2`,
                                    labels: h2Labels,
                                    series: h2Series,
                                    fileBase: `karakterutvikling-${normalizeHeader(row.label)}-h2`,
                                  })}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  <Expand className="w-3.5 h-3.5" />
                                  Utvid
                                </button>
                              </div>
                              <TrendGraph labels={h2Labels} series={h2Series} labelMap={schoolYearDisplayMap} />
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Halvår 1 og 2 (separate)</div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedGraph({
                                    title: `${displayRowLabel} - Halvår 1 og 2`,
                                    labels: termLabels,
                                    series: termSeries,
                                    fileBase: `karakterutvikling-${normalizeHeader(row.label)}-h1-h2`,
                                    xAxisLabelFilter: (l: string) => l.endsWith(' H2'),
                                  })}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  <Expand className="w-3.5 h-3.5" />
                                  Utvid
                                </button>
                              </div>
                              <TrendGraph labels={termLabels} series={termSeries} labelMap={termH2DisplayMap} xAxisLabelFilter={l => l.endsWith(' H2')} />
                            </div>
                          </div>

                          {viewMode === 'teacher' && teacherSubjectRows.length > 0 && (
                            <div className="rounded-lg border border-slate-200 bg-white">
                              <div className="px-3 py-2 flex items-center justify-between border-b border-slate-200">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vis i grafene</span>
                                <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs font-medium">
                                  <button
                                    type="button"
                                    className={`px-3 py-1 ${!showSubjectBreakdown ? 'bg-sky-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                                    onClick={() => setTeacherSubjectBreakdownByKey(prev => ({ ...prev, [row.key]: false }))}
                                  >
                                    Snitt
                                  </button>
                                  <button
                                    type="button"
                                    className={`px-3 py-1 border-l border-slate-300 ${showSubjectBreakdown ? 'bg-sky-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                                    onClick={() => setTeacherSubjectBreakdownByKey(prev => ({ ...prev, [row.key]: true }))}
                                  >
                                    Per fag
                                  </button>
                                </div>
                              </div>
                              {showSubjectBreakdown && (
                                <div className="px-3 py-2 flex flex-wrap gap-2">
                                  {teacherSubjectRows.map((subjectRow, i) => (
                                    <span key={subjectRow.key} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                                      <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: TEACHER_SERIES_COLORS[i % TEACHER_SERIES_COLORS.length] }} />
                                      {getFagnavn(subjectRow.label)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {viewMode === 'subject' && filteredRows.length > 1 && (() => {
                            const isLinkPanelCollapsed = collapsedLinkPanels[row.key] !== false
                            return (
                              <div className="rounded-lg border border-slate-200 bg-white">
                                <button
                                  type="button"
                                  className="w-full flex items-center justify-between px-3 py-2 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
                                  onClick={() => setCollapsedLinkPanels(prev => ({ ...prev, [row.key]: !isLinkPanelCollapsed }))}
                                >
                                  <span>Koble til andre fag (overlay i grafene)</span>
                                  {isLinkPanelCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                                {!isLinkPanelCollapsed && (
                                  <div className="divide-y divide-slate-200">
                                    {filteredRows.filter(r => r.key !== row.key).map((otherRow) => {
                                      const isLinked = (linkedSubjectsByKey[row.key] ?? []).includes(otherRow.key)
                                      const color = getLinkedColor(otherRow.key)
                                      return (
                                        <div key={otherRow.key} className="px-3 py-2 flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={isLinked}
                                            onChange={e => {
                                              const checked = e.currentTarget.checked
                                              setLinkedSubjectsByKey(prev => {
                                                const current = prev[row.key] ?? []
                                                const next = checked
                                                  ? Array.from(new Set([...current, otherRow.key]))
                                                  : current.filter(k => k !== otherRow.key)
                                                return { ...prev, [row.key]: next }
                                              })
                                            }}
                                            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                          />
                                          <label
                                            className="relative flex-shrink-0 w-4 h-4 rounded-full cursor-pointer overflow-hidden"
                                            title="Velg farge"
                                            style={{ backgroundColor: color }}
                                          >
                                            <input
                                              type="color"
                                              value={color}
                                              onChange={e => {
                                                const newColor = e.currentTarget.value
                                                setLinkedSubjectColors(prev => ({ ...prev, [otherRow.key]: newColor }))
                                              }}
                                              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                            />
                                          </label>
                                          <span className="text-sm text-slate-800">{otherRow.label}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                          {viewMode === 'subject' && (
                            <div className="rounded-lg border border-slate-200 bg-white">
                              <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lærere i faget (kryss av for å legge til i grafene)</span>
                                {subjectTeacherRows.length > 0 && (
                                  <button
                                    type="button"
                                    className="text-xs text-sky-600 hover:text-sky-800 font-medium"
                                    onClick={() => {
                                      const allKeys = subjectTeacherRows.map(tr => tr.key)
                                      const allSelected = allKeys.every(k => selectedTeacherKeys.includes(k))
                                      setSelectedTeacherKeysBySubject(prev => ({
                                        ...prev,
                                        [row.label]: allSelected ? [] : allKeys,
                                      }))
                                    }}
                                  >
                                    {subjectTeacherRows.every(tr => selectedTeacherKeys.includes(tr.key)) ? 'Fjern alle' : 'Velg alle'}
                                  </button>
                                )}
                              </div>
                              {subjectTeacherRows.length === 0 ? (
                                <div className="px-3 py-3 text-sm text-slate-500">Ingen lærerdata for denne fagkoden.</div>
                              ) : (
                                <div className="divide-y divide-slate-200">
                                  {subjectTeacherRows.map((teacherRow, teacherIdx) => {
                                    const checked = selectedTeacherKeys.includes(teacherRow.key)
                                    return (
                                      <div key={teacherRow.key} className="px-3 py-2">
                                        <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={e => {
                                              const nextChecked = e.currentTarget.checked
                                              setSelectedTeacherKeysBySubject(prev => {
                                                const current = prev[row.label] ?? []
                                                const next = nextChecked
                                                  ? Array.from(new Set([...current, teacherRow.key]))
                                                  : current.filter(key => key !== teacherRow.key)
                                                return { ...prev, [row.label]: next }
                                              })
                                            }}
                                            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                          />
                                          {maskTeacher(teacherRow.label, teacherIdx)}
                                          <span className="text-xs text-slate-500">({Object.keys(teacherRow.yearly).length} år)</span>
                                        </label>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {expandedGraph && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-6xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm sm:text-base font-semibold text-slate-900">{expandedGraph.title}</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadExpandedGraphAsSvg}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-sky-50 text-sky-800 border-sky-300 hover:bg-sky-100"
                >
                  Last ned SVG
                </button>
                <button
                  type="button"
                  onClick={downloadExpandedGraphAsPng}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                >
                  Last ned PNG
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedGraph(null)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  aria-label="Lukk"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-auto">
              <TrendGraph
                labels={expandedGraph.labels}
                series={expandedGraph.series}
                width={1000}
                height={420}
                svgRef={modalSvgRef}
                xAxisLabelFilter={expandedGraph.xAxisLabelFilter}
                labelMap={Object.fromEntries(expandedGraph.labels.map(label => {
                  if (expandedGraph.xAxisLabelFilter && termH2DisplayMap[label]) return [label, termH2DisplayMap[label]]
                  if (schoolYearDisplayMap[label]) return [label, schoolYearDisplayMap[label]]
                  if (termTimelineDisplayMap[label]) return [label, termTimelineDisplayMap[label]]
                  return [label, label]
                }))}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
