import { useMemo, useState } from 'react'
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

interface Row {
  key: string
  name: string
  studentCount: number
  avg: number
  median: number
  max: number
  avgHours: number
  overCount: number
}

const medianOf = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const pct = (value: number): string => `${value.toFixed(1).replace('.', ',')}%`
const hours = (value: number): string => value.toFixed(1).replace('.', ',')

export default function FravaerOverview({ data, groupBy, threshold = 0 }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('avg')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const showOverColumn = threshold > 0

  const rows = useMemo<Row[]>(() => {
    const map = new Map<
      string,
      { name: string; students: Set<string>; percentages: number[]; hoursList: number[]; overStudents: Set<string> }
    >()

    data.absences.forEach(record => {
      const name =
        groupBy === 'fag'
          ? record.subject?.trim() || '—'
          : resolveTeacher(record.subject ?? '', record.teacher ?? '').trim() || '—'
      const key = normalizeMatch(name)
      if (!key) return

      let entry = map.get(key)
      if (!entry) {
        entry = { name, students: new Set(), percentages: [], hoursList: [], overStudents: new Set() }
        map.set(key, entry)
      }
      const studentKey = `${record.class}::${normalizeMatch(record.navn)}`
      entry.students.add(studentKey)
      entry.percentages.push(record.percentageAbsence)
      entry.hoursList.push(record.hoursAbsence)
      if (meetsThreshold(record.percentageAbsence, threshold)) entry.overStudents.add(studentKey)
    })

    return Array.from(map.values()).map(entry => {
      const sum = entry.percentages.reduce((acc, value) => acc + value, 0)
      const hoursSum = entry.hoursList.reduce((acc, value) => acc + value, 0)
      return {
        key: normalizeMatch(entry.name),
        name: entry.name,
        studentCount: entry.students.size,
        avg: entry.percentages.length ? sum / entry.percentages.length : 0,
        median: medianOf(entry.percentages),
        max: entry.percentages.length ? Math.max(...entry.percentages) : 0,
        avgHours: entry.hoursList.length ? hoursSum / entry.hoursList.length : 0,
        overCount: entry.overStudents.size,
      }
    })
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

  const SortTh = ({ label, sk, align = 'center' }: { label: string; sk: SortKey; align?: 'left' | 'center' }) => (
    <th
      className={`sticky top-0 z-10 bg-white py-3 px-3 text-${align} text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap`}
    >
      <button type="button" onClick={() => toggleSort(sk)} className="inline-flex items-center gap-1 hover:text-slate-700">
        <span>{label}</span>
        <span className="min-w-2 text-[10px] leading-none text-slate-400">{indicator(sk)}</span>
      </button>
    </th>
  )

  const nameHeader = groupBy === 'fag' ? 'Fag' : 'Lærer'

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
              <th className="sticky top-0 z-10 bg-white py-3 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[160px]">
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
            {filteredAndSorted.map(row => (
              <tr key={row.key} className="border-b border-slate-100 hover:bg-sky-50/40">
                <td className="py-2 px-3 font-medium text-slate-900">{row.name}</td>
                <td className="py-2 px-3 text-center text-slate-700">{row.studentCount}</td>
                <td
                  className={`py-2 px-3 text-center font-medium ${
                    row.avg > 15 ? 'text-red-700' : row.avg > 10 ? 'text-amber-700' : 'text-slate-700'
                  }`}
                >
                  {pct(row.avg)}
                </td>
                <td className="py-2 px-3 text-center text-slate-700">{pct(row.median)}</td>
                <td className="py-2 px-3 text-center text-slate-700">{pct(row.max)}</td>
                <td className="py-2 px-3 text-center text-slate-700">{hours(row.avgHours)}</td>
                {showOverColumn && (
                  <td className="py-2 px-3 text-center text-amber-700 font-medium">{row.overCount > 0 ? row.overCount : '—'}</td>
                )}
              </tr>
            ))}
          </tbody>
          {filteredAndSorted.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={showOverColumn ? 7 : 6} className="py-6 px-3 text-center text-slate-500">
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
