import { useState } from 'react'
import { Download } from 'lucide-react'
import type { DataStore } from '../types'
import { sanitizeCsvCell } from '../securityUtils'

interface ReportExportProps {
  data: DataStore
}

export default function ReportExport({ data }: ReportExportProps) {
  const [selectedClasses, setSelectedClasses] = useState<string[]>(
    Array.from(new Set(data.absences.map(a => a.class))).sort()
  )

  const normalizeMatch = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')

  const generateCSV = () => {
    const filteredAbsences = data.absences.filter(a =>
      selectedClasses.includes(a.class)
    )

    if (filteredAbsences.length === 0) {
      alert('No data to export')
      return
    }

    const headers = [
      'Namn',
      'Klasse',
      'Fag',
      'Faggruppe',
      'Fraværsprosent',
      'Timer fravæ',
      'Lærer',
      'Varseltype',
      'Sendt',
    ]

    const rows = filteredAbsences.map(absence => {
      const matchingWarnings = data.warnings.filter(
        w =>
          normalizeMatch(w.navn) === normalizeMatch(absence.navn) &&
          normalizeMatch(w.subjectGroup) ===
            normalizeMatch(absence.subjectGroup)
      )

      const warningTypes = matchingWarnings
        .map(w => w.warningType)
        .join('; ')
      const sentDates = matchingWarnings
        .map(w => w.sentDate)
        .join('; ')

      return [
        absence.navn,
        absence.class,
        absence.subject,
        absence.subjectGroup,
        absence.percentageAbsence.toFixed(1),
        absence.hoursAbsence.toFixed(0),
        absence.teacher,
        warningTypes || '-',
        sentDates || '-',
      ]
    })

    const csvContent = [
      headers.join(','),
      ...rows.map(row =>
        row
          .map(cell => sanitizeCsvCell(cell))
          .map(cell => `"${cell.replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute(
      'download',
      `oppfolging-report-${new Date().toISOString().split('T')[0]}.csv`
    )
    link.click()
  }

  const allClasses = Array.from(new Set(data.absences.map(a => a.class))).sort()

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Export Report</h2>

        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-900 mb-3">
            Select Classes to Export
          </label>
          <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-4">
            {allClasses.map(cls => (
              <label
                key={cls}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedClasses.includes(cls)}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedClasses([...selectedClasses, cls].sort())
                    } else {
                      setSelectedClasses(
                        selectedClasses.filter((c: string) => c !== cls)
                      )
                    }
                  }}
                  className="w-4 h-4 text-sky-600 rounded border-slate-300"
                />
                <span className="text-sm text-slate-700">{cls}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={generateCSV}
          className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Export as CSV
        </button>
      </div>

      {selectedClasses.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            Preview
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Student
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Class
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Subject
                  </th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-900">
                    Absence %
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Warning
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.absences
                  .filter(a => selectedClasses.includes(a.class))
                  .slice(0, 20)
                  .map((absence, idx) => {
                    const matched = data.warnings.find(
                      w =>
                        normalizeMatch(w.navn) ===
                          normalizeMatch(absence.navn) &&
                        normalizeMatch(w.subjectGroup) ===
                          normalizeMatch(absence.subjectGroup)
                    )
                    return (
                      <tr
                        key={idx}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="py-2 px-3 text-slate-900">
                          {absence.navn}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {absence.class}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {absence.subject}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-slate-900">
                          {absence.percentageAbsence.toFixed(1)}%
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {matched ? matched.warningType : '-'}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Showing first 20 rows. Full export includes all data.
          </p>
        </div>
      )}
    </div>
  )
}
