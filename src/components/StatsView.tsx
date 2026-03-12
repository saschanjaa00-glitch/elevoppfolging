import { useMemo } from 'react'
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

function fmt(n: number | null, decimals = 2): string {
  return n === null ? '—' : n.toFixed(decimals).replace('.', ',')
}

function StatCard({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <div className={`text-2xl font-bold ${highlight ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

function Th({ children, center, right, className = '' }: { children: ReactNode; center?: boolean; right?: boolean; className?: string }) {
  const align = center ? 'text-center' : right ? 'text-right' : 'text-left'
  return (
    <th className={`py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${align} ${className}`}>
      {children}
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

export default function StatsView({ data }: Props) {
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

  return (
    <div className="space-y-6">
      {/* Section 1: Overall summary cards */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Totaloversikt</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <StatCard
            label="Elever"
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
          <StatCard label="Gj.snitt fravær" value={`${fmt(stats.overall.avgAbsence, 1)}%`} />
          <StatCard
            label="IV"
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
          />
          <StatCard label="Varsler totalt" value={String(stats.overall.totalWarnings)} />
          <StatCard label="Fraværsvarsler (F)" value={String(stats.overall.fWarnings)} />
          <StatCard label="Karaktervarsler (G)" value={String(stats.overall.gWarnings)} />
          <StatCard
            label="Manglende varsler (>8%)"
            value={String(stats.overall.missingWarnings)}
            highlight
          />
        </div>
      </div>

      {/* Section 2: Per-class table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Per klasse</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="border-b-2 border-slate-200">
                {/* Group: identity */}
                <Th>Klasse</Th>
                {/* Group: attendance – shaded */}
                <Th right className="bg-slate-50 border-l border-slate-200">Gj.snitt fravær</Th>
                {/* Group: grades */}
                <Th center className="border-l border-slate-200">IV</Th>
                <Th center>1</Th>
                <Th center>2</Th>
                {/* Group: warnings – shaded */}
                <Th center className="bg-slate-50 border-l border-slate-200">Varsler (F+G)</Th>
                {/* Group: missing – amber */}
                <Th center className="bg-amber-50 border-l border-slate-200">Manglende varsler</Th>
                {/* Group: averages */}
                <Th right className="border-l border-slate-200">GSK.P</Th>
                <Th right>Snitt vgs</Th>
              </tr>
            </thead>
            <tbody>
              {stats.perClass.map(c => (
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
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
