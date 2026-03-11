import type { DataStore } from '../types'

interface ClassSelectorProps {
  data: DataStore
  selectedClasses: string[]
  onClassChange: (classNames: string[]) => void
}

export default function ClassSelector({
  data,
  selectedClasses,
  onClassChange,
}: ClassSelectorProps) {
  const classes = Array.from(new Set(data.absences.map(a => a.class))).sort()

  const vg1 = classes.filter(c => /^1/i.test(c))
  const vg2 = classes.filter(c => /^2/i.test(c))
  const vg3 = classes.filter(c => /^3/i.test(c))
  const other = classes.filter(c => !/^[123]/i.test(c))

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
        <h3 className="text-sm font-semibold text-slate-900">Classes</h3>
        <span className="text-xs text-slate-500">{selectedClasses.length} selected</span>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => onClassChange(classes)}
          className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={() => onClassChange([])}
          className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
        >
          Clear
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
                  className={`px-2 py-1.5 rounded text-sm font-medium text-left transition-colors ${
                    selectedClasses.includes(cls)
                      ? 'bg-sky-500 text-white hover:bg-sky-600'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
