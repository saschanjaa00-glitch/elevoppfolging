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

  const toggleClass = (className: string) => {
    if (selectedClasses.includes(className)) {
      onClassChange(selectedClasses.filter(cls => cls !== className))
      return
    }
    onClassChange([...selectedClasses, className])
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Classes</h3>
        <span className="text-xs text-slate-500">{selectedClasses.length} selected</span>
      </div>

      <div className="flex gap-2 mb-3">
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

      <div className="space-y-2 max-h-[440px] overflow-auto pr-1">
        {classes.map(cls => (
          <label
            key={cls}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedClasses.includes(cls)}
              onChange={() => toggleClass(cls)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span className="text-sm text-slate-800">{cls}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
