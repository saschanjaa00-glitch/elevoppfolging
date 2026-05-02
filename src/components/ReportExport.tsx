import { useState } from 'react'
import { Download } from 'lucide-react'
import type { DataStore } from '../types'
import { sanitizeCsvCell } from '../securityUtils'
import { formatDateDdMmYyyy, todayDdMmYyyy } from '../dateUtils'
import { buildStudentSubjectKey } from '../studentInfoUtils'

interface ReportExportProps {
  data: DataStore
}

export default function ReportExport({ data }: ReportExportProps) {
  const [selectedClasses, setSelectedClasses] = useState<string[]>(
    Array.from(new Set(data.absences.map(a => a.class))).sort()
  )

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
          buildStudentSubjectKey(w.navn, w.class, w.subjectGroup) ===
            buildStudentSubjectKey(absence.navn, absence.class, absence.subjectGroup)
      )

      const warningTypes = matchingWarnings
        .map(w => w.warningType)
        .join('; ')
      const sentDates = matchingWarnings
        .map(w => formatDateDdMmYyyy(w.sentDate))
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
      `oppfolging-report-${todayDdMmYyyy()}.csv`
    )
    link.click()
  }

  const allClasses = Array.from(new Set(data.absences.map(a => a.class))).sort()

  return (
    <div className="space-y-5">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-5">Eksporter rapport</h2>

        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Velg klasser å eksportere
          </label>
          <div className="space-y-1.5 max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50">
            {allClasses.map(cls => (
              <label
                key={cls}
                className="flex items-center gap-2.5 cursor-pointer px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
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
                <span className="text-sm font-medium text-slate-700">{cls}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={generateCSV}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
        >
          <Download className="w-4 h-4" />
          Eksporter som CSV
        </button>
      </div>

      {selectedClasses.length > 0 && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wide text-slate-500">
            Forhåndsvisning
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Elev
                  </th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Klasse
                  </th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Fag
                  </th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Fravær %
                  </th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Varsel
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.absences
                  .filter(a => selectedClasses.includes(a.class))
                  .slice(0, 20)
                  .map((absence, idx) => {
                    const matched = data.warnings.find(
                      w =>
                        buildStudentSubjectKey(w.navn, w.class, w.subjectGroup) ===
                          buildStudentSubjectKey(absence.navn, absence.class, absence.subjectGroup)
                    )
                    return (
                      <tr
                        key={idx}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {absence.navn}
                        </td>
                        <td className="py-2 px-3 text-slate-500">
                          {absence.class}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {absence.subject}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-slate-900">
                          {absence.percentageAbsence.toFixed(1)}%
                        </td>
                        <td className="py-2 px-3 text-slate-500">
                          {matched ? matched.warningType : '–'}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Viser de første 20 radene. Full eksport inkluderer alle data.
          </p>
        </div>
      )}
    </div>
  )
}
