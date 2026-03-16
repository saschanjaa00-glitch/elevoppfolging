import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload } from 'lucide-react'
import type { DataStore, AbsenceRecord, WarningRecord, StudentInfoRecord } from '../types'
import { anonymizeData } from '../anonymizeNames'
import { normalizeCellText } from '../securityUtils'

interface FileUploadProps {
  onDataImport: (data: DataStore) => void
}

export default function FileUpload({ onDataImport }: FileUploadProps) {
  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
  const MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024
  const MAX_CELL_CHARS = 10000

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [anonymize, setAnonymize] = useState(false)

  const normalizeHeader = (header: string): string =>
    header
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '')

  const getRowValue = (row: Record<string, any>, aliases: string[]): string => {
    const headers = Object.keys(row)
    const normalizedAliases = aliases.map(a => normalizeHeader(a))
    const header = headers.find(h => normalizedAliases.includes(normalizeHeader(h)))
    return header ? normalizeCellText(row[header], MAX_CELL_CHARS) : ''
  }

  const getRawRowValueByTokens = (row: Record<string, any>, tokenSets: string[][]): unknown => {
    const headers = Object.keys(row)
    for (const tokenSet of tokenSets) {
      const normalizedTokens = tokenSet.map(t => normalizeHeader(t))
      const header = headers.find(h => {
        const normalized = normalizeHeader(h)
        return normalizedTokens.every(token => normalized.includes(token))
      })
      if (header) return row[header]
    }
    return ''
  }

  const getRowValueByTokens = (row: Record<string, any>, tokenSets: string[][]): string => {
    return normalizeCellText(getRawRowValueByTokens(row, tokenSets), MAX_CELL_CHARS)
  }

  const getDateField = (row: Record<string, any>, tokenSets: string[][]): string => {
    const formatAsIsoDate = (date: Date): string => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    const dateFromParts = (year: number, month: number, day: number): Date | null => {
      const d = new Date(year, month - 1, day)
      if (isNaN(d.getTime())) return null
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
      return d
    }

    const value = getRawRowValueByTokens(row, tokenSets)
    if (!value) return ''

    if (typeof value === 'object' && value !== null && 'getTime' in value) {
      const d = value as Date
      return formatAsIsoDate(d)
    }

    const normalizedValue = normalizeCellText(value, MAX_CELL_CHARS)
    const num = Number(normalizedValue)
    if (Number.isFinite(num) && num > 10000) {
      const date = new Date((num - 25569) * 86400 * 1000)
      return formatAsIsoDate(date)
    }

    const dmy = normalizedValue.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T].*)?$/)
    if (dmy) {
      const parsed = dateFromParts(parseInt(dmy[3], 10), parseInt(dmy[2], 10), parseInt(dmy[1], 10))
      if (parsed) return formatAsIsoDate(parsed)
    }

    const ymd = normalizedValue.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T].*)?$/)
    if (ymd) {
      const parsed = dateFromParts(parseInt(ymd[1], 10), parseInt(ymd[2], 10), parseInt(ymd[3], 10))
      if (parsed) return formatAsIsoDate(parsed)
    }

    return normalizedValue
  }

  const getNumericField = (row: Record<string, any>, aliases: string[]): number | null => {
    const value = getRowValue(row, aliases)
    if (!value) return null
    const parsed = parseFloat(value.replace(/\s+/g, '').replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }

  const toIsoDate = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const parseDateCandidate = (value: unknown): Date | null => {
    if (!value) return null
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value
    if (typeof value === 'number' && Number.isFinite(value) && value > 10000) {
      const d = new Date((value - 25569) * 86400 * 1000)
      return isNaN(d.getTime()) ? null : d
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return null
      const parsed = new Date(trimmed)
      return isNaN(parsed.getTime()) ? null : parsed
    }
    return null
  }

  const getWarningFileCreatedDate = (workbook: XLSX.WorkBook, file: File): string | undefined => {
    const workbookAny = workbook as unknown as {
      Props?: { CreatedDate?: unknown; createdate?: unknown }
      Custprops?: { CreatedDate?: unknown; createdate?: unknown }
    }

    const metadataCandidates: unknown[] = [
      workbookAny.Props?.CreatedDate,
      workbookAny.Props?.createdate,
      workbookAny.Custprops?.CreatedDate,
      workbookAny.Custprops?.createdate,
    ]

    for (const candidate of metadataCandidates) {
      const parsed = parseDateCandidate(candidate)
      if (parsed) return toIsoDate(parsed)
    }

    if (file.lastModified > 0) {
      return toIsoDate(new Date(file.lastModified))
    }

    return undefined
  }

  const looksLikeAbsenceWorkbook = (sheet: Record<string, any>[]): boolean => {
    if (sheet.length === 0) return false
    const first = sheet[0]
    const headerKeys = Object.keys(first)
    const normalizedHeaders = headerKeys.map(h => normalizeHeader(h))
    
    const hasNavn = normalizedHeaders.some(h => h.includes('navn'))
    const hasKlasse = normalizedHeaders.some(h => h.includes('klasse'))
    const hasFagnavn = normalizedHeaders.some(h => h.includes('fagnavn'))
    
    // Check for absence percentage and hours using original headers (they contain %)
    const hasPercent = headerKeys.some(h => 
      (h.includes('udok') || h.includes('fravær')) && h.includes('%')
    )
    const hasHours = headerKeys.some(h => 
      (h.includes('udok') || h.includes('fravær')) && h.toLowerCase().includes('timer')
    )
    
    return hasNavn && hasKlasse && hasFagnavn && hasPercent && hasHours
  }

  const looksLikeGradeWorkbook = (sheet: Record<string, any>[]): boolean => {
    if (sheet.length === 0) return false
    const first = sheet[0]
    const headers = Object.keys(first).map(h => normalizeHeader(h))
    const hasElev = headers.some(h => h === 'elev' || h.includes('elev'))
    const hasGruppe = headers.some(h => h === 'gruppe' || h.includes('gruppe'))
    const hasGrade = headers.some(h => h === 'grade' || h.includes('grade') || h.includes('karakter'))
    return hasElev && hasGruppe && hasGrade
  }

  const parseGradeSheet = (sheet: Record<string, any>[]): import('../types').GradeRecord[] => {
    return sheet
      .map(row => ({
        navn: getRowValue(row, ['elev', 'navn', 'student']),
        subjectGroup: getRowValue(row, ['gruppe', 'group', 'faggruppe']),
        fagkode: getRowValue(row, ['fagkode']),
        grade: getRowValue(row, ['grade', 'karakter']),
        subjectTeacher: getRowValue(row, ['subject teacher', 'faglærer', 'faglaerer', 'lærer', 'larer', 'teacher']),
        halvår: getRowValue(row, ['halvår', 'halvar', 'termin', 'term']),
      }))
      .filter(r => r.navn && r.subjectGroup && r.grade)
  }

  const looksLikeWarningWorkbook = (sheet: Record<string, any>[]): boolean => {
    if (sheet.length === 0) return false
    const first = sheet[0]
    const hasNavn = Object.keys(first).some(h => normalizeHeader(h).includes('navn'))
    const hasFaggruppe = Object.keys(first).some(h => {
      const n = normalizeHeader(h)
      return n.includes('faggruppe') || n.includes('fagkode') || n.includes('fag')
    })
    const hasVarselType = Object.keys(first).some(h => {
      const n = normalizeHeader(h)
      return n.includes('varsel') || n.includes('warning')
    })
    return hasNavn && hasFaggruppe && hasVarselType
  }

  const looksLikeStudentInfoWorkbook = (sheet: Record<string, any>[]): boolean => {
    if (sheet.length === 0) return false
    const first = sheet[0]
    const headers = Object.keys(first).map(h => normalizeHeader(h))
    const hasFornavn = headers.some(h => h.includes('fornavn') || h.includes('firstname'))
    const hasEtternavn = headers.some(h => h.includes('etternavn') || h.includes('lastname'))
    const hasProgramArea = headers.some(h => h.includes('programomrade') || h.includes('programområde'))
    const hasSidemal = headers.some(h => h.includes('sidemal') || h.includes('sidemål'))
    const hasIntake = headers.some(h => h.includes('inntakspoeng'))
    return hasFornavn && hasEtternavn && hasProgramArea && hasSidemal && hasIntake
  }

  const parseAbsenceSheet = (sheet: Record<string, any>[]): AbsenceRecord[] => {
    return sheet
      .map(row => {
        // Handle comma as decimal separator (6,96 -> 6.96)
        const percentStr = getRowValueByTokens(row, [['h1', 'h2', 'udok', 'frav']])
        const hoursStr = getRowValueByTokens(row, [['h1', 'h2', 'timer', 'udok', 'frav']])
        
        const percentage = parseFloat(percentStr.replace(',', '.')) || 0
        const hours = parseFloat(hoursStr.replace(',', '.')) || 0
        
        return {
          navn: getRowValue(row, ['navn', 'name', 'student']),
          class: getRowValue(row, ['klasse', 'class', 'gruppe']),
          subject: getRowValue(row, ['fagnavn', 'fag', 'subject']),
          subjectGroup: getRowValue(row, ['faggruppe', 'fagkode', 'code']),
          percentageAbsence: percentage,
          hoursAbsence: hours,
          teacher: getRowValue(row, ['lærer', 'larer', 'teacher', 'kontaktlærer', 'leder']),
          avbrudd: getRowValue(row, ['avbrudd', 'discontinued']).toLowerCase() === 'ja',
        }
      })
      .filter(r => r.navn && r.class && r.subject)
  }

  const parseWarningsSheet = (sheet: Record<string, any>[]): WarningRecord[] => {
    return sheet
      .map(row => ({
        navn: getRowValue(row, ['elevnavn', 'navn', 'name', 'student']),
        class: getRowValue(row, ['klasse', 'class']),
        subjectGroup: getRowValue(row, ['faggruppe']),
        warningType: getRowValue(row, ['type varsel', 'varseltype', 'type', 'varselbrev type']),
        sentDate: getDateField(row, [['sendt'], ['sent']]),
        dateOfBirth: getDateField(row, [['fdselsdato'], ['fodselsdato'], ['birthdate']]),
      }))
      .filter(r => r.navn && r.class)
  }

  const parseStudentInfoSheet = (sheet: Record<string, any>[]): StudentInfoRecord[] => {
    return sheet
      .map(row => {
        const fornavn = getRowValue(row, ['fornavn', 'first name', 'firstname'])
        const etternavn = getRowValue(row, ['etternavn', 'last name', 'lastname'])
        const navn = [fornavn, etternavn].filter(Boolean).join(' ').trim()
        const sidemalValue = getRowValue(row, ['fritak i sidemål', 'fritak i sidemal', 'sidemål', 'sidemal'])

        return {
          navn,
          fornavn,
          etternavn,
          class: getRowValue(row, ['klasse', 'class']),
          dateOfBirth: getDateField(row, [['fødselsdato'], ['fodselsdato'], ['birthdate'], ['dob']]),
          programArea: getRowValue(row, ['programområde', 'programomrade', 'program area']),
          sidemalExemption: sidemalValue.toLowerCase().includes('assessment exemption'),
          intakePoints: getNumericField(row, ['inntakspoeng', 'intake points']),
        }
      })
      .filter(r => r.navn)
  }

  const handleFileSelect = async (files: FileList) => {
    if (files.length === 0) return

    const selectedFiles = Array.from(files)
    const oversizedFile = selectedFiles.find(file => file.size > MAX_FILE_SIZE_BYTES)
    if (oversizedFile) {
      setError(`Filen "${oversizedFile.name}" er for stor. Maks filstørrelse er 25 MB.`)
      return
    }

    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0)
    if (totalSize > MAX_TOTAL_SIZE_BYTES) {
      setError('Total filstørrelse er for stor. Last opp maks 100 MB av gangen.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data: DataStore = {
        absences: [],
        warnings: [],
        grades: [],
        studentInfo: [],
        warningFileCreatedDate: undefined,
      }

      // Process all files and detect by content
      for (const file of selectedFiles) {
        try {
          const buffer = await file.arrayBuffer()
          const wb = XLSX.read(buffer)
          const sheetRaw = XLSX.utils.sheet_to_json(
            wb.Sheets[wb.SheetNames[0]]
          ) as Record<string, any>[]

          if (looksLikeAbsenceWorkbook(sheetRaw)) {
            const parsed = parseAbsenceSheet(sheetRaw)
            data.absences = parsed
          } else if (looksLikeWarningWorkbook(sheetRaw)) {
            const parsed = parseWarningsSheet(sheetRaw)
            data.warnings = parsed
            data.warningFileCreatedDate = getWarningFileCreatedDate(wb, file) ?? data.warningFileCreatedDate
          } else if (looksLikeGradeWorkbook(sheetRaw)) {
            const parsed = parseGradeSheet(sheetRaw)
            data.grades = parsed
          } else if (looksLikeStudentInfoWorkbook(sheetRaw)) {
            const parsed = parseStudentInfoSheet(sheetRaw)
            data.studentInfo = parsed
          }
        } catch (err) {
          console.error('Error processing file:', err)
          // Continue with next file
          continue
        }
      }

      if (data.absences.length === 0) {
        setError('Fant ingen gyldige fraværsdata')
        return
      }

      onDataImport(anonymize ? anonymizeData(data) : data)
    } catch (err) {
      setError('Feil ved behandling av filer: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-sky-100 rounded-lg flex items-center justify-center">
            <Upload className="w-8 h-8 text-sky-600" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-center text-slate-900 mb-2">
          Importer fraværsdata
        </h2>
        <p className="text-center text-slate-600 mb-4">
          Dra og slipp Excel-filer eller klikk for å laste opp
        </p>

        <label className="flex items-center justify-center gap-2 mb-6 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={anonymize}
            onChange={e => setAnonymize(e.target.checked)}
            className="w-4 h-4 rounded accent-sky-600"
          />
          <span className="text-sm text-slate-700 font-medium">Anonymiser navn (elever og lærere)</span>
        </label>

        <div
          className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center hover:border-sky-400 hover:bg-sky-50 transition-colors cursor-pointer"
          onDragOver={e => {
            e.preventDefault()
            e.currentTarget.classList.add('border-sky-400', 'bg-sky-50')
          }}
          onDragLeave={e => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-sky-400', 'bg-sky-50')
          }}
          onDrop={e => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-sky-400', 'bg-sky-50')
            handleFileSelect(e.dataTransfer.files)
          }}
        >
          <input
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            onChange={e => handleFileSelect(e.currentTarget.files!)}
            className="hidden"
            id="file-input"
          />
          <label htmlFor="file-input" className="cursor-pointer">
            <p className="font-medium text-slate-900">
              {loading ? 'Behandler...' : 'Klikk for å velge filer eller dra dem hit'}
            </p>
            <p className="text-sm text-slate-600 mt-1">
              XLSX-, XLS- eller CSV-filer
            </p>
          </label>
        </div>

        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 font-medium">{error}</p>
            <p className="text-sm text-red-600 mt-2">
              Kontroller at filene inneholder: Navn, Klasse, Fagnavn, H1+H2 % udok. fravær, H1+H2 timer udok. fravær, Lærer (fraværsfil), Navn, Faggruppe, Varseltype, Sendt, Fødselsdato (varselfil), Elev, Gruppe, Karakter (karakterfil) og Fornavn, Etternavn, Programområde, Fritak i sidemål, Inntakspoeng (elevfil)
            </p>
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">
              Fraværsfil
              <span className="block text-xs font-normal text-slate-500">(fra rapport)</span>
            </h4>
            <ul className="text-slate-600 space-y-1 text-xs">
              <li>• Navn</li>
              <li>• Klasse</li>
              <li>• Fagnavn</li>
              <li>• H1+H2 % udok. fravær</li>
              <li>• H1+H2 timer udok. fravær</li>
            </ul>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">
              Varselfil
              <span className="block text-xs font-normal text-slate-500">(manuelt fra varseloversikt)</span>
            </h4>
            <ul className="text-slate-600 space-y-1 text-xs">
              <li>• Navn</li>
              <li>• Faggruppe</li>
              <li>• Varseltype</li>
              <li>• Sendt</li>
              <li>• Fødselsdato</li>
            </ul>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">
              Karakterfil
              <span className="block text-xs font-normal text-slate-500">(fra rapport)</span>
            </h4>
            <ul className="text-slate-600 space-y-1 text-xs">
              <li>• Elev</li>
              <li>• Gruppe</li>
              <li>• Karakter</li>
              <li>• Faglærer</li>
              <li>• Halvår</li>
            </ul>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">
              Elevfil
              <span className="block text-xs font-normal text-slate-500">(eksporter elevliste)</span>
            </h4>
            <ul className="text-slate-600 space-y-1 text-xs">
              <li>• Fornavn</li>
              <li>• Etternavn</li>
              <li>• Programområde</li>
              <li>• Fritak i sidemål</li>
              <li>• Inntakspoeng</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
