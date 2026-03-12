const TOPPIDRETT_SUBJECTS = new Set(['toppidrett 1', 'toppidrett 2', 'toppidrett 3'])

export function resolveTeacher(subjectName: string, teacher: string): string {
  return TOPPIDRETT_SUBJECTS.has(subjectName.toLowerCase().trim()) ? 'Avhenger av idrett' : teacher
}
