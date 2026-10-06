import { useMemo, useState, Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DataStore } from '../types'
import { normalizeMatch } from '../studentInfoUtils'
import { resolveTeacher } from '../teacherUtils'
import { meetsThreshold } from '../thresholdUtils'

interface Props {
  data: DataStore
  groupBy: 'fag' | 'laerer'
  threshold?: number
}

type SortKey = 'name' | 'students' | 'avg' | 'median' | 'max' | 'avgHours' | 'over'
type SortDirection = 'asc' | 'desc'

interface Stats {
  studentCount: number
  avg: number
  median: number
  max: number
  maxStudent: string
  avgHours: number
  overCount: number
}

interface ChildRow extends Stats {
  key: string
  subjectGroup: string
  secondary: string
}

interface Row extends Stats {
  key: string
  name: string
  children: ChildRow[]
}

interface Accumulator {
  students: Set<string>
  percentages: number[]
  hoursList: number[]
  overStudents: Set<string>
  maxPct: number
  maxStudent: string
}

const newAccumulator = (): Accumulator => ({
  students: new Set(),
  percentages: [],
  hoursList: [],
  overStudents: new Set(),
  maxPct: -1,
  maxStudent: '',
})

const medianOf = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const toStats = (acc: Accumulator): Stats => {
  const sum = acc.percentages.reduce((total, value) => total + value, 0)
  const hoursSum = acc.hoursList.reduce((total, value) => total + value, 0)
  return {
    studentCount: acc.students.size,
    avg: acc.percentages.length ? sum / acc.percentages.length : 0,
    median: medianOf(acc.percentages),
    max: acc.maxPct >= 0 ? acc.maxPct : 0,
    maxStudent: acc.maxStudent,
    avgHours: acc.hoursList.length ? hoursSum / acc.hoursList.length : 0,
    overCount: acc.overStudents.size,
  }
}

const pct = (value: number): string => `${value.toFixed(1).replace('.', ',')}%`
const hours = (value: number): string => value.toFixed(1).replace('.', ',')

export default function FravaerOverview({ data, groupBy, threshold = 0 }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('avg')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const showOverColumn = threshold > 0

  const rows = useMemo<Row[]>(() => {
    const topMap = new Map<
      string,
      { name: string; acc: Accumulator; leaves: Map<string, { subjectGroup: string; secondary: string; acc: Accumulator }> }
    >()

    data.absences.forEach(record => {
      const teacher = resolveTeacher(record.subject ?? '', record.teacher ?? '').trim() || '—'
      const subject = record.subject?.trim() || '—'
      const name = groupBy === 'fag' ? subject : teacher
      const topKey = normalizeMatch(name)
      if (!topKey) return

      let top = topMap.get(topKey)
      if (!top) {
        top = { name, acc: newAccumulator(), leaves: new Map() }
        topMap.set(topKey, top)
      }

      const subjectGroup = record.subjectGroup?.trim() || subject
      const leafKey = normalizeMatch(`${subjectGroup}|${groupBy === 'fag' ? teacher : subject}`)
      let leaf = top.leaves.get(leafKey)
      if (!leaf) {
        leaf = { subjectGroup, secondary: groupBy === 'fag' ? teacher : subject, acc: newAccumulator() }
        top.leaves.set(leafKey, leaf)
      }

      const studentKey = `${record.class}::${normalizeMatch(record.navn)}`
      const over = meetsThreshold(record.percentageAbsence, threshold)
      ;[top.acc, leaf.acc].forEach(acc => {
        acc.students.add(studentKey)
        acc.percentages.push(record.percentageAbsence)
        acc.hoursList.push(record.hoursAbsence)
        if (over) acc.overStudents.add(studentKey)
        if (record.percentageAbsence > acc.maxPct) {
          acc.maxPct = record.percentageAbsence
          acc.maxStudent = record.navn
        }
      })
    })

    return Array.from(topMap.entries()).map(([key, top]) => ({
      key,
      name: top.name,
      ...toStats(top.acc),
      children: Array.from(top.leaves.entries())
        .map(([leafKey, leaf]) => ({
          key: leafKey,
          subjectGroup: leaf.subjectGroup,
          secondary: leaf.secondary,
          ...toStats(leaf.acc),
        }))
        .sort((a, b) => b.avg - a.avg),
    }))
  }, [data.absences, groupBy, threshold])

  const filteredAndSorted = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = query ? rows.filter(row => row.name.toLowerCase().includes(query)) : rows
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'nb-NO') * dir
      if (sortKey === 'over') return (a.overCount - b.overCount) * dir
      if (sortKey === 'students') return (a.studentCount - b.studentCount) * dir
      return (a[sortKey] - b[sortKey]) * dir
    })
  }, [rows, searchTerm, sortKey, sortDirection])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(direction => (direction === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(key === 'name' ? 'asc' : 'desc')
    }
  }

  const indicator = (key: SortKey): string =>
    sortKey === key ? (sortDirection === 'asc' ? '▲' : '▼') : ''

  const SortTh = ({ label, sk }: { label: string; sk: SortKey }) => (
    <th className="sticky top-0 z-10 bg-white py-3 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      <button type="button" onClick={() => toggleSort(sk)} className="inline-flex items-center gap-1 hover:text-slate-700">
        <span>{label}</span>
        <span className="min-w-2 text-[10px] leading-none text-slate-400">{indicator(sk)}</span>
      </button>
    </th>
  )

  const nameHeader = groupBy === 'fag' ? 'Fag' : 'Lærer'
  const columnCount = showOverColumn ? 7 : 6

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">Fravær per {groupBy === 'fag' ? 'fag' : 'lærer'}</h2>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder={`Søk etter ${groupBy === 'fag' ? 'fag' : 'lærer'}...`}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-slate-50 placeholder-slate-400"
        />
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[70vh]">
        <table className="w-full table-auto text-sm border-separate border-spacing-0">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="sticky top-0 z-10 bg-white py-3 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[180px]">
                <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-slate-700">
                  <span>{nameHeader}</span>
                  <span className="min-w-2 text-[10px] leading-none text-slate-400">{indicator('name')}</span>
                </button>
              </th>
              <SortTh label="Elever" sk="students" />
              <SortTh label="Snitt %" sk="avg" />
              <SortTh label="Median %" sk="median" />
              <SortTh label="Høyeste %" sk="max" />
              <SortTh label="Snitt timer" sk="avgHours" />
              {showOverColumn && <SortTh label={`Over ${threshold.toFixed(1).replace('.', ',')}%`} sk="over" />}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map(row => {
              const isExpanded = expandedKey === row.key
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => setExpandedKey(isExpanded ? null : row.key)}
                    className="border-b border-slate-100 hover:bg-sky-50/40 cursor-pointer"
                  >
                    <td className="py-2 px-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 flex-shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 flex-shrink-0 text-slate-400" />
                        )}
                        <span>{row.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">{row.studentCount}</td>
                    <td
                      className={`py-2 px-3 text-center font-medium ${
                        row.avg > 15 ? 'text-red-700' : row.avg > 10 ? 'text-amber-700' : 'text-slate-700'
                      }`}
                    >
                      {pct(row.avg)}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">{pct(row.median)}</td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      <span title={row.maxStudent || undefined} className="cursor-help">{pct(row.max)}</span>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">{hours(row.avgHours)}</td>
                    {showOverColumn && (
                      <td className="py-2 px-3 text-center text-amber-700 font-medium">{row.overCount > 0 ? row.overCount : '—'}</td>
                    )}
                  </tr>
                  {isExpanded &&
                    row.children.map(child => (
                      <tr key={child.key} className="bg-slate-50/70 border-b border-slate-100">
                        <td className="py-2 pl-9 pr-3 text-slate-700">
                          <div className="leading-tight">
                            <div className="font-medium text-slate-800">{child.subjectGroup}</div>
                            {child.secondary ? <div className="text-xs text-slate-500">{child.secondary}</div> : null}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600">{child.studentCount}</td>
                        <td
                          className={`py-2 px-3 text-center ${
                            child.avg > 15 ? 'text-red-700' : child.avg > 10 ? 'text-amber-700' : 'text-slate-600'
                          }`}
                        >
                          {pct(child.avg)}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600">{pct(child.median)}</td>
                        <td className="py-2 px-3 text-center text-slate-600">
                          <span title={child.maxStudent || undefined} className="cursor-help">{pct(child.max)}</span>
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600">{hours(child.avgHours)}</td>
                        {showOverColumn && (
                          <td className="py-2 px-3 text-center text-amber-700">{child.overCount > 0 ? child.overCount : '—'}</td>
                        )}
                      </tr>
                    ))}
                </Fragment>
              )
            })}
          </tbody>
          {filteredAndSorted.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={columnCount} className="py-6 px-3 text-center text-slate-500">
                  Ingen {groupBy === 'fag' ? 'fag' : 'lærere'} funnet
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      <div className="mt-4 text-xs text-slate-600">
        {filteredAndSorted.length} {groupBy === 'fag' ? 'fag' : 'lærere'} av {rows.length} totalt
      </div>
    </div>
  )
}
