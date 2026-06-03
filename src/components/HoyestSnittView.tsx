import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { DataStore, GradeRecord } from '../types'
import {
  buildStudentClassKey,
  createAbsenceSubjectClassLookup,
  normalizeMatch,
  resolveClassFromSubjectLookup,
} from '../studentInfoUtils'

interface Props {
  data: DataStore
}

interface StudentTopAverageRow {
  studentKey: string
  name: string
  className: string
  average: number
  grades: Array<{ subject: string; grade: string }>
}

interface UploadedListResult {
  fileName: string
  rows: StudentTopAverageRow[]
}

type SnittSubtab = 'top' | 'vg1' | 'vg2' | 'vg3'

const normalizeTerm = (value: string | undefined): 'T1' | 'T2' | null => {
  const normalized = (value ?? '').toString().trim().toLowerCase()
  if (!normalized) return null
  if (normalized === '1' || normalized.includes('1')) return 'T1'
  if (normalized === '2' || normalized.includes('2')) return 'T2'
  return null
}

const gradeToNumeric = (value: string): number | null => {
  const normalized = value.trim().toUpperCase().replace(',', '.')
  if (normalized === 'IV') return null
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 6) return null
  return numeric
}

const isVgClass = (className: string, vgYear: 1 | 2 | 3): boolean => {
  const normalized = className.trim().toUpperCase()
  if (!normalized) return false
  if (new RegExp(`^${vgYear}[A-Z0-9]`).test(normalized)) return true
  return new RegExp(`(^|\\W)VG\\s*${vgYear}(\\W|$)`).test(normalized)
}

const formatSubjectLabel = (grade: GradeRecord): string => {
  const subjectGroup = grade.subjectGroup?.trim()
  const code = grade.fagkode?.trim()
  if (subjectGroup && code && !subjectGroup.includes(code)) {
    return `${subjectGroup} (${code})`
  }
  return subjectGroup || code || 'Ukjent fag'
}

const normalizeHeader = (header: string): string =>
  header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')

const getRowValue = (row: Record<string, unknown>, aliases: string[]): string => {
  const headers = Object.keys(row)
  const normalizedAliases = aliases.map(alias => normalizeHeader(alias))
  const match = headers.find(header => normalizedAliases.includes(normalizeHeader(header)))
  const value = match ? row[match] : ''
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const isStandpunktAssessment = (value: string): boolean =>
  value.toLowerCase().includes('standpunkt')

const parseUploadedStandpunktRows = (
  rows: Record<string, unknown>[],
  expectedVg: 1 | 2
): StudentTopAverageRow[] => {
  const byStudent = new Map<string, { name: string; className: string; grades: Array<{ subject: string; grade: string }> }>()

  rows.forEach(row => {
    const assessmentType = getRowValue(row, ['assessment type', 'vurderingstype', 'type'])
    if (!isStandpunktAssessment(assessmentType)) return

    const name = getRowValue(row, ['elev', 'navn', 'student'])
    const classNameRaw = getRowValue(row, ['klasse', 'klassegruppe', 'class'])
    const className = classNameRaw || `VG${expectedVg}`
    const subjectGroup = getRowValue(row, ['gruppe', 'group', 'faggruppe'])
    const fagkode = getRowValue(row, ['fagkode'])
    const gradeValue = getRowValue(row, ['grade', 'karakter']).toUpperCase()

    if (!name || !gradeValue) return

    const subjectLabel = subjectGroup && fagkode && !subjectGroup.includes(fagkode)
      ? `${subjectGroup} (${fagkode})`
      : subjectGroup || fagkode || 'Ukjent fag'

    const studentKey = buildStudentClassKey(name, className)
    if (!byStudent.has(studentKey)) {
      byStudent.set(studentKey, {
        name,
        className,
        grades: [],
      })
    }

    byStudent.get(studentKey)!.grades.push({
      subject: subjectLabel,
      grade: gradeValue,
    })
  })

  const parsedRows: StudentTopAverageRow[] = []
  byStudent.forEach((student, studentKey) => {
    if (student.grades.length === 0) return
    if (student.grades.some(grade => grade.grade === 'IV' || grade.grade === '1')) return

    const numeric = student.grades
      .map(grade => gradeToNumeric(grade.grade))
      .filter((grade): grade is number => grade !== null)

    if (numeric.length === 0) return

    parsedRows.push({
      studentKey,
      name: student.name,
      className: student.className,
      average: numeric.reduce((sum, value) => sum + value, 0) / numeric.length,
      grades: student.grades.sort((a, b) => a.subject.localeCompare(b.subject, 'nb-NO')),
    })
  })

  return parsedRows.sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average
    const classCompare = a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
    if (classCompare !== 0) return classCompare
    return a.name.localeCompare(b.name, 'nb-NO')
  })
}

export default function HoyestSnittView({ data }: Props) {
  const [activeSubtab, setActiveSubtab] = useState<SnittSubtab>('top')
  const [visibleTopCount, setVisibleTopCount] = useState<number>(20)
  const [visibleUploadCombinedCount, setVisibleUploadCombinedCount] = useState<number>(20)
  const [uploadVg1, setUploadVg1] = useState<UploadedListResult | null>(null)
  const [uploadVg2, setUploadVg2] = useState<UploadedListResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const absenceSubjectClassLookup = useMemo(
    () => createAbsenceSubjectClassLookup(data.absences),
    [data.absences]
  )

  const allRows = useMemo<StudentTopAverageRow[]>(() => {
    const studentRows = new Map<string, { name: string; className: string; grades: Array<{ subject: string; grade: string }> }>()

    data.grades.forEach(grade => {
      if (normalizeTerm(grade.halvår) !== 'T2') return

      const resolvedClass = grade.class?.trim() || resolveClassFromSubjectLookup(absenceSubjectClassLookup, grade.navn, grade.subjectGroup)
      if (!resolvedClass) return

      const studentKey = buildStudentClassKey(grade.navn, resolvedClass)
      if (!studentRows.has(studentKey)) {
        studentRows.set(studentKey, {
          name: grade.navn,
          className: resolvedClass,
          grades: [],
        })
      }

      studentRows.get(studentKey)!.grades.push({
        subject: formatSubjectLabel(grade),
        grade: grade.grade.toUpperCase().trim(),
      })
    })

    const rows: StudentTopAverageRow[] = []

    studentRows.forEach((student, studentKey) => {
      if (student.grades.length === 0) return

      const numericGrades = student.grades
        .map(g => gradeToNumeric(g.grade))
        .filter((value): value is number => value !== null)

      if (numericGrades.length === 0) return

      const average = numericGrades.reduce((sum, grade) => sum + grade, 0) / numericGrades.length
      rows.push({
        studentKey,
        name: student.name,
        className: student.className,
        average,
        grades: student.grades.sort((a, b) => a.subject.localeCompare(b.subject, 'nb-NO')),
      })
    })

    return rows
      .sort((a, b) => {
        if (b.average !== a.average) return b.average - a.average
        const classCompare = a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
        if (classCompare !== 0) return classCompare
        return a.name.localeCompare(b.name, 'nb-NO')
      })
  }, [data.grades, absenceSubjectClassLookup])

  const topRows = useMemo(
    () => allRows.filter(row => isVgClass(row.className, 3) && !row.grades.some(g => g.grade === 'IV' || g.grade === '1')),
    [allRows]
  )

  const topStudentNameSet = useMemo(
    () => new Set(topRows.map(row => normalizeMatch(row.name))),
    [topRows]
  )

  const vg1Rows = useMemo(() => allRows.filter(row => isVgClass(row.className, 1)), [allRows])
  const vg2Rows = useMemo(() => allRows.filter(row => isVgClass(row.className, 2)), [allRows])
  const vg3Rows = useMemo(() => allRows.filter(row => isVgClass(row.className, 3)), [allRows])

  const visibleTopRows = useMemo(() => topRows.slice(0, visibleTopCount), [topRows, visibleTopCount])

  const activeRows = useMemo(() => {
    if (activeSubtab === 'top') return visibleTopRows
    if (activeSubtab === 'vg1') return vg1Rows
    if (activeSubtab === 'vg2') return vg2Rows
    return vg3Rows
  }, [activeSubtab, visibleTopRows, vg1Rows, vg2Rows, vg3Rows])

  const activeSubtabLabel =
    activeSubtab === 'top'
      ? 'Høyest snitt (VG3, T2)'
      : activeSubtab === 'vg1'
        ? 'Snittliste VG1 (T2)'
        : activeSubtab === 'vg2'
          ? 'Snittliste VG2 (T2)'
          : 'Snittliste VG3 (T2)'

  const activeSheetName =
    activeSubtab === 'top'
      ? 'Hoyest snitt VG3'
      : activeSubtab === 'vg1'
        ? 'Snittliste VG1'
        : activeSubtab === 'vg2'
          ? 'Snittliste VG2'
          : 'Snittliste VG3'

  const activeExportFile =
    activeSubtab === 'top'
      ? 'snitt_hoyest_vg3_t2.xlsx'
      : activeSubtab === 'vg1'
        ? 'snittliste_vg1_t2.xlsx'
        : activeSubtab === 'vg2'
          ? 'snittliste_vg2_t2.xlsx'
          : 'snittliste_vg3_t2.xlsx'

  const handleExportExcel = () => {
    if (activeRows.length === 0) return

    const exportRows = activeRows.map((row, index) => ({
      Rangering: index + 1,
      Elev: row.name,
      Klasse: row.className,
      'Snitt T2': Number(row.average.toFixed(2)),
      'Karakterer T2': row.grades.map(grade => `${grade.subject}: ${grade.grade}`).join(' | '),
    }))

    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    XLSX.utils.book_append_sheet(workbook, worksheet, activeSheetName)
    XLSX.writeFile(workbook, activeExportFile)
  }

  const handleExportUploaded = (rows: StudentTopAverageRow[], fileName: string, sheetName: string) => {
    if (rows.length === 0) return
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(toExportRows(rows))
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
    XLSX.writeFile(workbook, fileName)
  }

  const toExportRows = (rows: StudentTopAverageRow[]) =>
    rows.map((row, index) => ({
      Rangering: index + 1,
      Elev: row.name,
      Klasse: row.className,
      'Snitt T2': Number(row.average.toFixed(2)),
      'Karakterer T2': row.grades.map(grade => `${grade.subject}: ${grade.grade}`).join(' | '),
    }))

  const handleExportAllExcel = () => {
    const workbook = XLSX.utils.book_new()

    const sheets: Array<{ name: string; rows: StudentTopAverageRow[] }> = [
      { name: 'Hoyest snitt VG3', rows: topRows },
      { name: 'Snittliste VG1', rows: vg1Rows },
      { name: 'Snittliste VG2', rows: vg2Rows },
      { name: 'Snittliste VG3', rows: vg3Rows },
    ]

    if (uploadVg1?.rows.length) {
      sheets.push({ name: 'Upload VG1 Standpunkt', rows: uploadVg1.rows })
    }
    if (uploadVg2?.rows.length) {
      sheets.push({ name: 'Upload VG2 Standpunkt', rows: uploadVg2.rows })
    }
    if (uploadedCombinedRows.length) {
      sheets.push({ name: 'Upload VG1+VG2 Standpunkt', rows: uploadedCombinedRows })
    }

    let addedSheets = 0
    sheets.forEach(sheet => {
      if (sheet.rows.length === 0) return
      const worksheet = XLSX.utils.json_to_sheet(toExportRows(sheet.rows))
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
      addedSheets += 1
    })

    if (addedSheets === 0) return
    XLSX.writeFile(workbook, 'snittlister_t2_alle.xlsx')
  }

  const parseUploadedFile = async (file: File, expectedVg: 1 | 2): Promise<UploadedListResult> => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) return { fileName: file.name, rows: [] }
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]) as Record<string, unknown>[]
    const rows = parseUploadedStandpunktRows(rawRows, expectedVg)
    return {
      fileName: file.name,
      rows,
    }
  }

  const handleUploadChange = async (file: File | null, expectedVg: 1 | 2) => {
    if (!file) return
    setUploadError(null)
    try {
      const parsed = await parseUploadedFile(file, expectedVg)
      const cohortRows = parsed.rows.filter(row => topStudentNameSet.has(normalizeMatch(row.name)))
      if (expectedVg === 1) {
        setUploadVg1({ ...parsed, rows: cohortRows })
      } else {
        setUploadVg2({ ...parsed, rows: cohortRows })
      }
      setVisibleUploadCombinedCount(20)
    } catch {
      setUploadError('Kunne ikke lese filen. Sjekk formatet og prøv igjen.')
    }
  }

  const uploadedCombinedRows = useMemo<StudentTopAverageRow[]>(() => {
    const combined = new Map<string, StudentTopAverageRow>()

    const appendRows = (rows: StudentTopAverageRow[]) => {
      rows.forEach(row => {
        const key = normalizeMatch(row.name)
        const existing = combined.get(key)
        if (!existing) {
          combined.set(key, {
            studentKey: key,
            name: row.name,
            className: row.className,
            average: row.average,
            grades: [...row.grades],
          })
          return
        }

        const mergedGrades = [...existing.grades, ...row.grades]
        const numericGrades = mergedGrades
          .map(grade => gradeToNumeric(grade.grade))
          .filter((grade): grade is number => grade !== null)
        if (numericGrades.length === 0) return

        combined.set(key, {
          studentKey: key,
          name: existing.name,
          className: row.className || existing.className,
          average: numericGrades.reduce((sum, value) => sum + value, 0) / numericGrades.length,
          grades: mergedGrades.sort((a, b) => a.subject.localeCompare(b.subject, 'nb-NO')),
        })
      })
    }

    // Start from the original VG3 cohort list, then add uploaded VG1 and VG2 rows.
    appendRows(topRows)
    if (uploadVg1?.rows.length) appendRows(uploadVg1.rows)
    if (uploadVg2?.rows.length) appendRows(uploadVg2.rows)

    return Array.from(combined.values()).sort((a, b) => {
      if (b.average !== a.average) return b.average - a.average
      const classCompare = a.className.localeCompare(b.className, 'nb-NO', { numeric: true })
      if (classCompare !== 0) return classCompare
      return a.name.localeCompare(b.name, 'nb-NO')
    })
  }, [topRows, uploadVg1, uploadVg2])

  const visibleUploadedCombinedRows = useMemo(
    () => uploadedCombinedRows.slice(0, visibleUploadCombinedCount),
    [uploadedCombinedRows, visibleUploadCombinedCount]
  )

  const combinedMissingAllThreeKeys = useMemo(() => {
    const vg3Names = new Set(topRows.map(row => normalizeMatch(row.name)))
    const vg1Names = new Set((uploadVg1?.rows ?? []).map(row => normalizeMatch(row.name)))
    const vg2Names = new Set((uploadVg2?.rows ?? []).map(row => normalizeMatch(row.name)))

    const highlighted = new Set<string>()
    uploadedCombinedRows.forEach(row => {
      const key = normalizeMatch(row.name)
      const appearsInAllThree = vg3Names.has(key) && vg1Names.has(key) && vg2Names.has(key)
      if (!appearsInAllThree) highlighted.add(key)
    })
    return highlighted
  }, [topRows, uploadVg1, uploadVg2, uploadedCombinedRows])

  const renderTable = (rows: StudentTopAverageRow[], highlightedKeys?: Set<string>) => {
    const hasTopRoundedTie =
      rows.length > 1 && rows[0].average.toFixed(2) === rows[1].average.toFixed(2)
    const hasTopExactTie =
      hasTopRoundedTie && Math.abs(rows[0].average - rows[1].average) < 1e-9
    const isTopTieRow = (index: number): boolean => hasTopRoundedTie && (index === 0 || index === 1)

    const formatAverage = (average: number, index: number): string => {
      if (isTopTieRow(index) && !hasTopExactTie) {
        return average.toFixed(3).replace('.', ',')
      }
      return average.toFixed(2).replace('.', ',')
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">#</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Elev</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Klasse</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Snitt</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Karakterer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr
                key={row.studentKey}
                className={`${highlightedKeys?.has(normalizeMatch(row.name)) ? 'bg-amber-100/70' : 'hover:bg-slate-50'}`}
              >
                <td className="px-3 py-2 text-slate-700">{index + 1}</td>
                <td className="px-3 py-2 font-medium text-slate-900">{row.name}</td>
                <td className="px-3 py-2 text-slate-700">{row.className}</td>
                <td className="px-3 py-2 text-slate-900 font-semibold">
                  <div className="flex flex-col leading-tight">
                    <span>{formatAverage(row.average, index)}</span>
                    {isTopTieRow(index) && hasTopExactTie && (
                      <span className="text-xs text-slate-500">=</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-700">{row.grades.map(grade => `${grade.subject}: ${grade.grade}`).join(' | ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Snitt</h2>
        <p className="text-sm text-slate-600 mt-1">
          Lister basert på T2-karakterer. Velg visning under.
        </p>
        <div className="mt-3 inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm font-medium">
          {([
            { key: 'top', label: 'Høyest snitt' },
            { key: 'vg1', label: 'Snittliste VG1' },
            { key: 'vg2', label: 'Snittliste VG2' },
            { key: 'vg3', label: 'Snittliste VG3' },
          ] as Array<{ key: SnittSubtab; label: string }>).map(item => (
            <button
              key={item.key}
              onClick={() => {
                setActiveSubtab(item.key)
                if (item.key === 'top') setVisibleTopCount(20)
              }}
              className={`px-3 py-1.5 transition-colors ${
                activeSubtab === item.key
                  ? 'bg-sky-600 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <button
            onClick={handleExportExcel}
            disabled={activeRows.length === 0}
            className="px-3 py-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Eksporter til Excel
          </button>
          <button
            onClick={handleExportAllExcel}
            disabled={topRows.length + vg1Rows.length + vg2Rows.length + vg3Rows.length === 0}
            className="ml-2 px-3 py-1.5 text-sm font-medium text-sky-700 hover:text-sky-900 hover:bg-sky-50 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Eksporter alle lister (Excel)
          </button>
        </div>
      </div>

      {activeSubtab === 'top' && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Last opp tidligere lister (kun Standpunkt)</h3>
          <p className="text-xs text-slate-600 mt-1">Last opp én fil for VG1 og én fil for VG2. Kun karakterer med vurderingstype Standpunkt brukes.</p>
          {uploadError && (
            <p className="text-xs text-rose-700 mt-2">{uploadError}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">VG1-liste</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={event => void handleUploadChange(event.target.files?.[0] ?? null, 1)}
                className="block w-full text-xs text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-sky-700"
              />
              {uploadVg1?.fileName && (
                <span className="block mt-1 text-xs text-slate-500">{uploadVg1.fileName}</span>
              )}
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">VG2-liste</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={event => void handleUploadChange(event.target.files?.[0] ?? null, 2)}
                className="block w-full text-xs text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-sky-700"
              />
              {uploadVg2?.fileName && (
                <span className="block mt-1 text-xs text-slate-500">{uploadVg2.fileName}</span>
              )}
            </label>
          </div>
        </div>
      )}

      {activeRows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Ingen elever funnet for valgt liste.
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-600 mb-3">
            {activeSubtabLabel}
            {activeSubtab === 'top' && (
              <span>{` - Viser ${visibleTopRows.length} av ${topRows.length}`}</span>
            )}
          </div>
          {renderTable(activeRows)}
          {activeSubtab === 'top' && visibleTopCount < topRows.length && (
            <div className="mt-4">
              <button
                onClick={() => setVisibleTopCount(prev => prev + 20)}
                className="px-3 py-1.5 text-sm font-medium text-sky-700 hover:text-sky-900 hover:bg-sky-50 rounded-lg transition-colors"
              >
                Vis 20 til
              </button>
            </div>
          )}

          {activeSubtab === 'top' && uploadVg1 && uploadVg2 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-900">Kombinert snitt for VG3 + opplastede VG1 + VG2 (Standpunkt)</h3>
                <button
                  onClick={() => handleExportUploaded(uploadedCombinedRows, 'snitt_upload_vg1_vg2_vg3_standpunkt.xlsx', 'Upload VG1+VG2+VG3 Standpunkt')}
                  disabled={uploadedCombinedRows.length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  Eksporter kombinert liste
                </button>
              </div>
              {uploadedCombinedRows.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Ingen elever funnet i opplastede filer med vurderingstype Standpunkt.
                </div>
              ) : (
                <>
                  <div className="text-xs text-slate-600 mb-2">{`Viser ${visibleUploadedCombinedRows.length} av ${uploadedCombinedRows.length}`}</div>
                  {renderTable(visibleUploadedCombinedRows, combinedMissingAllThreeKeys)}
                  {visibleUploadCombinedCount < uploadedCombinedRows.length && (
                    <div className="mt-3">
                      <button
                        onClick={() => setVisibleUploadCombinedCount(prev => prev + 20)}
                        className="px-3 py-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 hover:bg-sky-50 rounded-lg transition-colors"
                      >
                        Vis 20 til (kombinert)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
