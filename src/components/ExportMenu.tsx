import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import type { PresetRecord } from '../types'
import { isAdviserRole } from '../teacherMatrixPrint'
import type { StudentListExportHandle } from './StudentList'

interface ExportMenuProps {
  selectedClassCount: number
  // Number of students in the filtered list; null when the list isn't shown (no classes selected).
  visibleStudentCount: number | null
  missingWarningsOnly: boolean
  presets: PresetRecord[]
  getListActions: () => StudentListExportHandle | null
  onPrintClassLists: () => void
  onPrintGruppeliste: () => void
  onExportClassOppfolgingsark: () => void
  onExportKlasseradsskjema: () => void
  onPrintLaererliste: (minStudents: number | null, maxMeetings: number | null) => void
}

type ExportFormat = 'PDF' | 'Word' | 'Excel' | 'Utskrift'

const FORMAT_ICON: Record<ExportFormat, ReactNode> = {
  PDF: <Printer className="w-4 h-4 shrink-0" />,
  Word: <FileText className="w-4 h-4 shrink-0" />,
  Excel: <FileSpreadsheet className="w-4 h-4 shrink-0" />,
  Utskrift: <Printer className="w-4 h-4 shrink-0" />,
}

function ExportButton({ label, format, onClick, disabled, title, expanded }: {
  label: string
  format: ExportFormat
  onClick: () => void
  disabled?: boolean
  title?: string
  expanded?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-expanded={expanded}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left rounded-lg border transition-colors bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed"
    >
      {FORMAT_ICON[format]}
      <span className="flex-1">{label}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">{format}</span>
    </button>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</h4>
        <p className="text-[11px] text-slate-400">{hint}</p>
      </div>
      {children}
    </div>
  )
}

// All export and print actions for the Elever tab, grouped by what they export.
export default function ExportMenu({
  selectedClassCount,
  visibleStudentCount,
  missingWarningsOnly,
  presets,
  getListActions,
  onPrintClassLists,
  onPrintGruppeliste,
  onExportClassOppfolgingsark,
  onExportKlasseradsskjema,
  onPrintLaererliste,
}: ExportMenuProps) {
  const [showLaererlisteOptions, setShowLaererlisteOptions] = useState(false)
  const [minStudentsInput, setMinStudentsInput] = useState('')
  const [maxMeetingsInput, setMaxMeetingsInput] = useState('')

  const presetWarning = useMemo(() => {
    if (presets.length === 0) {
      return 'Ingen preset-fil er lastet opp. Tidsplanen for klasselærerråd mangler da rådgivere (rom) og trinnledere/avdelingsledere.'
    }
    if (!presets.some(preset => isAdviserRole(preset.rolle))) {
      return 'Preset-filen inneholder ingen rådgivere (rolle «Rådgiver»). Tidsplanen kan ikke knytte klassene til faste rom.'
    }
    return null
  }, [presets])

  const startLaererliste = () => {
    const parsedMinStudents = Number.parseInt(minStudentsInput, 10)
    const minStudents = Number.isFinite(parsedMinStudents) && parsedMinStudents > 0 ? parsedMinStudents : null
    const parsedMaxMeetings = Number.parseInt(maxMeetingsInput, 10)
    const maxMeetings = Number.isFinite(parsedMaxMeetings) && parsedMaxMeetings > 0 ? parsedMaxMeetings : null
    setShowLaererlisteOptions(false)
    onPrintLaererliste(minStudents, maxMeetings)
  }

  const noClasses = selectedClassCount === 0
  const listShown = visibleStudentCount !== null
  const listEmpty = !listShown || visibleStudentCount === 0
  const listHint = listShown
    ? `Elevene som vises i listen (${visibleStudentCount})`
    : 'Velg klasser for å vise elevlisten'
  const listTitle = listShown && visibleStudentCount === 0 ? 'Ingen elever i listen med valgte filtre' : undefined
  const classTitle = noClasses ? 'Velg minst én klasse' : undefined

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-slate-900">Eksport og utskrift</h3>

      <Section title="Elevlisten" hint={listHint}>
        <ExportButton label="Samlet oversikt" format="PDF" disabled={listEmpty}
          title={listTitle ?? 'Én samlet fil, eller én fil per person i Rolle-filteret'}
          onClick={() => getListActions()?.openSamletOversikt()} />
        <ExportButton label="Side per elev" format="PDF" disabled={listEmpty} title={listTitle}
          onClick={() => getListActions()?.exportPdf('per-student')} />
        <ExportButton label="Oppfølgingsark" format="Word" disabled={listEmpty} title={listTitle}
          onClick={() => getListActions()?.exportOppfolgingsark()} />
        <ExportButton label="Excelliste" format="Excel" disabled={listEmpty} title={listTitle}
          onClick={() => getListActions()?.exportExcelliste()} />
        <ExportButton label="Oppfølgingsoversikt" format="Excel" disabled={!listShown}
          title={listShown ? 'Fylt med elevene i listen, eller som tom mal' : 'Velg klasser for å vise elevlisten'}
          onClick={() => getListActions()?.openOppfolgingsoversikt()} />
        {missingWarningsOnly && (
          <>
            <ExportButton label="Manglende varsler – detaljert" format="Word" disabled={listEmpty} title={listTitle}
              onClick={() => getListActions()?.exportMissingWarnings('detailed')} />
            <ExportButton label="Manglende varsler – oppsummert" format="Word" disabled={listEmpty} title={listTitle}
              onClick={() => getListActions()?.exportMissingWarnings('summary')} />
          </>
        )}
      </Section>

      <Section title="Valgte klasser" hint="Alle elever i valgte klasser, uavhengig av filtre">
        <ExportButton label="Oppfølgingsark" format="Word" disabled={noClasses} title={classTitle}
          onClick={onExportClassOppfolgingsark} />
        <ExportButton label="Klasselister" format="Word" disabled={noClasses} title={classTitle}
          onClick={onPrintClassLists} />
        <ExportButton label="Gruppeliste" format="Word" onClick={onPrintGruppeliste}
          title="Velg en faggruppe fra alle klasser" />
      </Section>

      <Section title="Klasselærerråd" hint="For valgte klasser">
        <ExportButton label="Klasselærerråd-skjema" format="Word" disabled={noClasses} title={classTitle}
          onClick={onExportKlasseradsskjema} />
        <div>
          <ExportButton label="Lærerliste" format="Utskrift" disabled={noClasses} title={classTitle}
            expanded={showLaererlisteOptions}
            onClick={() => setShowLaererlisteOptions(prev => !prev)} />
          {showLaererlisteOptions && !noClasses && (
            <div className="mt-2 p-3 rounded-lg border border-sky-200 bg-sky-50 space-y-2">
              {presetWarning && (
                <div role="alert" className="flex gap-2 p-2 rounded-md border border-amber-300 bg-amber-50 text-[11px] leading-snug text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <span>{presetWarning}</span>
                </div>
              )}
              <label htmlFor="min-students" className="block text-xs font-semibold text-slate-700">
                Minimum antall elever
              </label>
              <input
                id="min-students"
                type="number"
                min={1}
                value={minStudentsInput}
                placeholder="Ingen filter"
                onChange={event => setMinStudentsInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') startLaererliste()
                }}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 bg-white"
              />
              <p className="text-[11px] leading-snug text-slate-600">
                Lærere med færre elever enn dette slipper møtet. Kontaktlærere deltar alltid. Tomt felt = ingen filter.
              </p>
              <label htmlFor="max-meetings" className="block text-xs font-semibold text-slate-700">
                Maksimum antall møter
              </label>
              <input
                id="max-meetings"
                type="number"
                min={1}
                value={maxMeetingsInput}
                placeholder="Ingen grense"
                onChange={event => setMaxMeetingsInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') startLaererliste()
                }}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 bg-white"
              />
              <p className="text-[11px] leading-snug text-slate-600">
                Ved for mange møter beholdes klassene med flest elever. Ved likt elevtall prioriteres klassen alfabetisk. Kontaktlærermøter beholdes alltid.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={startLaererliste}
                  className="flex-1 px-2 py-1.5 text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 rounded-lg transition-colors"
                >
                  Åpne
                </button>
                <button
                  type="button"
                  onClick={() => setShowLaererlisteOptions(false)}
                  className="flex-1 px-2 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  Avbryt
                </button>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
