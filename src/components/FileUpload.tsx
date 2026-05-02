import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, X, AlertTriangle } from 'lucide-react'
import type { DataStore, AbsenceRecord, WarningRecord, StudentInfoRecord, PresetRecord } from '../types'
import { anonymizeData } from '../anonymizeNames'
import { normalizeCellText } from '../securityUtils'


interface FileUploadProps {
  onDataImport: (data: DataStore) => void;
  onPresetImport?: (presets: PresetRecord[]) => void;
  onOpenKarakterutvikling?: () => void;
}

export default function FileUpload({ onDataImport, onPresetImport, onOpenKarakterutvikling }: FileUploadProps) {
  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
  const MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024
  const MAX_CELL_CHARS = 10000

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [anonymize, setAnonymize] = useState(false)
  const [missingColumns, setMissingColumns] = useState<{ fileName: string; fileType: string; missing: string[] }[]>([])
  const [detectedTypes, setDetectedTypes] = useState<Set<string>>(new Set())

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

  const isAdultAtImport = (value: unknown): boolean => {
    const parsed = parseDateCandidate(value)
    if (!parsed) return false

    const today = new Date()
    const adultDate = new Date(parsed.getFullYear() + 18, parsed.getMonth(), parsed.getDate())
    return today >= adultDate
  }

  const getAdultStatus = (row: Record<string, any>, tokenSets: string[][]): boolean => {
    return isAdultAtImport(getRawRowValueByTokens(row, tokenSets))
  }

  const downloadWarningTemplate = () => {
    const headers = ['Type varsel', 'Elevnavn', 'Fødselsdato', 'Klasse', 'Fagkode', 'Faggruppe', 'Fraværsprosent', 'Kontaktansvarlig lærer', 'Avsenders navn', 'Sendt dato']
    const ws = XLSX.utils.aoa_to_sheet([headers])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Varsler')
    XLSX.writeFile(wb, 'varsler_mal.xlsx')
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

  const hasTokenMatch = (headers: string[], tokenSets: string[][]): boolean =>
    tokenSets.some(tokens => headers.some(h => tokens.every(t => normalizeHeader(h).includes(normalizeHeader(t)))))

  const hasAliasMatch = (headers: string[], aliases: string[]): boolean =>
    aliases.some(a => headers.some(h => normalizeHeader(h) === normalizeHeader(a)))

  const getMissingAbsenceColumns = (sheet: Record<string, any>[]): string[] => {
    if (sheet.length === 0) return []
    const headers = Object.keys(sheet[0])
    const missing: string[] = []
    if (!hasAliasMatch(headers, ['navn', 'name', 'student'])) missing.push('Navn')
    if (!hasAliasMatch(headers, ['klasse', 'class', 'gruppe'])) missing.push('Klasse')
    if (!hasAliasMatch(headers, ['fagnavn', 'fag', 'subject'])) missing.push('Fagnavn')
    if (!hasTokenMatch(headers, [['h1', 'h2', 'udok', 'frav']])) missing.push('H1+H2 % udok. fravær')
    if (!hasTokenMatch(headers, [['h1', 'h2', 'timer', 'udok', 'frav']])) missing.push('H1+H2 timer udok. fravær')
    if (!hasAliasMatch(headers, ['lærer', 'larer', 'teacher', 'leder'])) missing.push('Lærer')
    if (!hasAliasMatch(headers, ['kontaktlærer', 'kontaktansvarlig lærer', 'kontaktlaerer'])) missing.push('Kontaktlærer')
    if (!hasTokenMatch(headers, [['avbrudd'], ['discontinued']])) missing.push('Avbrudd i skoleåret')
    return missing
  }

  const getMissingWarningColumns = (sheet: Record<string, any>[]): string[] => {
    if (sheet.length === 0) return []
    const headers = Object.keys(sheet[0])
    const missing: string[] = []
    if (!hasAliasMatch(headers, ['elevnavn', 'navn', 'name', 'student'])) missing.push('Elevnavn')
    if (!hasAliasMatch(headers, ['klasse', 'klassegruppe', 'class'])) missing.push('Klasse')
    if (!hasAliasMatch(headers, ['faggruppe'])) missing.push('Faggruppe')
    if (!hasAliasMatch(headers, ['type varsel', 'varseltype', 'type', 'varselbrev type', 'hva'])) missing.push('Type varsel')
    if (!hasTokenMatch(headers, [['sendt dato'], ['sendt'], ['sent']])) missing.push('Sendt / Sendt dato')
    if (!hasTokenMatch(headers, [['fdselsdato'], ['fodselsdato'], ['birthdate']])) missing.push('Fødselsdato')
    return missing
  }

  const getMissingGradeColumns = (sheet: Record<string, any>[]): string[] => {
    if (sheet.length === 0) return []
    const headers = Object.keys(sheet[0])
    const missing: string[] = []
    if (!hasAliasMatch(headers, ['elev', 'navn', 'student'])) missing.push('Elev')
    if (!hasAliasMatch(headers, ['klasse', 'klassegruppe', 'class'])) missing.push('Klassegruppe')
    if (!hasAliasMatch(headers, ['gruppe', 'faggruppe', 'group'])) missing.push('Gruppe')
    if (!hasAliasMatch(headers, ['fagkode'])) missing.push('Fagkode')
    if (!hasAliasMatch(headers, ['grade', 'karakter'])) missing.push('Grade')
    if (!hasAliasMatch(headers, ['subject teacher', 'faglærer', 'faglaerer', 'lærer', 'larer', 'teacher'])) missing.push('Subject Teacher')
    if (!hasAliasMatch(headers, ['halvår', 'halvar', 'termin', 'term'])) missing.push('Halvår')
    return missing
  }

  const getMissingStudentInfoColumns = (sheet: Record<string, any>[]): string[] => {
    if (sheet.length === 0) return []
    const headers = Object.keys(sheet[0])
    const missing: string[] = []
    if (!hasAliasMatch(headers, ['fornavn', 'first name', 'firstname'])) missing.push('Fornavn')
    if (!hasAliasMatch(headers, ['etternavn', 'last name', 'lastname'])) missing.push('Etternavn')
    if (!hasTokenMatch(headers, [['fødselsdato'], ['fodselsdato'], ['birthdate'], ['dob']])) missing.push('Fødselsdato')
    if (!hasAliasMatch(headers, ['programområde', 'programomrade', 'program area'])) missing.push('Programområde')
    if (!hasAliasMatch(headers, ['fritak i sidemål', 'fritak i sidemal', 'sidemål', 'sidemal'])) missing.push('Fritak i sidemål')
    if (!hasAliasMatch(headers, ['inntakspoeng', 'intake points'])) missing.push('Inntakspoeng')
    if (!hasAliasMatch(headers, ['klasse', 'klassegruppe', 'class'])) missing.push('Klasse')
    return missing
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

  const parseGradeSheet = (sheet: Record<string, any>[]): { grades: import('../types').GradeRecord[] } => {
    const all = sheet
      .map(row => ({
        navn: getRowValue(row, ['elev', 'navn', 'student']),
        class: getRowValue(row, ['klasse', 'klassegruppe', 'class']) || undefined,
        subjectGroup: getRowValue(row, ['gruppe', 'group', 'faggruppe']),
        fagkode: getRowValue(row, ['fagkode']),
        grade: getRowValue(row, ['grade', 'karakter']),
        subjectTeacher: getRowValue(row, ['subject teacher', 'faglærer', 'faglaerer', 'lærer', 'larer', 'teacher']),
        halvår: getRowValue(row, ['halvår', 'halvar', 'termin', 'term']),
        skoleår: getRowValue(row, ['skoleår', 'skolear', 'school year', 'schoolyear']),
        assessmentType: getRowValue(row, ['assessment type', 'vurderingstype', 'type']),
      }))
      .filter(r => r.navn && r.subjectGroup && r.grade)

    const isTermType = (t: string) => {
      if (!t) return true // no assessment type column — keep as before
      const n = t.toLowerCase()
      return n.includes('halvår') || n.includes('halvar') || n.includes('standpunkt') || n.includes('termin')
    }

    return {
      grades: all.filter(r => isTermType(r.assessmentType ?? '')),
    }
  }

  const looksLikeWarningWorkbook = (sheet: Record<string, any>[]): boolean => {
    if (sheet.length === 0) return false
    const first = sheet[0]
    const headers = Object.keys(first)
    const normalized = headers.map(h => normalizeHeader(h))
    const hasFaggruppe = normalized.some(h => h.includes('faggruppe') || h.includes('fagkode') || h.includes('fag'))
    const hasSendt = normalized.some(h => h.includes('sendt') || h.includes('sent'))
    const hasKlasse = normalized.some(h => h.includes('klasse'))
    const hasVarselType = normalized.some(h => h.includes('varsel') || h.includes('warning') || h === 'hva')
    // Strict match: has explicit varsel-type column
    // Loose match: has faggruppe + sendt + klasse (distinctive combo for warning exports)
    return hasFaggruppe && (hasVarselType || (hasSendt && hasKlasse))
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
          teacher: getRowValue(row, ['lærer', 'larer', 'teacher', 'leder']),
          kontaktlaerer: getRowValue(row, ['kontaktlærer', 'kontaktansvarlig lærer', 'kontaktlaerer']) || undefined,
          avbrudd: getRowValueByTokens(row, [['avbrudd'], ['discontinued']]).toLowerCase() === 'ja',
        }
      })
      .filter(r => r.navn && r.class && r.subject)
  }

  const parseWarningsSheet = (sheet: Record<string, any>[]): WarningRecord[] => {
    return sheet
      .map(row => ({
        navn: getRowValue(row, ['elevnavn', 'navn', 'name', 'student']),
        class: getRowValue(row, ['klasse', 'klassegruppe', 'class']),
        subjectGroup: getRowValue(row, ['faggruppe']),
        warningType: getRowValue(row, ['type varsel', 'varseltype', 'type', 'varselbrev type', 'hva']),
        sentDate: getDateField(row, [['sendt dato'], ['sendt'], ['sent']]),  
        isAdult: getAdultStatus(row, [['fdselsdato'], ['fodselsdato'], ['birthdate']]),
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
          class: getRowValue(row, ['klasse', 'klassegruppe', 'class']) || undefined,
          isAdult: getAdultStatus(row, [['fødselsdato'], ['fodselsdato'], ['birthdate'], ['dob']]),
          programArea: getRowValue(row, ['programområde', 'programomrade', 'program area']),
          sidemalExemption: sidemalValue.toLowerCase().includes('assessment exemption'),
          intakePoints: getNumericField(row, ['inntakspoeng', 'intake points']),
        }
      })
      .filter(r => r.navn)
  }

  const looksLikePresetWorkbook = (sheet: Record<string, any>[]): boolean => {
    if (sheet.length === 0) return false
    const first = sheet[0]
    const headers = Object.keys(first).map(h => normalizeHeader(h))
    const hasNavn = headers.some(h => h === 'navn' || h.includes('navn'))
    const hasRolle = headers.some(h => h === 'rolle' || h.includes('rolle'))
    const hasKlasser = headers.some(h => h === 'klasser' || h.includes('klasser'))
    return hasNavn && hasRolle && hasKlasser
  }

  const parsePresetSheet = (sheet: Record<string, any>[]): PresetRecord[] => {
    return sheet.map(row => {
      const navn = row['Navn']?.toString().trim() || ''
      const rolle = row['Rolle']?.toString().trim() || ''
      const klasser = (row['Klasser']?.toString() || '').split(',').map((k: string) => k.trim()).filter(Boolean)
      return { navn, rolle, klasser }
    }).filter(r => r.navn && r.rolle && r.klasser.length > 0)
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
    setMissingColumns([])
    setDetectedTypes(new Set())

    try {
      const data: DataStore = {
        absences: [],
        warnings: [],
        grades: [],
        studentInfo: [],
        warningFileCreatedDate: undefined,
      }

      // Process all files and detect by content
      const missingWarnings: { fileName: string; fileType: string; missing: string[] }[] = []
      const detected = new Set<string>()
      for (const file of selectedFiles) {
        try {
          const buffer = await file.arrayBuffer()
          const wb = XLSX.read(buffer)
          const sheetRaw = XLSX.utils.sheet_to_json(
            wb.Sheets[wb.SheetNames[0]]
          ) as Record<string, any>[]

          if (looksLikeAbsenceWorkbook(sheetRaw)) {
            const missing = getMissingAbsenceColumns(sheetRaw)
            if (missing.length > 0) missingWarnings.push({ fileName: file.name, fileType: 'Fraværsfil', missing })
            const parsed = parseAbsenceSheet(sheetRaw)
            data.absences = parsed
            detected.add('absence')
          } else if (looksLikeWarningWorkbook(sheetRaw)) {
            const missing = getMissingWarningColumns(sheetRaw)
            if (missing.length > 0) missingWarnings.push({ fileName: file.name, fileType: 'Varselfil', missing })
            const parsed = parseWarningsSheet(sheetRaw)
            data.warnings = parsed
            data.warningFileCreatedDate = getWarningFileCreatedDate(wb, file) ?? data.warningFileCreatedDate
            detected.add('warnings')
          } else if (looksLikeGradeWorkbook(sheetRaw)) {
            const missing = getMissingGradeColumns(sheetRaw)
            if (missing.length > 0) missingWarnings.push({ fileName: file.name, fileType: 'Karakterfil', missing })
            const parsed = parseGradeSheet(sheetRaw)
            data.grades = parsed.grades
            // Derive skoleår from most common non-empty value in parsed grades
            const skYearCounts = new Map<string, number>()
            parsed.grades.forEach(r => { if (r.skoleår) skYearCounts.set(r.skoleår, (skYearCounts.get(r.skoleår) ?? 0) + 1) })
            const topSkoleår = Array.from(skYearCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
            if (topSkoleår) data.skoleår = topSkoleår.replace(/[^0-9A-Za-z]/g, '')
            detected.add('grades')
          } else if (looksLikeStudentInfoWorkbook(sheetRaw)) {
            const missing = getMissingStudentInfoColumns(sheetRaw)
            if (missing.length > 0) missingWarnings.push({ fileName: file.name, fileType: 'Elevfil', missing })
            const parsed = parseStudentInfoSheet(sheetRaw)
            data.studentInfo = parsed
            detected.add('studentInfo')
          } else if (looksLikePresetWorkbook(sheetRaw)) {
            const parsed = parsePresetSheet(sheetRaw)
            if (onPresetImport && parsed.length > 0) onPresetImport(parsed)
            detected.add('preset')
          } else {
            // File wasn't recognized — try each type's full column check to find the closest match
            const absenceMissing = getMissingAbsenceColumns(sheetRaw)
            const warningMissing = getMissingWarningColumns(sheetRaw)
            const gradeMissing = getMissingGradeColumns(sheetRaw)
            const studentMissing = getMissingStudentInfoColumns(sheetRaw)
            const candidates = [
              { fileType: 'Fraværsfil', missing: absenceMissing },
              { fileType: 'Varselfil', missing: warningMissing },
              { fileType: 'Karakterfil', missing: gradeMissing },
              { fileType: 'Elevfil', missing: studentMissing },
            ]
            const best = candidates.reduce((a, b) => a.missing.length <= b.missing.length ? a : b)
            if (best.missing.length > 0 && best.missing.length < 5) {
              missingWarnings.push({ fileName: file.name, fileType: best.fileType, missing: best.missing })
            } else {
              missingWarnings.push({ fileName: file.name, fileType: 'Ukjent fil', missing: ['Filen ble ikke gjenkjent som noen kjent filtype'] })
            }
          }
        } catch (err) {
          console.error('Error processing file:', err)
          // Continue with next file
          continue
        }
      }

      if (missingWarnings.length > 0) setMissingColumns(missingWarnings)

      if (data.absences.length === 0) {
        setError('Fant ingen gyldige fraværsdata')
        return
      }

      setDetectedTypes(detected)
      const finalData = anonymize ? anonymizeData(data) : data
      await new Promise(resolve => setTimeout(resolve, 2000))
      onDataImport(finalData)
    } catch (err) {
      setError('Feil ved behandling av filer: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-12">
      {missingColumns.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="font-semibold text-slate-900 text-lg">Manglende kolonner</h3>
              </div>
              <button
                onClick={() => setMissingColumns([])}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-96 overflow-y-auto">
              {missingColumns.map((w, i) => (
                <div key={i}>
                  <p className="text-sm font-medium text-slate-700 mb-1">
                    <span className="text-slate-500">{w.fileType}:</span> {w.fileName}
                  </p>
                  <ul className="space-y-1">
                    {w.missing.map(col => (
                      <li key={col} className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        {col}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-slate-200">
              <button
                onClick={() => setMissingColumns([])}
                className="w-full btn-primary py-2 text-sm"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 bg-gradient-to-br from-sky-100 to-sky-200 rounded-2xl flex items-center justify-center shadow-sm">
            <Upload className="w-8 h-8 text-sky-600" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-slate-900 mb-1.5">
          Importer fraværsdata
        </h2>
        <p className="text-center text-slate-500 mb-5">
          Dra og slipp Excel-filer eller klikk for å laste opp
        </p>

        <label className="flex items-center justify-center gap-2.5 mb-5 cursor-pointer select-none group">
          <input
            type="checkbox"
            checked={anonymize}
            onChange={e => setAnonymize(e.target.checked)}
            className="w-4 h-4 rounded accent-sky-600"
          />
          <span className="text-sm text-slate-600 font-medium group-hover:text-slate-800 transition-colors">Anonymiser navn (elever og lærere)</span>
        </label>

        <div
          className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center bg-slate-50/60 hover:border-sky-400 hover:bg-sky-50/60 transition-all duration-200 cursor-pointer"
          onDragOver={e => {
            e.preventDefault()
            e.currentTarget.classList.add('border-sky-400', '!bg-sky-50')
          }}
          onDragLeave={e => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-sky-400', '!bg-sky-50')
          }}
          onDrop={e => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-sky-400', '!bg-sky-50')
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
            <div className="flex justify-center mb-3">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                <Upload className="w-5 h-5 text-slate-400" />
              </div>
            </div>
            <p className="font-semibold text-slate-700">
              {loading ? 'Behandler...' : 'Klikk for å velge filer'}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              eller dra dem hit &middot; XLSX, XLS, CSV
            </p>
          </label>
        </div>

        {error && (
          <div className="mt-5 p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-700 font-semibold text-sm">{error}</p>
              <p className="text-xs text-red-500 mt-1.5 leading-relaxed">
                Kontroller at filene inneholder riktige kolonner: Fraværsfil: Navn, Klasse, Fagnavn, Faggruppe/Fagkode, H1+H2 % udok. fravær, H1+H2 timer udok. fravær, Lærer. Varselfil: Elevnavn/Navn, Klasse, Faggruppe, Type varsel, Sendt, Fødselsdato. Karakterfil: Elev, Klasse, Gruppe, Fagkode, Karakter, Faglærer, Halvår. Elevfil: Fornavn, Etternavn, Fødselsdato, Programområde, Fritak i sidemål, Inntakspoeng.
              </p>
            </div>
          </div>
        )}

        <div className="mt-7">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Støttede filtyper</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {([
            { key: 'absence', label: 'Fravær', sub: 'Fraværsrapport', cols: ['Navn', 'Klasse', 'Fagnavn', 'Faggruppe', 'H1+H2 % udok. fravær', 'H1+H2 timer udok. fravær', 'Lærer', 'Kontaktlærer', 'Avbrudd i skoleåret'] },
            { key: 'warnings', label: 'Varsler', sub: 'Varseloversikt*', cols: ['Elevnavn', 'Klasse', 'Faggruppe', 'Type varsel', 'Sendt dato', 'Fødselsdato'] },
            { key: 'grades', label: 'Karakterer', sub: 'Karakterrapport', cols: ['Elev', 'Klassegruppe', 'Gruppe', 'Fagkode', 'Karakter', 'Faglærer', 'Halvår'] },
            { key: 'studentInfo', label: 'Elevfil', sub: 'Elevliste', cols: ['Fornavn', 'Etternavn', 'Fødselsdato', 'Programområde', 'Fritak i sidemål', 'Inntakspoeng', 'Klasse'] },
            { key: 'preset', label: 'Preset-fil', sub: 'Valgfri', cols: ['Navn', 'Rolle', 'Klasser'] },
          ] as const).map(({ key, label, sub, cols }) => {
            const detected = detectedTypes.has(key)
            return (
              <div key={key} className={`relative rounded-xl border p-3.5 transition-all duration-300 ${
                detected
                  ? 'bg-green-50 border-green-200 shadow-sm'
                  : 'bg-white border-slate-200'
              }`}>
                {detected && (
                  <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                )}
                <h4 className={`font-semibold text-xs mb-0.5 pr-5 ${ detected ? 'text-green-800' : 'text-slate-800'}`}>
                  {label}
                </h4>
                <span className={`block text-xs mb-2 ${detected ? 'text-green-500' : 'text-slate-400'}`}>{sub}</span>
                <ul className={`space-y-0.5 text-xs ${detected ? 'text-green-700' : 'text-slate-500'}`}>
                  {cols.map(c => <li key={c}>· {c}</li>)}
                </ul>
              </div>
            )
          })}
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <h3 className="text-sm font-semibold text-sky-900 mb-1">Karakterutvikling</h3>
          <p className="text-sm text-sky-800 mb-3">
            Åpne Faginnsikt sin underfane for karakterutvikling. Der kan du laste opp flere karakterfiler og sammenligne snitt per skoleår.
          </p>
          <button
            type="button"
            onClick={() => onOpenKarakterutvikling?.()}
            className="px-3 py-2 rounded-lg text-sm font-medium border bg-white text-sky-800 border-sky-300 hover:bg-sky-100"
          >
            Åpne Karakterutvikling i Faginnsikt
          </button>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          * Finn i VIS under <span className="font-medium">Kommunikasjon &rarr; Varselbrev</span>. La siden laste helt inn før du trykker på nedtrekksmeny for <span className="font-medium">Antall per side</span> og velger <span className="font-medium">Alle</span>. Trykk tannhjulet og vis alle kolonner unntatt &laquo;Nedlasting&raquo;. Kopier radene uten headere og lim inn i Excel.{' '}
          <button
            type="button"
            onClick={downloadWarningTemplate}
            className="text-sky-600 hover:underline font-medium"
          >
            Mal kan lastes ned her
          </button>.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          I VIS må rekkefølgen være: <span className="font-medium">Type varsel, Elevnavn, Fødselsdato, Klasse, Fagkode, Faggruppe, Fraværsprosent, Kontaktansvarlig lærer, Avsenders navn, Sendt dato</span>.
        </p>
      </div>
    </div>
  )
}
