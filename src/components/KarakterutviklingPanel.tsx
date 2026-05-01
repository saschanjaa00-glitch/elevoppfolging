import { useMemo, useRef, useState, type RefObject } from 'react'
import * as XLSX from 'xlsx'
import { ChevronDown, ChevronRight, Upload, X, Expand } from 'lucide-react'
import type { GradeRecord } from '../types'

type ViewMode = 'subject' | 'teacher'

interface Props {
  baseGrades: GradeRecord[]
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
  values,
  width = 560,
  height = 180,
  svgRef,
  labelMap,
}: {
  labels: string[]
  values: Record<string, { avg: number; count: number }>
  width?: number
  height?: number
  svgRef?: RefObject<SVGSVGElement | null>
  labelMap?: Record<string, string>
}) {
  const padX = 34
  const padY = 24

  const points = labels
    .map((label, idx) => {
      const avg = values[label]?.avg
      if (avg === undefined) return null
      const x = padX + (idx * (width - padX * 2)) / Math.max(1, labels.length - 1)
      const y = padY + ((6 - avg) * (height - padY * 2)) / 5
      return { x, y, label, avg }
    })
    .filter((p): p is { x: number; y: number; label: string; avg: number } => Boolean(p))

  if (points.length === 0) {
    return <div className="text-sm text-slate-500">Ingen grafdata for denne raden.</div>
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg ref={svgRef} width={width} height={height} className="bg-slate-50 rounded border border-slate-200">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#94a3b8" strokeWidth="1" />
        <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="#94a3b8" strokeWidth="1" />
        {['1', '2', '3', '4', '5', '6'].map(level => {
          const y = padY + ((6 - Number(level)) * (height - padY * 2)) / 5
          return <line key={level} x1={padX} y1={y} x2={width - padX} y2={y} stroke="#e2e8f0" strokeWidth="1" />
        })}
        <polyline
          fill="none"
          stroke="#0284c7"
          strokeWidth="2"
          points={points.map(p => `${p.x},${p.y}`).join(' ')}
        />
        {points.map(p => (
          <g key={p.label}>
            <circle cx={p.x} cy={p.y} r="4" fill="#0ea5e9" />
            <text x={p.x} y={height - 8} textAnchor="middle" fontSize="11" fill="#334155">
              {labelMap?.[p.label] ?? p.label}
            </text>
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="11" fill="#0f172a">
              {p.avg.toFixed(2).replace('.', ',')}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function KarakterutviklingPanel({ baseGrades }: Props) {
  const [uploadedGrades, setUploadedGrades] = useState<GradeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('subject')
  const [filterText, setFilterText] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [expandedTeacherKey, setExpandedTeacherKey] = useState<string | null>(null)
  const [expandedGraph, setExpandedGraph] = useState<null | {
    title: string
    labels: string[]
    values: Record<string, { avg: number; count: number }>
    fileBase: string
  }>(null)
  const modalSvgRef = useRef<SVGSVGElement | null>(null)

  const allGrades = useMemo(() => [...baseGrades, ...uploadedGrades], [baseGrades, uploadedGrades])

  const rows = useMemo(() => {
    const source = allGrades.filter(g => g.skoleår)
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
  }, [allGrades, viewMode])

  const teacherRowsBySubject = useMemo(() => {
    const source = allGrades.filter(g => g.skoleår)
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
  }, [allGrades])

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

  const normalizedFilter = useMemo(
    () => normalizeHeader(filterText),
    [filterText]
  )

  const filteredRows = useMemo(() => {
    if (!normalizedFilter) return rows
    return rows.filter(row => normalizeHeader(row.label).includes(normalizedFilter))
  }, [rows, normalizedFilter])

  const exportFilteredToExcel = () => {
    void import('exceljs').then(async exceljs => {
      const workbook = new exceljs.Workbook()
      const worksheet = workbook.addWorksheet('Karakterutvikling', {
        views: [{ state: 'frozen', ySplit: 1 }],
      })

      const headers = [
        viewMode === 'subject' ? 'Fagkode' : 'Lærer',
        ...schoolYears.flatMap(year => [`${formatSchoolYearLabel(year)} H2`, `${formatSchoolYearLabel(year)} (H1)`]),
        'Endring H2',
        '(H1)',
      ]
      worksheet.addRow(headers)

      const addRowForTrend = (label: string, row: TrendRow) => {
        const firstYear = schoolYears[0]
        const lastYear = schoolYears[schoolYears.length - 1]
        const startH2 = firstYear ? row.yearlyH2[firstYear]?.avg : undefined
        const endH2 = lastYear ? row.yearlyH2[lastYear]?.avg : undefined
        const deltaH2 = startH2 !== undefined && endH2 !== undefined ? endH2 - startH2 : null
        const startH1 = firstYear ? row.yearlyH1[firstYear]?.avg : undefined
        const endH1 = lastYear ? row.yearlyH1[lastYear]?.avg : undefined
        const deltaH1 = startH1 !== undefined && endH1 !== undefined ? endH1 - startH1 : null

        worksheet.addRow([
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
        ])
      }

      filteredRows.forEach(row => {
        addRowForTrend(row.label, row)
        if (viewMode === 'subject') {
          const teacherRows = teacherRowsBySubject.get(row.label) ?? []
          teacherRows.forEach(teacherRow => {
            addRowForTrend(`  - ${teacherRow.label}`, teacherRow)
          })
        }
      })

      worksheet.columns.forEach((col, idx) => {
        col.width = idx === 0 ? 28 : 12
      })

      const headerRow = worksheet.getRow(1)
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF0F172A' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
      })

      for (let i = 2; i <= worksheet.rowCount; i += 1) {
        worksheet.getRow(i).getCell(1).alignment = { horizontal: 'left' }
        for (let col = 2; col <= headers.length; col += 1) {
          worksheet.getRow(i).getCell(col).numFmt = '0.00'
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
      const subtitle = `Eksportert fra Karakterutvikling`
      const headerHeight = 72
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height + headerHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Kunne ikke opprette tegneflate for eksport.')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 24px Segoe UI, Arial, sans-serif'
      ctx.fillText(title, 20, 32)
      ctx.fillStyle = '#475569'
      ctx.font = '16px Segoe UI, Arial, sans-serif'
      ctx.fillText(subtitle, 20, 56)

      ctx.drawImage(image, 0, headerHeight)

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
            onClick={() => setViewMode('subject')}
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
            onClick={() => setViewMode('teacher')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              viewMode === 'teacher'
                ? 'bg-sky-100 text-sky-800 border-sky-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Per lærer
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          id="karakterutvikling-upload"
          type="file"
          multiple
          accept=".xlsx,.xls,.csv"
          onChange={e => handleFileImport(e.currentTarget.files)}
          className="hidden"
        />
        <label
          htmlFor="karakterutvikling-upload"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-sky-50 text-sky-800 border-sky-300 hover:bg-sky-100 cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          {loading ? 'Laster opp...' : 'Last opp karakterfiler'}
        </label>
        <button
          type="button"
          onClick={() => {
            setUploadedGrades([])
            setFilterText('')
            setExpandedKey(null)
            setExpandedTeacherKey(null)
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
            setExpandedTeacherKey(null)
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
          Eksporter filtrerte linjer
        </button>
        <span className="text-xs text-slate-500">
          Datagrunnlag: {allGrades.length} karakterrader ({uploadedGrades.length} fra opplasting). Viser {filteredRows.length} av {rows.length} linjer.
        </span>
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
                  {viewMode === 'subject' ? 'Fagkode' : 'Lærer'}
                </th>
                {schoolYears.map(year => (
                  <th
                    key={year}
                    className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    {schoolYearDisplayMap[year] ?? year}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  Endring
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
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

                return (
                  <>
                    <tr
                      key={row.key}
                      className="border-b border-slate-100 hover:bg-sky-50/40 cursor-pointer"
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedKey(null)
                          setExpandedTeacherKey(null)
                        } else {
                          setExpandedKey(row.key)
                          setExpandedTeacherKey(null)
                        }
                      }}
                    >
                      <td className="py-2 px-3 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          {row.label}
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
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <td colSpan={schoolYears.length + 2} className="py-3 px-3 space-y-3">
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Halvår 2</div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedGraph({
                                    title: `${row.label} - Halvår 2`,
                                    labels: schoolYears,
                                    values: row.yearlyH2,
                                    fileBase: `karakterutvikling-${normalizeHeader(row.label)}-h2`,
                                  })}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  <Expand className="w-3.5 h-3.5" />
                                  Utvid
                                </button>
                              </div>
                              <TrendGraph labels={schoolYears} values={row.yearlyH2} labelMap={schoolYearDisplayMap} />
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Halvår 1 og 2 (separate)</div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedGraph({
                                    title: `${row.label} - Halvår 1 og 2`,
                                    labels: termTimelineLabels,
                                    values: row.termSeries,
                                    fileBase: `karakterutvikling-${normalizeHeader(row.label)}-h1-h2`,
                                  })}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  <Expand className="w-3.5 h-3.5" />
                                  Utvid
                                </button>
                              </div>
                              <TrendGraph labels={termTimelineLabels} values={row.termSeries} labelMap={termTimelineDisplayMap} />
                            </div>
                          </div>

                          {viewMode === 'subject' && (
                            <div className="rounded-lg border border-slate-200 bg-white">
                              <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Lærere i faget
                              </div>
                              {subjectTeacherRows.length === 0 ? (
                                <div className="px-3 py-3 text-sm text-slate-500">Ingen lærerdata for denne fagkoden.</div>
                              ) : (
                                <div className="divide-y divide-slate-200">
                                  {subjectTeacherRows.map(teacherRow => {
                                    const teacherExpanded = expandedTeacherKey === teacherRow.key
                                    return (
                                      <div key={teacherRow.key} className="px-3 py-2">
                                        <button
                                          type="button"
                                          className="w-full flex items-center justify-between text-left hover:text-sky-800"
                                          onClick={() => setExpandedTeacherKey(teacherExpanded ? null : teacherRow.key)}
                                        >
                                          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
                                            {teacherExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                            {teacherRow.label}
                                          </span>
                                          <span className="text-xs text-slate-500">
                                            {Object.keys(teacherRow.yearly).length} år
                                          </span>
                                        </button>
                                        {teacherExpanded && (
                                          <div className="mt-2">
                                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Halvår 2</div>
                                                  <button
                                                    type="button"
                                                    onClick={() => setExpandedGraph({
                                                      title: `${row.label} - ${teacherRow.label} - Halvår 2`,
                                                      labels: schoolYears,
                                                      values: teacherRow.yearlyH2,
                                                      fileBase: `karakterutvikling-${normalizeHeader(row.label)}-${normalizeHeader(teacherRow.label)}-h2`,
                                                    })}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                                                  >
                                                    <Expand className="w-3.5 h-3.5" />
                                                    Utvid
                                                  </button>
                                                </div>
                                                <TrendGraph labels={schoolYears} values={teacherRow.yearlyH2} labelMap={schoolYearDisplayMap} />
                                              </div>
                                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Halvår 1 og 2 (separate)</div>
                                                  <button
                                                    type="button"
                                                    onClick={() => setExpandedGraph({
                                                      title: `${row.label} - ${teacherRow.label} - Halvår 1 og 2`,
                                                      labels: termTimelineLabels,
                                                      values: teacherRow.termSeries,
                                                      fileBase: `karakterutvikling-${normalizeHeader(row.label)}-${normalizeHeader(teacherRow.label)}-h1-h2`,
                                                    })}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                                                  >
                                                    <Expand className="w-3.5 h-3.5" />
                                                    Utvid
                                                  </button>
                                                </div>
                                                <TrendGraph labels={termTimelineLabels} values={teacherRow.termSeries} labelMap={termTimelineDisplayMap} />
                                              </div>
                                            </div>
                                          </div>
                                        )}
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
                values={expandedGraph.values}
                width={1000}
                height={420}
                svgRef={modalSvgRef}
                labelMap={Object.fromEntries(expandedGraph.labels.map(label => {
                  if (termTimelineDisplayMap[label]) return [label, termTimelineDisplayMap[label]]
                  if (schoolYearDisplayMap[label]) return [label, schoolYearDisplayMap[label]]
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
