import type { AbsenceRecord } from './types'
import { normalizeMatch } from './studentInfoUtils'
import { todayDdMmYyyy } from './dateUtils'

export interface TeacherMatrixSection {
  className: string
  students: string[]
  teachers: Array<{ name: string; studentKeys: Set<string> }>
}

const PAGE_CONTENT_WIDTH_MM = 275
const TEACHER_COLUMN_MM = 42
const HEADER_HEIGHT_MM = 30
const MAX_COLUMN_MM = 7.5
const MIN_COLUMN_MM = 4.5
const FEW_STUDENTS_LIMIT = 5
const MAX_CLASS_RANK = 10

export interface TeacherClassRankOverview {
  classes: string[]
  teachers: Array<{ name: string; ranks: Map<string, number> }>
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildTeacherMatrixSections(
  absences: AbsenceRecord[],
  classNames: string[]
): TeacherMatrixSection[] {
  const orderedClasses = [...classNames].sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }))

  return orderedClasses
    .map(className => {
      const classRecords = absences.filter(record => record.class === className)

      const studentNames = new Map<string, string>()
      classRecords.forEach(record => {
        const navn = record.navn?.trim()
        if (!navn) return
        const key = normalizeMatch(navn)
        if (!studentNames.has(key)) studentNames.set(key, navn)
      })

      const teacherMap = new Map<string, { name: string; studentKeys: Set<string> }>()
      classRecords.forEach(record => {
        const teacher = record.teacher?.trim()
        const navn = record.navn?.trim()
        if (!teacher || !navn) return
        const teacherKey = normalizeMatch(teacher)
        let entry = teacherMap.get(teacherKey)
        if (!entry) {
          entry = { name: teacher, studentKeys: new Set<string>() }
          teacherMap.set(teacherKey, entry)
        }
        entry.studentKeys.add(normalizeMatch(navn))
      })

      const students = Array.from(studentNames.values()).sort((a, b) => a.localeCompare(b, 'nb', { sensitivity: 'base' }))

      const teachers = Array.from(teacherMap.values())
        .filter(teacher => teacher.studentKeys.size > 0)
        .sort((a, b) => {
          if (b.studentKeys.size !== a.studentKeys.size) return b.studentKeys.size - a.studentKeys.size
          return a.name.localeCompare(b.name, 'nb', { sensitivity: 'base' })
        })

      return { className, students, teachers }
    })
    .filter(section => section.students.length > 0 && section.teachers.length > 0)
}

export function buildTeacherClassRankOverview(
  absences: AbsenceRecord[],
  sections: TeacherMatrixSection[]
): TeacherClassRankOverview | null {
  const relevantTeachers = new Map<string, string>()
  sections.forEach(section => {
    section.teachers.forEach(teacher => {
      const key = normalizeMatch(teacher.name)
      if (!relevantTeachers.has(key)) relevantTeachers.set(key, teacher.name)
    })
  })
  if (relevantTeachers.size === 0) return null

  const studentsByTeacherClass = new Map<string, Map<string, Set<string>>>()
  absences.forEach(record => {
    const teacher = record.teacher?.trim()
    const navn = record.navn?.trim()
    const className = record.class?.trim()
    if (!teacher || !navn || !className) return
    const teacherKey = normalizeMatch(teacher)
    if (!relevantTeachers.has(teacherKey)) return
    let classMap = studentsByTeacherClass.get(teacherKey)
    if (!classMap) {
      classMap = new Map<string, Set<string>>()
      studentsByTeacherClass.set(teacherKey, classMap)
    }
    let studentSet = classMap.get(className)
    if (!studentSet) {
      studentSet = new Set<string>()
      classMap.set(className, studentSet)
    }
    studentSet.add(normalizeMatch(navn))
  })

  const usedClasses = new Set<string>()
  const teachers = Array.from(relevantTeachers.entries())
    .map(([teacherKey, name]) => {
      const classMap = studentsByTeacherClass.get(teacherKey) ?? new Map<string, Set<string>>()
      const ranked = Array.from(classMap.entries())
        .filter(([, studentSet]) => studentSet.size > 0)
        .sort((a, b) => {
          if (b[1].size !== a[1].size) return b[1].size - a[1].size
          return a[0].localeCompare(b[0], 'nb', { numeric: true })
        })
        .slice(0, MAX_CLASS_RANK)

      const ranks = new Map<string, number>()
      ranked.forEach(([className], index) => {
        ranks.set(className, index + 1)
        usedClasses.add(className)
      })

      return { name, ranks }
    })
    .filter(teacher => teacher.ranks.size > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb', { sensitivity: 'base' }))

  if (teachers.length === 0) return null

  const classes = Array.from(usedClasses).sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }))
  return { classes, teachers }
}

function buildRankOverviewHtml(overview: TeacherClassRankOverview): string {
  const columnCount = overview.classes.length
  const available = PAGE_CONTENT_WIDTH_MM - TEACHER_COLUMN_MM - HEADER_HEIGHT_MM
  const columnMm = Math.max(MIN_COLUMN_MM, Math.min(MAX_COLUMN_MM, available / Math.max(columnCount, 1)))

  const headerCells = overview.classes
    .map(className => `<th class="slant"><div><span>${escapeHtml(className)}</span></div></th>`)
    .join('')

  const bodyRows = overview.teachers
    .map(teacher => {
      const cells = overview.classes
        .map(className => {
          const rank = teacher.ranks.get(className)
          return `<td class="mark">${rank ?? ''}</td>`
        })
        .join('')
      return `<tr><th class="teacher" scope="row">${escapeHtml(teacher.name)}</th>${cells}<td class="spacer"></td></tr>`
    })
    .join('')

  return `
    <section class="sheet page-break">
      <h2>Lærernes klassefordeling</h2>
      <p class="meta">1 = klassen læreren har flest elever i, opp til ${MAX_CLASS_RANK}. Tom celle = ingen elever.</p>
      <table style="--col-width: ${columnMm.toFixed(2)}mm">
        <thead>
          <tr>
            <th class="teacher corner"></th>
            ${headerCells}
            <th class="spacer"></th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </section>
  `
}

function buildSectionHtml(section: TeacherMatrixSection, isFirst: boolean): string {
  const columnCount = section.students.length
  const available = PAGE_CONTENT_WIDTH_MM - TEACHER_COLUMN_MM - HEADER_HEIGHT_MM
  const columnMm = Math.max(MIN_COLUMN_MM, Math.min(MAX_COLUMN_MM, available / Math.max(columnCount, 1)))

  const headerCells = section.students
    .map(
      student =>
        `<th class="slant"><div><span>${escapeHtml(student)}</span></div></th>`
    )
    .join('')

  const bodyRows = section.teachers
    .map(teacher => {
      const studentCount = teacher.studentKeys.size
      const rowStyle = studentCount <= FEW_STUDENTS_LIMIT ? ' style="background-color: #f1f1f1;"' : ''
      const cells = section.students
        .map(student => {
          const teaches = teacher.studentKeys.has(normalizeMatch(student))
          return `<td class="mark"${rowStyle}>${teaches ? '✓' : ''}</td>`
        })
        .join('')
      const rowClass = studentCount <= FEW_STUDENTS_LIMIT ? ' class="few"' : ''
      return `<tr${rowClass}><th class="teacher" scope="row"${rowStyle}>${escapeHtml(teacher.name)} (${studentCount})</th>${cells}<td class="spacer"${rowStyle}></td></tr>`
    })
    .join('')

  return `
    <section class="sheet${isFirst ? '' : ' page-break'}">
      <h2>Lærerliste klasselærerråd – ${escapeHtml(section.className)}</h2>
      <p class="meta">${section.teachers.length} lærere · ${columnCount} elever · ${escapeHtml(todayDdMmYyyy())}</p>
      <table style="--col-width: ${columnMm.toFixed(2)}mm">
        <thead>
          <tr>
            <th class="teacher corner"></th>
            ${headerCells}
            <th class="spacer"></th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </section>
  `
}

export function buildTeacherMatrixHtml(
  sections: TeacherMatrixSection[],
  rankOverview: TeacherClassRankOverview | null = null
): string {
  const title = 'Lærerliste klasselærerråd'
  const body =
    sections.map((section, index) => buildSectionHtml(section, index === 0)).join('') +
    (rankOverview ? buildRankOverviewHtml(rankOverview) : '')

  return `<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<title>${title} – ${escapeHtml(todayDdMmYyyy())}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 10mm;
    background: #fff;
    color: #000;
    font-family: Calibri, Arial, sans-serif;
  }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  h2 { font-size: 12pt; margin: 0 0 1mm; }
  .doc-meta { font-size: 9pt; margin: 0 0 6mm; }
  .meta { font-size: 8.5pt; margin: 0 0 2mm; }
  .sheet { padding-top: 8mm; }
  .page-break { break-before: page; page-break-before: always; }
  table {
    border-collapse: collapse;
    table-layout: fixed;
    margin-top: 6mm;
  }
  th, td { border: 1px solid #000; font-size: 8pt; }
  th.teacher {
    width: ${TEACHER_COLUMN_MM}mm;
    text-align: left;
    font-weight: normal;
    padding: 0.8mm 1.5mm;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  th.corner { border: none; }
  td.mark {
    width: var(--col-width);
    height: 5.5mm;
    text-align: center;
    vertical-align: middle;
    font-size: 9pt;
  }
  th.spacer, td.spacer { width: ${HEADER_HEIGHT_MM}mm; border: none; }
  th.slant {
    width: var(--col-width);
    height: ${HEADER_HEIGHT_MM}mm;
    padding: 0;
    border: none;
    vertical-align: bottom;
  }
  th.slant > div {
    position: relative;
    width: var(--col-width);
    height: ${HEADER_HEIGHT_MM}mm;
    transform-origin: bottom left;
    transform: skewX(-45deg);
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    border-top: 1px solid #000;
  }
  /* skewX(45deg) cancels the parent skew so the text sits at a true 45 degrees */
  th.slant > div > span {
    position: absolute;
    bottom: 0;
    left: 0;
    display: block;
    transform-origin: bottom left;
    transform: skewX(45deg) rotate(-45deg) translate(3.5mm, 3mm);
    white-space: nowrap;
    max-width: ${(HEADER_HEIGHT_MM * 1.414 - 3).toFixed(1)}mm;
    overflow: hidden;
    text-overflow: ellipsis;
    background: #fff;
    padding: 0 0.8mm;
    font-weight: 600;
    font-size: 7.5pt;
    line-height: 1;
  }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tbody tr.few th.teacher, tbody tr.few td.mark {
    background: #f1f1f1;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .no-print { margin-bottom: 6mm; }
  .no-print button {
    font: inherit;
    padding: 2mm 4mm;
    border: 1px solid #000;
    background: #fff;
    cursor: pointer;
  }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="no-print"><button type="button" onclick="window.print()">Skriv ut / lagre som PDF</button></div>
  <h1>${title}</h1>
  <p class="doc-meta">Dato: ${escapeHtml(todayDdMmYyyy())}</p>
  ${body}
</body>
</html>`
}

export function printTeacherMatrix(absences: AbsenceRecord[], classNames: string[]): boolean {
  const sections = buildTeacherMatrixSections(absences, classNames)
  if (sections.length === 0) return false

  const rankOverview = buildTeacherClassRankOverview(absences, sections)

  const printWindow = window.open('', '_blank')
  if (!printWindow) return false

  printWindow.document.open()
  printWindow.document.write(buildTeacherMatrixHtml(sections, rankOverview))
  printWindow.document.close()
  printWindow.focus()
  printWindow.setTimeout(() => {
    void printWindow.document.fonts.ready.then(() => {
      printWindow.requestAnimationFrame(() => {
        printWindow.requestAnimationFrame(() => printWindow.print())
      })
    })
  }, 500)
  return true
}
