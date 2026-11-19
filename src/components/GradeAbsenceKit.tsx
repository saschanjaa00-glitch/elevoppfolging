import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import type { StudentGender } from '../types'
import {
  CAP_OPTIONS,
  CHART_WIDTH,
  FRAVAER_TYPE_INFO,
  FRAVAER_TYPES,
  GENDER_LABEL,
  MARGIN,
  PLOT_RIGHT,
  PLOT_WIDTH,
  STEP_OPTIONS,
  fmtPct,
} from '../gradeAbsenceUtils'
import type { GradeAbsenceData, XScale } from '../gradeAbsenceUtils'

// UI building blocks shared by the "… vs. fravær" subtabs under Statistikk.

export function ToggleButton({ active, disabled, title, onClick, children }: {
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
        disabled
          ? 'text-slate-300 cursor-not-allowed'
          : active
            ? 'bg-sky-600 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">{label}</span>
      {children}
    </div>
  )
}

export function SummaryCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" title={hint}>
      <p className="text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wide">{label}</p>
      <div className="text-xl font-bold leading-tight text-slate-900">{value}</div>
    </div>
  )
}

export function SideGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

export function ChartCard({ title, subtitle, controls, legend, footer, children }: {
  title: string
  subtitle?: string
  controls?: ReactNode
  legend?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {controls}
      </div>
      {children}
      {legend && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-xs text-slate-600">{legend}</div>}
      {footer}
    </div>
  )
}

export function ChartSvg({ height, label, children }: { height: number; label: string; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${height}`} className="w-full min-w-[640px] h-auto select-none" role="img" aria-label={label}>
        {children}
      </svg>
    </div>
  )
}

// Overflow-band background, vertical interval lines and fravær labels; drawn first so data sits on top.
export function XAxisBackground({ scale, yTop, yBottom }: { scale: XScale; yTop: number; yBottom: number }) {
  return (
    <g>
      {scale.overflow && (
        <rect x={scale.lin(scale.cap)} y={yTop} width={scale.lin(scale.span) - scale.lin(scale.cap)} height={yBottom - yTop} fill="#f8fafc" />
      )}
      {scale.boundaries.map((value, index) => (
        <g key={value}>
          <line x1={scale.lin(value)} x2={scale.lin(value)} y1={yTop} y2={yBottom} stroke="#e2e8f0" strokeWidth={1} />
          {(index % scale.labelEvery === 0 || index === scale.boundaries.length - 1) && (
            <text x={scale.lin(value)} y={yBottom + 14} textAnchor="middle" fontSize={10} fill="#64748b">{scale.formatTick(value)}</text>
          )}
        </g>
      ))}
      {scale.overflow && (
        <text x={scale.lin(scale.cap + scale.step / 2)} y={yBottom + 14} textAnchor="middle" fontSize={10} fill="#64748b">
          ≥{scale.formatTick(scale.cap)}
        </text>
      )}
      <text x={MARGIN.left + PLOT_WIDTH / 2} y={yBottom + 32} textAnchor="middle" fontSize={11} fill="#475569">
        {scale.title}
      </text>
    </g>
  )
}

export function AxisFrame({ yTop, yBottom, yTitle }: { yTop: number; yBottom: number; yTitle: string }) {
  const mid = (yTop + yBottom) / 2
  return (
    <g pointerEvents="none">
      <line x1={MARGIN.left} x2={MARGIN.left} y1={yTop} y2={yBottom} stroke="#94a3b8" />
      <line x1={MARGIN.left} x2={PLOT_RIGHT} y1={yBottom} y2={yBottom} stroke="#94a3b8" />
      <text x={14} y={mid} transform={`rotate(-90 14 ${mid})`} textAnchor="middle" fontSize={11} fill="#475569">{yTitle}</text>
    </g>
  )
}

// Side menu with Termin, Trinn, Kjønn, Klasser and the axis settings (Intervall and Samle over unless `axisControls` replaces them).
export function GradeAbsenceFilterSidebar({ state, axisControls }: { state: GradeAbsenceData; axisControls?: ReactNode }) {
  const {
    filtersActive, resetFilters, term, setTerm, hasT1, hasT2,
    levelFilter, setLevelFilter, levelOptions, genderFilter, setGenderFilter, hasGenderData,
    classOptions, activeClasses, toggleClass, clearClasses, step, setStep, cap, setCap,
  } = state
  return (
    <aside className="w-full lg:w-60 shrink-0 lg:sticky lg:top-4 bg-white rounded-lg shadow-sm border border-slate-100 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Filtre</h2>
        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md"
          >
            <RotateCcw className="w-3 h-3" />
            Nullstill
          </button>
        )}
      </div>
      <SideGroup label="Termin">
        <ToggleButton active={term === '1'} disabled={!hasT1} onClick={() => setTerm('1')}>T1</ToggleButton>
        <ToggleButton active={term === '2'} disabled={!hasT2} onClick={() => setTerm('2')}>T2</ToggleButton>
      </SideGroup>
      <SideGroup label="Trinn">
        <ToggleButton active={levelFilter === null} onClick={() => setLevelFilter(null)}>Alle</ToggleButton>
        {levelOptions.map(level => (
          <ToggleButton key={level} active={levelFilter === level} onClick={() => setLevelFilter(level)}>
            VG{level}
          </ToggleButton>
        ))}
      </SideGroup>
      <SideGroup label="Kjønn">
        <ToggleButton active={genderFilter === 'all'} onClick={() => setGenderFilter('all')}>Alle</ToggleButton>
        {(['girl', 'boy'] as StudentGender[]).map(gender => (
          <ToggleButton
            key={gender}
            active={genderFilter === gender}
            disabled={!hasGenderData}
            title={hasGenderData ? undefined : 'Krever elevfil med gyldige fødselsnumre'}
            onClick={() => setGenderFilter(gender)}
          >
            {GENDER_LABEL[gender]}
          </ToggleButton>
        ))}
      </SideGroup>
      <SideGroup label="Klasser">
        <button
          type="button"
          onClick={clearClasses}
          aria-pressed={activeClasses.length === 0}
          className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
            activeClasses.length === 0
              ? 'bg-sky-600 text-white border-sky-600'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          Alle
        </button>
        {classOptions.map(className => {
          const active = activeClasses.includes(className)
          return (
            <button
              key={className}
              type="button"
              onClick={() => toggleClass(className)}
              aria-pressed={active}
              className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                active
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {className}
            </button>
          )
        })}
      </SideGroup>
      <div className="space-y-2 border-t border-slate-100 pt-3">
        {axisControls ?? (
          <>
            <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Intervall</span>
              <select
                value={step}
                onChange={e => setStep(Number(e.target.value))}
                className="rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                {STEP_OPTIONS.map(option => (
                  <option key={option} value={option}>{fmtPct(option)} %</option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Samle over</span>
              <select
                value={cap}
                onChange={e => setCap(Number(e.target.value))}
                className="rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                {CAP_OPTIONS.map(option => (
                  <option key={option} value={option}>{option} %</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </aside>
  )
}

// Trendline comparison, fravær types and the D/IV graph filters.
export function GradeAbsenceOptionsBar({ state }: { state: GradeAbsenceData }) {
  const {
    compareBy, setCompareBy, hasGenderData, fravaerAvailable, fravaerTypes, activeTypes, toggleFravaerType,
    missingAnnualHours, useDFilter, setExcludeHighD, maxD, setMaxD, removedByD, excludeIv, setExcludeIv, removedByIv,
  } = state
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <FilterGroup label="Sammenlign trendlinjer">
        <ToggleButton active={compareBy === 'none'} onClick={() => setCompareBy('none')}>Ingen</ToggleButton>
        <ToggleButton
          active={compareBy === 'kjonn'}
          disabled={!hasGenderData}
          title={hasGenderData ? undefined : 'Krever elevfil med gyldige fødselsnumre'}
          onClick={() => setCompareBy('kjonn')}
        >
          Kjønn
        </ToggleButton>
        <ToggleButton active={compareBy === 'trinn'} onClick={() => setCompareBy('trinn')}>Trinn</ToggleButton>
      </FilterGroup>
      <FilterGroup label="Fravær">
        {FRAVAER_TYPES.map(type => {
          const available = fravaerAvailable[type]
          const checked = fravaerTypes[type] && available
          const locked = checked && activeTypes.length === 1
          return (
            <label
              key={type}
              className={`inline-flex items-center gap-1 mr-2 text-sm ${available ? 'text-slate-700' : 'text-slate-300 cursor-not-allowed'}`}
              title={available
                ? `${FRAVAER_TYPE_INFO[type].title}${locked ? '. Minst én type må være valgt.' : ''}`
                : 'Fraværsfilen mangler denne kolonnen.'}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!available}
                onChange={() => toggleFravaerType(type)}
                className="rounded border-slate-300"
              />
              <span className="font-semibold">{FRAVAER_TYPE_INFO[type].label}</span>
            </label>
          )
        })}
      </FilterGroup>
      {missingAnnualHours > 0 && (
        <span className="text-xs text-amber-700">
          {missingAnnualHours} {missingAnnualHours === 1 ? 'karakter' : 'karakterer'} med {activeTypes.filter(t => t !== 'X').join('/')}-fravær mangler årstimer og er ikke med.
        </span>
      )}
      <div
        className={`flex flex-wrap items-center gap-2 text-sm ${fravaerAvailable.D ? 'text-slate-700' : 'text-slate-300 cursor-not-allowed'}`}
        title={fravaerAvailable.D
          ? 'Tar bort elever med høyt dokumentert fravær (snitt av D-timer / årstimer over alle elevens fag) fra grafene og tabellen under den første grafen.'
          : 'Fraværsfilen mangler kolonnen for D-fravær.'}
      >
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={useDFilter}
            disabled={!fravaerAvailable.D}
            onChange={e => setExcludeHighD(e.target.checked)}
            className="rounded border-slate-300"
          />
          Fjern elever med D-fravær over
        </label>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={maxD}
          disabled={!useDFilter}
          onChange={e => setMaxD(Number(e.target.value))}
          aria-label="Grense for D-fravær"
          className="w-36 accent-sky-600 disabled:opacity-40"
        />
        <span className={`w-12 tabular-nums font-semibold ${useDFilter ? 'text-sky-700' : 'text-slate-300'}`}>{fmtPct(maxD)} %</span>
        {useDFilter && (
          <span className="text-xs text-slate-500">
            {removedByD} {removedByD === 1 ? 'elev' : 'elever'} fjernet fra grafene
          </span>
        )}
      </div>
      <div
        className="flex flex-wrap items-center gap-2 text-sm text-slate-700"
        title="Tar bort elever som har IV i minst ett fag denne terminen fra grafene og tabellen under den første grafen."
      >
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={excludeIv}
            onChange={e => setExcludeIv(e.target.checked)}
            className="rounded border-slate-300"
          />
          Fjern elever med IV
        </label>
        {excludeIv && (
          <span className="text-xs text-slate-500">
            {removedByIv} {removedByIv === 1 ? 'elev' : 'elever'} fjernet fra grafene
          </span>
        )}
      </div>
    </div>
  )
}
