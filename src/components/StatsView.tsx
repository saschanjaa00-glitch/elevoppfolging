import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DataStore } from '../types'
import { normalizeMatch } from '../studentInfoUtils'

interface Props {
  data: DataStore
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
  avgGrunnskolepoeng: number | null
  avgGrade: number | null
}

type MetricKey =
  | 'students'
  | 'avgAbsence'
  | 'iv'
  | 'grade1'
  | 'grade2'
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
          className={`inline-flex w-full items-center gap-1 ${justify} hover:text-slate-700`}
        >
          <span>{children}</span>
          <span className="text-[10px] leading-none min-w-2">{indicator}</span>
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

export default function StatsView({ data }: Props) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null)
  const [tableSort, setTableSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null)

  const toggleMetric = (metric: MetricKey) => {
    setSelectedMetric(current => (current === metric ? null : metric))
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
    // Warning map: normalizedNavn::normalizedSubjectGroup -> count by type
    const warningMap = new Map<string, { type: string }[]>()
    data.warnings.forEach(w => {
      const key = `${normalizeMatch(w.navn)}::${normalizeMatch(w.subjectGroup)}`
      if (!warningMap.has(key)) warningMap.set(key, [])
      warningMap.get(key)!.push({ type: w.warningType })
    })

    // Grade map: normalizedNavn -> grades[] (halvår 1 only)
    const gradesByStudent = new Map<string, string[]>()
    data.grades.forEach(g => {
      const h = g.halvår.toString().trim()
      if (h === '1' || h.toLowerCase().includes('1')) {
        const key = normalizeMatch(g.navn)
        if (!gradesByStudent.has(key)) gradesByStudent.set(key, [])
        gradesByStudent.get(key)!.push(g.grade)
      }
    })

    // Intake points map: normalizedNavn -> intakePoints
    const intakeByStudent = new Map<string, number | null>()
    data.studentInfo.forEach(si => {
      intakeByStudent.set(normalizeMatch(si.navn), si.intakePoints)
    })

    // All unique classes sorted
    const classSet = new Set<string>()
    data.absences.forEach(r => classSet.add(r.class))
    const classes = Array.from(classSet).sort((a, b) =>
      a.localeCompare(b, 'nb-NO', { numeric: true })
    )

    const computeClassStats = (absences: typeof data.absences, className: string): ClassStats => {
      // Unique students
      const studentNames = new Set(absences.map(r => normalizeMatch(r.navn)))
      const studentCount = studentNames.size

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
      studentNames.forEach(normNavn => {
        const grades = gradesByStudent.get(normNavn) ?? []
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

      // Missing warnings: absence > 8%, no warnings for that subject (unique student+subject combos)
      let missingWarnings = 0
      const checkedCombos = new Set<string>()
      absences.forEach(r => {
        const comboKey = `${normalizeMatch(r.navn)}::${normalizeMatch(r.subjectGroup)}`
        if (checkedCombos.has(comboKey)) return
        checkedCombos.add(comboKey)
        const warnings = warningMap.get(comboKey) ?? []
        if (r.percentageAbsence > 8 && warnings.length === 0) missingWarnings++
      })

      // Grunnskolepoeng
      const gpValues: number[] = []
      studentNames.forEach(normNavn => {
        const ip = intakeByStudent.get(normNavn)
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
      studentCount: new Set(data.absences.map(r => normalizeMatch(r.navn))).size,
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
        new Set(data.absences.map(r => normalizeMatch(r.navn))).size > 0
          ? ((overallIvStudentCount + overallGrade1StudentCount - overallBothIvAnd1StudentCount) /
              new Set(data.absences.map(r => normalizeMatch(r.navn))).size) *
            100
          : 0,
      totalWarnings: perClass.reduce((s, c) => s + c.totalWarnings, 0),
      fWarnings: perClass.reduce((s, c) => s + c.fWarnings, 0),
      gWarnings: perClass.reduce((s, c) => s + c.gWarnings, 0),
      missingWarnings: perClass.reduce((s, c) => s + c.missingWarnings, 0),
      avgGrunnskolepoeng:
        allGpValues.length > 0 ? allGpValues.reduce((a, b) => a + b, 0) / allGpValues.length : null,
      avgGrade:
        allGradeValues.length > 0
          ? allGradeValues.reduce((a, b) => a + b, 0) / allGradeValues.length
          : null,
    }

    return { overall, perClass }
  }, [data])

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
    if (metric === 'warningsTotal') return String(row.totalWarnings)
    if (metric === 'warningsF') return String(row.fWarnings)
    if (metric === 'warningsG') return String(row.gWarnings)
    return String(row.missingWarnings)
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

  return (
    <div className="space-y-6">
      {/* Section 1: Overall summary cards */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Totaloversikt</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <StatCard
            label="Elever"
            active={selectedMetric === 'students'}
            onClick={() => toggleMetric('students')}
            value={
              <div className="flex items-start justify-between gap-3">
                <span>{stats.overall.studentCount}</span>
                <span className="w-28 text-xs font-medium text-slate-500 leading-tight text-left">
                  <span className="block">
                    Negative karakterer: {stats.overall.negativeStudentsCount} elever ({fmt(stats.overall.negativeStudentsPct, 1)}%)
                  </span>
                </span>
              </div>
            }
          />
          <StatCard
            label="Gj.snitt fravær"
            value={`${fmt(stats.overall.avgAbsence, 1)}%`}
            active={selectedMetric === 'avgAbsence'}
            onClick={() => toggleMetric('avgAbsence')}
          />
          <StatCard
            label="IV"
            active={selectedMetric === 'iv'}
            onClick={() => toggleMetric('iv')}
            value={
              <div className="flex items-start justify-between gap-3">
                <span>{stats.overall.ivCount}</span>
                <span className="w-28 text-xs font-medium text-slate-500 leading-tight text-left">
                  <span className="block">IV: {Math.max(stats.overall.ivStudentCount - stats.overall.bothIvAnd1StudentCount, 0)} elever</span>
                  <span className="block">1+IV: {stats.overall.bothIvAnd1StudentCount} elever</span>
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
                <span>{stats.overall.grade1Count}</span>
                <span className="w-28 text-xs font-medium text-slate-500 leading-tight text-left">
                  <span className="block">1: {Math.max(stats.overall.grade1StudentCount - stats.overall.bothIvAnd1StudentCount, 0)} elever</span>
                  <span className="block">1+IV: {stats.overall.bothIvAnd1StudentCount} elever</span>
                </span>
              </div>
            }
          />
          <StatCard
            label="Karakter 2"
            value={`${stats.overall.grade2Count} (${stats.overall.grade2StudentCount})`}
            active={selectedMetric === 'grade2'}
            onClick={() => toggleMetric('grade2')}
          />
          <StatCard
            label="Varsler totalt"
            value={String(stats.overall.totalWarnings)}
            active={selectedMetric === 'warningsTotal'}
            onClick={() => toggleMetric('warningsTotal')}
          />
          <StatCard
            label="Fraværsvarsler (F)"
            value={String(stats.overall.fWarnings)}
            active={selectedMetric === 'warningsF'}
            onClick={() => toggleMetric('warningsF')}
          />
          <StatCard
            label="Karaktervarsler (G)"
            value={String(stats.overall.gWarnings)}
            active={selectedMetric === 'warningsG'}
            onClick={() => toggleMetric('warningsG')}
          />
          <StatCard
            label="Manglende varsler (>8%)"
            value={String(stats.overall.missingWarnings)}
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
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Per klasse</h2>
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
                  GSK.P
                </Th>
                <Th right onClick={() => cycleTableSort('avgGrade')} sort={currentSort('avgGrade')}>Snitt vgs</Th>
                <Th right onClick={() => cycleTableSort('avgGradeDelta')} sort={currentSort('avgGradeDelta')}>Delta</Th>
              </tr>
            </thead>
            <tbody>
              {sortedPerClass.map(c => (
                <tr key={c.className} className="border-b border-slate-100 hover:bg-sky-50/40">
                  <td className="py-2 px-3 font-medium text-slate-900">{c.className}</td>
                  <Td className="bg-slate-50 border-l border-slate-200">{fmt(c.avgAbsence, 1)}%</Td>
                  <Td center className="border-l border-slate-200">{c.ivCount || '—'}</Td>
                  <Td center>{c.grade1Count || '—'}</Td>
                  <Td center>{c.grade2Count || '—'}</Td>
                  <Td center className="bg-slate-50 border-l border-slate-200">{c.totalWarnings || '—'} ({c.fWarnings || 0}+{c.gWarnings || 0})</Td>
                  <Td center warn={c.missingWarnings > 0} className="bg-amber-50 border-l border-slate-200">{c.missingWarnings || '—'}</Td>
                  <Td className="border-l border-slate-200">{fmt(c.avgGrunnskolepoeng)}</Td>
                  <Td>{fmt(c.avgGrade)}</Td>
                  <Td
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
                <Td className="bg-slate-100 border-l border-slate-200">{fmt(stats.overall.avgAbsence, 1)}%</Td>
                <Td center className="bg-slate-50 border-l border-slate-200">{stats.overall.ivCount || '—'}</Td>
                <Td center className="bg-slate-50">{stats.overall.grade1Count || '—'}</Td>
                <Td center className="bg-slate-50">{stats.overall.grade2Count || '—'}</Td>
                <Td center className="bg-slate-100 border-l border-slate-200">{stats.overall.totalWarnings || '—'} ({stats.overall.fWarnings || 0}+{stats.overall.gWarnings || 0})</Td>
                <Td center warn={stats.overall.missingWarnings > 0} className="bg-amber-100 border-l border-slate-200">{stats.overall.missingWarnings || '—'}</Td>
                <Td className="bg-slate-50 border-l border-slate-200">{fmt(stats.overall.avgGrunnskolepoeng)}</Td>
                <Td className="bg-slate-50">{fmt(stats.overall.avgGrade)}</Td>
                <Td
                  className={
                    gradeDelta(stats.overall.avgGrade, stats.overall.avgGrunnskolepoeng) === null
                      ? 'bg-slate-50'
                      : gradeDelta(stats.overall.avgGrade, stats.overall.avgGrunnskolepoeng)! < 0
                        ? 'bg-red-50 text-slate-800'
                        : gradeDelta(stats.overall.avgGrade, stats.overall.avgGrunnskolepoeng)! > 0
                          ? 'bg-emerald-50 text-slate-800'
                          : 'bg-slate-50'
                  }
                >
                  {gradeDelta(stats.overall.avgGrade, stats.overall.avgGrunnskolepoeng) === null
                    ? '—'
                    : fmt(gradeDelta(stats.overall.avgGrade, stats.overall.avgGrunnskolepoeng), 2)}
                </Td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
