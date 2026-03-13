export const DEFAULT_MAX_CELL_CHARS = 10000

export function normalizeCellText(value: unknown, maxChars = DEFAULT_MAX_CELL_CHARS): string {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxChars)
}

export function sanitizeCsvCell(value: unknown): string {
  const text = String(value ?? '').replace(/\u0000/g, '')
  const trimmedStart = text.trimStart()
  if (/^[=+\-@]/.test(trimmedStart)) {
    return `'${text}`
  }
  return text
}
