import { useCallback, useMemo, useState } from 'react'
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
  fmtSigned,
  groupIntoBuckets,
  groupIntoRangeBuckets,
  intakeAsGrade,
  jitter,
  linearRegression,
  makeRangeXScale,
  makeXScale,
  mean,
  median,
  mostCommon,
  niceMax,
  trinnColor,
  useGradeAbsenceData,
} from '../gradeAbsenceUtils'
import type {
  AverageVariant,
  BucketRange,
  ChartMode,
  DataPoint,
  DotColorBy,
  FravaerType,
  HistogramMode,
  Regression,
  XScale,
} from '../gradeAbsenceUtils'
import {
  AxisFrame,
  ChartCard,
  ChartSvg,
  FilterGroup,
  GradeAbsenceFilterSidebar,
  GradeAbsenceOptionsBar,
  LegendDot,
  SummaryCard,
  ToggleButton,
  XAxisBackground,
} from './GradeAbsenceKit'

interface Props {
  data: DataStore
  xAxis: XAxisKind
}

// Karakterutvikling compares the grade with grunnskolepoeng = Inntakspoeng / 10 (same 1–6 scale as the grade),
// either as a difference (karakter − inntak, baseline 0) or a ratio (karakter / inntak, baseline 1).
type Measure = 'diff' | 'ratio'

interface Band {
  key: string
  label: string
  // Inclusive lower bound.
  min: number
  color: string
}

interface MeasureConfig {
  key: Measure
  // Value that means "same as inntak".
  baseline: number
  name: string
  formula: string
  compute: (grade: number, intake: number) => number
  format: (value: number | null, decimals?: number) => string
  bands: Band[]
  // Smallest half-span of the y-axis around the baseline for scatter, bar and box charts.
  minHalfSpan: { scatter: number; bars: number; box: number }
  maxHalfSpan: number
  // Half-spans are rounded up to a multiple of this.
  spanStep: number
  // Distance from the baseline that fills the mini bar in the table.
  cellScale: number
}

const BAND_COLORS = ['#b91c1c', '#f97316', '#fcd34d', '#bef264', '#4ade80', '#15803d']

const MEASURES: Record<Measure, MeasureConfig> = {
  diff: {
    key: 'diff',
    baseline: 0,
    name: 'Endring',
    formula: 'karakter − inntak',
    compute: (grade, intake) => grade - intake,
    format: (value, decimals = 2) => fmtSigned(value, decimals),
    bands: [
      { key: 'lt-1', label: '< −1', min: -Infinity },
      { key: '-1', label: '−1 til −0,5', min: -1 },
      { key: '-0.5', label: '−0,5 til 0', min: -0.5 },
      { key: '0', label: '0 til 0,5', min: 0 },
      { key: '0.5', label: '0,5 til 1', min: 0.5 },
      { key: 'ge1', label: '≥ 1', min: 1 },
    ].map((band, index) => ({ ...band, color: BAND_COLORS[index] })),
    minHalfSpan: { scatter: 1.5, bars: 0.5, box: 1 },
    maxHalfSpan: 5,
    spanStep: 0.5,
    cellScale: 2,
  },
  ratio: {
    key: 'ratio',
    baseline: 1,
    name: 'Forhold',
    formula: 'karakter / inntak',
    compute: (grade, intake) => grade / intake,
    format: (value, decimals = 2) => fmt(value, decimals),
    bands: [
      { key: 'lt-0.8', label: '< 0,8', min: -Infinity },
      { key: '0.8', label: '0,8 til 0,9', min: 0.8 },
      { key: '0.9', label: '0,9 til 1', min: 0.9 },
      { key: '1', label: '1 til 1,1', min: 1 },
      { key: '1.1', label: '1,1 til 1,2', min: 1.1 },
      { key: 'ge1.2', label: '≥ 1,2', min: 1.2 },
    ].map((band, index) => ({ ...band, color: BAND_COLORS[index] })),
    minHalfSpan: { scatter: 0.3, bars: 0.1, box: 0.2 },
    maxHalfSpan: 1,
    spanStep: 0.05,
    cellScale: 0.4,
  },
}

const chartModeDescription = (mode: ChartMode, m: MeasureConfig, xKind: XAxisKind): string => {
  const what = m.key === 'diff' ? 'endringen' : 'forholdet'
  if (mode === 'elev') {
    return xKind === 'fravaer'
      ? `Per elev: snitt av fraværsprosenten i elevens fag mot snitt av ${what} (${m.formula}) i elevens fag.`
      : `Per elev: elevens inntakspoeng/10 mot snitt av ${what} (${m.formula}) i elevens fag.`
  }
  const unit = mode === 'fag' ? 'faget' : 'faggruppen'
  const xText = xKind === 'fravaer' ? 'snitt av fraværet' : 'snitt av elevenes inntak'
  return `Per ${CHART_MODE_SINGULAR[mode]}: ${xText} mot snitt av ${what} (karakter ${m.key === 'diff' ? '−' : '/'} elevens inntak) for alle elever i ${unit}.`
}

const IV_COLOR = GRADE_COLOR.IV
const POSITIVE_COLOR = '#16a34a'
const NEGATIVE_COLOR = '#dc2626'

function bandIndex(value: number, bands: Band[]): number {
  for (let i = bands.length - 1; i >= 0; i--) {
    if (value + 1e-9 >= bands[i].min) return i
  }
  return 0
}

// What goes on the x-axis: fravær in the fag (%) or the student's inntak (inntakspoeng / 10).
export type XAxisKind = 'fravaer' | 'inntak'

const INTAKE_STEP_OPTIONS = [0.25, 0.5, 1]
const INTAKE_ROUNDING_OPTIONS = [0.1, 0.25, 0.5]

interface XModel {
  kind: XAxisKind
  scale: XScale
  bucketize: <T extends DeltaLike>(points: T[]) => BucketRange<T>[]
  noun: string
  intervalNoun: string
  firstColumn: string
  slopeText: (slope: number) => string
  slopeShort: (slope: number) => string
  roundingOptions: number[]
  formatValue: (value: number) => string
}

// Shared by single grades and plotted units, so the same bucket stats work for both.
interface DeltaLike {
  studentKey: string
  // Position on the x-axis (fravær % or inntak, depending on the view).
  x: number
  absence: number
  // The selected measure (karakter − inntak or karakter / inntak); null when there is no numeric grade (IV).
  delta: number | null
  grade: number | null
  intake: number | null
}

// One grade for a student with known Inntakspoeng.
interface DeltaPoint extends DataPoint, DeltaLike {
  intake: number
}

interface PointRow {
  name: string
  detail: string
  group: string
  studentCount: number
  gradeCount: number
  ivCount: number
  parts: Record<FravaerType, number>
}

interface PlotPoint extends DeltaLike {
  id: string
  gender: StudentGender | null
  level: string
  tooltip: string
  hasIv: boolean
  weight: number
  row: PointRow
}

interface FravaerAverage {
  x: number
  delta: number
  n: number
}

interface GroupTrend {
  key: string
  label: string
  color: string
  n: number
  regression: Regression
}

interface DeltaBucket<T extends DeltaLike> extends BucketRange<T> {
  studentCount: number
  numericCount: number
  avgGrade: number | null
  avgIntake: number | null
  avgAbsence: number | null
  avgDelta: number | null
  medianDelta: number | null
  bandCounts: number[]
  ivCount: number
  declineShare: number | null
}

function numericOf<T extends DeltaLike>(points: T[]): Array<T & { delta: number }> {
  return points.filter((p): p is T & { delta: number } => p.delta !== null)
}

// Averages over the numeric grades only (IV has no value to compare).
function summarizeDeltas<T extends DeltaLike>(points: T[], m: MeasureConfig) {
  const numeric = numericOf(points)
  const deltas = numeric.map(p => p.delta)
  const bandCounts = m.bands.map(() => 0)
  deltas.forEach(d => { bandCounts[bandIndex(d, m.bands)]++ })
  return {
    studentCount: new Set(points.map(p => p.studentKey)).size,
    numericCount: numeric.length,
    avgGrade: mean(numeric.flatMap(p => (p.grade === null ? [] : [p.grade]))),
    avgIntake: mean(numeric.flatMap(p => (p.intake === null ? [] : [p.intake]))),
    avgAbsence: mean(points.map(p => p.absence)),
    avgDelta: mean(deltas),
    medianDelta: median(deltas),
    bandCounts,
    ivCount: points.length - numeric.length,
    declineShare: deltas.length > 0 ? (deltas.filter(d => d < m.baseline - 1e-9).length / deltas.length) * 100 : null,
  }
}

function computeDeltaBuckets<T extends DeltaLike>(points: T[], bucketize: XModel['bucketize'], m: MeasureConfig): DeltaBucket<T>[] {
  return bucketize(points).map(range => ({ ...range, ...summarizeDeltas(range.points, m) }))
}

function computeDeltaRegression(points: DeltaLike[]): Regression {
  return linearRegression(numericOf(points).map(p => [p.x, p.delta] as [number, number]))
}

// Y-axis symmetric around the measure's baseline.
interface ValueAxis {
  baseline: number
  halfSpan: number
  ticks: number[]
  tickDecimals: number
}

function makeValueAxis(values: number[], m: MeasureConfig, minHalfSpan: number): ValueAxis {
  const maxDistance = values.reduce((max, v) => Math.max(max, Math.abs(v - m.baseline)), 0)
  const rounded = Math.ceil(maxDistance / m.spanStep - 1e-9) * m.spanStep
  const halfSpan = Math.min(m.maxHalfSpan, Math.max(minHalfSpan, rounded))
  const tickStep = [0.05, 0.1, 0.25, 0.5, 1].find(s => s >= halfSpan / 5 - 1e-9) ?? 1
  const ticks: number[] = []
  const count = Math.floor(halfSpan / tickStep + 1e-9)
  for (let i = -count; i <= count; i++) ticks.push(Math.round((m.baseline + i * tickStep) * 100) / 100)
  return { baseline: m.baseline, halfSpan, ticks, tickDecimals: tickStep < 0.1 || tickStep === 0.25 ? 2 : 1 }
}

function axisY(axis: ValueAxis, top: number, height: number) {
  const lo = axis.baseline - axis.halfSpan
  const hi = axis.baseline + axis.halfSpan
  return (value: number) => top + ((hi - Math.min(hi, Math.max(lo, value))) / (hi - lo)) * height
}

export default function KarakterutviklingView({ data, xAxis }: Props) {
  const state = useGradeAbsenceData(data)
  const {
    term, step, cap, compareBy, genderFilter, hasGenderData,
    activeTypes, onlyX, activeTypesLabel, allPoints, points, graphSourcePoints, studentInfoLookup,
  } = state
  const byFravaer = xAxis === 'fravaer'
  const tabName = byFravaer ? 'Karakterutvikling vs. fravær' : 'Karakterutvikling vs. inntakspoeng'
  const [histogramMode, setHistogramMode] = useState<HistogramMode>('antall')
  const [chartMode, setChartMode] = useState<ChartMode>('elev')
  const [averageVariant, setAverageVariant] = useState<AverageVariant>('bars')
  const [showTrend, setShowTrend] = useState(true)
  const [showFravaerAverage, setShowFravaerAverage] = useState(false)
  const [fravaerRounding, setFravaerRounding] = useState(byFravaer ? 0.5 : 0.1)
  const [intakeStep, setIntakeStep] = useState(0.5)
  const [showPointTable, setShowPointTable] = useState(false)
  const [measureKey, setMeasureKey] = useState<Measure>('diff')
  const m = MEASURES[measureKey]

  const intakeByStudent = useMemo(() => {
    const result = new Map<string, number>()
    studentInfoLookup.forEach((info, key) => {
      const intake = intakeAsGrade(info.intakePoints)
      if (intake !== null) result.set(key, intake)
    })
    return result
  }, [studentInfoLookup])

  const withIntake = useCallback((list: DataPoint[]): DeltaPoint[] => list.flatMap(p => {
    const intake = intakeByStudent.get(p.studentKey)
    if (intake === undefined) return []
    return [{ ...p, intake, x: byFravaer ? p.absence : intake, delta: p.grade === null ? null : m.compute(p.grade, intake) }]
  }), [intakeByStudent, m, byFravaer])
  const hasIntakeData = useMemo(() => allPoints.some(p => intakeByStudent.has(p.studentKey)), [allPoints, intakeByStudent])
  const deltaPoints = useMemo(() => withIntake(points), [points, withIntake])
  const graphDeltaPoints = useMemo(() => withIntake(graphSourcePoints), [graphSourcePoints, withIntake])
  const missingIntakeStudents = useMemo(
    () => new Set(points.filter(p => !intakeByStudent.has(p.studentKey)).map(p => p.studentKey)).size,
    [points, intakeByStudent]
  )

  // Inntak axis: whole intervals around the inntak of the filtered students, shared by the table and the graphs.
  const intakeRange = useMemo(() => {
    if (deltaPoints.length === 0) return { lo: 0, hi: intakeStep }
    const values = deltaPoints.map(p => p.intake)
    const lo = Math.floor(Math.min(...values) / intakeStep + 1e-9) * intakeStep
    const hi = (Math.floor(Math.max(...values) / intakeStep + 1e-9) + 1) * intakeStep
    return { lo, hi }
  }, [deltaPoints, intakeStep])

  const bucketize = useMemo<XModel['bucketize']>(() => (byFravaer
    ? <T extends DeltaLike>(list: T[]) => groupIntoBuckets(list, step, cap, p => p.x)
    : <T extends DeltaLike>(list: T[]) => groupIntoRangeBuckets(list, p => p.x, intakeRange.lo, intakeRange.hi, intakeStep, v => fmt(v, 2))
  ), [byFravaer, step, cap, intakeRange, intakeStep])

  const buckets = useMemo(() => computeDeltaBuckets(deltaPoints, bucketize, m), [deltaPoints, bucketize, m])

  const summary = useMemo(() => {
    const studentIntakes = new Map<string, number>()
    deltaPoints.forEach(p => studentIntakes.set(p.studentKey, p.intake))
    const numeric = numericOf(deltaPoints)
    return {
      ...summarizeDeltas(deltaPoints, m),
      count: deltaPoints.length,
      studentIntake: mean(Array.from(studentIntakes.values())),
      avgAbsence: mean(deltaPoints.map(p => p.absence)),
      improvedShare: numeric.length > 0 ? (numeric.filter(p => p.delta > m.baseline + 1e-9).length / numeric.length) * 100 : null,
      ...computeDeltaRegression(deltaPoints),
    }
  }, [deltaPoints, m])

  // One point per elev, fag or faggruppe: mean fravær vs. mean of the selected measure (IV excluded).
  // In fag/faggruppe mode each unit is split by kjønn or trinn when comparing, so group trendlines use like-for-like points.
  const chartPoints = useMemo<PlotPoint[]>(() => {
    const split = (p: DeltaPoint) => {
      if (chartMode === 'elev') return ''
      if (compareBy === 'kjonn') return `|${p.gender ?? 'ukjent'}`
      if (compareBy === 'trinn') return `|${p.level}`
      return ''
    }
    const keyOf = (p: DeltaPoint) => {
      if (chartMode === 'elev') return p.studentKey
      if (chartMode === 'fag') return `fag:${normalizeMatch(p.subject)}${split(p)}`
      return `gruppe:${normalizeMatch(p.subjectGroup)}${split(p)}`
    }
    const groups = new Map<string, DeltaPoint[]>()
    graphDeltaPoints.forEach(p => {
      const key = keyOf(p)
      const list = groups.get(key)
      if (list) list.push(p)
      else groups.set(key, [p])
    })

    return Array.from(groups.entries()).map(([key, list]) => {
      const stats = summarizeDeltas(list, m)
      const avgAbsence = list.reduce((s, p) => s + p.absence, 0) / list.length
      const avgParts = emptyParts()
      activeTypes.forEach(type => {
        avgParts[type] = list.reduce((s, p) => s + p.parts[type], 0) / list.length
      })
      const first = list[0]
      const ivText = stats.ivCount > 0 ? ` · ${stats.ivCount} IV` : ''
      const partsText = onlyX ? '' : ` (${activeTypes.map(type => `${FRAVAER_TYPE_INFO[type].label} ${fmt(avgParts[type], 1)}`).join(' + ')})`
      const studentCount = stats.studentCount
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

      // With only IV there is no grade to compare, so show the student's own Inntakspoeng.
      // On the inntak axis every grade counts (IV included), so IV-only units still get a position.
      const allIntake = list.reduce((s, p) => s + p.intake, 0) / list.length
      const intake = byFravaer ? stats.avgIntake ?? (chartMode === 'elev' ? first.intake : null) : allIntake
      return {
        id: key,
        studentKey: key,
        x: byFravaer ? avgAbsence : allIntake,
        absence: avgAbsence,
        delta: stats.avgDelta,
        grade: stats.avgGrade,
        intake,
        gender: chartMode === 'elev' || compareBy === 'kjonn' ? first.gender : null,
        level: chartMode === 'elev' || compareBy === 'trinn' ? first.level : mostCommon(list.map(p => p.level)),
        hasIv: stats.ivCount > 0,
        weight: list.length,
        tooltip: `${title}\n${countLine}\nSnitt fravær ${fmt(avgAbsence, 1)} %${partsText}\n`
          + `Inntak ${fmt(intake)} · snittkarakter ${fmt(stats.avgGrade)} · ${m.name.toLowerCase()} ${m.format(stats.avgDelta)}${ivText}`,
        row: { ...row, group, studentCount, gradeCount: list.length, ivCount: stats.ivCount, parts: avgParts },
      }
    })
  }, [graphDeltaPoints, chartMode, compareBy, activeTypes, onlyX, m, byFravaer])

  const chartUnit = CHART_MODE_UNIT[chartMode]
  const chartBuckets = useMemo(() => computeDeltaBuckets(chartPoints, bucketize, m), [chartPoints, bucketize, m])
  const chartRegression = useMemo(() => computeDeltaRegression(chartPoints), [chartPoints])
  const fravaerLabel = onlyX ? 'Udokumentert fravær' : `Fravær (${activeTypesLabel})`
  const xModel = useMemo<XModel>(() => byFravaer
    ? {
        kind: 'fravaer',
        scale: makeXScale(chartPoints.map(p => ({ absence: p.x })), step, cap, `${fravaerLabel} i faget (%)`),
        bucketize,
        noun: 'fravær',
        intervalNoun: 'fraværsintervall',
        firstColumn: onlyX ? 'Fravær' : `Fravær (${activeTypesLabel})`,
        slopeText: slope => `${fmtSigned(slope * 10)} per 10 % fravær`,
        slopeShort: slope => `${fmtSigned(slope * 10)} per 10 %`,
        roundingOptions: FRAVAER_ROUNDING_OPTIONS,
        formatValue: value => `${fmtPct(value)} %`,
      }
    : {
        kind: 'inntak',
        scale: makeRangeXScale(intakeRange.lo, intakeRange.hi, intakeStep, 'Inntak (inntakspoeng / 10)'),
        bucketize,
        noun: 'inntak',
        intervalNoun: 'inntaksintervall',
        firstColumn: 'Inntak',
        slopeText: slope => `${fmtSigned(slope)} per poeng høyere inntak`,
        slopeShort: slope => `${fmtSigned(slope)} per poeng`,
        roundingOptions: INTAKE_ROUNDING_OPTIONS,
        formatValue: value => fmt(value, 2),
      },
  [byFravaer, chartPoints, step, cap, fravaerLabel, bucketize, onlyX, activeTypesLabel, intakeRange, intakeStep])
  const xScale = xModel.scale

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
        regression: computeDeltaRegression(group.points),
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

  // Average of the measure for each x value, with x rounded to the nearest `fravaerRounding`.
  const fravaerAverages = useMemo<FravaerAverage[]>(() => {
    const groups = new Map<number, { sum: number; n: number }>()
    numericOf(chartPoints).forEach(p => {
      const rounded = Math.round(Math.round(p.x / fravaerRounding + 1e-9) * fravaerRounding * 1000) / 1000
      const group = groups.get(rounded)
      if (group) {
        group.sum += p.delta
        group.n++
      } else {
        groups.set(rounded, { sum: p.delta, n: 1 })
      }
    })
    return Array.from(groups.entries())
      .map(([x, { sum, n }]) => ({ x, delta: sum / n, n }))
      .sort((a, b) => a.x - b.x)
  }, [chartPoints, fravaerRounding])

  if (data.grades.length === 0 || !hasIntakeData) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 text-sm text-slate-600">
        {data.grades.length === 0
          ? `${tabName} krever en karakterfil. Last opp karakterer sammen med fraværsfilen og elevfilen.`
          : `${tabName} krever en elevfil med inntakspoeng. Fant ingen elever med inntakspoeng som kunne kobles til karakterer og fravær.`}
      </div>
    )
  }

  const deltaRegressionText = xModel.slopeText
  const isBelow = (value: number | null) => value !== null && value < m.baseline - 1e-9
  const measureHint = m.key === 'diff'
    ? 'Karakter − inntakspoeng/10. 0 betyr samme nivå som fra grunnskolen.'
    : 'Karakter / (inntakspoeng/10). 1 betyr samme nivå som fra grunnskolen; 0,9 betyr 10 % lavere.'

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <GradeAbsenceFilterSidebar
        state={state}
        axisControls={byFravaer ? undefined : (
          <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Intervall</span>
            <select
              value={intakeStep}
              onChange={e => setIntakeStep(Number(e.target.value))}
              className="rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {INTAKE_STEP_OPTIONS.map(option => (
                <option key={option} value={option}>{fmt(option, 2)} inntak</option>
              ))}
            </select>
          </label>
        )}
      />

      <div className="flex-1 min-w-0 space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <FilterGroup label="Sammenlign med inntak">
          {(['diff', 'ratio'] as Measure[]).map(key => (
            <ToggleButton key={key} active={measureKey === key} title={MEASURES[key].formula} onClick={() => setMeasureKey(key)}>
              {key === 'diff' ? 'Karakter − inntak' : 'Karakter / inntak'}
            </ToggleButton>
          ))}
        </FilterGroup>
        <span className="text-xs text-slate-500">{measureHint}</span>
      </div>
      {deltaPoints.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 text-sm text-slate-600">
          {allPoints.length === 0
            ? `Fant ingen T${term}-karakterer som kunne kobles til fravær i samme fag.`
            : points.length === 0
              ? 'Ingen datapunkter med valgte filtre.'
              : 'Ingen elever med inntakspoeng i valgte filtre.'}
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-4">
            <SummaryCard label="Karakterer" value={summary.count} hint="Antall fag-karakterer koblet til fravær i samme fag, for elever med inntakspoeng" />
            <SummaryCard
              label="Elever"
              value={summary.studentCount}
              hint={missingIntakeStudents > 0 ? `${missingIntakeStudents} elever i utvalget mangler inntakspoeng og er ikke med.` : undefined}
            />
            <SummaryCard label="Snitt inntak" value={fmt(summary.studentIntake)} hint="Snitt av inntakspoeng / 10 per elev" />
            <SummaryCard label="Snitt karakter" value={fmt(summary.avgGrade)} hint="IV er ikke med i snittet" />
            <SummaryCard
              label={`Snitt ${m.name.toLowerCase()}`}
              value={<span className={isBelow(summary.avgDelta) ? 'text-red-700' : 'text-green-700'}>{m.format(summary.avgDelta)}</span>}
              hint={`${m.key === 'diff' ? 'Karakter − inntakspoeng/10' : 'Karakter / (inntakspoeng/10)'}, snitt over alle karakterer (IV ikke med). ${fmt(summary.improvedShare, 1)} % av karakterene ligger over inntak, ${fmt(summary.declineShare, 1)} % under.`}
            />
            <SummaryCard label={onlyX ? 'Snitt fravær' : `Snitt fravær (${activeTypesLabel})`} value={`${fmt(summary.avgAbsence, 1)} %`} />
            <SummaryCard
              label="Korrelasjon (r)"
              value={fmt(summary.r)}
              hint={summary.slope !== null
                ? `Pearson-korrelasjon mellom ${xModel.noun} og ${m.name.toLowerCase()} (IV ikke med). Trendlinjen endres ${deltaRegressionText(summary.slope)}.`
                : `Pearson-korrelasjon mellom ${xModel.noun} og ${m.name.toLowerCase()} (IV ikke med).`}
            />
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
            <h2 className="text-base font-semibold text-slate-900">Karakterutvikling per {xModel.intervalNoun}</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              {m.key === 'diff'
                ? `Hvert datapunkt er én elevs T${term}-karakter i ett fag minus elevens inntakspoeng delt på 10${byFravaer ? ', sammen med elevens fravær i det samme faget' : ', gruppert etter elevens inntak'}. Endring over 0 betyr at karakteren er høyere enn grunnskolepoengene.`
                : `Hvert datapunkt er én elevs T${term}-karakter i ett fag delt på elevens inntakspoeng/10${byFravaer ? ', sammen med elevens fravær i det samme faget' : ', gruppert etter elevens inntak'}. Forhold over 1 betyr at karakteren er høyere enn grunnskolepoengene.`}
              {' '}Intervallene inkluderer nedre grense. IV er ikke med i snittene, men telles for seg.
              {!onlyX && ` Fravær er summen av ${activeTypesLabel}.`}
              {missingIntakeStudents > 0 && ` ${missingIntakeStudents} ${missingIntakeStudents === 1 ? 'elev' : 'elever'} uten inntakspoeng er ikke med.`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="bg-slate-50">
                    {[
                      { label: xModel.firstColumn },
                      { label: 'Karakterer' },
                      { label: 'Elever' },
                      byFravaer
                        ? { label: 'Inntak', title: 'Snitt av inntakspoeng / 10 for karakterene i intervallet' }
                        : { label: 'Fravær', title: `Snitt fravær${onlyX ? '' : ` (${activeTypesLabel})`} for karakterene i intervallet` },
                      { label: 'Snitt kar.' },
                      { label: m.name, title: m.key === 'diff' ? 'Snitt karakter − snitt inntak' : 'Snitt av karakter / inntak for hver karakter' },
                      { label: 'Median', title: `Median ${m.name.toLowerCase()}` },
                      ...m.bands.map(band => ({ label: band.label, title: `Antall karakterer med ${m.name.toLowerCase()} ${band.label}` })),
                      { label: 'IV' },
                      { label: 'Andel ned', title: 'Andel karakterer under inntakspoeng/10 (IV ikke med)' },
                    ].map((heading, index) => (
                      <th
                        key={heading.label}
                        title={heading.title}
                        className={`py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 ${index === 0 ? 'text-left' : 'text-right'}`}
                      >
                        {heading.label}
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
                        <td className="py-2 px-3 text-right border-b border-slate-100">{byFravaer ? fmt(bucket.avgIntake) : `${fmt(bucket.avgAbsence, 1)} %`}</td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">{fmt(bucket.avgGrade)}</td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">
                          <DeltaCell value={bucket.avgDelta} m={m} />
                        </td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">{m.format(bucket.medianDelta)}</td>
                        {m.bands.map((band, index) => (
                          <td key={band.key} className="py-2 px-3 text-right border-b border-slate-100">
                            {bucket.bandCounts[index] || (empty ? '' : '·')}
                          </td>
                        ))}
                        <td className={`py-2 px-3 text-right border-b border-slate-100 ${bucket.ivCount > 0 ? 'text-red-700 font-semibold' : ''}`}>
                          {bucket.ivCount || (empty ? '' : '·')}
                        </td>
                        <td className="py-2 px-3 text-right border-b border-slate-100">
                          {bucket.declineShare === null ? '' : `${fmt(bucket.declineShare, 1)} %`}
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
                    <td className="py-2 px-3 text-right border-t border-slate-200">{byFravaer ? fmt(summary.avgIntake) : `${fmt(summary.avgAbsence, 1)} %`}</td>
                    <td className="py-2 px-3 text-right border-t border-slate-200">{fmt(summary.avgGrade)}</td>
                    <td className="py-2 px-3 text-right border-t border-slate-200"><DeltaCell value={summary.avgDelta} m={m} /></td>
                    <td className="py-2 px-3 text-right border-t border-slate-200">{m.format(summary.medianDelta)}</td>
                    {m.bands.map((band, index) => (
                      <td key={band.key} className="py-2 px-3 text-right border-t border-slate-200">{summary.bandCounts[index]}</td>
                    ))}
                    <td className="py-2 px-3 text-right border-t border-slate-200">{summary.ivCount}</td>
                    <td className="py-2 px-3 text-right border-t border-slate-200">{fmt(summary.declineShare, 1)} %</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Charts — three separate graphs sharing the same x axis */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Grafer</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {chartModeDescription(chartMode, m, xAxis)}
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
            title={`${byFravaer ? 'Snittfravær' : 'Inntak'} og karakterutvikling per ${CHART_MODE_SINGULAR[chartMode]}`}
            subtitle={
              `${chartPoints.length} ${chartUnit} · r = ${fmt(chartRegression.r)}`
              + (chartRegression.slope !== null ? ` · trendlinjen endres ${deltaRegressionText(chartRegression.slope)}` : '')
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
                    m={m}
                    defaultSort={byFravaer ? 'absence' : 'intake'}
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
                  Snitt per {xModel.noun}
                </label>
                <label className={`inline-flex items-center gap-1.5 text-sm ${showFravaerAverage ? 'text-slate-600' : 'text-slate-300'}`}>
                  avrundet til
                  <select
                    value={fravaerRounding}
                    disabled={!showFravaerAverage}
                    onChange={e => setFravaerRounding(Number(e.target.value))}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:border-slate-200"
                  >
                    {xModel.roundingOptions.map(option => (
                      <option key={option} value={option}>{xModel.formatValue(option)}</option>
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
                    <span className="inline-block w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: IV_COLOR }} />
                    Har minst én IV
                  </span>
                ) : (
                  <span className="text-slate-500">Større prikk = flere karakterer</span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-5 border-t-2 border-slate-500" />
                  {fmt(m.baseline, 0)} = samme som inntak
                </span>
                {showFravaerAverage && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative inline-block w-5 h-0.5" style={{ backgroundColor: FRAVAER_AVERAGE_COLOR }}>
                      <span className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ backgroundColor: FRAVAER_AVERAGE_COLOR }} />
                    </span>
                    Snitt per {xModel.formatValue(fravaerRounding)} {xModel.noun} (større prikk = flere {chartUnit})
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
                      <span>r = {fmt(group.regression.r)} · {xModel.slopeShort(group.regression.slope)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <DeltaScatterChart
              points={chartPoints}
              m={m}
              xModel={xModel}
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
            title={averageVariant === 'box' ? `Spredning i karakterutvikling per ${xModel.intervalNoun}` : `Snitt ${m.name.toLowerCase()} per ${xModel.intervalNoun}`}
            subtitle={averageVariant === 'box'
              ? `Boksplott per intervall: boksen dekker midterste halvdel (25–75 %), streken i boksen er medianen og prikken er snittet. Linjene går til laveste og høyeste verdi innenfor 1,5 × boksens høyde; verdier utenfor vises som små ringer. Bygger på ${m.name.toLowerCase()} (${m.formula}) for hver ${CHART_MODE_SINGULAR[chartMode]}; IV er ikke med.`
              : `Snittet av ${m.name.toLowerCase()} (${m.formula}) for hver ${CHART_MODE_SINGULAR[chartMode]} i intervallet. Grønn = over inntak, rød = under. IV er ikke med.`}
            controls={
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
                <ToggleButton active={averageVariant === 'bars'} onClick={() => setAverageVariant('bars')}>Søyler</ToggleButton>
                <ToggleButton active={averageVariant === 'box'} onClick={() => setAverageVariant('box')}>Boksplott</ToggleButton>
              </div>
            }
            legend={
              averageVariant === 'box' ? (
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
              ) : (
                <>
                  <LegendDot color={POSITIVE_COLOR} label="Over inntak" />
                  <LegendDot color={NEGATIVE_COLOR} label="Under inntak" />
                </>
              )
            }
          >
            <DeltaAverageChart buckets={chartBuckets} scale={xScale} mode={chartMode} variant={averageVariant} m={m} intervalNoun={xModel.intervalNoun} />
          </ChartCard>

          <ChartCard
            title={`Fordeling av ${chartUnit} per ${xModel.intervalNoun}`}
            subtitle={`Antall ${chartUnit} i hvert intervall, fordelt på ${m.name.toLowerCase()} (${m.formula}).`}
            controls={
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
                <ToggleButton active={histogramMode === 'antall'} onClick={() => setHistogramMode('antall')}>Antall</ToggleButton>
                <ToggleButton active={histogramMode === 'andel'} onClick={() => setHistogramMode('andel')}>Andel</ToggleButton>
              </div>
            }
            legend={
              <>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: IV_COLOR }} />
                  Bare IV
                </span>
                {m.bands.map(band => (
                  <span key={band.key} className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: band.color }} />
                    {band.label}
                  </span>
                ))}
              </>
            }
          >
            <DeltaHistogramChart buckets={chartBuckets} scale={xScale} mode={chartMode} histogramMode={histogramMode} m={m} intervalNoun={xModel.intervalNoun} />
          </ChartCard>
        </>
      )}
      </div>
    </div>
  )
}

function DeltaCell({ value, m }: { value: number | null; m: MeasureConfig }) {
  if (value === null) return <span className="font-semibold">—</span>
  const distance = value - m.baseline
  const width = Math.min(100, (Math.abs(distance) / m.cellScale) * 100)
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden sm:flex w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="w-1/2 flex justify-end">
          {distance < 0 && <div className="h-full bg-red-500" style={{ width: `${width}%` }} />}
        </div>
        <div className="w-1/2">
          {distance > 0 && <div className="h-full bg-green-500" style={{ width: `${width}%` }} />}
        </div>
      </div>
      <span className={`font-semibold w-12 text-right ${distance < 0 ? 'text-red-700' : 'text-green-700'}`}>{m.format(value)}</span>
    </div>
  )
}

type PointSortKey = 'name' | 'detail' | 'group' | 'students' | 'grades' | 'absence' | FravaerType | 'intake' | 'grade' | 'delta' | 'iv'

// Compact list of the dots currently plotted in the scatter chart.
function PointTable({ points, mode, m, defaultSort, activeTypes, showParts, showGroup }: {
  points: PlotPoint[]
  mode: ChartMode
  m: MeasureConfig
  defaultSort: PointSortKey
  activeTypes: FravaerType[]
  showParts: boolean
  showGroup: boolean
}) {
  const [sort, setSort] = useState<{ key: PointSortKey; dir: 'asc' | 'desc' }>({ key: defaultSort, dir: 'desc' })

  const sorted = useMemo(() => {
    const value = (p: PlotPoint): string | number | null => {
      switch (sort.key) {
        case 'name': return p.row.name
        case 'detail': return p.row.detail
        case 'group': return p.row.group
        case 'students': return p.row.studentCount
        case 'grades': return p.row.gradeCount
        case 'absence': return p.absence
        case 'intake': return p.intake
        case 'grade': return p.grade
        case 'delta': return p.delta
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
    { key: 'intake', label: 'Inntak', numeric: true, title: 'Inntakspoeng / 10' },
    { key: 'grade', label: 'Snitt', numeric: true },
    { key: 'delta', label: m.name, numeric: true, title: m.key === 'diff' ? 'Snitt karakter − inntakspoeng/10' : 'Snitt av karakter / (inntakspoeng/10)' },
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
      case 'intake': return fmt(p.intake)
      case 'grade': return fmt(p.grade)
      case 'delta': return m.format(p.delta)
      case 'iv': return p.row.ivCount || ''
      default: return fmt(p.row.parts[key], 1)
    }
  }

  const cellTone = (p: PlotPoint, key: PointSortKey) => {
    if (key === 'iv' && p.row.ivCount > 0) return 'text-red-700 font-semibold'
    if (key === 'delta' && p.delta !== null) return p.delta < m.baseline - 1e-9 ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold'
    return ''
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
                  className={`px-2 py-0.5 ${column.numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left'} ${cellTone(p, column.key) || 'text-slate-700'}`}
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

// Horizontal grid, the baseline and tinted above/below-inntak areas for a value axis centred on the baseline.
function DeltaYAxis({ yOf, axis, m }: { yOf: (value: number) => number; axis: ValueAxis; m: MeasureConfig }) {
  const top = axis.baseline + axis.halfSpan
  const bottom = axis.baseline - axis.halfSpan
  const isBase = (value: number) => Math.abs(value - axis.baseline) < 1e-9
  return (
    <g pointerEvents="none">
      <rect x={MARGIN.left} y={yOf(top)} width={PLOT_WIDTH} height={yOf(axis.baseline) - yOf(top)} fill="#f0fdf4" opacity={0.6} />
      <rect x={MARGIN.left} y={yOf(axis.baseline)} width={PLOT_WIDTH} height={yOf(bottom) - yOf(axis.baseline)} fill="#fef2f2" opacity={0.6} />
      {axis.ticks.map(value => (
        <g key={value}>
          <line
            x1={MARGIN.left}
            x2={PLOT_RIGHT}
            y1={yOf(value)}
            y2={yOf(value)}
            stroke={isBase(value) ? '#64748b' : '#e2e8f0'}
            strokeWidth={isBase(value) ? 1.5 : 1}
          />
          <text x={MARGIN.left - 8} y={yOf(value) + 4} textAnchor="end" fontSize={10} fill={isBase(value) ? '#1e293b' : '#64748b'} fontWeight={isBase(value) ? 700 : 400}>
            {m.format(value, axis.tickDecimals)}
          </text>
        </g>
      ))}
    </g>
  )
}

function DeltaScatterChart({ points, m, xModel, scale, mode, dotColorBy, groupTrends, fravaerAverages, trend }: {
  points: PlotPoint[]
  m: MeasureConfig
  xModel: XModel
  scale: XScale
  mode: ChartMode
  dotColorBy: DotColorBy
  groupTrends: GroupTrend[]
  fravaerAverages: FravaerAverage[] | null
  trend: { slope: number; intercept: number } | null
}) {
  const axis = makeValueAxis(points.flatMap(p => (p.delta === null ? [] : [p.delta])), m, m.minHalfSpan.scatter)
  const plotHeight = 320
  const ivGap = 10
  const ivHeight = 34
  const top = MARGIN.top
  const bottom = top + plotHeight
  const yOf = axisY(axis, top, plotHeight)
  const ivTop = bottom + ivGap
  const ivCenter = ivTop + ivHeight / 2
  const plotBottom = ivTop + ivHeight
  const height = plotBottom + MARGIN.bottom

  const dotColor = (p: PlotPoint) => {
    if (dotColorBy === 'trinn') return trinnColor(p.level)
    if (dotColorBy === 'gender') return p.gender ? GENDER_COLOR[p.gender] : UNKNOWN_GENDER_COLOR
    return SINGLE_DOT_COLOR
  }
  const maxWeight = points.reduce((max, p) => Math.max(max, p.weight), 1)
  const radiusOf = (p: PlotPoint) => mode === 'elev'
    ? (points.length > 3000 ? 1.8 : points.length > 1000 ? 2.3 : 3.5)
    : 3 + 7 * Math.sqrt(p.weight / maxWeight)
  const baseOpacity = points.length > 3000 ? 0.35 : mode === 'elev' ? 0.7 : 0.6
  const dotOpacity = fravaerAverages ? 0.12 : groupTrends.length > 0 ? baseOpacity * 0.45 : baseOpacity
  const lineY = (slope: number, intercept: number, x: number) => yOf(intercept + slope * x)
  // The fravær axis keeps the trend over 0–cap; on a range axis it only spans the plotted values, so it isn't extrapolated.
  const xs = points.map(p => p.x)
  const trendFrom = scale.overflow || xs.length === 0 ? scale.start : Math.min(...xs)
  const trendTo = scale.overflow || xs.length === 0 ? scale.cap : Math.max(...xs)

  return (
    <ChartSvg height={height} label={`Spredningsplott over karakterutvikling og ${xModel.noun}`}>
      <XAxisBackground scale={scale} yTop={top} yBottom={plotBottom} />
      <DeltaYAxis yOf={yOf} axis={axis} m={m} />
      <rect x={MARGIN.left} y={ivTop} width={PLOT_WIDTH} height={ivHeight} fill="#fef2f2" opacity={0.7} />
      <text x={MARGIN.left - 8} y={ivCenter + 4} textAnchor="end" fontSize={11} fill="#991b1b" fontWeight={600}>IV</text>

      {points.map(point => {
        const cy = point.delta === null
          ? ivCenter + jitter(`${point.id}|y`) * (ivHeight / 2 - 5)
          : yOf(point.delta)
        const ringed = mode === 'elev' && point.hasIv && point.delta !== null
        return (
          <circle
            key={point.id}
            cx={scale.xOfAbsence(point.x)}
            cy={cy}
            r={radiusOf(point)}
            fill={dotColor(point)}
            fillOpacity={dotOpacity}
            stroke={ringed ? IV_COLOR : undefined}
            strokeWidth={ringed ? 1.5 : undefined}
            strokeOpacity={ringed ? Math.min(1, dotOpacity * 1.6) : undefined}
          >
            <title>{point.tooltip}</title>
          </circle>
        )
      })}

      {trend && (
        <line
          x1={scale.lin(trendFrom)}
          y1={lineY(trend.slope, trend.intercept, trendFrom)}
          x2={scale.lin(trendTo)}
          y2={lineY(trend.slope, trend.intercept, trendTo)}
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
            x1={scale.lin(trendFrom)}
            y1={lineY(slope, intercept, trendFrom)}
            x2={scale.lin(trendTo)}
            y2={lineY(slope, intercept, trendTo)}
            stroke={group.color}
            strokeWidth={3}
            strokeLinecap="round"
          >
            <title>{`${group.label}: r = ${fmt(group.regression.r)}, ${xModel.slopeText(slope)} (${group.n})`}</title>
          </line>
        )
      })}
      {fravaerAverages && fravaerAverages.length > 0 && (() => {
        const maxN = fravaerAverages.reduce((max, a) => Math.max(max, a.n), 1)
        const unit = CHART_MODE_UNIT[mode]
        const path = fravaerAverages
          .map((a, index) => `${index === 0 ? 'M' : 'L'}${scale.xOfAbsence(a.x).toFixed(1)},${yOf(a.delta).toFixed(1)}`)
          .join(' ')
        return (
          <g>
            <path d={path} fill="none" stroke={FRAVAER_AVERAGE_COLOR} strokeWidth={1.75} strokeLinejoin="round" pointerEvents="none" />
            {fravaerAverages.map(a => (
              <circle
                key={a.x}
                cx={scale.xOfAbsence(a.x)}
                cy={yOf(a.delta)}
                r={2.5 + 3.5 * Math.sqrt(a.n / maxN)}
                fill={FRAVAER_AVERAGE_COLOR}
                stroke="#ffffff"
                strokeWidth={1}
              >
                <title>{`${xModel.noun[0].toUpperCase()}${xModel.noun.slice(1)} ≈ ${xModel.formatValue(a.x)}: snitt ${m.name.toLowerCase()} ${m.format(a.delta)} (${a.n} ${unit})`}</title>
              </circle>
            ))}
          </g>
        )
      })()}
      <AxisFrame yTop={top} yBottom={plotBottom} yTitle={`${m.name} (${m.formula})`} />
    </ChartSvg>
  )
}

function DeltaAverageChart({ buckets, scale, mode, variant, m, intervalNoun }: {
  buckets: DeltaBucket<PlotPoint>[]
  scale: XScale
  mode: ChartMode
  variant: AverageVariant
  m: MeasureConfig
  intervalNoun: string
}) {
  const boxStats = buckets.map(bucket => computeBoxStats(numericOf(bucket.points).map(p => p.delta)))
  const axis = variant === 'box'
    ? makeValueAxis(boxStats.flatMap(stats => (stats ? [stats.min, stats.max] : [])), m, m.minHalfSpan.box)
    : makeValueAxis(buckets.flatMap(b => (b.avgDelta === null ? [] : [b.avgDelta])), m, m.minHalfSpan.bars)
  const plotHeight = variant === 'box' ? 280 : 240
  const top = MARGIN.top
  const bottom = top + plotHeight
  const yOf = axisY(axis, top, plotHeight)
  const height = bottom + MARGIN.bottom
  const unit = CHART_MODE_UNIT[mode]
  // Short labels on bars and box means; ratios need two decimals to be meaningful.
  const labelDecimals = m.key === 'ratio' ? 2 : 1

  return (
    <ChartSvg
      height={height}
      label={variant === 'box' ? `Boksplott over karakterutvikling per ${intervalNoun}` : `Søylediagram over snitt ${m.name.toLowerCase()} per ${intervalNoun}`}
    >
      <XAxisBackground scale={scale} yTop={top} yBottom={bottom} />
      <DeltaYAxis yOf={yOf} axis={axis} m={m} />
      {variant === 'bars' && buckets.map(bucket => {
        if (bucket.avgDelta === null) return null
        const { x1, x2 } = bucketX(scale, bucket)
        const y = yOf(bucket.avgDelta)
        const zero = yOf(m.baseline)
        const positive = bucket.avgDelta >= m.baseline
        return (
          <g key={bucket.key}>
            <rect
              x={x1 + 2}
              y={Math.min(y, zero)}
              width={Math.max(0, x2 - x1 - 4)}
              height={Math.max(1, Math.abs(zero - y))}
              fill={positive ? '#86efac' : '#fca5a5'}
              stroke={positive ? POSITIVE_COLOR : NEGATIVE_COLOR}
              strokeWidth={1}
            >
              <title>{`${bucket.label}: snitt ${m.name.toLowerCase()} ${m.format(bucket.avgDelta)} (inntak ${fmt(bucket.avgIntake)} → karakter ${fmt(bucket.avgGrade)}, ${bucket.numericCount} ${unit})`}</title>
            </rect>
            <text
              x={(x1 + x2) / 2}
              y={positive ? y - 5 : y + 13}
              textAnchor="middle"
              fontSize={10}
              fontWeight={700}
              fill={positive ? '#14532d' : '#7f1d1d'}
              pointerEvents="none"
            >
              {m.format(bucket.avgDelta, labelDecimals)}
            </text>
          </g>
        )
      })}
      {variant === 'box' && buckets.map((bucket, index) => {
        const stats = boxStats[index]
        if (!stats) return null
        const { x1, x2 } = bucketX(scale, bucket)
        const cx = (x1 + x2) / 2
        const boxWidth = Math.min(44, Math.max(8, (x2 - x1) * 0.55))
        const capWidth = boxWidth * 0.5
        const yQ1 = yOf(stats.q1)
        const yQ3 = yOf(stats.q3)
        const tooltip = `${bucket.label} (${stats.n} ${unit})\n`
          + `Snitt ${m.format(stats.mean)} · median ${m.format(stats.median)}\n`
          + `25–75 %: ${m.format(stats.q1)} til ${m.format(stats.q3)}\n`
          + `Laveste–høyeste: ${m.format(stats.min)} til ${m.format(stats.max)}`
          + (stats.outliers.length > 0 ? `\n${stats.outliers.length} ${stats.outliers.length === 1 ? 'uteligger' : 'uteliggere'}` : '')
        return (
          <g key={bucket.key}>
            <line x1={cx} x2={cx} y1={yOf(stats.whiskerHigh)} y2={yQ3} stroke="#0369a1" strokeWidth={1.5} />
            <line x1={cx} x2={cx} y1={yQ1} y2={yOf(stats.whiskerLow)} stroke="#0369a1" strokeWidth={1.5} />
            <line x1={cx - capWidth / 2} x2={cx + capWidth / 2} y1={yOf(stats.whiskerHigh)} y2={yOf(stats.whiskerHigh)} stroke="#0369a1" strokeWidth={1.5} />
            <line x1={cx - capWidth / 2} x2={cx + capWidth / 2} y1={yOf(stats.whiskerLow)} y2={yOf(stats.whiskerLow)} stroke="#0369a1" strokeWidth={1.5} />
            <rect x={cx - boxWidth / 2} y={yQ3} width={boxWidth} height={Math.max(1, yQ1 - yQ3)} fill="#bae6fd" stroke="#0284c7" strokeWidth={1.5}>
              <title>{tooltip}</title>
            </rect>
            <line x1={cx - boxWidth / 2} x2={cx + boxWidth / 2} y1={yOf(stats.median)} y2={yOf(stats.median)} stroke="#0c4a6e" strokeWidth={2.5} pointerEvents="none" />
            {stats.outliers.map((value, outlierIndex) => (
              <circle
                key={`${value}-${outlierIndex}`}
                cx={cx + (stats.outliers.length > 1 ? jitter(`${bucket.key}|${outlierIndex}`) * boxWidth * 0.3 : 0)}
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
              {m.format(stats.mean, labelDecimals)}
            </text>
          </g>
        )
      })}
      <AxisFrame yTop={top} yBottom={bottom} yTitle={m.name} />
    </ChartSvg>
  )
}

function DeltaHistogramChart({ buckets, scale, mode, histogramMode, m, intervalNoun }: {
  buckets: DeltaBucket<PlotPoint>[]
  scale: XScale
  mode: ChartMode
  histogramMode: HistogramMode
  m: MeasureConfig
  intervalNoun: string
}) {
  const plotHeight = 200
  const top = MARGIN.top
  const bottom = top + plotHeight
  const height = bottom + MARGIN.bottom
  const maxCount = buckets.reduce((max, b) => Math.max(max, b.points.length), 0)
  const histMax = histogramMode === 'andel' ? 100 : niceMax(maxCount)
  const yOf = (value: number) => bottom - (value / histMax) * plotHeight
  const unitLabel = CHART_MODE_UNIT[mode]
  // IV-only units at the bottom, then from the largest decline to the largest improvement.
  const segments = [
    { key: 'iv', label: 'bare IV', color: IV_COLOR, count: (b: DeltaBucket<PlotPoint>) => b.ivCount },
    ...m.bands.map((band, index) => ({
      key: band.key,
      label: `${m.name.toLowerCase()} ${band.label}`,
      color: band.color,
      count: (b: DeltaBucket<PlotPoint>) => b.bandCounts[index],
    })),
  ]

  return (
    <ChartSvg height={height} label={`Histogram over fordeling av karakterutvikling per ${intervalNoun}`}>
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
            {segments.map(segment => {
              const count = segment.count(bucket)
              if (count === 0) return null
              const value = histogramMode === 'andel' ? (count / total) * 100 : count
              const yTop = yOf(cumulative + value)
              const yBase = yOf(cumulative)
              cumulative += value
              return (
                <rect key={segment.key} x={x1} y={yTop} width={width} height={Math.max(0, yBase - yTop)} fill={segment.color}>
                  <title>{`${bucket.label} · ${segment.label}: ${count} av ${total} ${unitLabel} (${fmt((count / total) * 100, 1)} %)`}</title>
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
