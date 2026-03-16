import { memo, useMemo } from 'react'
import type { DataStore } from '../types'

interface ClassSelectorProps {
  data: DataStore
  selectedClasses: string[]
  onClassChange: (classNames: string[]) => void
  onPrintClassLists?: () => void
  onExportOppfolgingsark?: () => void
}

function ClassSelector({
  data,
  selectedClasses,
  onClassChange,
  onPrintClassLists,
  onExportOppfolgingsark,
}: ClassSelectorProps) {
  const classes = useMemo(
    () => Array.from(new Set(data.absences.map(a => a.class))).sort(),
    [data.absences]
  )

  const { vg1, vg2, vg3, other } = useMemo(() => {
    const nextVg1 = classes.filter(c => /^1/i.test(c))
    const nextVg2 = classes.filter(c => /^2/i.test(c))
    const nextVg3 = classes.filter(c => /^3/i.test(c))
    const nextOther = classes.filter(c => !/^[123]/i.test(c))
    return { vg1: nextVg1, vg2: nextVg2, vg3: nextVg3, other: nextOther }
  }, [classes])

  const toggleClass = (className: string) => {
    if (selectedClasses.includes(className)) {
      onClassChange(selectedClasses.filter(cls => cls !== className))
    } else {
      onClassChange([...selectedClasses, className])
    }
  }

  const toggleGroup = (group: string[]) => {
    const allSelected = group.every(c => selectedClasses.includes(c))
    if (allSelected) {
      onClassChange(selectedClasses.filter(c => !group.includes(c)))
    } else {
      const toAdd = group.filter(c => !selectedClasses.includes(c))
      onClassChange([...selectedClasses, ...toAdd])
    }
  }

  const columns = [
    { label: 'Vg1', classes: vg1 },
    { label: 'Vg2', classes: vg2 },
    { label: 'Vg3', classes: vg3 },
    ...(other.length > 0 ? [{ label: 'Andre', classes: other }] : []),
  ]

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Klasser</h3>
        <span className="text-xs text-slate-500">{selectedClasses.length} valgt</span>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => onClassChange(classes)}
          className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
        >
          Velg alle
        </button>
        <button
          type="button"
          onClick={() => onClassChange([])}
          className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
        >
          Tøm
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {columns.map(({ label, classes: group }) => (
          <div key={label}>
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className={`w-full mb-2 px-2 py-1 text-xs font-bold rounded transition-colors ${
                group.length > 0 && group.every(c => selectedClasses.includes(c))
                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {label}
            </button>
            <div className="flex flex-col gap-1">
              {group.map(cls => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => toggleClass(cls)}
                  className={`w-full px-2 py-1.5 rounded text-sm font-medium text-left border transition-colors ${
                    selectedClasses.includes(cls)
                      ? 'bg-sky-500 text-white hover:bg-sky-600 border-sky-500'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {(onPrintClassLists || onExportOppfolgingsark) && (
        <div className="mt-4 space-y-2">
          {onPrintClassLists && (
            <button
              type="button"
              onClick={onPrintClassLists}
              disabled={selectedClasses.length === 0}
              className={`w-full px-3 py-2 text-sm font-medium rounded transition-colors ${
                selectedClasses.length > 0
                  ? 'bg-slate-800 text-white hover:bg-slate-700'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              Skriv ut klasselister
            </button>
          )}
          {onExportOppfolgingsark && (
            <button
              type="button"
              onClick={onExportOppfolgingsark}
              disabled={selectedClasses.length === 0}
              className={`w-full px-3 py-2 text-sm font-medium rounded transition-colors ${
                selectedClasses.length > 0
                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              Oppfølgingsark for valgte klasser
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(ClassSelector)
