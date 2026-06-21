import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { DataStore } from '../types'
import { normalizeSubjectGroupKey } from '../studentInfoUtils'
import { fagkodeLookup } from '../fagkodeLookup'

interface EksamenViewProps {
  data: DataStore
}

interface EksamenRow {
  navn: string
  klasse?: string
  subjectGroup: string
  subject: string
  grade: string
  standpunkt: string
  imDoc?: 'dok' | 'udok' | null
}

type SortKey = 'navn' | 'klasse' | 'subject' | 'standpunkt' | 'grade'
type SortDir = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'navn', label: 'Elev' },
  { key: 'klasse', label: 'Klasse' },
  { key: 'subject', label: 'Fag' },
  { key: 'standpunkt', label: 'Standpunkt' },
  { key: 'grade', label: 'Eksamen / T2' },
]

// Worst-to-best ordering so failing grades sort first in ascending order.
const GRADE_ORDER = ['IM', 'IV', '1', '2', '3', '4', '5', '6']
const gradeRank = (g: string): number => {
  const i = GRADE_ORDER.indexOf((g || '').toUpperCase())
  return i === -1 ? GRADE_ORDER.length : i
}

const compareByColumn = (key: SortKey, a: string, b: string): number => {
  if (key === 'grade' || key === 'standpunkt') return gradeRank(a) - gradeRank(b)
  return a.localeCompare(b, 'nb')
}

// Compare exam grade vs. standpunkt. Returns the direction of change, or null
// when a comparison isn't possible (missing/unknown standpunkt or exam grade).
type GradeChange = 'up' | 'down' | 'same'
const gradeChange = (r: EksamenRow): GradeChange | null => {
  const s = GRADE_ORDER.indexOf((r.standpunkt || '').toUpperCase())
  const e = GRADE_ORDER.indexOf((r.grade || '').toUpperCase())
  if (s === -1 || e === -1) return null
  if (e > s) return 'up'
  if (e < s) return 'down'
  return 'same'
}

// Display value for the exam grade, e.g. "IM (udok)".
const formatExamGrade = (r: EksamenRow): string =>
  r.grade === 'IM' && r.imDoc ? `IM (${r.imDoc})` : r.grade

// Derive the trinn (VG1/VG2/VG3) from the leading digit of a class name, e.g. "2STB" -> '2'.
const classLevel = (klasse?: string): '1' | '2' | '3' | null => {
  const m = (klasse ?? '').trim().match(/^(\d)/)
  return m && (m[1] === '1' || m[1] === '2' || m[1] === '3') ? (m[1] as '1' | '2' | '3') : null
}

const normalizeHeader = (h: string) =>
  h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '')

const getRowValue = (row: Record<string, any>, aliases: string[]) => {
  const headers = Object.keys(row)
  const normalizedAliases = aliases.map(a => normalizeHeader(a))
  const header = headers.find(h => normalizedAliases.includes(normalizeHeader(h)))
  return header ? String(row[header] ?? '').trim() : ''
}

// Order-independent name key so "Ola Nordmann" and "Nordmann Ola" match.
const orderInvariantNameKey = (navn: string): string =>
  (navn ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join('')

const buildNameSubjectKey = (navn: string, subjectGroup: string): string =>
  `${orderInvariantNameKey(navn)}::${normalizeSubjectGroupKey(subjectGroup)}`

// Pull the bare fagkode out of a record's fagkode / faggruppe field.
const subjectCodeOf = (fagkode: string, subjectGroup: string): string => {
  const fk = (fagkode || '').toUpperCase().trim()
  if (fk) return fk
  return (subjectGroup || '').toUpperCase().split('/').pop()?.trim() ?? ''
}

const resolveSubjectName = (subject: string, fagkode: string, subjectGroup: string): string => {
  if (subject) return subject
  return fagkodeLookup[subjectCodeOf(fagkode, subjectGroup)] || subjectGroup
}

// Base subject key that ignores oral/written qualifiers so e.g. "Spansk II"
// (standpunkt) matches "Spansk II, muntlig" (oral exam, different fagkode).
const subjectNameKey = (name: string): string =>
  (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(muntlig|skriftlig|praktisk)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')

// Canonicalise a grade value. Handles decorated values such as
// "IM (dokumentert fravær)", "IV", "1 (klage)" -> "IM" / "IV" / "1".
const canonicalGrade = (raw: string): string => {
  const up = (raw ?? '').toString().toUpperCase().trim()
  if (!up) return ''
  if (/\bIM\b/.test(up) || up.startsWith('IM')) return 'IM'
  if (/\bIV\b/.test(up) || up.startsWith('IV')) return 'IV'
  const digit = up.match(/[1-6]/)
  return digit ? digit[0] : up
}

// For an IM grade, detect whether the absence is documented (dok) or not (udok).
// udok covers "udokumentert" as well as "ikke dokumentert fravær".
const detectImDoc = (raw: string): 'dok' | 'udok' | null => {
  const low = (raw ?? '').toString().toLowerCase()
  const compact = low.replace(/[^a-z]/g, '')
  if (low.includes('udok') || compact.includes('ikkedok')) return 'udok'
  if (compact.includes('dok')) return 'dok'
  return null
}

export default function EksamenView({ data }: EksamenViewProps) {
  const [rows, setRows] = useState<EksamenRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
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
    const copy = [...rows]
    copy.sort((a, b) => {
      const primary = compareByColumn(sortKey, String(a[sortKey] ?? ''), String(b[sortKey] ?? ''))
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
      ['Elev', 'Klasse', 'Fag', 'Standpunkt', 'Eksamen / T2'],
      ...visibleRows.map(r => [r.navn, r.klasse || 'NUS', r.subject || r.subjectGroup, r.standpunkt || '', formatExamGrade(r)]),
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
    const headers = ['#', 'Elev', 'Klasse', 'Fag', 'Standpunkt', 'Eksamen / T2']
    const widths = [24, 150, 60, 165, 70, 70]
    let y = marginTop

    const fillFor = (r: EksamenRow): [number, number, number] | null => {
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

    doc.save('eksamen.pdf')
  }

  const exportNavneliste = () => {
    if (visibleRows.length === 0) return
    const order: string[] = []
    const groups = new Map<string, EksamenRow[]>()
    visibleRows.forEach(r => {
      if (!groups.has(r.navn)) {
        groups.set(r.navn, [])
        order.push(r.navn)
      }
      groups.get(r.navn)!.push(r)
    })

    void import('docx').then(async ({ Document, Packer, Paragraph, TextRun }) => {
      const children: Paragraph[] = []
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

  // Standpunkt (1. termin) grade per student+subject, name-order independent.
  // Indexed both by fagkode and by base subject name, so an oral exam with a
  // different fagkode still resolves the matching standpunkt grade.
  const standpunktMap = useMemo(() => {
    const byCode = new Map<string, string>()
    const byName = new Map<string, string>()
    data.grades.forEach(g => {
      const assessment = (g.assessmentType ?? '').toString().toLowerCase()
      const halv = (g.halvår ?? '').toString().toLowerCase()
      const isStandpunkt = assessment.includes('standpunkt') || halv.includes('1') || assessment.includes('termin')
      if (!isStandpunkt) return
      const nameKey = orderInvariantNameKey(g.navn)
      if (!nameKey) return
      const grade = canonicalGrade(g.grade ?? '')
      const codeKey = buildNameSubjectKey(g.navn, g.subjectGroup || g.fagkode)
      if (codeKey && !byCode.has(codeKey)) byCode.set(codeKey, grade)
      const subName = fagkodeLookup[subjectCodeOf(g.fagkode, g.subjectGroup)] || ''
      const nKey = subjectNameKey(subName)
      if (nKey) {
        const k = `${nameKey}::${nKey}`
        if (!byName.has(k)) byName.set(k, grade)
      }
    })
    return { byCode, byName }
  }, [data.grades])

  const resolveStandpunkt = (navn: string, fagkode: string, subjectGroup: string, subjectName: string): string => {
    const byCode = standpunktMap.byCode.get(buildNameSubjectKey(navn, subjectGroup))
    if (byCode) return byCode
    const nKey = subjectNameKey(subjectName)
    if (!nKey) return ''
    return standpunktMap.byName.get(`${orderInvariantNameKey(navn)}::${nKey}`) ?? ''
  }

  // Resolve a student's class from absences/grades, by name (and subject when available).
  const classByNameSubject = useMemo(() => {
    const m = new Map<string, string>()
    const add = (navn: string, subjectGroup: string, className?: string) => {
      const cls = className?.trim()
      if (!cls) return
      const subjectKey = buildNameSubjectKey(navn, subjectGroup)
      if (!m.has(subjectKey)) m.set(subjectKey, cls)
      const nameKey = orderInvariantNameKey(navn)
      if (nameKey && !m.has(nameKey)) m.set(nameKey, cls)
    }
    data.absences.forEach(a => add(a.navn, a.subjectGroup, a.class))
    data.grades.forEach(g => add(g.navn, g.subjectGroup || g.fagkode, g.class))
    return m
  }, [data.absences, data.grades])

  const resolveClass = (navn: string, subjectGroup: string): string | undefined =>
    classByNameSubject.get(buildNameSubjectKey(navn, subjectGroup)) ??
    classByNameSubject.get(orderInvariantNameKey(navn))

  const handleFile = async (file: File | null) => {
    if (!file) return
    setError(null)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, any>[]

      const parsed: EksamenRow[] = []
      for (const r of sheet) {
        const fornavn = getRowValue(r, ['fornavn', 'first name', 'firstname'])
        const etternavn = getRowValue(r, ['etternavn', 'last name', 'lastname'])
        const navn =
          [fornavn, etternavn].filter(Boolean).join(' ').trim() ||
          getRowValue(r, ['navn', 'elev', 'student', 'navn_elev', 'elevnavn'])

        const klasse = getRowValue(r, ['klasse', 'class', 'klassegruppe'])
        const fagkode = getRowValue(r, ['fagkode', 'code'])
        const faggruppe = getRowValue(r, ['faggruppe', 'gruppe', 'subjectgroup'])
        const subjectGroup = faggruppe || fagkode
        const subject = getRowValue(r, ['fagnavn', 'fag', 'subject'])
        const grade = getRowValue(r, ['karakter', 'grade', 'resultat'])
        const halv = getRowValue(r, ['halvår', 'halvar', 'termin', 'term'])
        const assessmentType = getRowValue(r, ['vurderingstype', 'assessment type', 'type'])

        if (!navn || !subjectGroup || !grade) continue

        const gradeNorm = canonicalGrade(grade)
        const halvarNorm = halv.toString().trim().toLowerCase()
        const assessmentNorm = assessmentType.toString().trim().toLowerCase()

        const isExam =
          assessmentNorm.includes('eksam') || assessmentNorm.includes('pas') || halvarNorm.includes('2')

        // Only skip rows that explicitly belong to another term/assessment.
        // When the file has no term/assessment columns, treat every row as relevant.
        if (!isExam && !halvarNorm.includes('2') && (halvarNorm || assessmentNorm)) continue

        const subjectName = resolveSubjectName(subject, fagkode, subjectGroup)
        const resolvedClass = klasse || resolveClass(navn, subjectGroup)
        const standpunkt = resolveStandpunkt(navn, fagkode, subjectGroup, subjectName)

        parsed.push({
          navn,
          klasse: resolvedClass,
          subjectGroup,
          subject: subjectName,
          grade: gradeNorm,
          standpunkt,
          imDoc: gradeNorm === 'IM' ? detectImDoc(grade) : null,
        })
      }

      setFileName(file.name)
      setRows(parsed)
      if (parsed.length === 0) {
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

      {rows.length > 0 && (
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
                    <td className="py-2 pr-4">{r.subject || r.subjectGroup}</td>
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
