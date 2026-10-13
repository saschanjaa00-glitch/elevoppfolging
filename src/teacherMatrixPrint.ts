import type { AbsenceRecord, PresetRecord } from './types'
import { normalizeMatch } from './studentInfoUtils'
import { sanitizeFilenamePart } from './securityUtils'
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
    ? ` contenteditable="true" spellcheck="false" oninput="syncLabel(this)" aria-label="${escapeHtml(options.ariaLabel ?? 'Rediger navn')}"`
    : ''
  return `<span class="${classes}" data-sync-group="${group}" data-sync-index="${index}"${editableAttrs}>${escapeHtml(text)}</span>`
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

  const headers = roomHeaders(false)
  const editableTeacherHeaders = roomHeaders(true)

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
        editable: false,
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
        editable: true,
        ariaLabel: 'Rediger navn på tidsluke',
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
      <h2>Forslag til tidsplan for klasselærerråd</h2>
      <p class="meta">Rommene følger rådgiverne. Planen bruker færrest mulige tidsluker, fordeler klassene jevnt og minimerer lærerkonflikter vektet etter antall elever.</p>
      ${warnings}
      <div class="no-print copy-row">
        <button type="button" onclick="copyScheduleTable(this, 'discussion-schedule-table')">Kopier tabell</button>
        <button type="button" onclick="exportTableToExcel(this, 'discussion-schedule-table', 'tidsplan_klasselaererrad')">Last ned Excel</button>
        <label class="toggle-option"><input type="checkbox" onchange="toggleCollisions(this)"> Vis kollisjoner</label>
      </div>
      <table id="discussion-schedule-table" class="schedule-table hide-collisions">
        <thead>
          <tr>
            <th class="schedule-time">Tid</th>
            ${headers}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
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
        <button type="button" onclick="copyScheduleTable(this, 'teacher-schedule-table')">Kopier tabell</button>
        <button type="button" onclick="exportTableToExcel(this, 'teacher-schedule-table', 'laererfordeling_tidsluke')">Last ned Excel</button>
        <label class="toggle-option"><input type="checkbox" onchange="toggleParentheses(this, 'teacher-schedule-table')"> Vis tall i parentes</label>
        <span class="room-edit-hint">Klikk på et rom- eller tidsnavn for å endre det. Endringen oppdateres i alle tabellene.</span>
      </div>
      <table id="teacher-schedule-table" class="schedule-table teacher-schedule-table hide-paren">
        <thead>
          <tr>
            <th class="schedule-time">Tid</th>
            ${editableTeacherHeaders}
          </tr>
        </thead>
        <tbody>${teacherRows}</tbody>
      </table>
      ${buildTeacherMeetingOverviewHtml(buildTeacherMeetingOverview(schedule), anonymization)}
    </section>
  `
}

function buildTeacherMeetingOverviewHtml(
  overview: TeacherMeetingOverview,
  anonymization: AnonymizationMap | null
): string {
  const headerCells = overview.slotLabels
    .map((label, index) => `<th>${syncedLabelHtml(SLOT_SYNC_GROUP, index, label, { editable: false })}</th>`)
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
      <h3 class="schedule-subtitle">Møteoversikt per lærer</h3>
      <p class="meta">Klassen læreren skal møte i hver tidsluke. Siste kolonne viser totalt antall møter læreren skal delta på.</p>
      <div class="no-print copy-row">
        <button type="button" onclick="copyScheduleTable(this, 'teacher-meeting-table')">Kopier tabell</button>
        <button type="button" onclick="exportTableToExcel(this, 'teacher-meeting-table', 'moteoversikt_laerere')">Last ned Excel</button>
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

function buildSectionHtml(
  section: TeacherMatrixSection,
  isFirst: boolean,
  index: number,
  anonymization: AnonymizationMap | null
): string {
  const columnCount = section.students.length
  const available = PAGE_CONTENT_WIDTH_MM - TEACHER_COLUMN_MM - HEADER_HEIGHT_MM
  const columnMm = Math.max(MIN_COLUMN_MM, Math.min(MAX_COLUMN_MM, available / Math.max(columnCount, 1)))
  const tableId = `matrix-table-${index}`

  const headerCells = section.students
    .map(
      student =>
        `<th class="slant"><div><span>${personSpan(student, anonymization)}</span></div></th>`
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
      return `<tr${rowClass}><th class="teacher" scope="row"${rowStyle}>${personSpan(teacher.name, anonymization)} (${studentCount})</th>${cells}<td class="spacer"${rowStyle}></td></tr>`
    })
    .join('')

  return `
    <section class="sheet${isFirst ? '' : ' page-break'}">
      <h2>Lærerliste klasselærerråd – ${escapeHtml(section.className)}</h2>
      <p class="meta">${section.teachers.length} lærere · ${columnCount} elever · ${escapeHtml(todayDdMmYyyy())}</p>
      <table id="${tableId}" style="--col-width: ${columnMm.toFixed(2)}mm">
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
  const body =
    sections
      .map((section, index) => buildSectionHtml(section, index === 0, index, anonymization))
      .join('') +
    (discussionSchedule ? buildDiscussionScheduleHtml(discussionSchedule, anonymization) : '')

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
  .editable-label {
    cursor: text;
  }
  .editable-label:hover,
  .editable-label:focus {
    outline: 1px dashed #000;
    outline-offset: 1px;
  }
  .room-edit-hint {
    margin-left: 3mm;
    font-size: 9pt;
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
  .schedule-table.hide-collisions .schedule-collision-summary {
    display: none;
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
  .no-print.toolbar {
    display: flex;
    align-items: center;
    gap: 3mm;
  }
  .no-print button {
    font: inherit;
    padding: 2mm 4mm;
    border: 1px solid #000;
    background: #fff;
    cursor: pointer;
  }
  .toggle-option {
    display: inline-block;
    margin-left: 3mm;
    font-size: 9pt;
    cursor: pointer;
  }
  .hide-paren .paren { display: none; }
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
    .editable-label { outline: none; }
  }
</style>
</head>
<body>
  <div class="no-print toolbar">
    <button type="button" onclick="window.print()">Skriv ut / lagre som PDF</button>
    <label class="toggle-option"><input type="checkbox" onchange="toggleAnonymous(this)"> Anonymiser</label>
  </div>
  <h1>${title}</h1>
  <p class="doc-meta">Dato: ${escapeHtml(todayDdMmYyyy())}</p>
  ${body}
  <script>
    function buildScheduleClipboardHtml(table) {
      var clone = table.cloneNode(true);
      clone.setAttribute('border', '1');
      clone.style.borderCollapse = 'collapse';
      clone.removeAttribute('style');
      if (table.className.indexOf('hide-paren') >= 0) {
        var hidden = clone.querySelectorAll('.paren');
        for (var h = hidden.length - 1; h >= 0; h -= 1) {
          hidden[h].parentNode.removeChild(hidden[h]);
        }
      }
      if (table.className.indexOf('hide-collisions') >= 0) {
        var collisionSummaries = clone.querySelectorAll('.schedule-collision-summary');
        for (var c = collisionSummaries.length - 1; c >= 0; c -= 1) {
          collisionSummaries[c].parentNode.removeChild(collisionSummaries[c]);
        }
      }
      var slanted = clone.querySelectorAll('th.slant');
      for (var s = 0; s < slanted.length; s += 1) {
        slanted[s].textContent = slanted[s].textContent.trim();
        slanted[s].className = '';
      }
      var spacers = clone.querySelectorAll('.spacer');
      for (var p = spacers.length - 1; p >= 0; p -= 1) {
        spacers[p].parentNode.removeChild(spacers[p]);
      }
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
          if (cells[j].className.indexOf('spacer') >= 0) continue;
          values.push((cells[j].innerText || cells[j].textContent || '').replace(/\\s*\\n\\s*/g, '; ').trim());
        }
        lines.push(values.join('\\t'));
      }
      return lines.join('\\n');
    }

    function readTableMatrix(table) {
      var matrix = [];
      var rows = table.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i += 1) {
        var cells = rows[i].querySelectorAll('th, td');
        var values = [];
        for (var j = 0; j < cells.length; j += 1) {
          var cell = cells[j];
          if (cell.className.indexOf('spacer') >= 0) continue;
          var items = cell.querySelectorAll('li');
          if (items.length > 0) {
            var parts = [];
            var heading = cell.querySelector('strong');
            if (heading) parts.push((heading.innerText || heading.textContent || '').trim());
            for (var k = 0; k < items.length; k += 1) {
              parts.push((items[k].innerText || items[k].textContent || '').trim());
            }
            values.push(parts.join('\\n'));
          } else {
            values.push((cell.innerText || cell.textContent || '').replace(/\\s*\\n\\s*/g, '\\n').trim());
          }
        }
        matrix.push(values);
      }
      return matrix;
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

    function toggleParentheses(checkbox, tableId) {
      var table = document.getElementById(tableId);
      if (!table) return;
      if (checkbox.checked) {
        table.className = table.className.replace(/\\s*hide-paren/g, '');
      } else if (table.className.indexOf('hide-paren') < 0) {
        table.className += ' hide-paren';
      }
    }

    function syncLabel(source) {
      var group = source.getAttribute('data-sync-group');
      var index = source.getAttribute('data-sync-index');
      if (group === null || index === null) return;
      var text = (source.innerText || source.textContent || '').replace(/\\s+/g, ' ').trim();
      var selector = '[data-sync-group="' + group + '"][data-sync-index="' + index + '"]';
      var targets = document.querySelectorAll(selector);
      for (var i = 0; i < targets.length; i += 1) {
        if (targets[i] === source) continue;
        targets[i].textContent = text;
      }
    }

    function toggleCollisions(checkbox) {
      var table = document.getElementById('discussion-schedule-table');
      if (!table) return;
      if (checkbox.checked) {
        table.className = table.className.replace(/\\s*hide-collisions/g, '');
      } else if (table.className.indexOf('hide-collisions') < 0) {
        table.className += ' hide-collisions';
      }
    }

    function toggleAnonymous(checkbox) {
      var anonymous = checkbox.checked;
      var names = document.querySelectorAll('.pname');
      for (var i = 0; i < names.length; i += 1) {
        names[i].textContent = anonymous
          ? names[i].getAttribute('data-anon')
          : names[i].getAttribute('data-real');
      }
    }

    function exportTableToExcel(button, tableId, filenameBase) {
      var table = document.getElementById(tableId);
      if (!table || typeof window.buildTableWorkbook !== 'function') return;
      var originalLabel = button.getAttribute('data-label') || button.textContent;
      button.setAttribute('data-label', originalLabel);
      button.textContent = 'Lager Excel …';
      window.buildTableWorkbook(readTableMatrix(table), filenameBase).then(function (download) {
        var link = document.createElement('a');
        link.href = download.url;
        link.download = download.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(download.url); }, 10000);
        button.textContent = 'Lastet ned!';
        setTimeout(function () { button.textContent = originalLabel; }, 2000);
      }, function () {
        button.textContent = 'Eksport feilet';
        setTimeout(function () { button.textContent = originalLabel; }, 2000);
      });
    }

    document.addEventListener('paste', function (event) {
      var target = event.target;
      if (!target || !target.className || String(target.className).indexOf('editable-label') < 0) return;
      event.preventDefault();
      var clipboard = event.clipboardData || window.clipboardData;
      var text = clipboard ? clipboard.getData('text') : '';
      document.execCommand('insertText', false, text.replace(/\\s+/g, ' ').trim());
      syncLabel(target);
    });
  </script>
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
