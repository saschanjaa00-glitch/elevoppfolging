import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload } from 'lucide-react'
import type { DataStore, AbsenceRecord, WarningRecord } from '../types'

interface FileUploadProps {
  onDataImport: (data: DataStore) => void
}

export default function FileUpload({ onDataImport }: FileUploadProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    return header ? String(row[header] ?? '').trim() : ''
  }

  const getRowValueByTokens = (row: Record<string, any>, tokenSets: string[][]): string => {
    const headers = Object.keys(row)
    for (const tokenSet of tokenSets) {
      const normalizedTokens = tokenSet.map(t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      const header = headers.find(h => {
        const normalized = normalizeHeader(h)
        return normalizedTokens.every(token => normalized.includes(token))
      })
      if (header) return String(row[header] ?? '').trim()
    }
    return ''
  }

  const getDateField = (row: Record<string, any>, tokenSets: string[][]): string => {
    const value = getRowValueByTokens(row, tokenSets)
    if (!value) return ''

    if (typeof value === 'object' && value !== null && 'getTime' in value) {
      const d = value as Date
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
    }

    const num = parseFloat(value)
    if (num > 10000) {
      const date = new Date((num - 25569) * 86400 * 1000)
      return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
    }

    return String(value)
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

  const handleFileSelect = async (files: FileList) => {
    if (files.length === 0) return

    setLoading(true)
    setError(null)

    try {
      const data: DataStore = {
        absences: [],
        warnings: [],
        grades: [],
      }

      // Process all files and detect by content
      for (const file of Array.from(files)) {
        try {
          console.log('Processing file:', file.name)
          const buffer = await file.arrayBuffer()
          const wb = XLSX.read(buffer)
          const sheetRaw = XLSX.utils.sheet_to_json(
            wb.Sheets[wb.SheetNames[0]]
          ) as Record<string, any>[]

          console.log('Sheet headers:', Object.keys(sheetRaw[0] || {}))
          console.log('First row:', sheetRaw[0])

          if (looksLikeAbsenceWorkbook(sheetRaw)) {
            console.log('Detected as ABSENCE workbook')
            const parsed = parseAbsenceSheet(sheetRaw)
            console.log('Parsed absences:', parsed.length)
            console.log('Sample records:', parsed.slice(0, 3))
            data.absences = parsed
          } else if (looksLikeWarningWorkbook(sheetRaw)) {
            console.log('Detected as WARNING workbook')
            const parsed = parseWarningsSheet(sheetRaw)
            console.log('Parsed warnings:', parsed.length)
            data.warnings = parsed
          } else if (looksLikeGradeWorkbook(sheetRaw)) {
            console.log('Detected as GRADE workbook')
            const parsed = parseGradeSheet(sheetRaw)
            console.log('Parsed grades:', parsed.length)
            data.grades = parsed
          } else {
            console.log('File not recognized as absence, warning, or grade workbook')
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

      onDataImport(data)
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
        <p className="text-center text-slate-600 mb-6">
          Dra og slipp Excel-filer eller klikk for å laste opp
        </p>

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
              Kontroller at filene inneholder: Navn, Klasse, Fagnavn, H1+H2 % udok. fravær, H1+H2 timer udok. fravær, Lærer (fraværsfil) og Navn, Faggruppe, Varseltype, Sendt, Fødselsdato (varselfil)
            </p>
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-4 text-sm">
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">Fraværsfil</h4>
            <ul className="text-slate-600 space-y-1 text-xs">
              <li>• Navn</li>
              <li>• Klasse</li>
              <li>• Fagnavn</li>
              <li>• H1+H2 % udok. fravær</li>
              <li>• H1+H2 timer udok. fravær</li>
            </ul>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">Varselfil</h4>
            <ul className="text-slate-600 space-y-1 text-xs">
              <li>• Navn</li>
              <li>• Faggruppe</li>
              <li>• Varseltype</li>
              <li>• Sendt</li>
              <li>• Fødselsdato</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
