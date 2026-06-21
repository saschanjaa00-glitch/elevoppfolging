import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { DataStore } from '../types'
import {
  type ParsedExamRow,
  parseExamFile,
  GRADE_ORDER,
  gradeRank,
  formatExamGrade,
  truncate,
  classLevel,
} from '../examData'

interface EksamenViewProps {
  data: DataStore
  rows: ParsedExamRow[] | null
  fileName: string | null
  onParsed: (rows: ParsedExamRow[], fileName: string) => void
}

type SortKey = 'navn' | 'klasse' | 'subject' | 'standpunkt' | 'grade' | 'endring'
type SortDir = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'navn', label: 'Elev' },
  { key: 'klasse', label: 'Klasse' },
  { key: 'subject', label: 'Fag' },
  { key: 'standpunkt', label: 'Standpunkt' },
  { key: 'grade', label: 'Eksamen / T2' },
  { key: 'endring', label: 'Endring' },
]

const compareByColumn = (key: SortKey, a: string, b: string): number => {
  if (key === 'grade' || key === 'standpunkt') return gradeRank(a) - gradeRank(b)
  return a.localeCompare(b, 'nb')
}

// Compare exam grade vs. standpunkt. Returns the direction of change, or null
// when a comparison isn't possible (missing/unknown standpunkt or exam grade).
type GradeChange = 'up' | 'down' | 'same'
const gradeChange = (r: ParsedExamRow): GradeChange | null => {
  const s = GRADE_ORDER.indexOf((r.standpunkt || '').toUpperCase())
  const e = GRADE_ORDER.indexOf((r.grade || '').toUpperCase())
  if (s === -1 || e === -1) return null
  if (e > s) return 'up'
  if (e < s) return 'down'
  return 'same'
}

// Signed change in grade steps between standpunkt and exam (e.g. 2 -> 4 = +2).
// IV/IM exam results have no numeric change, so they're left blank and excluded.
const gradeDelta = (r: ParsedExamRow): number | null => {
  const grade = (r.grade || '').toUpperCase()
  if (grade === 'IM' || grade === 'IV') return null
  const s = GRADE_ORDER.indexOf((r.standpunkt || '').toUpperCase())
  const e = GRADE_ORDER.indexOf(grade)
  if (s === -1 || e === -1) return null
  return e - s
}

const formatDelta = (d: number | null): string => (d === null ? '' : d > 0 ? `+${d}` : String(d))

export default function EksamenView({ data, rows, fileName, onParsed }: EksamenViewProps) {
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('navn')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showOpp, setShowOpp] = useState(true)
  const [showNed, setShowNed] = useState(true)
  const [showLikt, setShowLikt] = useState(true)
  const [showVg, setShowVg] = useState<{ '1': boolean; '2': boolean; '3': boolean }>({
    '1': true,
    '2': true,
    '3': true,
  })
  const [showNus, setShowNus] = useState(true)

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }


  const sortedRows = useMemo(() => {
    const copy = (rows ?? []).filter(r => !r.noExam)
    copy.sort((a, b) => {
      let primary: number
      if (sortKey === 'endring') {
        const da = gradeDelta(a)
        const db = gradeDelta(b)
        primary = (da ?? Number.NEGATIVE_INFINITY) - (db ?? Number.NEGATIVE_INFINITY)
      } else {
        primary = compareByColumn(sortKey, String((a as unknown as Record<string, unknown>)[sortKey] ?? ''), String((b as unknown as Record<string, unknown>)[sortKey] ?? ''))
      }
      const directed = sortDir === 'asc' ? primary : -primary
      // Name is always at least the secondary sort key (ascending) when it isn't primary.
      if (directed !== 0 || sortKey === 'navn') return directed
      return String(a.navn).localeCompare(String(b.navn), 'nb')
    })
    return copy
  }, [rows, sortKey, sortDir])

  const visibleRows = useMemo(() => {
    let result = sortedRows
    result = result.filter(r => {
      const change = gradeChange(r) ?? 'same'
      if (change === 'up') return showOpp
      if (change === 'down') return showNed
      return showLikt
    })
    result = result.filter(r => {
      const lvl = classLevel(r.klasse)
      if (lvl === null) return showNus
      return showVg[lvl]
    })
    return result
  }, [sortedRows, showOpp, showNed, showLikt, showVg, showNus])

  const uniqueEleverCount = new Set(visibleRows.map(r => r.navn)).size
  const totalGrades = (rows ?? []).filter(r => !r.noExam).length
  const gradePercent =
    totalGrades > 0 ? ((visibleRows.length / totalGrades) * 100).toFixed(1).replace('.', ',') : null
  const avgDelta = (() => {
    const deltas = visibleRows.map(gradeDelta).filter((d): d is number => d !== null)
    if (deltas.length === 0) return null
    return deltas.reduce((sum, d) => sum + d, 0) / deltas.length
  })()
  const avgDeltaText =
    avgDelta === null ? null : `${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(2).replace('.', ',')}`

  // 1-based number per unique name, by first appearance in the visible order.
  const nameOrdinal = useMemo(() => {
    const m = new Map<string, number>()
    visibleRows.forEach(r => {
      if (!m.has(r.navn)) m.set(r.navn, m.size + 1)
    })
    return m
  }, [visibleRows])

  const exportExcel = () => {
    if (visibleRows.length === 0) return
    const aoa = [
      ['Elev', 'Klasse', 'Fag', 'Standpunkt', 'Eksamen / T2', 'Endring'],
      ...visibleRows.map(r => [r.navn, r.klasse || 'NUS', r.subject || r.subjectGroup, r.standpunkt || '', formatExamGrade(r), formatDelta(gradeDelta(r))]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Eksamen')
    XLSX.writeFile(wb, 'eksamen.xlsx')
  }

  const exportPdf = async () => {
    if (visibleRows.length === 0) return
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const marginX = 28
    const marginTop = 36
    const marginBottom = 30
    const rowHeight = 20
    const headers = ['#', 'Elev', 'Klasse', 'Fag', 'Standpunkt', 'Eksamen / T2', 'Endring']
    const widths = [24, 140, 55, 140, 65, 65, 50]
    let y = marginTop

    const fillFor = (r: ParsedExamRow): [number, number, number] | null => {
      const change = gradeChange(r)
      if (change === 'up') return [220, 252, 231]
      if (change === 'down') return [254, 226, 226]
      return null
    }

    const drawTableHeader = () => {
      doc.setFillColor(226, 232, 240)
      doc.rect(marginX, y, pageWidth - marginX * 2, rowHeight, 'F')
      doc.setDrawColor(203, 213, 225)
      doc.setLineWidth(0.5)
      doc.rect(marginX, y, pageWidth - marginX * 2, rowHeight)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(15, 23, 42)
      let x = marginX
      headers.forEach((h, idx) => {
        if (idx > 0) doc.line(x, y, x, y + rowHeight)
        doc.text(h, x + 4, y + 13)
        x += widths[idx]
      })
      y += rowHeight
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(15, 23, 42)
    doc.text('Eksamen', marginX, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const pctText = gradePercent !== null ? ` (${gradePercent} %)` : ''
    const avgText = avgDeltaText !== null ? `  ·  snitt endring ${avgDeltaText}` : ''
    doc.text(`${visibleRows.length} av ${totalGrades} karakterer${pctText}  ·  ${uniqueEleverCount} unike elever${avgText}`, marginX, y)
    y += 14

    drawTableHeader()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)

    visibleRows.forEach((r, i) => {
      if (y + rowHeight > pageHeight - marginBottom) {
        doc.addPage()
        y = marginTop
        drawTableHeader()
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
      }

      const fill = fillFor(r)
      if (fill) {
        doc.setFillColor(fill[0], fill[1], fill[2])
        doc.rect(marginX, y, pageWidth - marginX * 2, rowHeight, 'F')
      }

      const isNewGroup = i === 0 || visibleRows[i - 1].navn !== r.navn
      if (isNewGroup) {
        doc.setDrawColor(148, 163, 184)
        doc.setLineWidth(1)
      } else {
        doc.setDrawColor(226, 232, 240)
        doc.setLineWidth(0.4)
      }
      doc.line(marginX, y, pageWidth - marginX, y)

      doc.setTextColor(15, 23, 42)
      const cells = [
        isNewGroup ? `${nameOrdinal.get(r.navn)}.` : '',
        r.navn,
        r.klasse || 'NUS',
        r.subject || r.subjectGroup,
        r.standpunkt || '-',
        formatExamGrade(r),
        formatDelta(gradeDelta(r)),
      ]
      let x = marginX
      cells.forEach((c, idx) => {
        const text = (doc.splitTextToSize(String(c), widths[idx] - 6)[0] as string) ?? ''
        doc.text(text, x + 4, y + 13)
        x += widths[idx]
      })
      y += rowHeight
    })

    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.5)
    doc.line(marginX, y, pageWidth - marginX, y)

    doc.save('eksamen.pdf')
  }

  const exportNavneliste = () => {
    if (visibleRows.length === 0) return
    const order: string[] = []
    const groups = new Map<string, ParsedExamRow[]>()
    visibleRows.forEach(r => {
      if (!groups.has(r.navn)) {
        groups.set(r.navn, [])
        order.push(r.navn)
      }
      groups.get(r.navn)!.push(r)
    })

    void import('docx').then(async ({ Document, Packer, Paragraph, TextRun }) => {
      const children: InstanceType<typeof Paragraph>[] = []
      order.forEach((navn, index) => {
        if (index > 0) children.push(new Paragraph({ children: [] }))
        children.push(
          new Paragraph({
            children: [new TextRun({ text: navn, bold: true })],
          }),
        )
        groups.get(navn)!.forEach(r => {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `${r.subject || r.subjectGroup} (${formatExamGrade(r)})` })],
            }),
          )
        })
      })

      const doc = new Document({
        styles: { default: { document: { run: { font: 'Calibri' } } } },
        sections: [{ children }],
      })

      const blob = await Packer.toBlob(doc)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'navneliste.docx'
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  const handleFile = async (file: File | null) => {
    if (!file) return
    setError(null)
    try {
      const parsed = await parseExamFile(file, data)
      onParsed(parsed, file.name)
      if (parsed.filter(r => !r.noExam).length === 0) {
        setError('Ingen eksamenskarakterer ble funnet i filen.')
      }
    } catch {
      setError('Feil ved lesing av fil')
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0] ?? null
    void handleFile(file)
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold mb-2">Eksamen</h3>
      <p className="text-sm text-slate-600 mb-4">
        Last opp eksamensregistreringer-filen (Fornavn, Etternavn, Fagkode, Fagnavn og Karakter trengs som minimum).
        Systemet kobler eleven via for- og etternavn og faget via fagkode/fagnavn, og viser alle eksamenskarakterer
        sammenlignet med standpunkt.
      </p>

      <div
        onDragOver={e => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={e => {
          e.preventDefault()
          setIsDragging(false)
        }}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 mb-4 text-center transition-colors ${
          isDragging ? 'border-sky-400 bg-sky-50' : 'border-slate-200'
        }`}
      >
        <p className="text-sm text-slate-600 mb-3">Dra og slipp filen her, eller velg en fil nedenfor.</p>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={e => {
            void handleFile(e.currentTarget.files?.[0] ?? null)
            e.currentTarget.value = ''
          }}
        />
        {fileName && <p className="text-xs text-slate-500 mt-3">Lest inn: {fileName}</p>}
      </div>

      {error && (
        <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4 text-sm">{error}</div>
      )}

      {totalGrades > 0 && (
        <div className="overflow-x-auto">
          <div className="mb-3 text-sm text-slate-600">
            <span className="font-medium text-slate-700">{visibleRows.length}</span> av{' '}
            <span className="font-medium text-slate-700">{totalGrades}</span> karakterer
            {gradePercent !== null && <span className="text-slate-500"> ({gradePercent} %)</span>}
            {' · '}
            <span className="font-medium text-slate-700">{uniqueEleverCount}</span> unike elever
            {avgDeltaText !== null && (
              <span className="text-slate-500"> · snitt endring <span className="font-medium text-slate-700">{avgDeltaText}</span></span>
            )}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showOpp}
                onChange={e => setShowOpp(e.currentTarget.checked)}
                className="rounded border-slate-300"
              />
              Opp
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showNed}
                onChange={e => setShowNed(e.currentTarget.checked)}
                className="rounded border-slate-300"
              />
              Ned
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showLikt}
                onChange={e => setShowLikt(e.currentTarget.checked)}
                className="rounded border-slate-300"
              />
              Likt
            </label>
            <div className="inline-flex items-center gap-3 text-sm text-slate-600">
              <span className="text-slate-500">Trinn:</span>
              {(['1', '2', '3'] as const).map(lvl => (
                <label key={lvl} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showVg[lvl]}
                    onChange={e => {
                      const checked = e.currentTarget.checked
                      setShowVg(prev => ({ ...prev, [lvl]: checked }))
                    }}
                    className="rounded border-slate-300"
                  />
                  VG{lvl}
                </label>
              ))}
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showNus}
                  onChange={e => setShowNus(e.currentTarget.checked)}
                  className="rounded border-slate-300"
                />
                NUS
              </label>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportExcel}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-sky-600 text-white hover:bg-sky-700"
              >
                Eksporter til Excel
              </button>
              <button
                type="button"
                onClick={() => void exportPdf()}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Eksporter PDF
              </button>
              <button
                type="button"
                onClick={exportNavneliste}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Eksporter navneliste
              </button>
            </div>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 pr-4 w-10">#</th>
                {COLUMNS.map(col => {
                  const active = sortKey === col.key
                  return (
                    <th key={col.key} className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={`inline-flex items-center gap-1 font-medium hover:text-slate-700 ${
                          active ? 'text-slate-700' : ''
                        }`}
                      >
                        {col.label}
                        <span className="text-[10px]">{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => {
                const change = gradeChange(r)
                const rowClass =
                  change === 'up'
                    ? 'bg-emerald-50 border-l-4 border-emerald-300'
                    : change === 'down'
                      ? 'bg-rose-50 border-l-4 border-rose-300'
                      : ''
                const isNewGroup = i === 0 || visibleRows[i - 1].navn !== r.navn
                const groupBorder = isNewGroup ? 'border-t-2 border-t-slate-300' : ''
                return (
                  <tr key={i} className={`${rowClass} ${groupBorder}`}>
                    <td className="py-2 pr-4 text-slate-400">{isNewGroup ? `${nameOrdinal.get(r.navn)}.` : ''}</td>
                    <td className="py-2 pr-4 font-medium">{r.navn}</td>
                    <td className="py-2 pr-4">{r.klasse || 'NUS'}</td>
                    <td className="py-2 pr-4">{truncate(r.subject || r.subjectGroup, 25)}</td>
                    <td className="py-2 pr-4">{r.standpunkt || '-'}</td>
                    <td className="py-2 pr-4">{formatExamGrade(r)}</td>
                    <td className="py-2 pr-4 font-medium">{formatDelta(gradeDelta(r))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
