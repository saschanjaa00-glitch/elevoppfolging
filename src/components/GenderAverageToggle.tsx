import { useId } from 'react'
import type { StudentGender } from '../types'
import { describeGenderCoverage, type GenderCoverage } from '../studentInfoUtils'

const GENDER_ORDER: StudentGender[] = ['girl', 'boy']
const GENDER_LABEL: Record<StudentGender, string> = {
  girl: 'Jenter',
  boy: 'Gutter',
}

interface Props {
  visible: Record<StudentGender, boolean>
  onToggle: (gender: StudentGender) => void
  coverage: GenderCoverage
  className?: string
}

// "Kjønnssnitt: Jenter / Gutter". Greyed out when no pupil has a valid fødselsnummer;
// hovering (or focusing) says what is missing. The buttons stay focusable so keyboard
// and screen-reader users get the same explanation.
export default function GenderAverageToggle({ visible, onToggle, coverage, className = '' }: Props) {
  const { available, message } = describeGenderCoverage(coverage)
  const messageId = useId()
  return (
    <div
      role="group"
      aria-label="Kjønnssnitt"
      title={message}
      className={`flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 ${available ? '' : 'cursor-not-allowed'} ${className}`}
    >
      <span className={`px-2 text-xs font-medium ${available ? 'text-slate-500' : 'text-slate-400'}`}>Kjønnssnitt</span>
      {GENDER_ORDER.map(gender => (
        <button
          key={gender}
          type="button"
          aria-pressed={available ? visible[gender] : false}
          aria-disabled={!available}
          aria-describedby={messageId}
          onClick={() => { if (available) onToggle(gender) }}
          className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
            !available
              ? 'cursor-not-allowed text-slate-300'
              : visible[gender]
                ? 'bg-sky-100 text-sky-800'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          {GENDER_LABEL[gender]}
        </button>
      ))}
      <span id={messageId} className="sr-only">{message}</span>
    </div>
  )
}
