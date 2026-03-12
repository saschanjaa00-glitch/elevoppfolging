const TOPPIDRETT_CLASSES = new Set(['1TID', '2TID', '3TID'])

export function resolveTeacher(className: string, teacher: string): string {
  return TOPPIDRETT_CLASSES.has(className) ? 'Avhenger av idrett' : teacher
}
