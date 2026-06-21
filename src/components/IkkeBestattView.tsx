import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { DataStore } from '../types'
import {
  type ParsedExamRow,
  parseExamFile,
  gradeRank,
  formatExamGrade,
  truncate,
  classLevel,
  orderInvariantNameKey,
} from '../examData'

interface IkkeBestattViewProps {
  data: DataStore
  rows: ParsedExamRow[] | null
  fileName: string | null
  onParsed: (rows: ParsedExamRow[], fileName: string) => void
}

const FAIL_GRADES = new Set(['1', 'IV', 'IM'])

type SortKey = 'navn' | 'klasse' | 'telefon' | 'subject' | 'standpunkt' | 'grade'
type SortDir = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'navn', label: 'Elev' },
  { key: 'klasse', label: 'Klasse' },
  { key: 'telefon', label: 'Telefon' },
  { key: 'subject', label: 'Fag' },
  { key: 'standpunkt', label: 'Standpunkt' },
  { key: 'grade', label: 'Eksamen / T2' },
]

const compareByColumn = (key: SortKey, a: string, b: string): number => {
  if (key === 'grade' || key === 'standpunkt') return gradeRank(a) - gradeRank(b)
  return a.localeCompare(b, 'nb')
}

// A student who failed standpunkt with a "1" but passed the exam/2. termin.
// IV/IM in standpunkt is NOT redeemed by a passing exam, so only "1" counts.
const isPassedAfter = (r: ParsedExamRow): boolean =>
  Boolean(r.standpunkt === '1' && r.grade && !FAIL_GRADES.has(r.grade))

// Students who failed (1/IV/IM) in exam/2. termin, or whose result changed vs. standpunkt.
const isIkkeBestatt = (p: ParsedExamRow): boolean => {
  // Failed standpunkt with no exam in the subject.
  if (p.noExam) return Boolean(p.standpunkt && FAIL_GRADES.has(p.standpunkt))
  if (FAIL_GRADES.has(p.grade)) return true
  if (p.standpunkt && FAIL_GRADES.has(p.standpunkt) && p.grade && !FAIL_GRADES.has(p.grade) && Number(p.grade) >= 2) return true
  if (p.standpunkt && !FAIL_GRADES.has(p.standpunkt) && p.grade && FAIL_GRADES.has(p.grade)) return true
  return false
}

export default function IkkeBestattView({ data, rows, fileName, onParsed }: IkkeBestattViewProps) {
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('navn')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [hideBestatt, setHideBestatt] = useState(false)
  const [showOnlyIM, setShowOnlyIM] = useState(false)
  const [hideImDok, setHideImDok] = useState(false)
  const [hideImUdok, setHideImUdok] = useState(false)
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

  // Only the students who didn't pass (or whose grade changed) are shown here.
  const failingRows = useMemo(() => (rows ?? []).filter(isIkkeBestatt), [rows])

  const sortedRows = useMemo(() => {
    const copy = [...failingRows]
    copy.sort((a, b) => {
      const primary = compareByColumn(sortKey, String(a[sortKey] ?? ''), String(b[sortKey] ?? ''))
      const directed = sortDir === 'asc' ? primary : -primary
      // Name is always at least the secondary sort key (ascending) when it isn't primary.
      if (directed !== 0 || sortKey === 'navn') return directed
      return String(a.navn).localeCompare(String(b.navn), 'nb')
    })
    return copy
  }, [failingRows, sortKey, sortDir])

  const visibleRows = useMemo(() => {
    let result = sortedRows
    if (hideBestatt) result = result.filter(r => !isPassedAfter(r))
    if (showOnlyIM) result = result.filter(r => r.grade === 'IM')
    if (hideImDok) result = result.filter(r => !(r.grade === 'IM' && r.imDoc === 'dok'))
    if (hideImUdok) result = result.filter(r => !(r.grade === 'IM' && r.imDoc === 'udok'))
    result = result.filter(r => {
      const lvl = classLevel(r.klasse)
      if (lvl === null) return showNus
      return showVg[lvl]
    })
    return result
  }, [sortedRows, hideBestatt, showOnlyIM, hideImDok, hideImUdok, showVg, showNus])

  // Total unique students per trinn across the whole school (from the roster).
  const totalStudentsByLevel = useMemo(() => {
    const seen: Record<'1' | '2' | '3', Set<string>> = { '1': new Set(), '2': new Set(), '3': new Set() }
    const add = (navn: string, klasse?: string) => {
      const lvl = classLevel(klasse)
      if (!lvl) return
      const key = `${orderInvariantNameKey(navn)}::${(klasse ?? '').toLowerCase().trim()}`
      seen[lvl].add(key)
    }
    data.studentInfo.forEach(s => add(s.navn, s.class))
    data.absences.forEach(a => add(a.navn, a.class))
    data.grades.forEach(g => add(g.navn, g.class))
    return { '1': seen['1'].size, '2': seen['2'].size, '3': seen['3'].size }
  }, [data.studentInfo, data.absences, data.grades])

  const selectedTrinnTotal = (['1', '2', '3'] as const).reduce(
    (sum, lvl) => sum + (showVg[lvl] ? totalStudentsByLevel[lvl] : 0),
    0,
  )
  const uniqueEleverCount = new Set(visibleRows.map(r => r.navn)).size
  const eleverPercent =
    selectedTrinnTotal > 0 ? ((uniqueEleverCount / selectedTrinnTotal) * 100).toFixed(1).replace('.', ',') : null

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
      ['Elev', 'Klasse', 'Telefon', 'Fag', 'Standpunkt', 'Eksamen / T2'],
      ...visibleRows.map(r => [r.navn, r.klasse || 'NUS', r.telefon || '', r.subject || r.subjectGroup, r.standpunkt || '', formatExamGrade(r)]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ikke bestått')
    XLSX.writeFile(wb, 'ikke-bestatt.xlsx')
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
    const headers = ['#', 'Elev', 'Klasse', 'Telefon', 'Fag', 'Standpunkt', 'Eksamen / T2']
    const widths = [24, 120, 55, 80, 120, 70, 70]
    let y = marginTop

    const fillFor = (r: ParsedExamRow): [number, number, number] | null => {
      if (r.standpunkt === 'IV') return [241, 245, 249]
      if (r.grade === 'IM' && r.imDoc === 'dok') return [224, 242, 254]
      if (isPassedAfter(r)) return [220, 252, 231]
      if (FAIL_GRADES.has(r.grade) || (r.noExam && FAIL_GRADES.has(r.standpunkt))) return [254, 226, 226]
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
    doc.text('Ikke bestått', marginX, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const pctText = eleverPercent !== null ? ` (${eleverPercent} % av ${selectedTrinnTotal} i valgte trinn)` : ''
    doc.text(`${uniqueEleverCount} unike elever${pctText}  ·  ${visibleRows.length} fag`, marginX, y)
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
        r.telefon || '',
        r.subject || r.subjectGroup,
        r.standpunkt || '-',
        formatExamGrade(r),
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

    doc.save('ikke-bestatt.pdf')
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
        children.push(
          new Paragraph({
            spacing: { before: index > 0 ? 200 : 0, after: 40 },
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

  // Standpunkt (1. termin) grade per student+subject, name-order independent.
  // Indexed both by fagkode and by base subject name, so an oral exam with a
  // different fagkode still resolves the matching standpunkt grade.
  const handleFile = async (file: File | null) => {
    if (!file) return
    setError(null)
    try {
      const parsed = await parseExamFile(file, data)
      onParsed(parsed, file.name)
      if (parsed.filter(isIkkeBestatt).length === 0) {
        setError('Ingen elever med ikke bestått ble funnet i filen.')
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
      <h3 className="text-lg font-semibold mb-2">Ikke bestått (eksamen/2. termin)</h3>
      <p className="text-sm text-slate-600 mb-4">
        Last opp eksamensregistreringer-filen (Fornavn, Etternavn, Fagkode, Fagnavn og Karakter trengs som minimum).
        Systemet kobler eleven via for- og etternavn og faget via fagkode/fagnavn, og viser elever med karakterene
        IM, IV eller 1.
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

      {failingRows.length > 0 && (
        <div className="overflow-x-auto">
          <div className="mb-3 text-sm text-slate-600">
            <span className="font-medium text-slate-700">{uniqueEleverCount}</span> unike elever
            {eleverPercent !== null && (
              <span className="text-slate-500"> ({eleverPercent} % av {selectedTrinnTotal} i valgte trinn)</span>
            )}
            {' · '}
            <span className="font-medium text-slate-700">{visibleRows.length}</span> fag
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={hideBestatt}
                onChange={e => setHideBestatt(e.currentTarget.checked)}
                className="rounded border-slate-300"
              />
              Skjul bestått
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyIM}
                onChange={e => setShowOnlyIM(e.currentTarget.checked)}
                className="rounded border-slate-300"
              />
              Vis kun IM
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={hideImDok}
                onChange={e => setHideImDok(e.currentTarget.checked)}
                className="rounded border-slate-300"
              />
              Skjul IM (dok)
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={hideImUdok}
                onChange={e => setHideImUdok(e.currentTarget.checked)}
                className="rounded border-slate-300"
              />
              Skjul IM (udok)
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
                const isFailed = FAIL_GRADES.has(r.grade) || (Boolean(r.noExam) && FAIL_GRADES.has(r.standpunkt))
                const isDokIM = r.grade === 'IM' && r.imDoc === 'dok'
                const passedAfter = isPassedAfter(r)
                const isIvStandpunkt = r.standpunkt === 'IV'
                const rowClass = isIvStandpunkt
                  ? 'bg-slate-100 border-l-4 border-slate-300'
                  : isDokIM
                    ? 'bg-sky-50 border-l-4 border-sky-300'
                    : passedAfter
                      ? 'bg-emerald-50 border-l-4 border-emerald-300'
                      : isFailed
                        ? 'bg-rose-50 border-l-4 border-rose-300'
                        : ''
                const isNewGroup = i === 0 || visibleRows[i - 1].navn !== r.navn
                const groupBorder = isNewGroup ? 'border-t-2 border-t-slate-300' : ''
                return (
                  <tr key={i} className={`${rowClass} ${groupBorder}`}>
                    <td className="py-2 pr-4 text-slate-400">{isNewGroup ? `${nameOrdinal.get(r.navn)}.` : ''}</td>
                    <td className="py-2 pr-4 font-medium">{r.navn}</td>
                    <td className="py-2 pr-4">{r.klasse || 'NUS'}</td>
                    <td className="py-2 pr-4">{r.telefon || '-'}</td>
                    <td className="py-2 pr-4">{truncate(r.subject || r.subjectGroup, 25)}</td>
                    <td className="py-2 pr-4">{r.standpunkt || '-'}</td>
                    <td className="py-2 pr-4">{formatExamGrade(r)}</td>
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
