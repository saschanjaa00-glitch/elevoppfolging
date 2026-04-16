import { useMemo, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import type { DataStore } from '../types'
import {
  buildStudentClassKey,
  buildStudentSubjectKey,
  createAbsenceSubjectClassLookup,
  normalizeMatch,
  resolveClassFromSubjectLookup,
} from '../studentInfoUtils'
import { todayDdMmYyyy } from '../dateUtils'

interface Props {
  data: DataStore
  threshold: number
}

interface ClassStats {
  className: string
  studentCount: number
  avgAbsence: number
  ivCount: number
  ivStudentCount: number
  grade1Count: number
  grade1StudentCount: number
  grade2Count: number
  grade2StudentCount: number
  bothIvAnd1StudentCount: number
  negativeStudentsCount: number
  negativeStudentsPct: number
  totalWarnings: number
  fWarnings: number
  gWarnings: number
  missingWarnings: number
  missingWarningStudentCount: number
  avgGrunnskolepoeng: number | null
  avgGrade: number | null
}

type MetricKey =
  | 'students'
  | 'avgAbsence'
  | 'iv'
  | 'grade1'
  | 'grade2'
  | 'avgDelta'
  | 'warningsTotal'
  | 'warningsF'
  | 'warningsG'
  | 'missingWarnings'

interface LevelStats {
  level: string
  classCount: number
  studentCount: number
  avgAbsence: number
  ivCount: number
  ivStudentCount: number
  grade1Count: number
  grade1StudentCount: number
  grade2Count: number
  grade2StudentCount: number
  bothIvAnd1StudentCount: number
  negativeStudentsCount: number
  negativeStudentsPct: number
  totalWarnings: number
  fWarnings: number
  gWarnings: number
  missingWarnings: number
  missingWarningStudentCount: number
  avgGrunnskolepoeng: number | null
  avgGrade: number | null
}

type SortKey =
  | 'avgAbsence'
  | 'ivCount'
  | 'grade1Count'
  | 'grade2Count'
  | 'totalWarnings'
  | 'missingWarnings'
  | 'avgGrunnskolepoeng'
  | 'avgGrade'
  | 'avgGradeDelta'

type SortDirection = 'asc' | 'desc'

function fmt(n: number | null, decimals = 2): string {
  return n === null ? '—' : n.toFixed(decimals).replace('.', ',')
}

function StatCard({
  label,
  value,
  highlight,
  active,
  onClick,
}: {
  label: string
  value: ReactNode
  highlight?: boolean
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        highlight ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
      } ${active ? 'ring-2 ring-sky-300 ring-offset-1' : ''}`}
    >
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <div className={`text-2xl font-bold ${highlight ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>
    </button>
  )
}

function Th({
  children,
  center,
  right,
  className = '',
  onClick,
  sort,
}: {
  children: ReactNode
  center?: boolean
  right?: boolean
  className?: string
  onClick?: () => void
  sort?: SortDirection | null
}) {
  const align = center ? 'text-center' : right ? 'text-right' : 'text-left'
  const justify = center ? 'justify-center' : right ? 'justify-end' : 'justify-start'
  const indicator = sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : ''
  return (
    <th className={`py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${align} ${className}`}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex w-full items-center gap-1 bg-transparent p-0 text-xs font-semibold uppercase tracking-wide text-slate-500 ${justify} hover:text-slate-600 focus:outline-none`}
        >
          <span>{children}</span>
          <span className="min-w-2 text-[10px] leading-none text-slate-400">{indicator}</span>
        </button>
      ) : (
        children
      )}
    </th>
  )
}

function Td({ children, warn, center, className = '' }: { children: ReactNode; warn?: boolean; center?: boolean; className?: string }) {
  return (
    <td className={`py-2 px-3 ${center ? 'text-center' : 'text-right'} ${warn ? 'text-amber-700 font-semibold' : 'text-slate-700'} ${className}`}>
      {children}
    </td>
  )
}

function gradeDelta(avgGrade: number | null, avgGrunnskolepoeng: number | null): number | null {
  if (avgGrade === null || avgGrunnskolepoeng === null) return null
  return avgGrade - avgGrunnskolepoeng
}

export default function StatsView({ data, threshold }: Props) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null)
  const [tableSort, setTableSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null)
  const [vgFilter, setVgFilter] = useState<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const toggleMetric = (metric: MetricKey) => {
    setSelectedMetric(current => (current === metric ? null : metric))
  }

  const exportStatsPNG = async () => {
    if (!summaryRef.current || !tableRef.current) return

    try {
      const { default: html2canvas } = await import('html2canvas')

      // Capture summary section
      const summaryCanvas = await html2canvas(summaryRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
      })

      // Capture table section
      const tableCanvas = await html2canvas(tableRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
      })

      // Combine canvases vertically
      const gap = 20
      const combinedHeight = summaryCanvas.height + tableCanvas.height + gap * 2
      const combinedCanvas = document.createElement('canvas')
      combinedCanvas.width = summaryCanvas.width
      combinedCanvas.height = combinedHeight

      const ctx = combinedCanvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height)
      ctx.drawImage(summaryCanvas, 0, gap)
      ctx.drawImage(tableCanvas, 0, summaryCanvas.height + gap * 2)

      // Download
      const link = document.createElement('a')
      link.href = combinedCanvas.toDataURL('image/png')
      link.download = `statistikk-${todayDdMmYyyy()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Export failed:', error)
      alert('Kunne ikke eksportere statistikk. Prøv på nytt.')
    }
  }

  const generateStatsPptx = async () => {
    const PptxGenJS = (await import('pptxgenjs')).default
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_16x9'

    const NAVY = '1E3A5F'
    const BLUE = '2563EB'
    const WHITE = 'FFFFFF'
    const AMBER = 'F59E0B'
    const RED = 'D93025'
    const SLATE = '64748B'
    const TEXT = '1E293B'

    const addHeader = (slide: any, title: string) => {
      slide.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.75, fill: { color: NAVY } })
      slide.addText(title, { x: 0.3, y: 0, w: 9.1, h: 0.75, fontSize: 20, bold: true, color: WHITE, valign: 'middle' })
      slide.addText(todayDdMmYyyy(), { x: 8.7, y: 0, w: 1.2, h: 0.75, fontSize: 9, color: 'A0B4CC', valign: 'middle', align: 'right' })
    }

    // ── Compute supplementary totals ────────────────────────────────────
    // Students with at least one subject > 10% absence
    const studentsOver10 = new Set<string>()
    data.absences.forEach(r => {
      if (r.percentageAbsence > 10) studentsOver10.add(buildStudentClassKey(r.navn, r.class))
    })
    // Missing warnings where absence > 10%
    const missingWarningsOver10Students = new Set<string>()
    const missingWarningsOver10Subjects = new Set<string>()
    const _checkedOver10 = new Set<string>()
    const _warnMap10 = new Map<string, boolean>()
    data.warnings.forEach(w => {
      _warnMap10.set(buildStudentSubjectKey(w.navn, w.class, w.subjectGroup), true)
    })
    data.absences.forEach(r => {
      const combo = buildStudentSubjectKey(r.navn, r.class, r.subjectGroup)
      if (_checkedOver10.has(combo)) return
      _checkedOver10.add(combo)
      if (r.percentageAbsence > 10 && !_warnMap10.has(combo)) {
        missingWarningsOver10Students.add(buildStudentClassKey(r.navn, r.class))
        missingWarningsOver10Subjects.add(combo)
      }
    })
    // Students who received a vurderingsgrunnlag warning
    const gWarningStudents = new Set<string>()
    data.warnings.forEach(w => {
      const t = w.warningType.toLowerCase()
      if (t.includes('vurdering') || t.includes('grunnlag')) {
        gWarningStudents.add(buildStudentClassKey(w.navn, w.class))
      }
    })

    // ── Slide 1: Title ──────────────────────────────────────────────────
    const s1 = pptx.addSlide()
    s1.background = { color: NAVY }
    s1.addShape('rect', { x: 0, y: 4.5, w: '100%', h: 1.125, fill: { color: BLUE } })
    s1.addText('Opplæringsstatistikk', { x: 0.6, y: 1.1, w: 8.8, h: 1.3, fontSize: 42, bold: true, color: WHITE })
    s1.addText(`Skoleåret \u00b7 ${todayDdMmYyyy()}`, { x: 0.6, y: 2.45, w: 8.8, h: 0.6, fontSize: 18, color: 'AACCEE' })
    s1.addText(`${stats.overall.studentCount} elever \u00b7 ${stats.perClass.length} klasser`, { x: 0.6, y: 3.1, w: 8.8, h: 0.5, fontSize: 14, color: '7AAABB' })
    s1.addText('Generert av Oppfølging', { x: 0.6, y: 4.55, w: 8.8, h: 0.55, fontSize: 12, color: WHITE, valign: 'middle' })

    // ── Slide 2: Totaloversikt ───────────────────────────────────────────
    const s2 = pptx.addSlide()
    s2.background = { color: 'F8FAFC' }
    addHeader(s2 as any, 'Totaloversikt')
    // 3×3 grid of cards (shrunk to fit 9 cards)
    const totalCards = [
      { label: 'Elever', value: String(stats.overall.studentCount), sub: null, warn: false },
      { label: 'Gj.snitt fravær', value: `${fmt(stats.overall.avgAbsence, 1)}%`, sub: null, warn: false },
      { label: 'Elever over 10% fravær', value: String(studentsOver10.size), sub: null, warn: studentsOver10.size > 0 },
      { label: 'IV', value: String(stats.overall.ivCount), sub: `${stats.overall.ivStudentCount} elever`, warn: false },
      { label: 'Karakter 1', value: String(stats.overall.grade1Count), sub: `${stats.overall.grade1StudentCount} elever`, warn: false },
      { label: 'Varsler totalt', value: String(stats.overall.totalWarnings), sub: null, warn: false },
      { label: 'Manglende varsler', value: String(stats.overall.missingWarnings), sub: `${stats.overall.missingWarningStudentCount} elever`, warn: true },
      { label: 'Manglende varsler >10%', value: String(missingWarningsOver10Students.size), sub: `${missingWarningsOver10Subjects.size} fag uten varsel`, warn: missingWarningsOver10Students.size > 0 },
      { label: 'Varslet vurderingsgrunnlag', value: String(gWarningStudents.size), sub: 'elever varslet', warn: false },
    ]
    totalCards.forEach((card, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = 0.3 + col * 3.2
      const y = 0.85 + row * 1.45
      const h = 1.3
      s2.addShape('rect', { x, y, w: 3.0, h, fill: { color: card.warn ? 'FFF7ED' : WHITE }, line: { color: card.warn ? 'FDB07E' : 'CBD5E1', width: 1 } })
      s2.addText(card.label, { x, y: y + 0.08, w: 3.0, h: 0.32, fontSize: 8, color: SLATE, align: 'center' })
      s2.addText(card.value, { x, y: y + 0.38, w: 3.0, h: 0.62, fontSize: 26, bold: true, color: card.warn ? 'C2410C' : TEXT, align: 'center' })
      if (card.sub) s2.addText(card.sub, { x, y: y + 1.02, w: 3.0, h: 0.24, fontSize: 7.5, color: SLATE, align: 'center' })
    })
    levelStats.forEach((ls, i) => {
      const x = 0.3 + i * 3.2
      s2.addText(`Vg${ls.level}: ${ls.studentCount} elever \u00b7 ${fmt(ls.avgAbsence, 1)}% fravær`, { x, y: 5.2, w: 3.0, h: 0.28, fontSize: 8, color: SLATE, align: 'center' })
    })

    // ── Slides per trinn ────────────────────────────────────────────────
    // Build grade distribution by class (T1 only) — used in per-trinn and karakterfordeling slides
    const gradeDistByClass = new Map<string, Map<string, number>>()
    data.grades.forEach(g => {
      const h = g.halvår.toString().trim()
      if (!(h === '1' || h.toLowerCase().includes('1'))) return
      const resolvedClass = g.class?.trim()
      if (!resolvedClass) return
      const gradeVal = g.grade.trim().toUpperCase()
      if (!['1','2','3','4','5','6','IV'].includes(gradeVal)) return
      if (!gradeDistByClass.has(resolvedClass)) gradeDistByClass.set(resolvedClass, new Map())
      const dist = gradeDistByClass.get(resolvedClass)!
      dist.set(gradeVal, (dist.get(gradeVal) ?? 0) + 1)
    })

    for (const ls of levelStats) {
      const classRows = stats.perClass.filter(c => c.className.startsWith(ls.level))
      const labels = classRows.map(c => c.className)

      const slide = pptx.addSlide()
      slide.background = { color: 'F8FAFC' }
      addHeader(slide as any, `Vg${ls.level} \u2013 ${ls.studentCount} elever i ${ls.classCount} klasser`)

      // Left: key metrics
      const leftMetrics = [
        { label: 'Gj.snitt fravær', value: `${fmt(ls.avgAbsence, 1)}%` },
        { label: 'IV', value: `${ls.ivCount} (${ls.ivStudentCount} elever)` },
        { label: 'Karakter 1', value: `${ls.grade1Count} (${ls.grade1StudentCount} elever)` },
        { label: 'Neg. karakterer', value: `${ls.negativeStudentsCount} (${fmt(ls.negativeStudentsPct, 1)}%)` },
        { label: 'Varsler F', value: String(ls.fWarnings) },
        { label: 'Varsler G', value: String(ls.gWarnings) },
        { label: 'Manglende', value: String(ls.missingWarnings) },
      ]
      leftMetrics.forEach((m, i) => {
        const y = 0.9 + i * 0.64
        slide.addText(m.label + ':', { x: 0.2, y, w: 1.8, h: 0.55, fontSize: 9.5, color: SLATE, valign: 'middle' })
        slide.addText(m.value, { x: 2.0, y, w: 1.6, h: 0.55, fontSize: 10.5, bold: true, color: TEXT, valign: 'middle' })
      })

      // Right top: absence bar chart
      slide.addChart('bar', [{ name: 'Fravær %', labels, values: classRows.map(c => parseFloat(c.avgAbsence.toFixed(1))) }] as any, {
        x: 3.9, y: 0.8, w: 5.8, h: 2.3,
        barDir: 'col',
        chartColors: [BLUE],
        showValue: true,
        dataLabelFontSize: 8,
        catAxisLabelFontSize: 8,
        valAxisMinVal: 0,
        valAxisMaxVal: 30,
        showTitle: true,
        title: 'Gj.snitt fravær %',
        titleFontSize: 10,
      } as any)

      // Right bottom: grades chart
      slide.addChart('bar', [
        { name: 'IV', labels, values: classRows.map(c => c.ivCount) },
        { name: 'Karakter 1', labels, values: classRows.map(c => c.grade1Count) },
        { name: 'Karakter 2', labels, values: classRows.map(c => c.grade2Count) },
      ] as any, {
        x: 3.9, y: 3.2, w: 5.8, h: 2.3,
        barDir: 'col',
        barGrouping: 'clustered',
        chartColors: [RED, AMBER, '60A5FA'],
        showValue: true,
        dataLabelFontSize: 8,
        catAxisLabelFontSize: 8,
        showTitle: true,
        title: 'IV / Karakter 1 / Karakter 2',
        titleFontSize: 10,
        showLegend: true,
        legendFontSize: 8,
        legendPos: 'b',
      } as any)

      // ── Grade spread slide for this trinn ──────────────────────────────
      const gradeKeys = ['IV', '1', '2', '3', '4', '5', '6']
      const gradeColors = [RED, 'F97316', AMBER, 'FDE68A', '86EFAC', '22C55E', '166534']
      // Aggregate grade counts across all classes in this trinn
      const trinnGradeCounts = gradeKeys.map(gk =>
        classRows.reduce((sum, c) => sum + (gradeDistByClass.get(c.className)?.get(gk) ?? 0), 0)
      )
      const totalGradesInTrinn = trinnGradeCounts.reduce((a, b) => a + b, 0)
      if (totalGradesInTrinn > 0) {
        const sg2 = pptx.addSlide()
        sg2.background = { color: 'F8FAFC' }
        addHeader(sg2 as any, `Vg${ls.level} \u2013 Karakterspredning snitt (T1)`)
        // Left: bar chart one bar per grade
        sg2.addChart('bar', gradeKeys.map((gk, gi) => ({
          name: gk,
          labels: [gk],
          values: [trinnGradeCounts[gi]],
          color: gradeColors[gi],
        })) as any, {
          x: 0.3, y: 0.85, w: 5.0, h: 4.5,
          barDir: 'col',
          barGrouping: 'clustered',
          chartColors: gradeColors,
          showValue: true,
          dataLabelFontSize: 10,
          catAxisLabelFontSize: 11,
          showTitle: true,
          title: 'Antall karakterer (alle klasser i trinnet)',
          titleFontSize: 10,
          showLegend: false,
        } as any)
        // Right: pie chart
        sg2.addChart('pie', [{
          name: 'Karakterfordeling',
          labels: gradeKeys,
          values: trinnGradeCounts,
        }] as any, {
          x: 5.5, y: 0.85, w: 4.2, h: 4.5,
          chartColors: gradeColors,
          showValue: false,
          showPercent: true,
          dataLabelFontSize: 9,
          showTitle: true,
          title: 'Fordeling (%)',
          titleFontSize: 10,
          showLegend: true,
          legendFontSize: 9,
          legendPos: 'b',
        } as any)
      }
    }

    // ── Slide: Varsler ──────────────────────────────────────────────────
    const sv = pptx.addSlide()
    sv.background = { color: 'F8FAFC' }
    addHeader(sv as any, 'Varsler \u2013 oversikt')

    const allLabels = stats.perClass.map(c => c.className)
    sv.addChart('bar', [
      { name: 'Fraværsvarsler (F)', labels: allLabels, values: stats.perClass.map(c => c.fWarnings) },
      { name: 'Karaktervarsler (G)', labels: allLabels, values: stats.perClass.map(c => c.gWarnings) },
    ] as any, {
      x: 0.3, y: 0.85, w: 9.4, h: 2.9,
      barDir: 'col',
      barGrouping: 'stacked',
      chartColors: [BLUE, AMBER],
      showValue: true,
      dataLabelFontSize: 7,
      catAxisLabelFontSize: 8,
      showTitle: true,
      title: 'Varsler per klasse',
      titleFontSize: 10,
    } as any)

    const missingLabels = stats.perClass.filter(c => c.missingWarnings > 0).map(c => c.className)
    const missingValues = stats.perClass.filter(c => c.missingWarnings > 0).map(c => c.missingWarnings)
    if (missingLabels.length > 0) {
      sv.addChart('bar', [{ name: 'Manglende varsler', labels: missingLabels, values: missingValues }] as any, {
        x: 0.3, y: 3.9, w: 9.4, h: 1.6,
        barDir: 'col',
        chartColors: [RED],
        showValue: true,
        dataLabelFontSize: 7,
        catAxisLabelFontSize: 8,
        showTitle: true,
        title: 'Manglende varsler per klasse',
        titleFontSize: 10,
      } as any)
    }

    // ── Slides: Inntakspoeng delta per trinn ─────────────────────────────
    for (const ls of levelStats) {
      const classRows = stats.perClass.filter(c => c.className.startsWith(ls.level) && c.avgGrunnskolepoeng !== null && c.avgGrade !== null)
      if (classRows.length === 0) continue
      const labels = classRows.map(c => c.className)
      const deltas = classRows.map(c => parseFloat((c.avgGrade! - c.avgGrunnskolepoeng!).toFixed(2)))
      const si = pptx.addSlide()
      si.background = { color: 'F8FAFC' }
      addHeader(si as any, `Vg${ls.level} \u2013 Inntakspoeng: \u0394 VGS-snitt minus grunnskolepoeng`)
      // pptxgenjs doesn't natively support per-bar colours, so we split into two series: positive and negative
      const posValues = deltas.map(d => d >= 0 ? d : null)
      const negValues = deltas.map(d => d < 0 ? d : null)
      si.addChart('bar', [
        { name: 'Positiv utvikling (\u2191)', labels, values: posValues },
        { name: 'Negativ utvikling (\u2193)', labels, values: negValues },
      ] as any, {
        x: 0.3, y: 0.85, w: 9.4, h: 4.6,
        barDir: 'col',
        barGrouping: 'stacked',
        chartColors: ['166534', 'C0392B'],
        showValue: true,
        dataLabelFontSize: 9,
        dataLabelFormatCode: '0.00',
        catAxisLabelFontSize: 9,
        valAxisMinVal: Math.min(...deltas) < 0 ? Math.floor(Math.min(...deltas)) - 0.5 : -1,
        valAxisMaxVal: Math.max(...deltas) > 0 ? Math.ceil(Math.max(...deltas)) + 0.5 : 1,
        showTitle: true,
        title: '\u0394 = Snitt VGS T1 \u2212 Inntakspoeng (grunnskole) \u2014 baseline 0',
        titleFontSize: 10,
        showLegend: true,
        legendFontSize: 9,
      } as any)
    }

    // ── Slides: Karakterfordeling per trinn ──────────────────────────────
    for (const ls of levelStats) {
      const classRows = stats.perClass.filter(c => c.className.startsWith(ls.level) && gradeDistByClass.has(c.className))
      if (classRows.length === 0) continue
      const labels = classRows.map(c => c.className)
      const gradeKeys = ['IV', '1', '2', '3', '4', '5', '6']
      const gradeColors = [RED, 'F97316', AMBER, 'FDE68A', '86EFAC', '22C55E', '166534']

      // Find class with most low grades (IV + 1 + 2)
      const lowGradeKeys = ['IV', '1', '2']
      let worstClass = ''
      let worstCount = -1
      classRows.forEach(c => {
        const dist = gradeDistByClass.get(c.className)
        const count = lowGradeKeys.reduce((sum, gk) => sum + (dist?.get(gk) ?? 0), 0)
        if (count > worstCount) { worstCount = count; worstClass = c.className }
      })

      const sg = pptx.addSlide()
      sg.background = { color: 'F8FAFC' }
      addHeader(sg as any, `Vg${ls.level} \u2013 Karakterfordeling per klasse (T1)`)
      sg.addChart('bar', gradeKeys.map((gk, gi) => ({
        name: gk,
        labels,
        values: labels.map(cls => gradeDistByClass.get(cls)?.get(gk) ?? 0),
        color: gradeColors[gi],
      })) as any, {
        x: 0.3, y: 0.85, w: 9.4, h: 3.9,
        barDir: 'col',
        barGrouping: 'stacked',
        chartColors: gradeColors,
        showValue: true,
        dataLabelFontSize: 7,
        catAxisLabelFontSize: 9,
        showTitle: true,
        title: 'Antall karakterer per klasse (T1)',
        titleFontSize: 10,
        showLegend: true,
        legendFontSize: 9,
      } as any)

      // Underline + annotation for class with most low grades (IV/1/2)
      // Chart plot area: x=0.3, w=9.4, left margin ~12%, right margin ~3% in pptxgenjs stacked bar
      if (worstClass && worstCount > 0) {
        const idx = labels.indexOf(worstClass)
        const n = labels.length
        const plotLeft = 0.3 + 9.4 * 0.12
        const plotWidth = 9.4 * 0.85
        const barSlotW = plotWidth / n
        const xCenter = plotLeft + (idx + 0.5) * barSlotW
        // Line just below the chart
        sg.addShape('line' as any, {
          x: xCenter - barSlotW * 0.35, y: 4.82, w: barSlotW * 0.7, h: 0,
          line: { color: RED, width: 2.5 },
        })
        sg.addText(`\u26a0 ${worstClass}: flest lave karakterer (IV/1/2: ${worstCount})`, {
          x: 0.3, y: 4.95, w: 9.4, h: 0.28,
          fontSize: 8,
          color: RED,
          bold: true,
          align: 'center',
        })
      }
    }

    // ── Slide: Karakterspredning sammenlignet per trinn ──────────────────
    {
      const gradeKeys = ['IV', '1', '2', '3', '4', '5', '6']
      // Trinn that actually have grade data
      const trinnWithData = levelStats.filter(ls =>
        stats.perClass.some(c => c.className.startsWith(ls.level) && gradeDistByClass.has(c.className))
      )
      if (trinnWithData.length > 0) {
        // Compute percentage of each grade per trinn
        const trinnTotals = trinnWithData.map(ls => {
          const classRows = stats.perClass.filter(c => c.className.startsWith(ls.level))
          return gradeKeys.reduce((sum, gk) =>
            sum + classRows.reduce((s, c) => s + (gradeDistByClass.get(c.className)?.get(gk) ?? 0), 0), 0)
        })
        const sc = pptx.addSlide()
        sc.background = { color: 'F8FAFC' }
        addHeader(sc as any, 'Karakterspredning \u2013 sammenligning per trinn (T1, %)')
        // One series per trinn, X-axis = grade, values = % of that grade in that trinn
        sc.addChart('bar', trinnWithData.map((ls, ti) => ({
          name: `Vg${ls.level}`,
          labels: gradeKeys,
          values: gradeKeys.map(gk => {
            const classRows = stats.perClass.filter(c => c.className.startsWith(ls.level))
            const count = classRows.reduce((s, c) => s + (gradeDistByClass.get(c.className)?.get(gk) ?? 0), 0)
            return trinnTotals[ti] > 0 ? parseFloat(((count / trinnTotals[ti]) * 100).toFixed(1)) : 0
          }),
        })) as any, {
          x: 0.3, y: 0.85, w: 9.4, h: 4.5,
          barDir: 'col',
          barGrouping: 'clustered',
          showValue: true,
          dataLabelFontSize: 8,
          dataLabelFormatCode: '0.0"%"',
          catAxisLabelFontSize: 12,
          valAxisMaxVal: 50,
          showTitle: true,
          title: '% av karakterer per trinn \u2014 ett sett stolper per karakter, ett per trinn',
          titleFontSize: 10,
          showLegend: true,
          legendFontSize: 10,
          legendPos: 'b',
        } as any)
      }
    }

    await pptx.writeFile({ fileName: `statistikk_${todayDdMmYyyy()}.pptx` })
  }

  const cycleTableSort = (key: SortKey) => {
    setTableSort(current => {
      if (!current || current.key !== key) return { key, direction: 'asc' }
      if (current.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
  }

  const resetTableSort = () => {
    setTableSort(null)
  }

  const stats = useMemo(() => {
    const absenceSubjectClassLookup = createAbsenceSubjectClassLookup(data.absences)

    // Warning map: normalizedNavn::normalizedSubjectGroup -> count by type
    const warningMap = new Map<string, { type: string }[]>()
    data.warnings.forEach(w => {
      const key = buildStudentSubjectKey(w.navn, w.class, w.subjectGroup)
      if (!warningMap.has(key)) warningMap.set(key, [])
      warningMap.get(key)!.push({ type: w.warningType })
    })

    // Grade map: normalizedNavn::normalizedClass -> grades[] (halvår 1 only)
    const gradesByStudent = new Map<string, string[]>()
    data.grades.forEach(g => {
      const h = g.halvår.toString().trim()
      if (h === '1' || h.toLowerCase().includes('1')) {
        const resolvedClass = g.class?.trim() || resolveClassFromSubjectLookup(absenceSubjectClassLookup, g.navn, g.subjectGroup)
        if (!resolvedClass) return
        const key = buildStudentClassKey(g.navn, resolvedClass)
        if (!gradesByStudent.has(key)) gradesByStudent.set(key, [])
        gradesByStudent.get(key)!.push(g.grade)
      }
    })

    // Intake points map: normalizedNavn::normalizedClass -> intakePoints
    const intakeByStudent = new Map<string, number | null>()
    data.studentInfo.forEach(si => {
      if (!si.class) return
      intakeByStudent.set(buildStudentClassKey(si.navn, si.class), si.intakePoints)
    })

    // All unique classes sorted
    const classSet = new Set<string>()
    data.absences.forEach(r => classSet.add(r.class))
    const classes = Array.from(classSet).sort((a, b) =>
      a.localeCompare(b, 'nb-NO', { numeric: true })
    )

    const computeClassStats = (absences: typeof data.absences, className: string): ClassStats => {
      // Unique students
      const studentKeys = new Set(absences.map(r => buildStudentClassKey(r.navn, r.class)))
      const studentCount = studentKeys.size

      // Avg absence
      const avgAbsence =
        absences.length > 0
          ? absences.reduce((s, r) => s + r.percentageAbsence, 0) / absences.length
          : 0

      // Grade counts from grades file
      let ivCount = 0
      let ivStudentCount = 0
      let grade1Count = 0
      let grade1StudentCount = 0
      let grade2Count = 0
      let grade2StudentCount = 0
      let bothIvAnd1StudentCount = 0
      const numericGrades: number[] = []
      studentKeys.forEach(studentKey => {
        const grades = gradesByStudent.get(studentKey) ?? []
        let hasIv = false
        let hasGrade1 = false
        let hasGrade2 = false
        grades.forEach(g => {
          const lower = g.toLowerCase().trim()
          if (lower === 'iv') {
            ivCount++
            hasIv = true
          } else if (g === '1') {
            grade1Count++
            hasGrade1 = true
          } else if (g === '2') {
            grade2Count++
            hasGrade2 = true
          }
          const num = parseInt(g)
          if (!isNaN(num) && num >= 1 && num <= 6) numericGrades.push(num)
        })
        if (hasIv) ivStudentCount++
        if (hasGrade1) grade1StudentCount++
        if (hasGrade2) grade2StudentCount++
        if (hasIv && hasGrade1) bothIvAnd1StudentCount++
      })
      const avgGrade =
        numericGrades.length > 0
          ? numericGrades.reduce((a, b) => a + b, 0) / numericGrades.length
          : null

      const negativeStudentsCount = ivStudentCount + grade1StudentCount - bothIvAnd1StudentCount
      const negativeStudentsPct = studentCount > 0 ? (negativeStudentsCount / studentCount) * 100 : 0

      // Warnings for this class
      let totalWarnings = 0
      let fWarnings = 0
      let gWarnings = 0
      data.warnings
        .filter(w => w.class === className)
        .forEach(w => {
          totalWarnings++
          const t = w.warningType.toLowerCase()
          if (t.includes('frav')) fWarnings++
          else if (t.includes('vurdering') || t.includes('grunnlag')) gWarnings++
        })

      // Missing warnings: absence > threshold%, no warnings for that subject (unique student+subject combos)
      let missingWarnings = 0
      const checkedCombos = new Set<string>()
      const missingWarningStudents = new Set<string>()
      absences.forEach(r => {
        const comboKey = buildStudentSubjectKey(r.navn, r.class, r.subjectGroup)
        if (checkedCombos.has(comboKey)) return
        checkedCombos.add(comboKey)
        const warnings = warningMap.get(comboKey) ?? []
        if (r.percentageAbsence > threshold && warnings.length === 0) {
          missingWarnings++
          missingWarningStudents.add(buildStudentClassKey(r.navn, r.class))
        }
      })

      // Grunnskolepoeng
      const gpValues: number[] = []
      studentKeys.forEach(studentKey => {
        const ip = intakeByStudent.get(studentKey)
        if (ip === null || ip === undefined) return
        if (ip > 400 && ip < 500) gpValues.push((ip - 400) / 10)
        else if (ip > 900 && ip < 1000) gpValues.push((ip - 900) / 10)
      })
      const avgGrunnskolepoeng =
        gpValues.length > 0 ? gpValues.reduce((a, b) => a + b, 0) / gpValues.length : null

      return {
        className,
        studentCount,
        avgAbsence,
        ivCount,
        ivStudentCount,
        grade1Count,
        grade1StudentCount,
        grade2Count,
        grade2StudentCount,
        bothIvAnd1StudentCount,
        negativeStudentsCount,
        negativeStudentsPct,
        totalWarnings,
        fWarnings,
        gWarnings,
        missingWarnings,
        missingWarningStudentCount: missingWarningStudents.size,
        avgGrunnskolepoeng,
        avgGrade,
      }
    }

    const perClass: ClassStats[] = classes.map(className => {
      const absences = data.absences.filter(r => r.class === className)
      return computeClassStats(absences, className)
    })

    // Overall totals (sum/average across all)
    const allGpValues = perClass.flatMap(c =>
      c.avgGrunnskolepoeng !== null ? [c.avgGrunnskolepoeng] : []
    )
    const allGradeValues = perClass.flatMap(c => (c.avgGrade !== null ? [c.avgGrade] : []))

    let overallIvStudentCount = 0
    let overallGrade1StudentCount = 0
    let overallGrade2StudentCount = 0
    let overallBothIvAnd1StudentCount = 0
    gradesByStudent.forEach(grades => {
      let hasIv = false
      let hasGrade1 = false
      let hasGrade2 = false
      grades.forEach(g => {
        const lower = g.toLowerCase().trim()
        if (lower === 'iv') hasIv = true
        else if (g === '1') hasGrade1 = true
        else if (g === '2') hasGrade2 = true
      })
      if (hasIv) overallIvStudentCount++
      if (hasGrade1) overallGrade1StudentCount++
      if (hasGrade2) overallGrade2StudentCount++
      if (hasIv && hasGrade1) overallBothIvAnd1StudentCount++
    })

    const overall: ClassStats = {
      className: 'Totalt',
      studentCount: new Set(data.absences.map(r => buildStudentClassKey(r.navn, r.class))).size,
      avgAbsence:
        data.absences.length > 0
          ? data.absences.reduce((s, r) => s + r.percentageAbsence, 0) / data.absences.length
          : 0,
      ivCount: perClass.reduce((s, c) => s + c.ivCount, 0),
          ivStudentCount: overallIvStudentCount,
      grade1Count: perClass.reduce((s, c) => s + c.grade1Count, 0),
          grade1StudentCount: overallGrade1StudentCount,
      grade2Count: perClass.reduce((s, c) => s + c.grade2Count, 0),
          grade2StudentCount: overallGrade2StudentCount,
      bothIvAnd1StudentCount: overallBothIvAnd1StudentCount,
      negativeStudentsCount:
        overallIvStudentCount + overallGrade1StudentCount - overallBothIvAnd1StudentCount,
      negativeStudentsPct:
        new Set(data.absences.map(r => buildStudentClassKey(r.navn, r.class))).size > 0
          ? ((overallIvStudentCount + overallGrade1StudentCount - overallBothIvAnd1StudentCount) /
              new Set(data.absences.map(r => buildStudentClassKey(r.navn, r.class))).size) *
            100
          : 0,
      totalWarnings: perClass.reduce((s, c) => s + c.totalWarnings, 0),
      fWarnings: perClass.reduce((s, c) => s + c.fWarnings, 0),
      gWarnings: perClass.reduce((s, c) => s + c.gWarnings, 0),
      missingWarnings: perClass.reduce((s, c) => s + c.missingWarnings, 0),
      missingWarningStudentCount: perClass.reduce((s, c) => s + c.missingWarningStudentCount, 0),
      avgGrunnskolepoeng:
        allGpValues.length > 0 ? allGpValues.reduce((a, b) => a + b, 0) / allGpValues.length : null,
      avgGrade:
        allGradeValues.length > 0
          ? allGradeValues.reduce((a, b) => a + b, 0) / allGradeValues.length
          : null,
    }

    return { overall, perClass }
  }, [data, threshold])

  const levelStats = useMemo((): LevelStats[] => {
    const levels = ['1', '2', '3']
    return levels
      .map(level => {
        const classRows = stats.perClass.filter(c => c.className.startsWith(level))
        if (classRows.length === 0) return null

        const classNames = new Set(classRows.map(c => c.className))
        const levelAbsences = data.absences.filter(a => classNames.has(a.class))
        const avgAbsence =
          levelAbsences.length > 0
            ? levelAbsences.reduce((sum, row) => sum + row.percentageAbsence, 0) / levelAbsences.length
            : 0

        const studentCount = classRows.reduce((sum, c) => sum + c.studentCount, 0)
        const ivStudentCount = classRows.reduce((sum, c) => sum + c.ivStudentCount, 0)
        const grade1StudentCount = classRows.reduce((sum, c) => sum + c.grade1StudentCount, 0)
        const bothIvAnd1StudentCount = classRows.reduce((sum, c) => sum + c.bothIvAnd1StudentCount, 0)
        const negativeStudentsCount =
          ivStudentCount + grade1StudentCount - bothIvAnd1StudentCount

        const gskValues = classRows
          .map(c => c.avgGrunnskolepoeng)
          .filter((v): v is number => v !== null)
        const gradeValues = classRows.map(c => c.avgGrade).filter((v): v is number => v !== null)

        return {
          level,
          classCount: classRows.length,
          studentCount,
          avgAbsence,
          ivCount: classRows.reduce((sum, c) => sum + c.ivCount, 0),
          ivStudentCount,
          grade1Count: classRows.reduce((sum, c) => sum + c.grade1Count, 0),
          grade1StudentCount,
          grade2Count: classRows.reduce((sum, c) => sum + c.grade2Count, 0),
          grade2StudentCount: classRows.reduce((sum, c) => sum + c.grade2StudentCount, 0),
          bothIvAnd1StudentCount,
          negativeStudentsCount,
          negativeStudentsPct: studentCount > 0 ? (negativeStudentsCount / studentCount) * 100 : 0,
          totalWarnings: classRows.reduce((sum, c) => sum + c.totalWarnings, 0),
          fWarnings: classRows.reduce((sum, c) => sum + c.fWarnings, 0),
          gWarnings: classRows.reduce((sum, c) => sum + c.gWarnings, 0),
          missingWarnings: classRows.reduce((sum, c) => sum + c.missingWarnings, 0),
          missingWarningStudentCount: classRows.reduce((sum, c) => sum + c.missingWarningStudentCount, 0),
          avgGrunnskolepoeng:
            gskValues.length > 0
              ? gskValues.reduce((sum, v) => sum + v, 0) / gskValues.length
              : null,
          avgGrade:
            gradeValues.length > 0
              ? gradeValues.reduce((sum, v) => sum + v, 0) / gradeValues.length
              : null,
        }
      })
      .filter((row): row is LevelStats => row !== null)
  }, [data.absences, stats.perClass])

  const metricTitle: Record<MetricKey, string> = {
    students: 'Elever',
    avgAbsence: 'Gj.snitt fravær',
    iv: 'IV',
    grade1: 'Karakter 1',
    grade2: 'Karakter 2',
    avgDelta: 'Delta',
    warningsTotal: 'Varsler totalt',
    warningsF: 'Fraværsvarsler (F)',
    warningsG: 'Karaktervarsler (G)',
    missingWarnings: 'Manglende varsler (>8%)',
  }

  const metricValueText = (metric: MetricKey, row: LevelStats): string => {
    if (metric === 'students') {
      return `${row.studentCount} elever | Negative karakterer: ${row.negativeStudentsCount} (${fmt(row.negativeStudentsPct, 1)}%)`
    }
    if (metric === 'avgAbsence') return `${fmt(row.avgAbsence, 1)}%`
    if (metric === 'iv') {
      const ivOnly = Math.max(row.ivStudentCount - row.bothIvAnd1StudentCount, 0)
      return `${row.ivCount} | IV: ${ivOnly} elever | 1+IV: ${row.bothIvAnd1StudentCount} elever`
    }
    if (metric === 'grade1') {
      const oneOnly = Math.max(row.grade1StudentCount - row.bothIvAnd1StudentCount, 0)
      return `${row.grade1Count} | 1: ${oneOnly} elever | 1+IV: ${row.bothIvAnd1StudentCount} elever`
    }
    if (metric === 'grade2') return `${row.grade2Count} (${row.grade2StudentCount} elever)`
    if (metric === 'avgDelta') return fmt(gradeDelta(row.avgGrade, row.avgGrunnskolepoeng), 2)
    if (metric === 'warningsTotal') return String(row.totalWarnings)
    if (metric === 'warningsF') return String(row.fWarnings)
    if (metric === 'warningsG') return String(row.gWarnings)
    return `${row.missingWarnings} (${row.missingWarningStudentCount} elever)`
  }

  const sortedPerClass = useMemo(() => {
    if (!tableSort) return stats.perClass

    const valueFor = (row: ClassStats): number | null => {
      if (tableSort.key === 'avgAbsence') return row.avgAbsence
      if (tableSort.key === 'ivCount') return row.ivCount
      if (tableSort.key === 'grade1Count') return row.grade1Count
      if (tableSort.key === 'grade2Count') return row.grade2Count
      if (tableSort.key === 'totalWarnings') return row.totalWarnings
      if (tableSort.key === 'missingWarnings') return row.missingWarnings
      if (tableSort.key === 'avgGrunnskolepoeng') return row.avgGrunnskolepoeng
      if (tableSort.key === 'avgGrade') return row.avgGrade
      return gradeDelta(row.avgGrade, row.avgGrunnskolepoeng)
    }

    return [...stats.perClass].sort((a, b) => {
      const aVal = valueFor(a)
      const bVal = valueFor(b)

      if (aVal === null && bVal === null) {
        return a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
      }
      if (aVal === null) return 1
      if (bVal === null) return -1

      const diff = aVal - bVal
      if (diff !== 0) return tableSort.direction === 'asc' ? diff : -diff
      return a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
    })
  }, [stats.perClass, tableSort])

  const currentSort = (key: SortKey): SortDirection | null => {
    return tableSort?.key === key ? tableSort.direction : null
  }

  const filteredPerClass = useMemo(() => {
    if (!vgFilter) return sortedPerClass
    return sortedPerClass.filter(c => c.className.startsWith(vgFilter))
  }, [sortedPerClass, vgFilter])

  const filteredStats = useMemo(() => {
    if (filteredPerClass.length === 0) {
      return {
        className: 'Totalt',
        studentCount: 0,
        avgAbsence: 0,
        ivCount: 0,
        ivStudentCount: 0,
        grade1Count: 0,
        grade1StudentCount: 0,
        grade2Count: 0,
        grade2StudentCount: 0,
        bothIvAnd1StudentCount: 0,
        negativeStudentsCount: 0,
        negativeStudentsPct: 0,
        totalWarnings: 0,
        fWarnings: 0,
        gWarnings: 0,
        missingWarnings: 0,
        missingWarningStudentCount: 0,
        avgGrunnskolepoeng: null,
        avgGrade: null,
      }
    }

    // Get all student names from filtered classes
    const studentNames = new Set<string>()
    filteredPerClass.forEach(c => {
      const classAbsences = data.absences.filter(a => a.class === c.className)
      classAbsences.forEach(r => studentNames.add(normalizeMatch(r.navn)))
    })

    // Calculate totals from filtered per-class data
    const totalStudents = studentNames.size
    const totalIvCount = filteredPerClass.reduce((sum, c) => sum + c.ivCount, 0)
    const totalIvStudents = filteredPerClass.reduce((sum, c) => sum + c.ivStudentCount, 0)
    const totalGrade1Count = filteredPerClass.reduce((sum, c) => sum + c.grade1Count, 0)
    const totalGrade1Students = filteredPerClass.reduce((sum, c) => sum + c.grade1StudentCount, 0)
    const totalGrade2Count = filteredPerClass.reduce((sum, c) => sum + c.grade2Count, 0)
    const totalGrade2Students = filteredPerClass.reduce((sum, c) => sum + c.grade2StudentCount, 0)
    const totalBothIvAnd1 = filteredPerClass.reduce((sum, c) => sum + c.bothIvAnd1StudentCount, 0)
    const totalNegativeStudents = totalIvStudents + totalGrade1Students - totalBothIvAnd1
    
    // Calculate average absence from filtered absences
    const classNames = new Set(filteredPerClass.map(c => c.className))
    const filteredAbsences = data.absences.filter(a => classNames.has(a.class))
    const avgAbsence = filteredAbsences.length > 0
      ? filteredAbsences.reduce((sum, r) => sum + r.percentageAbsence, 0) / filteredAbsences.length
      : 0

    // Calculate average grades from filtered per-class data
    const gskValues = filteredPerClass
      .map(c => c.avgGrunnskolepoeng)
      .filter((v): v is number => v !== null)
    const gradeValues = filteredPerClass
      .map(c => c.avgGrade)
      .filter((v): v is number => v !== null)
    const avgGrunnskolepoeng = gskValues.length > 0
      ? gskValues.reduce((sum, v) => sum + v, 0) / gskValues.length
      : null
    const avgGrade = gradeValues.length > 0
      ? gradeValues.reduce((sum, v) => sum + v, 0) / gradeValues.length
      : null

    return {
      className: 'Totalt',
      studentCount: totalStudents,
      avgAbsence,
      ivCount: totalIvCount,
      ivStudentCount: totalIvStudents,
      grade1Count: totalGrade1Count,
      grade1StudentCount: totalGrade1Students,
      grade2Count: totalGrade2Count,
      grade2StudentCount: totalGrade2Students,
      bothIvAnd1StudentCount: totalBothIvAnd1,
      negativeStudentsCount: totalNegativeStudents,
      negativeStudentsPct: totalStudents > 0 ? (totalNegativeStudents / totalStudents) * 100 : 0,
      totalWarnings: filteredPerClass.reduce((sum, c) => sum + c.totalWarnings, 0),
      fWarnings: filteredPerClass.reduce((sum, c) => sum + c.fWarnings, 0),
      gWarnings: filteredPerClass.reduce((sum, c) => sum + c.gWarnings, 0),
      missingWarnings: filteredPerClass.reduce((sum, c) => sum + c.missingWarnings, 0),
      missingWarningStudentCount: filteredPerClass.reduce((sum, c) => sum + c.missingWarningStudentCount, 0),
      avgGrunnskolepoeng,
      avgGrade,
    }
  }, [filteredPerClass, data.absences])

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2 mb-2">
        <button
          type="button"
          onClick={() => void generateStatsPptx()}
          className="px-3 py-2 text-sm font-medium bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
        >
          📊 Eksporter som PowerPoint
        </button>
        <button
          type="button"
          onClick={exportStatsPNG}
          className="px-3 py-2 text-sm font-medium bg-slate-600 text-white rounded hover:bg-slate-700 transition-colors"
        >
          📥 Eksporter som PNG
        </button>
      </div>
      {/* Section 1: Overall summary cards */}
      <div ref={summaryRef} className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Totaloversikt</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <StatCard
            label="Elever"
            active={selectedMetric === 'students'}
            onClick={() => toggleMetric('students')}
            value={
              <div className="flex items-start justify-between gap-3">
                <span>{filteredStats.studentCount}</span>
                <span className="w-28 text-xs font-medium text-slate-500 leading-tight text-left">
                  <span className="block">
                    Negative karakterer: {filteredStats.negativeStudentsCount} elever ({fmt(filteredStats.negativeStudentsPct, 1)}%)
                  </span>
                </span>
              </div>
            }
          />
          <StatCard
            label="Gj.snitt fravær"
            value={`${fmt(filteredStats.avgAbsence, 1)}%`}
            active={selectedMetric === 'avgAbsence'}
            onClick={() => toggleMetric('avgAbsence')}
          />
          <StatCard
            label="IV"
            active={selectedMetric === 'iv'}
            onClick={() => toggleMetric('iv')}
            value={
              <div className="flex items-start justify-between gap-3">
                <span>{filteredStats.ivCount}</span>
                <span className="w-28 text-xs font-medium text-slate-500 leading-tight text-left">
                  <span className="block">IV: {Math.max(filteredStats.ivStudentCount - filteredStats.bothIvAnd1StudentCount, 0)} elever</span>
                  <span className="block">1+IV: {filteredStats.bothIvAnd1StudentCount} elever</span>
                </span>
              </div>
            }
          />
          <StatCard
            label="Karakter 1"
            active={selectedMetric === 'grade1'}
            onClick={() => toggleMetric('grade1')}
            value={
              <div className="flex items-start justify-between gap-3">
                <span>{filteredStats.grade1Count}</span>
                <span className="w-28 text-xs font-medium text-slate-500 leading-tight text-left">
                  <span className="block">1: {Math.max(filteredStats.grade1StudentCount - filteredStats.bothIvAnd1StudentCount, 0)} elever</span>
                  <span className="block">1+IV: {filteredStats.bothIvAnd1StudentCount} elever</span>
                </span>
              </div>
            }
          />
          <StatCard
            label="Karakter 2"
            value={`${filteredStats.grade2Count} (${filteredStats.grade2StudentCount})`}
            active={selectedMetric === 'grade2'}
            onClick={() => toggleMetric('grade2')}
          />
          <StatCard
            label="Delta"
            value={fmt(gradeDelta(filteredStats.avgGrade, filteredStats.avgGrunnskolepoeng), 2)}
            active={selectedMetric === 'avgDelta'}
            onClick={() => toggleMetric('avgDelta')}
          />
          <StatCard
            label="Varsler totalt"
            value={String(filteredStats.totalWarnings)}
            active={selectedMetric === 'warningsTotal'}
            onClick={() => toggleMetric('warningsTotal')}
          />
          <StatCard
            label="Fraværsvarsler (F)"
            value={String(filteredStats.fWarnings)}
            active={selectedMetric === 'warningsF'}
            onClick={() => toggleMetric('warningsF')}
          />
          <StatCard
            label="Karaktervarsler (G)"
            value={String(filteredStats.gWarnings)}
            active={selectedMetric === 'warningsG'}
            onClick={() => toggleMetric('warningsG')}
          />
          <StatCard
            label="Manglende varsler (>8%)"
            value={String(filteredStats.missingWarnings)}
            highlight
            active={selectedMetric === 'missingWarnings'}
            onClick={() => toggleMetric('missingWarnings')}
          />
        </div>

        {selectedMetric && (
          <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Detaljer per trinn</h3>
            <p className="text-xs text-slate-600 mt-1">Valgt nøkkeltall: {metricTitle[selectedMetric]}</p>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sky-200">
                    <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Trinn</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Klasser</th>
                    <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Verdi</th>
                  </tr>
                </thead>
                <tbody>
                  {levelStats.map(row => (
                    <tr key={row.level} className="border-b border-sky-100 last:border-0">
                      <td className="py-2 px-3 font-medium text-slate-900">{row.level}. trinn</td>
                      <td className="py-2 px-3 text-slate-700">{row.classCount}</td>
                      <td className="py-2 px-3 text-slate-700">{metricValueText(selectedMetric, row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Per-class table */}
      <div ref={tableRef} className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Per klasse</h2>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setVgFilter(null)}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              vgFilter === null
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Alle
          </button>
          <button
            type="button"
            onClick={() => setVgFilter('1')}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              vgFilter === '1'
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            VG1
          </button>
          <button
            type="button"
            onClick={() => setVgFilter('2')}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              vgFilter === '2'
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            VG2
          </button>
          <button
            type="button"
            onClick={() => setVgFilter('3')}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              vgFilter === '3'
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            VG3
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="border-b-2 border-slate-200">
                {/* Group: identity */}
                <Th onClick={resetTableSort}>Klasse</Th>
                {/* Group: attendance – shaded */}
                <Th
                  right
                  className="bg-slate-50 border-l border-slate-200"
                  onClick={() => cycleTableSort('avgAbsence')}
                  sort={currentSort('avgAbsence')}
                >
                  Gj.snitt fravær
                </Th>
                {/* Group: grades */}
                <Th
                  center
                  className="border-l border-slate-200"
                  onClick={() => cycleTableSort('ivCount')}
                  sort={currentSort('ivCount')}
                >
                  IV
                </Th>
                <Th center onClick={() => cycleTableSort('grade1Count')} sort={currentSort('grade1Count')}>1</Th>
                <Th center onClick={() => cycleTableSort('grade2Count')} sort={currentSort('grade2Count')}>2</Th>
                {/* Group: warnings – shaded */}
                <Th
                  center
                  className="bg-slate-50 border-l border-slate-200"
                  onClick={() => cycleTableSort('totalWarnings')}
                  sort={currentSort('totalWarnings')}
                >
                  Varsler (F+G)
                </Th>
                {/* Group: missing – amber */}
                <Th
                  center
                  className="bg-amber-50 border-l border-slate-200"
                  onClick={() => cycleTableSort('missingWarnings')}
                  sort={currentSort('missingWarnings')}
                >
                  Manglende varsler
                </Th>
                {/* Group: averages */}
                <Th
                  right
                  className="border-l border-slate-200"
                  onClick={() => cycleTableSort('avgGrunnskolepoeng')}
                  sort={currentSort('avgGrunnskolepoeng')}
                >
                  Inntakspoeng
                </Th>
                <Th right onClick={() => cycleTableSort('avgGrade')} sort={currentSort('avgGrade')}>Snitt vgs</Th>
                <Th right onClick={() => cycleTableSort('avgGradeDelta')} sort={currentSort('avgGradeDelta')}>Delta</Th>
              </tr>
            </thead>
            <tbody>
              {filteredPerClass.map(c => (
                <tr key={c.className} className="border-b border-slate-100 hover:bg-sky-50/40">
                  <td className="py-2 px-3 font-medium text-slate-900">{c.className}</td>
                  <Td center className="bg-slate-50 border-l border-slate-200">{fmt(c.avgAbsence, 1)}%</Td>
                  <Td center className="border-l border-slate-200">
                    {c.ivCount ? `${c.ivCount} (${c.ivStudentCount})` : '—'}
                  </Td>
                  <Td center>{c.grade1Count ? `${c.grade1Count} (${c.grade1StudentCount})` : '—'}</Td>
                  <Td center>{c.grade2Count ? `${c.grade2Count} (${c.grade2StudentCount})` : '—'}</Td>
                  <Td center className="bg-slate-50 border-l border-slate-200">{c.totalWarnings || '—'} ({c.fWarnings || 0}+{c.gWarnings || 0})</Td>
                  <Td center warn={c.missingWarnings > 0} className="bg-amber-50 border-l border-slate-200">
                    {c.missingWarnings ? `${c.missingWarnings} (${c.missingWarningStudentCount})` : '—'}
                  </Td>
                  <Td center className="border-l border-slate-200">{fmt(c.avgGrunnskolepoeng)}</Td>
                  <Td center>{fmt(c.avgGrade)}</Td>
                  <Td
                    center
                    className={
                      gradeDelta(c.avgGrade, c.avgGrunnskolepoeng) === null
                        ? ''
                        : gradeDelta(c.avgGrade, c.avgGrunnskolepoeng)! < 0
                          ? 'bg-red-50 text-slate-800 font-semibold'
                          : gradeDelta(c.avgGrade, c.avgGrunnskolepoeng)! > 0
                            ? 'bg-emerald-50 text-slate-800 font-semibold'
                            : ''
                    }
                  >
                    {gradeDelta(c.avgGrade, c.avgGrunnskolepoeng) === null
                      ? '—'
                      : fmt(gradeDelta(c.avgGrade, c.avgGrunnskolepoeng), 2)}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 px-3 text-slate-900 bg-slate-100">Totalt</td>
                <Td center className="bg-slate-100 border-l border-slate-200">{fmt(filteredStats.avgAbsence, 1)}%</Td>
                <Td center className="bg-slate-50 border-l border-slate-200">
                  {filteredStats.ivCount ? `${filteredStats.ivCount} (${filteredStats.ivStudentCount})` : '—'}
                </Td>
                <Td center className="bg-slate-50">
                  {filteredStats.grade1Count ? `${filteredStats.grade1Count} (${filteredStats.grade1StudentCount})` : '—'}
                </Td>
                <Td center className="bg-slate-50">
                  {filteredStats.grade2Count ? `${filteredStats.grade2Count} (${filteredStats.grade2StudentCount})` : '—'}
                </Td>
                <Td center className="bg-slate-100 border-l border-slate-200">{filteredStats.totalWarnings || '—'} ({filteredStats.fWarnings || 0}+{filteredStats.gWarnings || 0})</Td>
                <Td center warn={filteredStats.missingWarnings > 0} className="bg-amber-100 border-l border-slate-200">
                  {filteredStats.missingWarnings
                    ? `${filteredStats.missingWarnings} (${filteredStats.missingWarningStudentCount})`
                    : '—'}
                </Td>
                <Td center className="bg-slate-50 border-l border-slate-200">{fmt(filteredStats.avgGrunnskolepoeng)}</Td>
                <Td center className="bg-slate-50">{fmt(filteredStats.avgGrade)}</Td>
                <Td
                  center
                  className={
                    gradeDelta(filteredStats.avgGrade, filteredStats.avgGrunnskolepoeng) === null
                      ? 'bg-slate-50'
                      : gradeDelta(filteredStats.avgGrade, filteredStats.avgGrunnskolepoeng)! < 0
                        ? 'bg-red-50 text-slate-800'
                        : gradeDelta(filteredStats.avgGrade, filteredStats.avgGrunnskolepoeng)! > 0
                          ? 'bg-emerald-50 text-slate-800'
                          : 'bg-slate-50'
                  }
                >
                  {gradeDelta(filteredStats.avgGrade, filteredStats.avgGrunnskolepoeng) === null
                    ? '—'
                    : fmt(gradeDelta(filteredStats.avgGrade, filteredStats.avgGrunnskolepoeng), 2)}
                </Td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
