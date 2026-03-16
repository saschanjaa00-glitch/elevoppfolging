export const parseFlexibleDate = (value: string): Date | null => {
  const input = (value ?? '').trim()
  if (!input) return null

  const dmy = input.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T].*)?$/)
  if (dmy) {
    const day = parseInt(dmy[1], 10)
    const month = parseInt(dmy[2], 10)
    const year = parseInt(dmy[3], 10)
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
    return null
  }

  const ymd = input.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T].*)?$/)
  if (ymd) {
    const year = parseInt(ymd[1], 10)
    const month = parseInt(ymd[2], 10)
    const day = parseInt(ymd[3], 10)
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
    return null
  }

  const parsed = new Date(input)
  return isNaN(parsed.getTime()) ? null : parsed
}

export const formatDateDdMmYyyy = (value: string): string => {
  const parsed = parseFlexibleDate(value)
  if (!parsed) return (value ?? '').trim()
  const day = String(parsed.getDate()).padStart(2, '0')
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const year = parsed.getFullYear()
  return `${day}.${month}.${year}`
}

export const compareDateStrings = (a: string, b: string): number => {
  const aParsed = parseFlexibleDate(a)
  const bParsed = parseFlexibleDate(b)
  if (!aParsed && !bParsed) return a.localeCompare(b, 'nb-NO')
  if (!aParsed) return 1
  if (!bParsed) return -1
  return aParsed.getTime() - bParsed.getTime()
}

export const warningDateColorClass = (value: string): string => {
  const parsed = parseFlexibleDate(value)
  if (!parsed) return ''

  const day = parsed.getDate()
  const month = parsed.getMonth() + 1
  if ((month >= 8 && month <= 12) || (month === 1 && day < 15)) return 'text-blue-600 font-semibold'
  if (month >= 1 && month <= 4) return 'text-green-600 font-semibold'
  if (month >= 5 && month <= 6) return 'text-orange-500 font-semibold'
  return ''
}

export const todayDdMmYyyy = (): string => {
  const now = new Date()
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const year = now.getFullYear()
  return `${day}.${month}.${year}`
}
