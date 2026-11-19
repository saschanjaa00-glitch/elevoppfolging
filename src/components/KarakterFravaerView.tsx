import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Table2 } from 'lucide-react'
import type { DataStore, StudentGender } from '../types'
import { normalizeMatch } from '../studentInfoUtils'
import {
  CHART_MODE_LABEL,
  CHART_MODE_SINGULAR,
  CHART_MODE_UNIT,
  FRAVAER_AVERAGE_COLOR,
  FRAVAER_ROUNDING_OPTIONS,
  FRAVAER_TYPE_INFO,
  GENDER_COLOR,
  GENDER_LABEL,
  GRADE_COLOR,
  GRADE_LABELS,
  MARGIN,
  PLOT_RIGHT,
  PLOT_WIDTH,
  SINGLE_DOT_COLOR,
  UNKNOWN_GENDER_COLOR,
  bucketX,
  computeBoxStats,
  emptyParts,
  fmt,
  fmtPct,
  groupIntoBuckets,
  jitter,
  linearRegression,
  makeXScale,
  median,
  mostCommon,
  niceMax,
  trinnColor,
  useGradeAbsenceData,
} from '../gradeAbsenceUtils'
import type {
  AverageVariant,
  ChartMode,
  DataPoint,
  DotColorBy,
  FravaerType,
  GradeLabel,
  HistogramMode,
  Regression,
  XScale,
} from '../gradeAbsenceUtils'
import {
  AxisFrame,
  ChartCard,
  ChartSvg,
  GradeAbsenceFilterSidebar,
  GradeAbsenceOptionsBar,
  LegendDot,
  SummaryCard,
  ToggleButton,
  XAxisBackground,
} from './GradeAbsenceKit'

interface Props {
  data: DataStore
}

const CHART_MODE_DESCRIPTION: Record<ChartMode, string> = {
  elev: 'Per elev: snitt av fraværsprosenten i elevens fag mot snitt av elevens tallkarakterer.',
  fag: 'Per fag: snitt av fraværet mot snittkarakteren for alle elever i faget.',
  faggruppe: 'Per faggruppe: snitt av fraværet mot snittkarakteren for alle elever i faggruppen.',
}

// What the Tabell under the scatter plot lists for each dot.
interface PointRow {
  name: string
  detail: string
  group: string
  studentCount: number
  gradeCount: number
  ivCount: number
  parts: Record<FravaerType, number>
}

interface FravaerAverage {
  absence: number
  grade: number
  n: number
}

interface BasePoint {
  studentKey: string
  absence: number
  grade: number | null
  gradeLabel: GradeLabel
}

// What the chart draws: either one grade per fag, or one student's averages across fag.
interface PlotPoint extends BasePoint {
  id: string
  gender: StudentGender | null
  level: string
  tooltip: string
  hasIv: boolean
  // Number of grades behind the point; used to size fag/faggruppe dots.
  weight: number
  row: PointRow
}

interface GroupTrend {
  key: string
  label: string
  color: string
  n: number
  regression: Regression
}

interface Bucket<T extends BasePoint = DataPoint> {
  key: string
  label: string
  lo: number
  hi: number
  overflow: boolean
  points: T[]
  studentCount: number
  numericCount: number
  avgGrade: number | null
  medianGrade: number | null
  counts: Record<GradeLabel, number>
  negativeShare: number | null
}

function computeBuckets<T extends BasePoint>(points: T[], step: number, cap: number): Bucket<T>[] {
  return groupIntoBuckets(points, step, cap).map(range => {
    const bucketPoints = range.points
    const counts = emptyCounts()
    bucketPoints.forEach(p => { counts[p.gradeLabel]++ })
    const numeric = bucketPoints.flatMap(p => (p.grade === null ? [] : [p.grade]))
    return {
      ...range,
      studentCount: new Set(bucketPoints.map(p => p.studentKey)).size,
      numericCount: numeric.length,
      avgGrade: numeric.length > 0 ? numeric.reduce((sum, g) => sum + g, 0) / numeric.length : null,
      medianGrade: median(numeric),
      counts,
      negativeShare: bucketPoints.length > 0 ? ((counts.IV + counts['1']) / bucketPoints.length) * 100 : null,
    }
  })
}

// Pearson correlation and least-squares line between fravær % and grade (points without a numeric grade excluded).
function computeRegression(points: BasePoint[]): Regression {
  return linearRegression(points.flatMap(p => (p.grade === null ? [] : [[p.absence, p.grade] as [number, number]])))
}

function emptyCounts(): Record<GradeLabel, number> {
  return { IV: 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
}

export default function KarakterFravaerView({ data }: Props) {
  const state = useGradeAbsenceData(data)
  const {
    term, step, cap, compareBy, genderFilter, hasGenderData,
    activeTypes, onlyX, activeTypesLabel, allPoints, points, graphSourcePoints,
  } = state
  const [histogramMode, setHistogramMode] = useState<HistogramMode>('antall')
  const [chartMode, setChartMode] = useState<ChartMode>('elev')
  const [averageVariant, setAverageVariant] = useState<AverageVariant>('bars')
  const [showTrend, setShowTrend] = useState(true)
  const [showFravaerAverage, setShowFravaerAverage] = useState(false)
  const [fravaerRounding, setFravaerRounding] = useState(0.5)
  const [showPointTable, setShowPointTable] = useState(false)

  const buckets = useMemo(() => computeBuckets(points, step, cap), [points, step, cap])

  const summary = useMemo(() => {
    const numeric = points.filter(p => p.grade !== null)
    const n = numeric.length
    const counts = emptyCounts()
    points.forEach(p => { counts[p.gradeLabel]++ })
    const avgGrade = n > 0 ? numeric.reduce((s, p) => s + p.grade!, 0) / n : null
    const avgAbsence = points.length > 0 ? points.reduce((s, p) => s + p.absence, 0) / points.length : null

    return {
      count: points.length,
      studentCount: new Set(points.map(p => p.studentKey)).size,
      numericCount: n,
      avgGrade,
      medianGrade: median(numeric.map(p => p.grade!)),
      avgAbsence,
      counts,
      negativeShare: points.length > 0 ? ((counts.IV + counts['1']) / points.length) * 100 : null,
      ...computeRegression(points),
    }
  }, [points])

  // One point per elev, fag or faggruppe: mean fravær vs. mean of the numeric grades (IV excluded).
  // In fag/faggruppe mode each unit is split by kjønn or trinn when comparing, so group trendlines use like-for-like points.
  // Units with only IV land in the IV lane; the histogram stacks units by rounded average.
  const chartPoints = useMemo<PlotPoint[]>(() => {
    const split = (p: DataPoint) => {
      if (chartMode === 'elev') return ''
      if (compareBy === 'kjonn') return `|${p.gender ?? 'ukjent'}`
      if (compareBy === 'trinn') return `|${p.level}`
      return ''
    }
    const keyOf = (p: DataPoint) => {
      if (chartMode === 'elev') return p.studentKey
      if (chartMode === 'fag') return `fag:${normalizeMatch(p.subject)}${split(p)}`
      return `gruppe:${normalizeMatch(p.subjectGroup)}${split(p)}`
    }
    const groups = new Map<string, DataPoint[]>()
    graphSourcePoints.forEach(p => {
      const key = keyOf(p)
      const list = groups.get(key)
      if (list) list.push(p)
      else groups.set(key, [p])
    })

    return Array.from(groups.entries()).map(([key, list]) => {
      const numeric = list.flatMap(p => (p.grade === null ? [] : [p.grade]))
      const ivCount = list.length - numeric.length
      const avgGrade = numeric.length > 0 ? numeric.reduce((s, g) => s + g, 0) / numeric.length : null
      const avgAbsence = list.reduce((s, p) => s + p.absence, 0) / list.length
      const avgParts = emptyParts()
      activeTypes.forEach(type => {
        avgParts[type] = list.reduce((s, p) => s + p.parts[type], 0) / list.length
      })
      const first = list[0]
      const ivText = ivCount > 0 ? ` · ${ivCount} IV` : ''
      const partsText = onlyX ? '' : ` (${activeTypes.map(type => `${FRAVAER_TYPE_INFO[type].label} ${fmt(avgParts[type], 1)}`).join(' + ')})`
      const studentCount = new Set(list.map(p => p.studentKey)).size
      const group = compareBy === 'kjonn'
        ? (first.gender ? GENDER_LABEL[first.gender] : 'Ukjent')
        : compareBy === 'trinn' ? `VG${first.level}` : ''

      let title: string
      let countLine: string
      let row: Pick<PointRow, 'name' | 'detail'>
      if (chartMode === 'elev') {
        title = `${first.navn} (${first.className})`
        countLine = `${list.length} fag`
        row = { name: first.navn, detail: first.className }
      } else {
        const teacher = mostCommon(list.map(p => p.teacher))
        title = chartMode === 'fag'
          ? first.subject
          : `${first.subjectGroup} – ${first.subject} · ${teacher}`
        if (compareBy === 'kjonn') title += ` (${first.gender ? GENDER_LABEL[first.gender] : 'ukjent kjønn'})`
        if (compareBy === 'trinn') title += ` (VG${first.level})`
        countLine = `${studentCount} elever · ${list.length} karakterer`
        row = chartMode === 'fag'
          ? { name: first.subject, detail: '' }
          : { name: first.subjectGroup, detail: `${first.subject} · ${teacher}` }
      }

      return {
        id: key,
        studentKey: key,
        absence: avgAbsence,
        grade: avgGrade,
        gradeLabel: avgGrade === null ? 'IV' : (String(Math.min(6, Math.max(1, Math.round(avgGrade)))) as GradeLabel),
        gender: chartMode === 'elev' || compareBy === 'kjonn' ? first.gender : null,
        level: chartMode === 'elev' || compareBy === 'trinn' ? first.level : mostCommon(list.map(p => p.level)),
        hasIv: ivCount > 0,
        weight: list.length,
        tooltip: `${title}\n${countLine}\nSnitt fravær ${fmt(avgAbsence, 1)} %${partsText}\nSnittkarakter ${fmt(avgGrade)}${ivText}`,
        row: { ...row, group, studentCount, gradeCount: list.length, ivCount, parts: avgParts },
      }
    })
  }, [graphSourcePoints, chartMode, compareBy, activeTypes, onlyX])

  const chartUnit = CHART_MODE_UNIT[chartMode]
  const chartBuckets = useMemo(() => computeBuckets(chartPoints, step, cap), [chartPoints, step, cap])
  const chartRegression = useMemo(() => computeRegression(chartPoints), [chartPoints])
  const fravaerLabel = onlyX ? 'Udokumentert fravær' : `Fravær (${activeTypesLabel})`
  const xScale = useMemo(
    () => makeXScale(chartPoints, step, cap, `${fravaerLabel} i faget (%)`),
    [chartPoints, step, cap, fravaerLabel]
  )

  // One trendline per kjønn or trinn, computed on the same points as the chart.
  const groupTrends = useMemo<GroupTrend[]>(() => {
    if (compareBy === 'none') return []
    const groups = compareBy === 'kjonn'
      ? (['girl', 'boy'] as StudentGender[]).map(gender => ({
          key: gender,
          label: GENDER_LABEL[gender],
          color: GENDER_COLOR[gender],
          points: chartPoints.filter(p => p.gender === gender),
        }))
      : Array.from(new Set(chartPoints.map(p => p.level).filter(Boolean))).sort().map(level => ({
          key: level,
          label: `VG${level}`,
          color: trinnColor(level),
          points: chartPoints.filter(p => p.level === level),
        }))
    return groups
      .filter(group => group.points.length > 0)
      .map(group => ({
        key: group.key,
        label: group.label,
        color: group.color,
        n: group.points.length,
        regression: computeRegression(group.points),
      }))
  }, [compareBy, chartPoints])

  const colorByGender = genderFilter === 'all' && hasGenderData
  const dotColorBy: DotColorBy = compareBy === 'trinn'
    ? 'trinn'
    : compareBy === 'kjonn' || (chartMode === 'elev' && colorByGender) ? 'gender' : 'single'
  const trinnLegend = useMemo(
    () => Array.from(new Set(chartPoints.map(p => p.level).filter(Boolean))).sort(),
    [chartPoints]
  )

  // Average grade for each fravær value, with fravær rounded to the nearest `fravaerRounding` %.
  const fravaerAverages = useMemo<FravaerAverage[]>(() => {
    const groups = new Map<number, { sum: number; n: number }>()
    chartPoints.forEach(p => {
      if (p.grade === null) return
      const rounded = Math.round(p.absence / fravaerRounding + 1e-9) * fravaerRounding
      const group = groups.get(rounded)
      if (group) {
        group.sum += p.grade
        group.n++
      } else {
        groups.set(rounded, { sum: p.grade, n: 1 })
      }
    })
    return Array.from(groups.entries())
      .map(([absence, { sum, n }]) => ({ absence, grade: sum / n, n }))
      .sort((a, b) => a.absence - b.absence)
  }, [chartPoints, fravaerRounding])

  if (data.grades.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 text-sm text-slate-600">
        Karakter vs. fravær krever en karakterfil. Last opp karakterer sammen med fraværsfilen for å se sammenhengen.
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <GradeAbsenceFilterSidebar state={state} />

      <div className="flex-1 min-w-0 space-y-6">
      {points.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 text-sm text-slate-600">
          {allPoints.length === 0
            ? `Fant ingen T${term}-karakterer som kunne kobles til fravær i samme fag.`
            : 'Ingen datapunkter med valgte filtre.'}
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <SummaryCard label="Karakterer" value={summary.count} hint="Antall fag-karakterer koblet til fravær i samme fag" />
            <SummaryCard label="Elever" value={summary.studentCount} />
            <SummaryCard label="Snitt karakter" value={fmt(summary.avgGrade)} hint="IV er ikke med i snittet" />
            <SummaryCard label={onlyX ? 'Snitt fravær' : `Snitt fravær (${activeTypesLabel})`} value={`${fmt(summary.avgAbsence, 1)} %`} />
            <SummaryCard label="Andel 1/IV" value={`${fmt(summary.negativeShare, 1)} %`} />
            <SummaryCard
              label="Korrelasjon (r)"
              value={fmt(summary.r)}
              hint={summary.slope !== null
                ? `Pearson-korrelasjon mellom fravær og karakter (IV ikke med). Trendlinjen faller ${fmt(-summary.slope * 10)} karakterpoeng per 10 % fravær.`
                : 'Pearson-korrelasjon mellom fravær og karakter (IV ikke med).'}
            />
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
            <h2 className="text-base font-semibold text-slate-900">Karaktersnitt per fraværsintervall</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Hvert datapunkt er én elevs T{term}-karakter i ett fag, sammen med elevens fravær i det samme faget.
              Intervallene inkluderer nedre grense. IV er ikke med i snittet, men telles i fordelingen.
              {!onlyX && ` Fravær er summen av ${activeTypesLabel}.`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="bg-slate-50">
                    {[onlyX ? 'Fravær' : `Fravær (${activeTypesLabel})`, 'Karakterer', 'Elever', 'Snitt', 'Median', ...GRADE_LABELS, 'Andel 1/IV'].map((heading, index) => (
                      <th
                        key={heading}
                        className={`py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 ${index === 0 ? 'text-left' : 'text-right'}`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buckets.map(bucket => {
                    const empty = bucket.points.length === 0
                    return (
                      <tr key={bucket.key} className={`border-b border-slate-100 ${empty ? 'text-slate-300' : 'text-slate-700'} hover:bg-slate-50`}>
                        <td className="py-2 px-3 font-medium whitespace-nowrap border-b border-slate-100">{bucket.label}</td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">{bucket.points.length}</td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">{bucket.studentCount}</td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">
                          <div className="flex items-center justify-end gap-2">
                            {bucket.avgGrade !== null && (
                              <div className="hidden sm:block w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full bg-sky-500" style={{ width: `${(bucket.avgGrade / 6) * 100}%` }} />
                              </div>
                            )}
                            <span className="font-semibold w-10 text-right">{fmt(bucket.avgGrade)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">{fmt(bucket.medianGrade, 1)}</td>
                        {GRADE_LABELS.map(label => (
                          <td
                            key={label}
                            className={`py-2 px-3 text-right border-b border-slate-100 ${
                              (label === 'IV' || label === '1') && bucket.counts[label] > 0 ? 'text-red-700 font-semibold' : ''
                            }`}
                          >
                            {bucket.counts[label] || (empty ? '' : '·')}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-right border-b border-slate-100">
                          {bucket.negativeShare === null ? '' : `${fmt(bucket.negativeShare, 1)} %`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold text-slate-900">
                    <td className="py-2 px-3 border-t border-slate-200">Totalt</td>
                    <td className="py-2 px-3 text-right border-t border-slate-200">{summary.count}</td>
                    <td className="py-2 px-3 text-right border-t border-slate-200">{summary.studentCount}</td>
                    <td className="py-2 px-3 text-right border-t border-slate-200">{fmt(summary.avgGrade)}</td>
                    <td className="py-2 px-3 text-right border-t border-slate-200">{fmt(summary.medianGrade, 1)}</td>
                    {GRADE_LABELS.map(label => (
                      <td key={label} className="py-2 px-3 text-right border-t border-slate-200">{summary.counts[label]}</td>
                    ))}
                    <td className="py-2 px-3 text-right border-t border-slate-200">{fmt(summary.negativeShare, 1)} %</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Charts — three separate graphs sharing the same fravær axis */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Grafer</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {CHART_MODE_DESCRIPTION[chartMode]}
                  {' '}Hold musepekeren over punkter og søyler for detaljer.
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                <ToggleButton active={chartMode === 'elev'} onClick={() => setChartMode('elev')}>Per elev</ToggleButton>
                <ToggleButton active={chartMode === 'fag'} onClick={() => setChartMode('fag')}>Per fag</ToggleButton>
                <ToggleButton active={chartMode === 'faggruppe'} onClick={() => setChartMode('faggruppe')}>Per faggruppe</ToggleButton>
              </div>
            </div>
            <GradeAbsenceOptionsBar state={state} />
          </div>

          <ChartCard
            title={`Snittfravær og snittkarakter per ${CHART_MODE_SINGULAR[chartMode]}`}
            subtitle={
              `${chartPoints.length} ${chartUnit} · r = ${fmt(chartRegression.r)}`
              + (chartRegression.slope !== null ? ` · trendlinjen endres ${fmt(chartRegression.slope * 10)} karakterpoeng per 10 % fravær` : '')
            }
            footer={
              <div className="mt-4 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPointTable(current => !current)}
                  aria-expanded={showPointTable}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Table2 className="w-4 h-4" />
                  {showPointTable ? 'Skjul tabell' : 'Tabell'}
                </button>
                {showPointTable && (
                  <PointTable
                    points={chartPoints}
                    mode={chartMode}
                    activeTypes={activeTypes}
                    showParts={!onlyX}
                    showGroup={compareBy !== 'none'}
                  />
                )}
              </div>
            }
            controls={
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" checked={showFravaerAverage} onChange={e => setShowFravaerAverage(e.target.checked)} className="rounded border-slate-300" />
                  Snitt per fravær
                </label>
                <label className={`inline-flex items-center gap-1.5 text-sm ${showFravaerAverage ? 'text-slate-600' : 'text-slate-300'}`}>
                  avrundet til
                  <select
                    value={fravaerRounding}
                    disabled={!showFravaerAverage}
                    onChange={e => setFravaerRounding(Number(e.target.value))}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed"
                  >
                    {FRAVAER_ROUNDING_OPTIONS.map(option => (
                      <option key={option} value={option}>{fmtPct(option)} %</option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" checked={showTrend} onChange={e => setShowTrend(e.target.checked)} className="rounded border-slate-300" />
                  Trendlinje
                </label>
              </div>
            }
            legend={
              <>
                {dotColorBy === 'gender' && (
                  <>
                    <LegendDot color={GENDER_COLOR.girl} label="Jenter" />
                    <LegendDot color={GENDER_COLOR.boy} label="Gutter" />
                    <LegendDot color={UNKNOWN_GENDER_COLOR} label="Ukjent kjønn" />
                  </>
                )}
                {dotColorBy === 'trinn' && trinnLegend.map(level => (
                  <LegendDot key={level} color={trinnColor(level)} label={`VG${level}`} />
                ))}
                {dotColorBy === 'single' && (
                  <LegendDot color={SINGLE_DOT_COLOR} label={CHART_MODE_LABEL[chartMode]} />
                )}
                {chartMode === 'elev' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: GRADE_COLOR.IV }} />
                    Har minst én IV
                  </span>
                ) : (
                  <span className="text-slate-500">Større prikk = flere karakterer</span>
                )}
                {showFravaerAverage && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative inline-block w-5 h-0.5" style={{ backgroundColor: FRAVAER_AVERAGE_COLOR }}>
                      <span className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ backgroundColor: FRAVAER_AVERAGE_COLOR }} />
                    </span>
                    Snitt per {fmtPct(fravaerRounding)} % fravær (større prikk = flere {chartUnit})
                  </span>
                )}
                {showTrend && chartRegression.slope !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-5 border-t-2 border-dashed border-slate-700" />
                    Trendlinje{compareBy !== 'none' ? ' (alle)' : ''}
                  </span>
                )}
              </>
            }
          >
            {groupTrends.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {groupTrends.map(group => (
                  <div key={group.key} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                    <span className="inline-block w-5 border-t-[3px]" style={{ borderColor: group.color }} />
                    <span className="font-semibold">{group.label}</span>
                    <span className="text-slate-500">{group.n} {chartUnit}</span>
                    {group.regression.slope === null ? (
                      <span className="text-slate-400">for få data</span>
                    ) : (
                      <span>r = {fmt(group.regression.r)} · {fmt(group.regression.slope * 10)} per 10 %</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <ScatterChart
              points={chartPoints}
              scale={xScale}
              mode={chartMode}
              dotColorBy={dotColorBy}
              groupTrends={groupTrends}
              fravaerAverages={showFravaerAverage ? fravaerAverages : null}
              trend={showTrend && chartRegression.slope !== null && chartRegression.intercept !== null
                ? { slope: chartRegression.slope, intercept: chartRegression.intercept }
                : null}
            />
          </ChartCard>

          <ChartCard
            title={averageVariant === 'box' ? 'Karakterspredning per fraværsintervall' : 'Snittkarakter per fraværsintervall'}
            subtitle={averageVariant === 'box'
              ? `Boksplott per intervall: boksen dekker midterste halvdel (25–75 %), streken i boksen er medianen og prikken er snittet. Linjene går til laveste og høyeste verdi innenfor 1,5 × boksens høyde; verdier utenfor vises som små ringer. Bygger på snittet for hver ${CHART_MODE_SINGULAR[chartMode]}; IV er ikke med.`
              : `Snittet av snittkarakterene for hver ${CHART_MODE_SINGULAR[chartMode]} i intervallet. IV er ikke med.`}
            controls={
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
                <ToggleButton active={averageVariant === 'bars'} onClick={() => setAverageVariant('bars')}>Søyler</ToggleButton>
                <ToggleButton active={averageVariant === 'box'} onClick={() => setAverageVariant('box')}>Boksplott</ToggleButton>
              </div>
            }
            legend={
              <>
                {averageVariant === 'box' && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-4 h-3 rounded-sm bg-sky-200 border border-sky-600" />
                      25–75 %
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-4 border-t-2 border-sky-900" />
                      Median
                    </span>
                    <LegendDot color="#0c4a6e" label="Snitt" />
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full border border-slate-500" />
                      Uteligger
                    </span>
                  </>
                )}
              </>
            }
          >
            <AverageChart buckets={chartBuckets} scale={xScale} mode={chartMode} variant={averageVariant} />
          </ChartCard>

          <ChartCard
            title={`Fordeling av ${chartUnit} per fraværsintervall`}
            subtitle={`Antall ${chartUnit} i hvert intervall, fordelt på avrundet snittkarakter.`}
            controls={
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
                <ToggleButton active={histogramMode === 'antall'} onClick={() => setHistogramMode('antall')}>Antall</ToggleButton>
                <ToggleButton active={histogramMode === 'andel'} onClick={() => setHistogramMode('andel')}>Andel</ToggleButton>
              </div>
            }
            legend={
              <>
                {GRADE_LABELS.map(label => (
                  <span key={label} className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: GRADE_COLOR[label] }} />
                    {label === 'IV' ? 'Bare IV' : label}
                  </span>
                ))}
              </>
            }
          >
            <HistogramChart buckets={chartBuckets} scale={xScale} mode={chartMode} histogramMode={histogramMode} />
          </ChartCard>
        </>
      )}
      </div>
    </div>
  )
}

type PointSortKey = 'name' | 'detail' | 'group' | 'students' | 'grades' | 'absence' | FravaerType | 'grade' | 'iv'

// Compact list of the dots currently plotted in the scatter chart.
function PointTable({ points, mode, activeTypes, showParts, showGroup }: {
  points: PlotPoint[]
  mode: ChartMode
  activeTypes: FravaerType[]
  showParts: boolean
  showGroup: boolean
}) {
  const [sort, setSort] = useState<{ key: PointSortKey; dir: 'asc' | 'desc' }>({ key: 'absence', dir: 'desc' })

  const sorted = useMemo(() => {
    const value = (p: PlotPoint): string | number | null => {
      switch (sort.key) {
        case 'name': return p.row.name
        case 'detail': return p.row.detail
        case 'group': return p.row.group
        case 'students': return p.row.studentCount
        case 'grades': return p.row.gradeCount
        case 'absence': return p.absence
        case 'grade': return p.grade
        case 'iv': return p.row.ivCount
        default: return p.row.parts[sort.key]
      }
    }
    return [...points].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      // Missing values (e.g. no numeric grade) always go last.
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      const diff = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb), 'nb-NO', { numeric: true })
        : va - vb
      return sort.dir === 'asc' ? diff : -diff
    })
  }, [points, sort])

  const toggleSort = (key: PointSortKey) => {
    setSort(current => current.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' || key === 'detail' || key === 'group' ? 'asc' : 'desc' })
  }

  const columns: Array<{ key: PointSortKey; label: string; numeric: boolean; title?: string }> = [
    { key: 'name', label: CHART_MODE_LABEL[mode], numeric: false },
    ...(mode === 'elev' ? [{ key: 'detail' as const, label: 'Klasse', numeric: false }] : []),
    ...(mode === 'faggruppe' ? [{ key: 'detail' as const, label: 'Fag · lærer', numeric: false }] : []),
    ...(showGroup ? [{ key: 'group' as const, label: 'Gruppe', numeric: false }] : []),
    ...(mode === 'elev'
      ? [{ key: 'grades' as const, label: 'Fag', numeric: true }]
      : [{ key: 'students' as const, label: 'Elever', numeric: true }, { key: 'grades' as const, label: 'Karakterer', numeric: true }]),
    { key: 'absence', label: 'Fravær %', numeric: true },
    ...(showParts ? activeTypes.map(type => ({ key: type, label: `${FRAVAER_TYPE_INFO[type].label} %`, numeric: true, title: FRAVAER_TYPE_INFO[type].title })) : []),
    { key: 'grade', label: 'Snitt', numeric: true },
    { key: 'iv', label: 'IV', numeric: true },
  ]

  const cell = (p: PlotPoint, key: PointSortKey): ReactNode => {
    switch (key) {
      case 'name': return p.row.name
      case 'detail': return p.row.detail
      case 'group': return p.row.group
      case 'students': return p.row.studentCount
      case 'grades': return p.row.gradeCount
      case 'absence': return fmt(p.absence, 1)
      case 'grade': return fmt(p.grade)
      case 'iv': return p.row.ivCount || ''
      default: return fmt(p.row.parts[key], 1)
    }
  }

  return (
    <div className="mt-3 max-h-96 overflow-auto rounded border border-slate-200">
      <table className="w-full text-[11px] leading-tight">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {columns.map(column => (
              <th
                key={column.key}
                title={column.title}
                className={`px-2 py-1 font-semibold text-slate-500 whitespace-nowrap border-b border-slate-200 ${column.numeric ? 'text-right' : 'text-left'}`}
              >
                <button type="button" onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-0.5 hover:text-slate-800">
                  {column.label}
                  <span className="text-[9px] text-slate-400 w-2">{sort.key === column.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.id} className="odd:bg-white even:bg-slate-50/60 hover:bg-sky-50">
              {columns.map(column => (
                <td
                  key={column.key}
                  className={`px-2 py-0.5 text-slate-700 ${column.numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left'} ${column.key === 'iv' && p.row.ivCount > 0 ? 'text-red-700 font-semibold' : ''}`}
                >
                  {cell(p, column.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScatterChart({ points, scale, mode, dotColorBy, groupTrends, fravaerAverages, trend }: {
  points: PlotPoint[]
  scale: XScale
  mode: ChartMode
  dotColorBy: DotColorBy
  groupTrends: GroupTrend[]
  fravaerAverages: FravaerAverage[] | null
  trend: { slope: number; intercept: number } | null
}) {
  const gradeHeight = 300
  const ivGap = 10
  const ivHeight = 34
  const gradeTop = MARGIN.top
  const gradeBottom = gradeTop + gradeHeight
  const yOfGrade = (grade: number) => gradeTop + ((6.5 - grade) / 6) * gradeHeight
  const ivTop = gradeBottom + ivGap
  const ivCenter = ivTop + ivHeight / 2
  const plotBottom = ivTop + ivHeight
  const height = plotBottom + MARGIN.bottom

  const dotColor = (p: PlotPoint) => {
    if (dotColorBy === 'trinn') return trinnColor(p.level)
    if (dotColorBy === 'gender') return p.gender ? GENDER_COLOR[p.gender] : UNKNOWN_GENDER_COLOR
    return SINGLE_DOT_COLOR
  }
  const maxWeight = points.reduce((max, p) => Math.max(max, p.weight), 1)
  // Students share one size; fag/faggruppe dots grow with the number of grades behind them.
  const radiusOf = (p: PlotPoint) => mode === 'elev'
    ? (points.length > 3000 ? 1.8 : points.length > 1000 ? 2.3 : 3.5)
    : 3 + 7 * Math.sqrt(p.weight / maxWeight)
  const baseOpacity = points.length > 3000 ? 0.35 : mode === 'elev' ? 0.7 : 0.6
  // With Snitt per fravær on, the dots become a faint background; group lines fade them a little.
  const dotOpacity = fravaerAverages ? 0.12 : groupTrends.length > 0 ? baseOpacity * 0.45 : baseOpacity
  const clampGrade = (g: number) => Math.min(6.5, Math.max(0.5, g))

  return (
    <ChartSvg height={height} label="Spredningsplott over karakter og fravær">
      <XAxisBackground scale={scale} yTop={gradeTop} yBottom={plotBottom} />
      {[1, 2, 3, 4, 5, 6].map(grade => (
        <g key={grade}>
          <line x1={MARGIN.left} x2={PLOT_RIGHT} y1={yOfGrade(grade)} y2={yOfGrade(grade)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={MARGIN.left - 8} y={yOfGrade(grade) + 4} textAnchor="end" fontSize={11} fill="#475569">{grade}</text>
        </g>
      ))}
      <rect x={MARGIN.left} y={ivTop} width={PLOT_WIDTH} height={ivHeight} fill="#fef2f2" opacity={0.7} />
      <text x={MARGIN.left - 8} y={ivCenter + 4} textAnchor="end" fontSize={11} fill="#991b1b" fontWeight={600}>IV</text>

      {points.map(point => {
        const cy = point.grade === null
          ? ivCenter + jitter(`${point.id}|y`) * (ivHeight / 2 - 5)
          : yOfGrade(point.grade)
        const ringed = mode === 'elev' && point.hasIv && point.grade !== null
        return (
          <circle
            key={point.id}
            cx={scale.xOfAbsence(point.absence)}
            cy={cy}
            r={radiusOf(point)}
            fill={dotColor(point)}
            fillOpacity={dotOpacity}
            stroke={ringed ? GRADE_COLOR.IV : undefined}
            strokeWidth={ringed ? 1.5 : undefined}
            strokeOpacity={ringed ? Math.min(1, dotOpacity * 1.6) : undefined}
          >
            <title>{point.tooltip}</title>
          </circle>
        )
      })}

      {trend && (
        <line
          x1={scale.lin(0)}
          y1={yOfGrade(clampGrade(trend.intercept))}
          x2={scale.lin(scale.cap)}
          y2={yOfGrade(clampGrade(trend.intercept + trend.slope * scale.cap))}
          stroke="#334155"
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />
      )}
      {groupTrends.map(group => {
        const { slope, intercept } = group.regression
        if (slope === null || intercept === null) return null
        return (
          <line
            key={group.key}
            x1={scale.lin(0)}
            y1={yOfGrade(clampGrade(intercept))}
            x2={scale.lin(scale.cap)}
            y2={yOfGrade(clampGrade(intercept + slope * scale.cap))}
            stroke={group.color}
            strokeWidth={3}
            strokeLinecap="round"
          >
            <title>{`${group.label}: r = ${fmt(group.regression.r)}, ${fmt(slope * 10)} karakterpoeng per 10 % fravær (${group.n})`}</title>
          </line>
        )
      })}
      {fravaerAverages && fravaerAverages.length > 0 && (() => {
        const maxN = fravaerAverages.reduce((max, a) => Math.max(max, a.n), 1)
        const unit = CHART_MODE_UNIT[mode]
        const path = fravaerAverages
          .map((a, index) => `${index === 0 ? 'M' : 'L'}${scale.xOfAbsence(a.absence).toFixed(1)},${yOfGrade(a.grade).toFixed(1)}`)
          .join(' ')
        return (
          <g>
            <path d={path} fill="none" stroke={FRAVAER_AVERAGE_COLOR} strokeWidth={1.75} strokeLinejoin="round" pointerEvents="none" />
            {fravaerAverages.map(a => (
              <circle
                key={a.absence}
                cx={scale.xOfAbsence(a.absence)}
                cy={yOfGrade(a.grade)}
                r={2.5 + 3.5 * Math.sqrt(a.n / maxN)}
                fill={FRAVAER_AVERAGE_COLOR}
                stroke="#ffffff"
                strokeWidth={1}
              >
                <title>{`Fravær ≈ ${fmtPct(a.absence)} %: snitt ${fmt(a.grade)} (${a.n} ${unit})`}</title>
              </circle>
            ))}
          </g>
        )
      })()}
      <AxisFrame yTop={gradeTop} yBottom={plotBottom} yTitle="Snittkarakter" />
    </ChartSvg>
  )
}

function AverageChart({ buckets, scale, mode, variant }: {
  buckets: Bucket<PlotPoint>[]
  scale: XScale
  mode: ChartMode
  variant: AverageVariant
}) {
  const plotHeight = variant === 'box' ? 280 : 220
  const top = MARGIN.top
  const bottom = top + plotHeight
  // Bars start at 0; box plots use the 1–6 scale with some padding.
  const yMin = variant === 'box' ? 0.5 : 0
  const yMax = variant === 'box' ? 6.5 : 6
  const yOf = (grade: number) => bottom - ((grade - yMin) / (yMax - yMin)) * plotHeight
  const height = bottom + MARGIN.bottom
  const unit = CHART_MODE_UNIT[mode]

  return (
    <ChartSvg
      height={height}
      label={variant === 'box' ? 'Boksplott over karakter per fraværsintervall' : 'Søylediagram over snittkarakter per fraværsintervall'}
    >
      <XAxisBackground scale={scale} yTop={top} yBottom={bottom} />
      {[1, 2, 3, 4, 5, 6].map(grade => (
        <g key={grade}>
          <line x1={MARGIN.left} x2={PLOT_RIGHT} y1={yOf(grade)} y2={yOf(grade)} stroke="#f1f5f9" />
          <text x={MARGIN.left - 8} y={yOf(grade) + 4} textAnchor="end" fontSize={11} fill="#475569">{grade}</text>
        </g>
      ))}
      {variant === 'bars' && buckets.map(bucket => {
        if (bucket.avgGrade === null) return null
        const { x1, x2 } = bucketX(scale, bucket)
        const y = yOf(bucket.avgGrade)
        return (
          <g key={bucket.key}>
            <rect x={x1 + 2} y={y} width={Math.max(0, x2 - x1 - 4)} height={Math.max(0, bottom - y)} fill="#7dd3fc" stroke="#0284c7" strokeWidth={1}>
              <title>{`${bucket.label}: snitt ${fmt(bucket.avgGrade)} (${bucket.numericCount} ${unit})`}</title>
            </rect>
            <text x={(x1 + x2) / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0c4a6e" pointerEvents="none">
              {fmt(bucket.avgGrade, 1)}
            </text>
          </g>
        )
      })}
      {variant === 'box' && buckets.map(bucket => {
        const stats = computeBoxStats(bucket.points.flatMap(p => (p.grade === null ? [] : [p.grade])))
        if (!stats) return null
        const { x1, x2 } = bucketX(scale, bucket)
        const cx = (x1 + x2) / 2
        const boxWidth = Math.min(44, Math.max(8, (x2 - x1) * 0.55))
        const capWidth = boxWidth * 0.5
        const yQ1 = yOf(stats.q1)
        const yQ3 = yOf(stats.q3)
        const tooltip = `${bucket.label} (${stats.n} ${unit})\n`
          + `Snitt ${fmt(stats.mean)} · median ${fmt(stats.median)}\n`
          + `25–75 %: ${fmt(stats.q1)}–${fmt(stats.q3)}\n`
          + `Laveste–høyeste: ${fmt(stats.min)}–${fmt(stats.max)}`
          + (stats.outliers.length > 0 ? `\n${stats.outliers.length} ${stats.outliers.length === 1 ? 'uteligger' : 'uteliggere'}` : '')
        return (
          <g key={bucket.key}>
            <line x1={cx} x2={cx} y1={yOf(stats.whiskerHigh)} y2={yQ3} stroke="#0369a1" strokeWidth={1.5} />
            <line x1={cx} x2={cx} y1={yQ1} y2={yOf(stats.whiskerLow)} stroke="#0369a1" strokeWidth={1.5} />
            <line x1={cx - capWidth / 2} x2={cx + capWidth / 2} y1={yOf(stats.whiskerHigh)} y2={yOf(stats.whiskerHigh)} stroke="#0369a1" strokeWidth={1.5} />
            <line x1={cx - capWidth / 2} x2={cx + capWidth / 2} y1={yOf(stats.whiskerLow)} y2={yOf(stats.whiskerLow)} stroke="#0369a1" strokeWidth={1.5} />
            <rect
              x={cx - boxWidth / 2}
              y={yQ3}
              width={boxWidth}
              height={Math.max(1, yQ1 - yQ3)}
              fill="#bae6fd"
              stroke="#0284c7"
              strokeWidth={1.5}
            >
              <title>{tooltip}</title>
            </rect>
            <line x1={cx - boxWidth / 2} x2={cx + boxWidth / 2} y1={yOf(stats.median)} y2={yOf(stats.median)} stroke="#0c4a6e" strokeWidth={2.5} pointerEvents="none" />
            {stats.outliers.map((value, index) => (
              <circle
                key={`${value}-${index}`}
                cx={cx + (stats.outliers.length > 1 ? jitter(`${bucket.key}|${index}`) * boxWidth * 0.3 : 0)}
                cy={yOf(value)}
                r={2.5}
                fill="none"
                stroke="#64748b"
                strokeWidth={1}
                pointerEvents="none"
              />
            ))}
            <circle cx={cx} cy={yOf(stats.mean)} r={4} fill="#0c4a6e" stroke="#ffffff" strokeWidth={1.5}>
              <title>{tooltip}</title>
            </circle>
            <text
              x={cx + boxWidth / 2 + 4}
              y={yOf(stats.mean) + 3.5}
              fontSize={10}
              fontWeight={700}
              fill="#0c4a6e"
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {fmt(stats.mean, 1)}
            </text>
          </g>
        )
      })}
      <AxisFrame yTop={top} yBottom={bottom} yTitle="Snittkarakter" />
    </ChartSvg>
  )
}

function HistogramChart({ buckets, scale, mode, histogramMode }: {
  buckets: Bucket<PlotPoint>[]
  scale: XScale
  mode: ChartMode
  histogramMode: HistogramMode
}) {
  const plotHeight = 200
  const top = MARGIN.top
  const bottom = top + plotHeight
  const height = bottom + MARGIN.bottom
  const maxCount = buckets.reduce((max, b) => Math.max(max, b.points.length), 0)
  const histMax = histogramMode === 'andel' ? 100 : niceMax(maxCount)
  const yOf = (value: number) => bottom - (value / histMax) * plotHeight
  const unitLabel = CHART_MODE_UNIT[mode]

  return (
    <ChartSvg height={height} label="Histogram over fordeling per fraværsintervall">
      <XAxisBackground scale={scale} yTop={top} yBottom={bottom} />
      {[0, histMax / 4, histMax / 2, (histMax * 3) / 4, histMax].map(value => (
        <g key={value}>
          <line x1={MARGIN.left} x2={PLOT_RIGHT} y1={yOf(value)} y2={yOf(value)} stroke="#f1f5f9" />
          <text x={MARGIN.left - 8} y={yOf(value) + 4} textAnchor="end" fontSize={10} fill="#64748b">
            {histogramMode === 'andel' ? `${value} %` : fmtPct(value)}
          </text>
        </g>
      ))}
      {buckets.map(bucket => {
        const total = bucket.points.length
        if (total === 0) return null
        const { x1: left, x2: right } = bucketX(scale, bucket)
        const x1 = left + 2
        const width = Math.max(0, right - left - 4)
        let cumulative = 0
        return (
          <g key={bucket.key}>
            {GRADE_LABELS.map(label => {
              const count = bucket.counts[label]
              if (count === 0) return null
              const value = histogramMode === 'andel' ? (count / total) * 100 : count
              const yTop = yOf(cumulative + value)
              const yBase = yOf(cumulative)
              cumulative += value
              const what = label === 'IV' ? 'bare IV' : `snitt ≈ ${label}`
              return (
                <rect key={label} x={x1} y={yTop} width={width} height={Math.max(0, yBase - yTop)} fill={GRADE_COLOR[label]}>
                  <title>{`${bucket.label} · ${what}: ${count} av ${total} ${unitLabel} (${fmt((count / total) * 100, 1)} %)`}</title>
                </rect>
              )
            })}
            {histogramMode === 'antall' && (
              <text x={x1 + width / 2} y={yOf(total) - 4} textAnchor="middle" fontSize={10} fill="#334155" pointerEvents="none">
                {total}
              </text>
            )}
          </g>
        )
      })}
      <AxisFrame yTop={top} yBottom={bottom} yTitle={histogramMode === 'andel' ? 'Andel' : 'Antall'} />
    </ChartSvg>
  )
}