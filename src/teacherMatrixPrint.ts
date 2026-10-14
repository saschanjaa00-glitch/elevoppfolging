import type { AbsenceRecord, PresetRecord } from './types'
import { normalizeMatch } from './studentInfoUtils'
import { sanitizeFilenamePart } from './securityUtils'
import { todayDdMmYyyy } from './dateUtils'
import printWindowCssUrl from './teacherMatrixPrintWindow.css?url'
import printWindowScriptUrl from './teacherMatrixPrintWindow.js?url'

export interface TeacherMatrixSection {
  className: string
  students: string[]
  teachers: Array<{ name: string; studentKeys: Set<string> }>
}

const PAGE_CONTENT_WIDTH_MM = 275
// TEACHER_COLUMN_MM and HEADER_HEIGHT_MM are mirrored in teacherMatrixPrintWindow.css.
const TEACHER_COLUMN_MM = 42
const HEADER_HEIGHT_MM = 30
const MAX_COLUMN_MM = 7.5
const MIN_COLUMN_MM = 4.5
const SLOT_SYNC_GROUP = 'slot'
const ROOM_SYNC_GROUP = 'room'
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
  maxMeetings: number | null
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

export interface AnonymizationMap {
  lookup: Map<string, string>
}

function createAnonymizationMap(
  groups: Array<{ label: string; names: string[] }>
): AnonymizationMap {
  const lookup = new Map<string, string>()
  groups.forEach(group => {
    Array.from(new Set(group.names.map(name => name.trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'nb', { sensitivity: 'base' }))
      .forEach((name, index) => {
        const key = normalizeMatch(name)
        if (!lookup.has(key)) lookup.set(key, `${group.label} ${index + 1}`)
      })
  })
  return { lookup }
}

function personSpan(name: string, anonymization: AnonymizationMap | null): string {
  const real = escapeHtml(name)
  const anonymous = anonymization?.lookup.get(normalizeMatch(name))
  if (!anonymous) return real
  return `<span class="pname" data-real="${real}" data-anon="${escapeHtml(anonymous)}">${real}</span>`
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

export function isAdviserRole(rolle: string): boolean {
  return normalizeMatch(rolle).includes('radgiver')
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
  minStudents: number | null = null,
  maxMeetings: number | null = null
): { classes: DiscussionClass[]; warnings: string[] } {
  const warnings: string[] = []
  const classes = [...new Set(classNames)]
    .sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }))
    .map(className => {
      const advisers = getPresetOwners(
        presets,
        className,
        isAdviserRole
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

  if (maxMeetings !== null) {
    const teacherKeys = new Set(classes.flatMap(item => Array.from(item.teacherNames.keys())))

    teacherKeys.forEach(teacherKey => {
      const memberships = classes.filter(item => item.teacherNames.has(teacherKey))
      if (memberships.length <= maxMeetings) return

      const contactClasses = memberships.filter(item => item.contactTeacherKeys.has(teacherKey))
      const otherClasses = memberships
        .filter(item => !item.contactTeacherKeys.has(teacherKey))
        .sort(
          (a, b) =>
            (b.teacherWeights.get(teacherKey) ?? 0) - (a.teacherWeights.get(teacherKey) ?? 0) ||
            a.className.localeCompare(b.className, 'nb', { sensitivity: 'base', numeric: true })
        )
      const availableOtherMeetings = Math.max(0, maxMeetings - contactClasses.length)
      const keptClasses = new Set([
        ...contactClasses,
        ...otherClasses.slice(0, availableOtherMeetings),
      ])

      memberships.forEach(item => {
        if (keptClasses.has(item)) return
        item.teacherWeights.delete(teacherKey)
        item.teacherNames.delete(teacherKey)
      })

      if (contactClasses.length > maxMeetings) {
        const teacherName = contactClasses[0].teacherNames.get(teacherKey) ?? teacherKey
        warnings.push(
          `${teacherName}: har ${contactClasses.length} kontaktlærermøter og kan derfor ikke begrenses til ${maxMeetings} møter.`
        )
      }
    })
  }

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
  minStudents: number | null = null,
  maxMeetings: number | null = null
): DiscussionSchedule | null {
  const { classes, warnings } = buildDiscussionClasses(
    absences,
    classNames,
    presets,
    minStudents,
    maxMeetings
  )
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

  return { rooms, slots, warnings, minStudents, maxMeetings }
}

function syncedLabelHtml(
  group: string,
  index: number,
  text: string,
  options: { editable: boolean; className?: string; ariaLabel?: string }
): string {
  const classes = ['sync-label', options.className, options.editable ? 'editable-label' : null]
    .filter(Boolean)
    .join(' ')
  const editableAttrs = options.editable
    ? ` contenteditable="true" spellcheck="false" aria-label="${escapeHtml(options.ariaLabel ?? 'Rediger navn')}"`
    : ''
  return `<span class="${classes}" data-sync-group="${group}" data-sync-index="${index}"${editableAttrs}>${escapeHtml(text)}</span>`
}

function printTableButtonHtml(tableId: string): string {
  return `<button type="button" data-action="print-table" data-table="${tableId}">Skriv ut tabell</button>`
}

function buildDiscussionScheduleHtml(
  schedule: DiscussionSchedule,
  anonymization: AnonymizationMap | null
): string {
  const roomHeaders = (editable: boolean): string =>
    schedule.rooms
      .map(
        (room, index) =>
          `<th>${syncedLabelHtml(ROOM_SYNC_GROUP, index, `Rom ${index + 1}`, {
            editable,
            className: 'room-number',
            ariaLabel: 'Rediger romnavn',
          })}<span class="room-adviser">${personSpan(room.adviser, anonymization)}</span></th>`
      )
      .join('')

  const editableHeaders = roomHeaders(true)
  const teacherHeaders = roomHeaders(false)

  const rows = schedule.slots
    .map((slot, slotIndex) => {
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
            ? assignment.leaders.map(leader => personSpan(leader, anonymization)).join(', ')
            : 'Mangler i preset'
          return `<td>
            <strong>${escapeHtml(assignment.className)}</strong>
            <span>Rådgiver: ${personSpan(assignment.adviser, anonymization)}</span>
            <span>Trinnleder/avdelingsleder: ${leaders}</span>
          </td>`
        })
        .join('')
      return `<tr><th scope="row">${syncedLabelHtml(SLOT_SYNC_GROUP, slotIndex, slot.label, {
        editable: true,
        ariaLabel: 'Rediger navn på tidsluke',
      })}<span class="schedule-collision-summary">${teacherOccurrences.size} total · ${teachersWithoutCollisions} u/kollisjon · ${teachersWithCollisions} m/kollisjon</span></th>${cells}</tr>`
    })
    .join('')

  const teacherRows = schedule.slots
    .map((slot, slotIndex) => {
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
              const content = `${personSpan(teacher.name, anonymization)}<span class="paren"> (${counts})</span>${teacher.isContactTeacher ? '<span class="paren"> <em>(kontaktlærer)</em></span>' : ''}`
              return `<li>${isEmphasizedTeacher(teacher) ? `<b>${content}</b>` : content}</li>`
            })
            .join('')
          const assigned = assignment.assignedTeachers ?? []
          const contactCount = assigned.filter(teacher => teacher.isContactTeacher).length
          const otherCount = assigned.length - contactCount
          return `<td>
            <strong>${escapeHtml(assignment.className)}<span class="paren"> (${contactCount}+${otherCount})</span></strong>
            ${teachers ? `<ul class="schedule-teachers">${teachers}</ul>` : '<span>Ingen lærere</span>'}
          </td>`
        })
        .join('')
      return `<tr><th scope="row">${syncedLabelHtml(SLOT_SYNC_GROUP, slotIndex, slot.label, {
        editable: false,
      })}</th>${cells}</tr>`
    })
    .join('')

  const warnings = schedule.warnings.length > 0
    ? `<div class="schedule-warnings"><strong>Kontroller preset-data:</strong><ul>${schedule.warnings
        .map(warning => `<li>${escapeHtml(warning)}</li>`)
        .join('')}</ul></div>`
    : ''

  return `
    <section class="sheet page-break schedule-section">
      <div class="table-block">
      <h2>Forslag til tidsplan for klasselærerråd</h2>
      <p class="meta">Rommene følger rådgiverne. Planen bruker færrest mulige tidsluker, fordeler klassene jevnt og minimerer lærerkonflikter vektet etter antall elever.</p>
      ${warnings}
      <div class="no-print copy-row">
        <button type="button" data-action="copy-table" data-table="discussion-schedule-table">Kopier tabell</button>
        <button type="button" data-action="export-excel" data-table="discussion-schedule-table" data-filename="tidsplan_klasselaererrad">Last ned Excel</button>
        ${printTableButtonHtml('discussion-schedule-table')}
        <label class="toggle-option"><input type="checkbox" data-action="toggle-collisions"> Vis kollisjoner</label>
        <span class="room-edit-hint">Klikk på et rom- eller tidsnavn for å endre det. Endringen oppdateres i alle tabellene.</span>
      </div>
      <table id="discussion-schedule-table" class="schedule-table hide-collisions">
        <thead>
          <tr>
            <th class="schedule-time">Tid</th>
            ${editableHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <div class="table-block">
      <h3 class="schedule-subtitle">Lærerfordeling per tidsluke</h3>
      <p class="meta">Tallene bak klassenavnet viser antall kontaktlærere + antall øvrige lærere. Kontaktlærere er plassert i egen klasse. Andre lærere er plassert i klassen der de har flest elever i den aktuelle tidsluken. Tallene i parentes viser antall elever læreren har i hver av klassene i tidsluken (samme rekkefølge som kolonnene), og det understrekede tallet er klassen læreren er plassert i.${
        schedule.minStudents !== null
          ? ` Filter: lærere med færre enn ${schedule.minStudents} elever i en klasse er utelatt (kontaktlærere deltar alltid).`
          : ''
      }${
        schedule.maxMeetings !== null
          ? ` Maks ${schedule.maxMeetings} møter per lærer; klassene med flest elever prioriteres, deretter klassenavn alfabetisk. Kontaktlærermøter beholdes alltid.`
          : ''
      }</p>
      <div class="no-print copy-row">
        <button type="button" data-action="copy-table" data-table="teacher-schedule-table">Kopier tabell</button>
        <button type="button" data-action="export-excel" data-table="teacher-schedule-table" data-filename="laererfordeling_tidsluke">Last ned Excel</button>
        ${printTableButtonHtml('teacher-schedule-table')}
        <label class="toggle-option"><input type="checkbox" data-action="toggle-parentheses" data-table="teacher-schedule-table"> Vis tall i parentes</label>
      </div>
      <table id="teacher-schedule-table" class="schedule-table teacher-schedule-table hide-paren">
        <thead>
          <tr>
            <th class="schedule-time">Tid</th>
            ${teacherHeaders}
          </tr>
        </thead>
        <tbody>${teacherRows}</tbody>
      </table>
      </div>
      ${buildTeacherMeetingOverviewHtml(buildTeacherMeetingOverview(schedule), anonymization)}
    </section>
  `
}

function buildTeacherMeetingOverviewHtml(
  overview: TeacherMeetingOverview,
  anonymization: AnonymizationMap | null
): string {
  const headerCells = overview.slotLabels
    .map((label, index) => `<th class="meeting-slot">${syncedLabelHtml(SLOT_SYNC_GROUP, index, label, { editable: false })}</th>`)
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
      return `<tr><th class="meeting-teacher" scope="row">${personSpan(teacher.name, anonymization)}</th>${cells}<td class="meeting-total">${teacher.total}</td></tr>`
    })
    .join('')

  return `
      <div class="table-block">
      <h3 class="schedule-subtitle">Møteoversikt per lærer</h3>
      <p class="meta">Klassen læreren skal møte i hver tidsluke. Siste kolonne viser totalt antall møter læreren skal delta på.</p>
      <div class="no-print copy-row">
        <button type="button" data-action="copy-table" data-table="teacher-meeting-table">Kopier tabell</button>
        <button type="button" data-action="export-excel" data-table="teacher-meeting-table" data-filename="moteoversikt_laerere">Last ned Excel</button>
        ${printTableButtonHtml('teacher-meeting-table')}
        <label class="toggle-option"><input type="checkbox" data-action="toggle-meeting-counts"> Vis antall elever</label>
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
      </div>
  `
}

export function buildAssignedTeacherSections(
  sections: TeacherMatrixSection[],
  schedule: DiscussionSchedule
): TeacherMatrixSection[] {
  const assignedByClass = new Map<string, string[]>()
  schedule.slots
    .flatMap(slot => slot.assignments)
    .forEach(assignment => {
      const names = (assignment.assignedTeachers ?? []).map(teacher => teacher.name)
      assignedByClass.set(normalizeMatch(assignment.className), names)
    })

  return sections
    .map(section => {
      const assignedNames = assignedByClass.get(normalizeMatch(section.className)) ?? []
      const byKey = new Map(section.teachers.map(teacher => [normalizeMatch(teacher.name), teacher]))
      const teachers = Array.from(
        new Map(
          assignedNames.map(name => {
            const key = normalizeMatch(name)
            return [key, byKey.get(key) ?? { name, studentKeys: new Set<string>() }]
          })
        ).values()
      ).sort(
        (a, b) =>
          b.studentKeys.size - a.studentKeys.size ||
          a.name.localeCompare(b.name, 'nb', { sensitivity: 'base' })
      )
      return { ...section, teachers }
    })
    .filter(section => section.teachers.length > 0)
}

function buildSectionHtml(
  section: TeacherMatrixSection,
  isFirst: boolean,
  tableId: string,
  anonymization: AnonymizationMap | null,
  variant: 'all' | 'assigned' = 'all'
): string {
  const columnCount = section.students.length
  const available = PAGE_CONTENT_WIDTH_MM - TEACHER_COLUMN_MM - HEADER_HEIGHT_MM
  const columnMm = Math.max(MIN_COLUMN_MM, Math.min(MAX_COLUMN_MM, available / Math.max(columnCount, 1)))
  const heading = variant === 'assigned'
    ? `Lærerliste klasselærerråd – Oppsatte lærere – ${escapeHtml(section.className)}`
    : `Lærerliste klasselærerråd – ${escapeHtml(section.className)}`
  const teacherLabel = variant === 'assigned' ? 'oppsatte lærere' : 'lærere'

  const headerCells = section.students
    .map(
      student =>
        `<th class="slant"><div><span>${personSpan(student, anonymization)}</span></div></th>`
    )
    .join('')

  const bodyRows = section.teachers
    .map(teacher => {
      const studentCount = teacher.studentKeys.size
      const cells = section.students
        .map(student => {
          const teaches = teacher.studentKeys.has(normalizeMatch(student))
          return `<td class="mark">${teaches ? '✓' : ''}</td>`
        })
        .join('')
      const rowClass = variant === 'all' && studentCount <= FEW_STUDENTS_LIMIT ? ' class="few"' : ''
      return `<tr${rowClass}><th class="teacher" scope="row">${personSpan(teacher.name, anonymization)} (${studentCount})</th>${cells}<td class="spacer"></td></tr>`
    })
    .join('')

  return `
    <section class="sheet table-block${isFirst ? '' : ' page-break'}">
      <h2>${heading}</h2>
      <p class="meta">${section.teachers.length} ${teacherLabel} · ${columnCount} elever · ${escapeHtml(todayDdMmYyyy())}</p>
      <div class="no-print copy-row">
        ${printTableButtonHtml(tableId)}
      </div>
      <table id="${tableId}" data-col-width="${columnMm.toFixed(2)}mm">
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
  discussionSchedule: DiscussionSchedule | null = null
): string {
  const title = 'Lærerliste klasselærerråd'
  const anonymization = createAnonymizationMap([
    { label: 'Elev', names: sections.flatMap(section => section.students) },
    {
      label: 'Lærer',
      names: [
        ...sections.flatMap(section => section.teachers.map(teacher => teacher.name)),
        ...(discussionSchedule?.slots ?? [])
          .flatMap(slot => slot.assignments)
          .flatMap(assignment => (assignment.assignedTeachers ?? []).map(teacher => teacher.name)),
      ],
    },
    { label: 'Rådgiver', names: (discussionSchedule?.rooms ?? []).map(room => room.adviser) },
    {
      label: 'Leder',
      names: (discussionSchedule?.slots ?? [])
        .flatMap(slot => slot.assignments)
        .flatMap(assignment => assignment.leaders),
    },
  ])
  const assignedSections = discussionSchedule
    ? buildAssignedTeacherSections(sections, discussionSchedule)
    : []
  const body =
    sections
      .map((section, index) =>
        buildSectionHtml(section, index === 0, `matrix-table-${index}`, anonymization)
      )
      .join('') +
    (discussionSchedule ? buildDiscussionScheduleHtml(discussionSchedule, anonymization) : '') +
    assignedSections
      .map((section, index) =>
        buildSectionHtml(section, false, `assigned-matrix-table-${index}`, anonymization, 'assigned')
      )
      .join('')

  return `<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<title>${title} – ${escapeHtml(todayDdMmYyyy())}</title>
<link rel="stylesheet" href="${escapeHtml(printWindowCssUrl)}" />
</head>
<body>
  <div class="no-print toolbar">
    <button type="button" data-action="print">Skriv ut / lagre som PDF</button>
    <label class="toggle-option"><input type="checkbox" data-action="toggle-anonymous"> Anonymiser</label>
  </div>
  <h1>${title}</h1>
  <p class="doc-meta">Dato: ${escapeHtml(todayDdMmYyyy())}</p>
  ${body}
  <script src="${escapeHtml(printWindowScriptUrl)}"></script>
</body>
</html>`
}

interface TableWorkbookDownload {
  url: string
  filename: string
}

async function buildTableWorkbookDownload(
  matrix: string[][],
  filenameBase: string
): Promise<TableWorkbookDownload> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Tabell')
  const rows = Array.from(matrix, row =>
    Array.from(row, value => String(value ?? ''))
  )

  rows.forEach(row => sheet.addRow(row))

  const columnCount = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  for (let index = 1; index <= columnCount; index += 1) {
    const longest = rows.reduce((widest, row) => {
      const lines = (row[index - 1] ?? '').split('\n')
      return Math.max(widest, ...lines.map(line => line.length))
    }, 0)
    sheet.getColumn(index).width = Math.max(8, Math.min(40, longest + 2))
    sheet.getColumn(index).alignment = { vertical: 'top', wrapText: true }
  }

  if (rows.length > 0) sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  return {
    url,
    filename: `${sanitizeFilenamePart(filenameBase)}_${todayDdMmYyyy()}.xlsx`,
  }
}

export function printTeacherMatrix(
  absences: AbsenceRecord[],
  classNames: string[],
  presets: PresetRecord[] = [],
  minStudents: number | null = null,
  maxMeetings: number | null = null
): boolean {
  const sections = buildTeacherMatrixSections(absences, classNames)
  if (sections.length === 0) return false

  const discussionSchedule = buildDiscussionSchedule(
    absences,
    classNames,
    presets,
    minStudents,
    maxMeetings
  )

  const printWindow = window.open('', '_blank')
  if (!printWindow) return false

  printWindow.document.open()
  printWindow.document.write(buildTeacherMatrixHtml(sections, discussionSchedule))
  printWindow.document.close()
  printWindow.focus()

  ;(printWindow as Window & {
    buildTableWorkbook?: (
      matrix: string[][],
      filenameBase: string
    ) => Promise<TableWorkbookDownload>
  }).buildTableWorkbook = buildTableWorkbookDownload

  return true
}
