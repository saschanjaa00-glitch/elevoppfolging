import type { AbsenceRecord, PresetRecord } from './types'
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

export interface DiscussionAssignment {
  className: string
  adviser: string
  leaders: string[]
  teacherKeys?: string[]
  assignedTeachers?: Array<{
    name: string
    studentCount: number
    isContactTeacher: boolean
    slotStudentCounts: number[]
    placedSlotIndex: number
  }>
}

export interface DiscussionSchedule {
  rooms: Array<{ key: string; adviser: string }>
  slots: Array<{ label: string; assignments: DiscussionAssignment[] }>
  warnings: string[]
  minStudents: number | null
}

export interface TeacherMeetingOverview {
  slotLabels: string[]
  teachers: Array<{
    name: string
    classBySlot: Array<string | null>
    classWithCountBySlot: Array<string | null>
    total: number
  }>
}

export function buildTeacherMeetingOverview(schedule: DiscussionSchedule): TeacherMeetingOverview {
  const slotLabels = schedule.slots.map(slot => slot.label)
  const byTeacher = new Map<
    string,
    { name: string; entriesBySlot: Array<Array<{ className: string; studentCount: number }>> }
  >()

  schedule.slots.forEach((slot, slotIndex) => {
    slot.assignments.forEach(assignment => {
      (assignment.assignedTeachers ?? []).forEach(teacher => {
        const key = normalizeMatch(teacher.name)
        let entry = byTeacher.get(key)
        if (!entry) {
          entry = { name: teacher.name, entriesBySlot: slotLabels.map(() => []) }
          byTeacher.set(key, entry)
        }
        entry.entriesBySlot[slotIndex].push({
          className: assignment.className,
          studentCount: teacher.studentCount,
        })
      })
    })
  })

  const teachers = Array.from(byTeacher.values())
    .map(entry => ({
      name: entry.name,
      classBySlot: entry.entriesBySlot.map(items =>
        items.length ? items.map(item => item.className).join(', ') : null
      ),
      classWithCountBySlot: entry.entriesBySlot.map(items =>
        items.length
          ? items.map(item => `${item.className} (${item.studentCount})`).join(', ')
          : null
      ),
      total: entry.entriesBySlot.filter(items => items.length > 0).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb', { sensitivity: 'base' }))

  return { slotLabels, teachers }
}

interface DiscussionClass extends DiscussionAssignment {
  roomKey: string
  requiredPersonKeys: Set<string>
  teacherWeights: Map<string, number>
  teacherNames: Map<string, string>
  contactTeacherKeys: Set<string>
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

function getPresetOwners(
  presets: PresetRecord[],
  className: string,
  matchesRole: (normalizedRole: string) => boolean
): string[] {
  const classKey = normalizeMatch(className)
  return Array.from(
    new Map(
      presets
        .filter(preset => matchesRole(normalizeMatch(preset.rolle)))
        .filter(preset => preset.klasser.some(presetClass => normalizeMatch(presetClass) === classKey))
        .map(preset => [normalizeMatch(preset.navn), preset.navn.trim()])
    ).values()
  ).sort((a, b) => a.localeCompare(b, 'nb', { sensitivity: 'base' }))
}

function buildDiscussionClasses(
  absences: AbsenceRecord[],
  classNames: string[],
  presets: PresetRecord[],
  minStudents: number | null = null
): { classes: DiscussionClass[]; warnings: string[] } {
  const warnings: string[] = []
  const classes = [...new Set(classNames)]
    .sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }))
    .map(className => {
      const advisers = getPresetOwners(
        presets,
        className,
        role => role === 'radgiver' || role.includes('radgiver')
      )
      const leaders = getPresetOwners(
        presets,
        className,
        role => role.includes('trinnleder') || role.includes('avdelingsleder')
      )

      if (advisers.length === 0) warnings.push(`${className}: mangler rådgiver i preset-filen.`)
      if (advisers.length > 1) {
        warnings.push(`${className}: flere rådgivere funnet (${advisers.join(', ')}); første navn brukes som fast rom.`)
      }
      if (leaders.length === 0) warnings.push(`${className}: mangler trinnleder/avdelingsleder i preset-filen.`)

      const adviser = advisers[0] ?? `Mangler rådgiver – ${className}`
      const roomKey = advisers.length > 0 ? normalizeMatch(adviser) : `mangler-${normalizeMatch(className)}`
      const classRecords = absences.filter(
        record => normalizeMatch(record.class) === normalizeMatch(className)
      )
      const teacherNames = new Map<string, string>()
      const contactTeacherKeys = new Set<string>()
      classRecords.forEach(record => {
        const teacher = record.teacher?.trim()
        if (teacher) {
          const teacherKey = normalizeMatch(teacher)
          if (!teacherNames.has(teacherKey)) teacherNames.set(teacherKey, teacher)
        }
        const contactTeacher = record.kontaktlaerer?.trim()
        if (contactTeacher) {
          const contactTeacherKey = normalizeMatch(contactTeacher)
          contactTeacherKeys.add(contactTeacherKey)
          if (!teacherNames.has(contactTeacherKey)) teacherNames.set(contactTeacherKey, contactTeacher)
        }
      })
      const requiredPersonKeys = new Set([
        ...advisers.map(normalizeMatch),
        ...leaders.map(normalizeMatch),
        ...contactTeacherKeys,
      ])
      if (requiredPersonKeys.size === 0) requiredPersonKeys.add(roomKey)

      const studentsByTeacher = new Map<string, Set<string>>()
      classRecords.forEach(record => {
        const teacher = record.teacher?.trim()
        const student = record.navn?.trim()
        if (!teacher || !student) return
        const teacherKey = normalizeMatch(teacher)
        let students = studentsByTeacher.get(teacherKey)
        if (!students) {
          students = new Set<string>()
          studentsByTeacher.set(teacherKey, students)
        }
        students.add(normalizeMatch(student))
      })

      const keepTeacher = (teacherKey: string, studentCount: number): boolean =>
        contactTeacherKeys.has(teacherKey) || minStudents === null || studentCount >= minStudents

      return {
        className,
        adviser,
        leaders,
        roomKey,
        requiredPersonKeys,
        teacherWeights: new Map(
          Array.from(studentsByTeacher.entries())
            .filter(([teacherKey, students]) => keepTeacher(teacherKey, students.size))
            .map(([teacherKey, students]) => [teacherKey, students.size])
        ),
        teacherNames: new Map(
          Array.from(teacherNames.entries()).filter(([teacherKey]) =>
            keepTeacher(teacherKey, studentsByTeacher.get(teacherKey)?.size ?? 0)
          )
        ),
        contactTeacherKeys,
      }
    })

  return { classes, warnings }
}

function classesConflict(a: DiscussionClass, b: DiscussionClass): boolean {
  if (a.roomKey === b.roomKey) return true
  return Array.from(a.requiredPersonKeys).some(person => b.requiredPersonKeys.has(person))
}

function slotIsValid(classIndexes: number[], classes: DiscussionClass[]): boolean {
  for (let i = 0; i < classIndexes.length; i += 1) {
    for (let j = i + 1; j < classIndexes.length; j += 1) {
      if (classesConflict(classes[classIndexes[i]], classes[classIndexes[j]])) return false
    }
  }
  return true
}

function colorDiscussionClasses(classes: DiscussionClass[]): number[] {
  if (classes.length === 0) return []

  const conflicts = classes.map(() => new Set<number>())
  classes.forEach((current, currentIndex) => {
    classes.forEach((other, otherIndex) => {
      if (otherIndex > currentIndex && classesConflict(current, other)) {
        conflicts[currentIndex].add(otherIndex)
        conflicts[otherIndex].add(currentIndex)
      }
    })
  })

  const resourceLoads = new Map<string, number>()
  classes.forEach(item => {
    new Set([item.roomKey, ...item.requiredPersonKeys]).forEach(resource => {
      resourceLoads.set(resource, (resourceLoads.get(resource) ?? 0) + 1)
    })
  })
  const lowerBound = Math.max(1, ...resourceLoads.values())

  for (let slotCount = lowerBound; slotCount <= classes.length; slotCount += 1) {
    const colors = Array<number>(classes.length).fill(-1)
    const occupancy = Array<number>(slotCount).fill(0)
    let visited = 0

    const assignNext = (assignedCount: number): boolean => {
      visited += 1
      if (visited > 750_000) return false
      if (assignedCount === classes.length) return true

      let selected = -1
      let bestSaturation = -1
      let bestDegree = -1
      classes.forEach((item, index) => {
        if (colors[index] !== -1) return
        const usedNeighborColors = new Set(
          Array.from(conflicts[index])
            .map(neighbor => colors[neighbor])
            .filter(color => color !== -1)
        )
        const degree = conflicts[index].size
        if (
          usedNeighborColors.size > bestSaturation ||
          (usedNeighborColors.size === bestSaturation && degree > bestDegree) ||
          (usedNeighborColors.size === bestSaturation &&
            degree === bestDegree &&
            (selected === -1 || item.className.localeCompare(classes[selected].className, 'nb') < 0))
        ) {
          selected = index
          bestSaturation = usedNeighborColors.size
          bestDegree = degree
        }
      })

      const blockedColors = new Set(Array.from(conflicts[selected]).map(neighbor => colors[neighbor]))
      const maxUsedColor = colors.reduce((max, color) => Math.max(max, color), -1)
      const candidates = Array.from({ length: slotCount }, (_, index) => index)
        .filter(color => !blockedColors.has(color) && color <= maxUsedColor + 1)
        .sort((a, b) => occupancy[a] - occupancy[b] || a - b)

      for (const color of candidates) {
        colors[selected] = color
        occupancy[color] += 1
        if (assignNext(assignedCount + 1)) return true
        occupancy[color] -= 1
        colors[selected] = -1
      }
      return false
    }

    if (assignNext(0)) return colors
  }

  return classes.map((_, index) => index)
}

function getScheduleQuality(colors: number[], classes: DiscussionClass[]): {
  balancePenalty: number
  teacherScore: number
} {
  const slotCount = Math.max(...colors) + 1
  const slots = Array.from({ length: slotCount }, () => [] as number[])
  colors.forEach((slot, classIndex) => slots[slot].push(classIndex))

  const balancePenalty = slots.reduce((sum, slot) => sum + slot.length * slot.length, 0)
  let teacherScore = 0

  slots.forEach(slot => {
    const requiredClassByPerson = new Map<string, number>()
    slot.forEach(classIndex => {
      classes[classIndex].requiredPersonKeys.forEach(person => {
        requiredClassByPerson.set(person, classIndex)
      })
    })

    const teacherKeys = new Set<string>()
    slot.forEach(classIndex => {
      classes[classIndex].teacherWeights.forEach((_, teacher) => teacherKeys.add(teacher))
    })

    teacherKeys.forEach(teacher => {
      const requiredClass = requiredClassByPerson.get(teacher)
      if (requiredClass !== undefined) {
        teacherScore += classes[requiredClass].teacherWeights.get(teacher) ?? 0
        return
      }
      teacherScore += Math.max(...slot.map(classIndex => classes[classIndex].teacherWeights.get(teacher) ?? 0))
    })
  })

  return { balancePenalty, teacherScore }
}

function isBetterSchedule(
  candidate: { balancePenalty: number; teacherScore: number },
  current: { balancePenalty: number; teacherScore: number }
): boolean {
  return (
    candidate.balancePenalty < current.balancePenalty ||
    (candidate.balancePenalty === current.balancePenalty && candidate.teacherScore > current.teacherScore)
  )
}

function improveDiscussionSchedule(initialColors: number[], classes: DiscussionClass[]): number[] {
  const colors = [...initialColors]
  const slotCount = Math.max(...colors) + 1

  for (let round = 0; round < 50; round += 1) {
    let bestColors: number[] | null = null
    let bestQuality = getScheduleQuality(colors, classes)
    const occupancies = Array<number>(slotCount).fill(0)
    colors.forEach(slot => { occupancies[slot] += 1 })

    classes.forEach((_, classIndex) => {
      const source = colors[classIndex]
      if (occupancies[source] <= 1) return
      for (let target = 0; target < slotCount; target += 1) {
        if (target === source) continue
        const targetClasses = colors
          .map((slot, index) => ({ slot, index }))
          .filter(entry => entry.slot === target)
          .map(entry => entry.index)
        if (!slotIsValid([...targetClasses, classIndex], classes)) continue
        const candidate = [...colors]
        candidate[classIndex] = target
        const quality = getScheduleQuality(candidate, classes)
        if (isBetterSchedule(quality, bestQuality)) {
          bestColors = candidate
          bestQuality = quality
        }
      }
    })

    for (let first = 0; first < classes.length; first += 1) {
      for (let second = first + 1; second < classes.length; second += 1) {
        if (colors[first] === colors[second]) continue
        const candidate = [...colors]
        const firstSlot = colors[first]
        candidate[first] = colors[second]
        candidate[second] = firstSlot
        const affectedSlots = new Set([candidate[first], candidate[second]])
        const valid = Array.from(affectedSlots).every(slot =>
          slotIsValid(
            candidate
              .map((candidateSlot, index) => ({ candidateSlot, index }))
              .filter(entry => entry.candidateSlot === slot)
              .map(entry => entry.index),
            classes
          )
        )
        if (!valid) continue
        const quality = getScheduleQuality(candidate, classes)
        if (isBetterSchedule(quality, bestQuality)) {
          bestColors = candidate
          bestQuality = quality
        }
      }
    }

    if (!bestColors) break
    colors.splice(0, colors.length, ...bestColors)
  }

  return colors
}

type AssignedTeacher = NonNullable<DiscussionAssignment['assignedTeachers']>[number]

function isEmphasizedTeacher(teacher: AssignedTeacher): boolean {
  return teacher.isContactTeacher || teacher.slotStudentCounts.every(
    (count, index) => index === teacher.placedSlotIndex || count === 0
  )
}

function buildSlotAssignments(slotClasses: DiscussionClass[]): DiscussionAssignment[] {
  const orderedClasses = [...slotClasses].sort(
    (a, b) => a.adviser.localeCompare(b.adviser, 'nb') || a.className.localeCompare(b.className, 'nb')
  )
  const assignments = orderedClasses.map(item => ({
    className: item.className,
    adviser: item.adviser,
    leaders: item.leaders,
    teacherKeys: Array.from(item.teacherNames.keys()),
    assignedTeachers: [] as NonNullable<DiscussionAssignment['assignedTeachers']>,
  }))
  const assignmentByClass = new Map(assignments.map(assignment => [assignment.className, assignment]))
  const teacherKeys = new Set(orderedClasses.flatMap(item => Array.from(item.teacherNames.keys())))

  teacherKeys.forEach(teacherKey => {
    const contactClass = orderedClasses.find(item => item.contactTeacherKeys.has(teacherKey))
    const targetClass = contactClass ?? [...orderedClasses]
      .filter(item => (item.teacherWeights.get(teacherKey) ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.teacherWeights.get(teacherKey) ?? 0) - (a.teacherWeights.get(teacherKey) ?? 0) ||
          a.className.localeCompare(b.className, 'nb', { numeric: true })
      )[0]
    if (!targetClass) return

    const name = targetClass.teacherNames.get(teacherKey) ??
      orderedClasses.find(item => item.teacherNames.has(teacherKey))?.teacherNames.get(teacherKey)
    if (!name) return
    assignmentByClass.get(targetClass.className)?.assignedTeachers?.push({
      name,
      studentCount: targetClass.teacherWeights.get(teacherKey) ?? 0,
      isContactTeacher: targetClass.contactTeacherKeys.has(teacherKey),
      slotStudentCounts: orderedClasses.map(item => item.teacherWeights.get(teacherKey) ?? 0),
      placedSlotIndex: orderedClasses.findIndex(item => item.className === targetClass.className),
    })
  })

  assignments.forEach(assignment => {
    assignment.assignedTeachers?.sort(
      (a, b) =>
        Number(b.isContactTeacher) - Number(a.isContactTeacher) ||
        Number(isEmphasizedTeacher(b)) - Number(isEmphasizedTeacher(a)) ||
        a.name.localeCompare(b.name, 'nb', { sensitivity: 'base' })
    )
  })
  return assignments
}

export function buildDiscussionSchedule(
  absences: AbsenceRecord[],
  classNames: string[],
  presets: PresetRecord[],
  minStudents: number | null = null
): DiscussionSchedule | null {
  const { classes, warnings } = buildDiscussionClasses(absences, classNames, presets, minStudents)
  if (classes.length === 0) return null

  const colors = improveDiscussionSchedule(colorDiscussionClasses(classes), classes)
  const slotCount = Math.max(...colors) + 1
  const rooms = Array.from(
    new Map(classes.map(item => [item.roomKey, { key: item.roomKey, adviser: item.adviser }])).values()
  ).sort((a, b) => a.adviser.localeCompare(b.adviser, 'nb', { sensitivity: 'base' }))

  const slots = Array.from({ length: slotCount }, (_, slotIndex) =>
    buildSlotAssignments(classes.filter((_, classIndex) => colors[classIndex] === slotIndex))
  )
    .sort(
      (a, b) =>
        b.length - a.length ||
        (a[0]?.className ?? '').localeCompare(b[0]?.className ?? '', 'nb')
    )
    .map((assignments, slotIndex) => ({ label: `Tid ${slotIndex + 1}`, assignments }))

  return { rooms, slots, warnings, minStudents }
}

function buildDiscussionScheduleHtml(schedule: DiscussionSchedule): string {
  const headers = schedule.rooms
    .map(
      (room, index) =>
        `<th><span class="room-number">Rom ${index + 1}</span><span class="room-adviser">${escapeHtml(room.adviser)}</span></th>`
    )
    .join('')

  const rows = schedule.slots
    .map(slot => {
      const teacherOccurrences = new Map<string, number>()
      slot.assignments.forEach(assignment => {
        (assignment.teacherKeys ?? []).forEach(teacher => {
          teacherOccurrences.set(teacher, (teacherOccurrences.get(teacher) ?? 0) + 1)
        })
      })
      const teachersWithCollisions = Array.from(teacherOccurrences.values()).filter(count => count > 1).length
      const teachersWithoutCollisions = teacherOccurrences.size - teachersWithCollisions
      const cells = schedule.rooms
        .map(room => {
          const assignment = slot.assignments.find(item => item.adviser === room.adviser)
          if (!assignment) return '<td class="schedule-empty"></td>'
          const leaders = assignment.leaders.length > 0
            ? assignment.leaders.map(escapeHtml).join(', ')
            : 'Mangler i preset'
          return `<td>
            <strong>${escapeHtml(assignment.className)}</strong>
            <span>Rådgiver: ${escapeHtml(assignment.adviser)}</span>
            <span>Trinnleder/avdelingsleder: ${leaders}</span>
          </td>`
        })
        .join('')
      return `<tr><th scope="row">${escapeHtml(slot.label)}<span class="schedule-collision-summary">${teacherOccurrences.size} total · ${teachersWithoutCollisions} u/kollisjon · ${teachersWithCollisions} m/kollisjon</span></th>${cells}</tr>`
    })
    .join('')

  const teacherRows = schedule.slots
    .map(slot => {
      const cells = schedule.rooms
        .map(room => {
          const assignment = slot.assignments.find(item => item.adviser === room.adviser)
          if (!assignment) return '<td class="schedule-empty"></td>'
          const teachers = (assignment.assignedTeachers ?? [])
            .map(teacher => {
              const counts = teacher.slotStudentCounts
                .map((count, index) =>
                  index === teacher.placedSlotIndex ? `<u>${count}</u>` : `${count}`
                )
                .join(' / ')
              const content = `${escapeHtml(teacher.name)} (${counts})${teacher.isContactTeacher ? ' <em>(kontaktlærer)</em>' : ''}`
              return `<li>${isEmphasizedTeacher(teacher) ? `<b>${content}</b>` : content}</li>`
            })
            .join('')
          return `<td>
            <strong>${escapeHtml(assignment.className)}</strong>
            ${teachers ? `<ul class="schedule-teachers">${teachers}</ul>` : '<span>Ingen lærere</span>'}
          </td>`
        })
        .join('')
      return `<tr><th scope="row">${escapeHtml(slot.label)}</th>${cells}</tr>`
    })
    .join('')

  const warnings = schedule.warnings.length > 0
    ? `<div class="schedule-warnings"><strong>Kontroller preset-data:</strong><ul>${schedule.warnings
        .map(warning => `<li>${escapeHtml(warning)}</li>`)
        .join('')}</ul></div>`
    : ''

  return `
    <section class="sheet page-break schedule-section">
      <h2>Forslag til tidsplan for klasselærerråd</h2>
      <p class="meta">Rommene følger rådgiverne. Planen bruker færrest mulige tidsluker, fordeler klassene jevnt og minimerer lærerkonflikter vektet etter antall elever.</p>
      ${warnings}
      <div class="no-print copy-row">
        <button type="button" onclick="copyScheduleTable(this, 'discussion-schedule-table')">Kopier tabell</button>
      </div>
      <table id="discussion-schedule-table" class="schedule-table">
        <thead>
          <tr>
            <th class="schedule-time">Tid</th>
            ${headers}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <h3 class="schedule-subtitle">Lærerfordeling per tidsluke</h3>
      <p class="meta">Kontaktlærere er plassert i egen klasse. Andre lærere er plassert i klassen der de har flest elever i den aktuelle tidsluken. Tallene i parentes viser antall elever læreren har i hver av klassene i tidsluken (samme rekkefølge som kolonnene), og det understrekede tallet er klassen læreren er plassert i.${
        schedule.minStudents !== null
          ? ` Filter: lærere med færre enn ${schedule.minStudents} elever i en klasse er utelatt (kontaktlærere deltar alltid).`
          : ''
      }</p>
      <div class="no-print copy-row">
        <button type="button" onclick="copyScheduleTable(this, 'teacher-schedule-table')">Kopier tabell</button>
      </div>
      <table id="teacher-schedule-table" class="schedule-table teacher-schedule-table">
        <thead>
          <tr>
            <th class="schedule-time">Tid</th>
            ${headers}
          </tr>
        </thead>
        <tbody>${teacherRows}</tbody>
      </table>
      ${buildTeacherMeetingOverviewHtml(buildTeacherMeetingOverview(schedule))}
    </section>
  `
}

function buildTeacherMeetingOverviewHtml(overview: TeacherMeetingOverview): string {
  const headerCells = overview.slotLabels
    .map(label => `<th>${escapeHtml(label)}</th>`)
    .join('')

  const bodyRows = overview.teachers
    .map(teacher => {
      const cells = teacher.classBySlot
        .map((className, index) => {
          if (!className) return '<td class="meeting-cell schedule-empty"></td>'
          const withCount = teacher.classWithCountBySlot[index] ?? className
          return `<td class="meeting-cell" data-plain="${escapeHtml(className)}" data-count="${escapeHtml(withCount)}">${escapeHtml(className)}</td>`
        })
        .join('')
      return `<tr><th class="meeting-teacher" scope="row">${escapeHtml(teacher.name)}</th>${cells}<td class="meeting-total">${teacher.total}</td></tr>`
    })
    .join('')

  return `
      <h3 class="schedule-subtitle">Møteoversikt per lærer</h3>
      <p class="meta">Klassen læreren skal møte i hver tidsluke. Siste kolonne viser totalt antall møter læreren skal delta på.</p>
      <div class="no-print copy-row">
        <button type="button" onclick="copyScheduleTable(this, 'teacher-meeting-table')">Kopier tabell</button>
        <a id="teacher-meeting-excel" class="download-link" href="#" aria-disabled="true">Forbereder Excel …</a>
        <label class="toggle-option"><input type="checkbox" onchange="toggleMeetingCounts(this)"> Vis antall elever</label>
      </div>
      <table id="teacher-meeting-table" class="schedule-table meeting-table">
        <thead>
          <tr>
            <th class="meeting-teacher">Lærer</th>
            ${headerCells}
            <th class="meeting-total">Totalt</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
  `
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
  rankOverview: TeacherClassRankOverview | null = null,
  discussionSchedule: DiscussionSchedule | null = null
): string {
  const title = 'Lærerliste klasselærerråd'
  const body =
    sections.map((section, index) => buildSectionHtml(section, index === 0)).join('') +
    (rankOverview ? buildRankOverviewHtml(rankOverview) : '') +
    (discussionSchedule ? buildDiscussionScheduleHtml(discussionSchedule) : '')

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
  .schedule-table {
    width: 100%;
    table-layout: fixed;
    margin-top: 4mm;
  }
  .schedule-table th,
  .schedule-table td {
    padding: 2mm;
    vertical-align: top;
    font-size: 8pt;
  }
  .schedule-table th {
    text-align: left;
    font-weight: 700;
  }
  .schedule-table .schedule-time {
    width: 16mm;
    vertical-align: middle;
  }
  .schedule-table .schedule-collision-summary {
    display: block;
    margin-top: 1mm;
    font-size: 6.5pt;
    font-weight: 400;
    line-height: 1.2;
  }
  .schedule-table .room-number,
  .schedule-table .room-adviser,
  .schedule-table td span {
    display: block;
  }
  .schedule-table .room-number {
    font-size: 7pt;
    font-weight: 400;
  }
  .schedule-table td strong {
    display: block;
    margin-bottom: 1mm;
    font-size: 9pt;
  }
  .schedule-table td span {
    margin-top: 0.5mm;
  }
  .schedule-table .schedule-empty {
    background: #f7f7f7;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .schedule-subtitle {
    margin: 8mm 0 1mm;
    font-size: 11pt;
  }
  .teacher-schedule-table {
    margin-top: 3mm;
  }
  .schedule-teachers {
    margin: 1mm 0 0 4mm;
    padding: 0;
  }
  .schedule-teachers li {
    margin: 0.5mm 0;
  }
  .schedule-teachers em {
    font-size: 7pt;
    font-style: normal;
    font-weight: 700;
  }
  .schedule-warnings {
    margin: 3mm 0;
    padding: 2mm 3mm;
    border: 1px solid #777;
    font-size: 8pt;
  }
  .schedule-warnings ul {
    margin: 1mm 0 0 5mm;
    padding: 0;
  }
  .no-print { margin-bottom: 6mm; }
  .no-print.copy-row { margin: 2mm 0 0; }
  .no-print button {
    font: inherit;
    padding: 2mm 4mm;
    border: 1px solid #000;
    background: #fff;
    cursor: pointer;
  }
  .download-link {
    display: inline-block;
    margin-left: 3mm;
    padding: 2mm 4mm;
    border: 1px solid #000;
    background: #fff;
    color: #000;
    text-decoration: none;
  }
  .download-link[aria-disabled="true"] {
    opacity: 0.5;
    pointer-events: none;
  }
  .toggle-option {
    display: inline-block;
    margin-left: 3mm;
    font-size: 9pt;
    cursor: pointer;
  }
  .meeting-table .meeting-teacher {
    width: 45mm;
    vertical-align: middle;
  }
  .meeting-table .meeting-cell,
  .meeting-table .meeting-total {
    text-align: center;
    vertical-align: middle;
  }
  .meeting-table .meeting-total {
    width: 16mm;
    font-weight: 700;
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
  <script>
    function buildScheduleClipboardHtml(table) {
      var clone = table.cloneNode(true);
      clone.setAttribute('border', '1');
      clone.style.borderCollapse = 'collapse';
      var cells = clone.querySelectorAll('th, td');
      for (var i = 0; i < cells.length; i += 1) {
        cells[i].style.border = '1px solid #000';
        cells[i].style.padding = '4px 6px';
        cells[i].style.verticalAlign = 'top';
        cells[i].style.fontFamily = 'Calibri, Arial, sans-serif';
        cells[i].style.fontSize = '10pt';
      }
      var lists = clone.querySelectorAll('ul');
      for (var j = 0; j < lists.length; j += 1) {
        lists[j].style.margin = '2px 0 0 14px';
        lists[j].style.padding = '0';
      }
      return '<meta charset="utf-8">' + clone.outerHTML;
    }

    function buildScheduleClipboardText(table) {
      var lines = [];
      var rows = table.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i += 1) {
        var cells = rows[i].querySelectorAll('th, td');
        var values = [];
        for (var j = 0; j < cells.length; j += 1) {
          values.push((cells[j].innerText || cells[j].textContent || '').replace(/\\s*\\n\\s*/g, '; ').trim());
        }
        lines.push(values.join('\\t'));
      }
      return lines.join('\\n');
    }

    function copyScheduleTable(button, tableId) {
      var table = document.getElementById(tableId);
      if (!table) return;
      var html = buildScheduleClipboardHtml(table);
      var text = buildScheduleClipboardText(table);
      var originalLabel = button.getAttribute('data-label') || button.textContent;
      button.setAttribute('data-label', originalLabel);

      function done(ok) {
        button.textContent = ok ? 'Kopiert!' : 'Kopiering feilet';
        setTimeout(function () { button.textContent = originalLabel; }, 2000);
      }

      function fallback() {
        try {
          var selection = window.getSelection();
          var range = document.createRange();
          range.selectNode(table);
          selection.removeAllRanges();
          selection.addRange(range);
          var ok = document.execCommand('copy');
          selection.removeAllRanges();
          done(ok);
        } catch (error) {
          done(false);
        }
      }

      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        var item = new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(function () { done(true); }, fallback);
        return;
      }
      fallback();
    }

    function toggleMeetingCounts(checkbox) {
      var show = checkbox.checked;
      var cells = document.querySelectorAll('#teacher-meeting-table .meeting-cell[data-plain]');
      for (var i = 0; i < cells.length; i += 1) {
        cells[i].textContent = show
          ? cells[i].getAttribute('data-count')
          : cells[i].getAttribute('data-plain');
      }
    }
  </script>
</body>
</html>`
}

async function buildTeacherMeetingWorkbookUrl(overview: TeacherMeetingOverview): Promise<string> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Møteoversikt')

  sheet.columns = [
    { header: 'Lærer', key: 'teacher', width: 32 },
    ...overview.slotLabels.map((label, index) => ({ header: label, key: `slot${index}`, width: 14 })),
    { header: 'Totalt', key: 'total', width: 10 },
  ]

  overview.teachers.forEach(teacher => {
    const row: Record<string, string | number> = { teacher: teacher.name, total: teacher.total }
    teacher.classBySlot.forEach((className, index) => {
      row[`slot${index}`] = className ?? ''
    })
    sheet.addRow(row)
  })

  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return URL.createObjectURL(blob)
}

export function printTeacherMatrix(
  absences: AbsenceRecord[],
  classNames: string[],
  presets: PresetRecord[] = [],
  minStudents: number | null = null
): boolean {
  const sections = buildTeacherMatrixSections(absences, classNames)
  if (sections.length === 0) return false

  const rankOverview = buildTeacherClassRankOverview(absences, sections)
  const discussionSchedule = buildDiscussionSchedule(absences, classNames, presets, minStudents)

  const printWindow = window.open('', '_blank')
  if (!printWindow) return false

  printWindow.document.open()
  printWindow.document.write(buildTeacherMatrixHtml(sections, rankOverview, discussionSchedule))
  printWindow.document.close()
  printWindow.focus()

  if (discussionSchedule) {
    const overview = buildTeacherMeetingOverview(discussionSchedule)
    void buildTeacherMeetingWorkbookUrl(overview).then(
      url => {
        const link = printWindow.document.getElementById('teacher-meeting-excel')
        if (!link) return
        link.setAttribute('href', url)
        link.setAttribute('download', `moteoversikt_laerere_${todayDdMmYyyy()}.xlsx`)
        link.removeAttribute('aria-disabled')
        link.textContent = 'Last ned Excel'
      },
      () => {
        const link = printWindow.document.getElementById('teacher-meeting-excel')
        if (link) link.textContent = 'Excel utilgjengelig'
      }
    )
  }

  return true
}
