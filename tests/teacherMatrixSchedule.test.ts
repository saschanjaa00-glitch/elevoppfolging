import { describe, expect, it } from 'vitest'
import {
  buildDiscussionSchedule,
  buildTeacherClassRankOverview,
  buildTeacherMatrixHtml,
  buildTeacherMatrixSections,
  buildTeacherMeetingOverview,
} from '../src/teacherMatrixPrint'
import type { AbsenceRecord, PresetRecord } from '../src/types'

function absence(className: string, teacher: string, studentNumber: number): AbsenceRecord {
  return {
    navn: `Elev ${studentNumber} ${className}`,
    class: className,
    subject: 'Testfag',
    subjectGroup: `${className}/TEST`,
    percentageAbsence: 0,
    hoursAbsence: 0,
    teacher,
    avbrudd: false,
  }
}

function preset(navn: string, rolle: string, klasser: string[]): PresetRecord {
  return { navn, rolle, klasser }
}

describe('teacher discussion scheduling', () => {
  it('keeps adviser rooms fixed and prevents required-person conflicts', () => {
    const classNames = ['1A', '1B', '1C']
    const absences = classNames.map(className => absence(className, `Lærer ${className}`, 1))
    const presets = [
      preset('Rådgiver Rød', 'Rådgiver', ['1A', '1C']),
      preset('Rådgiver Blå', 'Rådgiver', ['1B']),
      preset('Felles leder', 'Avdelingsleder', ['1A', '1B']),
      preset('Annen leder', 'Trinnleder', ['1C']),
    ]

    const schedule = buildDiscussionSchedule(absences, classNames, presets)

    expect(schedule).not.toBeNull()
    expect(schedule?.rooms.map(room => room.adviser)).toEqual(['Rådgiver Blå', 'Rådgiver Rød'])
    expect(schedule?.slots).toHaveLength(2)
    for (const slot of schedule?.slots ?? []) {
      expect(new Set(slot.assignments.map(item => item.adviser)).size).toBe(slot.assignments.length)
      const leaders = slot.assignments.flatMap(item => item.leaders)
      expect(new Set(leaders).size).toBe(leaders.length)
    }
  })

  it('balances four classes as two plus two instead of three plus one', () => {
    const classNames = ['A1', 'A2', 'B1', 'C1']
    const absences = classNames.map(className => absence(className, `Lærer ${className}`, 1))
    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['A1', 'A2']),
      preset('Rådgiver B', 'Rådgiver', ['B1']),
      preset('Rådgiver C', 'Rådgiver', ['C1']),
      ...classNames.map(className => preset(`Leder ${className}`, 'Avdelingsleder', [className])),
    ]

    const schedule = buildDiscussionSchedule(absences, classNames, presets)

    expect(schedule?.slots.map(slot => slot.assignments.length)).toEqual([2, 2])
  })

  it('separates the teacher’s two highest-weight classes when balance is unchanged', () => {
    const classNames = ['A1', 'A2', 'B1', 'B2']
    const absences: AbsenceRecord[] = []
    for (let student = 1; student <= 10; student += 1) {
      absences.push(absence('A1', 'Felles lærer', student))
      absences.push(absence('B1', 'Felles lærer', student))
    }
    absences.push(absence('A2', 'Felles lærer', 1), absence('B2', 'Felles lærer', 1))

    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['A1', 'A2']),
      preset('Rådgiver B', 'Rådgiver', ['B1', 'B2']),
      ...classNames.map(className => preset(`Leder ${className}`, 'Trinnleder', [className])),
    ]

    const schedule = buildDiscussionSchedule(absences, classNames, presets)
    const slotFor = (className: string) =>
      schedule?.slots.findIndex(slot => slot.assignments.some(item => item.className === className))

    expect(schedule?.slots.map(slot => slot.assignments.length)).toEqual([2, 2])
    expect(slotFor('A1')).not.toBe(slotFor('B1'))
  })

  it('lists time slots with the most empty rooms last', () => {
    const classNames = ['A1', 'A2', 'A3', 'B1', 'C1']
    const absences = classNames.map(className => absence(className, `Lærer ${className}`, 1))
    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['A1', 'A2', 'A3']),
      preset('Rådgiver B', 'Rådgiver', ['B1']),
      preset('Rådgiver C', 'Rådgiver', ['C1']),
      ...classNames.map(className => preset(`Leder ${className}`, 'Avdelingsleder', [className])),
    ]

    const schedule = buildDiscussionSchedule(absences, classNames, presets)
    const sizes = schedule?.slots.map(slot => slot.assignments.length) ?? []

    expect(sizes.length).toBeGreaterThan(1)
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]).toBeLessThanOrEqual(sizes[index - 1])
    }
    expect(schedule?.slots.map(slot => slot.label)).toEqual(
      sizes.map((_, index) => `Tid ${index + 1}`)
    )
  })

  it('pins contact teachers to their class and assigns other teachers by student weight', () => {
    const classNames = ['A1', 'B1']
    const contactRecord = absence('A1', 'Lærer A', 1)
    contactRecord.kontaktlaerer = 'Kontakt Lærer'
    const absences = [
      contactRecord,
      absence('A1', 'Valgfri Lærer', 2),
      ...Array.from({ length: 4 }, (_, index) => absence('B1', 'Kontakt Lærer', index + 1)),
      ...Array.from({ length: 3 }, (_, index) => absence('B1', 'Valgfri Lærer', index + 10)),
      absence('B1', 'Zebra Lærer', 20),
    ]
    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['A1']),
      preset('Rådgiver B', 'Rådgiver', ['B1']),
      preset('Leder A', 'Avdelingsleder', ['A1']),
      preset('Leder B', 'Avdelingsleder', ['B1']),
    ]

    const schedule = buildDiscussionSchedule(absences, classNames, presets)
    const assignmentFor = (className: string) =>
      schedule?.slots.flatMap(slot => slot.assignments).find(item => item.className === className)

    expect(assignmentFor('A1')?.assignedTeachers).toContainEqual({
      name: 'Kontakt Lærer',
      studentCount: 0,
      isContactTeacher: true,
      slotStudentCounts: [0, 4],
      placedSlotIndex: 0,
    })
    expect(assignmentFor('B1')?.assignedTeachers?.map(teacher => teacher.name))
      .toContain('Valgfri Lærer')
    expect(assignmentFor('B1')?.assignedTeachers?.map(teacher => teacher.name))
      .not.toContain('Kontakt Lærer')
    expect(assignmentFor('B1')?.assignedTeachers?.map(teacher => teacher.name))
      .toEqual(['Zebra Lærer', 'Valgfri Lærer'])
  })

  it('builds a teacher meeting overview with per-slot classes and totals', () => {
    const classNames = ['1A', '1B', '1C']
    const absences = [
      absence('1A', 'Anne Berg', 1),
      absence('1B', 'Anne Berg', 2),
      absence('1C', 'Bjørn Dahl', 3),
    ]
    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['1A', '1B']),
      preset('Rådgiver B', 'Rådgiver', ['1C']),
      ...classNames.map(className => preset(`Leder ${className}`, 'Avdelingsleder', [className])),
    ]

    const schedule = buildDiscussionSchedule(absences, classNames, presets)
    const overview = buildTeacherMeetingOverview(schedule!)

    expect(overview.slotLabels).toEqual(schedule?.slots.map(slot => slot.label))
    expect(overview.teachers.map(teacher => teacher.name)).toEqual(['Anne Berg', 'Bjørn Dahl'])

    const anne = overview.teachers.find(teacher => teacher.name === 'Anne Berg')
    expect(anne?.total).toBe(2)
    expect(anne?.classBySlot.filter(Boolean).sort()).toEqual(['1A', '1B'])

    const bjorn = overview.teachers.find(teacher => teacher.name === 'Bjørn Dahl')
    expect(bjorn?.total).toBe(1)
    expect(bjorn?.classBySlot.filter(Boolean)).toEqual(['1C'])

    expect(anne?.classWithCountBySlot.filter(Boolean).sort()).toEqual(['1A (1)', '1B (1)'])
    expect(bjorn?.classWithCountBySlot.filter(Boolean)).toEqual(['1C (1)'])
  })

  it('excludes teachers below the minimum student filter but keeps contact teachers', () => {
    const classNames = ['1A', '1B']
    const smallRecord = absence('1A', 'Liten Lærer', 1)
    smallRecord.kontaktlaerer = 'Kontakt Lærer'
    const absences = [
      smallRecord,
      ...Array.from({ length: 3 }, (_, index) => absence('1A', 'Stor Lærer', index + 1)),
      ...Array.from({ length: 5 }, (_, index) => absence('1B', 'Stor Lærer', index + 10)),
    ]
    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['1A']),
      preset('Rådgiver B', 'Rådgiver', ['1B']),
      preset('Leder A', 'Avdelingsleder', ['1A']),
      preset('Leder B', 'Avdelingsleder', ['1B']),
    ]

    const unfiltered = buildDiscussionSchedule(absences, classNames, presets)
    const unfilteredNames = unfiltered?.slots
      .flatMap(slot => slot.assignments)
      .flatMap(item => item.assignedTeachers ?? [])
      .map(teacher => teacher.name)
    expect(unfilteredNames).toContain('Liten Lærer')

    const filtered = buildDiscussionSchedule(absences, classNames, presets, 4)
    const filteredNames = filtered?.slots
      .flatMap(slot => slot.assignments)
      .flatMap(item => item.assignedTeachers ?? [])
      .map(teacher => teacher.name)

    expect(filtered?.minStudents).toBe(4)
    expect(filteredNames).not.toContain('Liten Lærer')
    expect(filteredNames).toContain('Kontakt Lærer')
    expect(filteredNames).toContain('Stor Lærer')
  })

  it('renders the schedule as the final print section', () => {
    const classNames = ['1A', '1B']
    const absences = classNames.map(className => absence(className, `Lærer ${className}`, 1))
    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['1A']),
      preset('Rådgiver B', 'Rådgiver', ['1B']),
      preset('Leder A', 'Avdelingsleder', ['1A']),
      preset('Leder B', 'Trinnleder', ['1B']),
    ]
    const sections = buildTeacherMatrixSections(absences, classNames)
    const overview = buildTeacherClassRankOverview(absences, sections)
    const schedule = buildDiscussionSchedule(absences, classNames, presets)

    const html = buildTeacherMatrixHtml(sections, overview, schedule)

    expect(html.lastIndexOf('Forslag til tidsplan for klasselærerråd'))
      .toBeGreaterThan(html.lastIndexOf('Lærernes klassefordeling'))
    expect(html).toContain('Rom 1')
    expect(html).toContain('Trinnleder/avdelingsleder: Leder A')
    expect(html).toContain('u/kollisjon')
    expect(html).toContain('m/kollisjon')
    expect(html).toContain('total ·')
    expect(html).toContain('Lærerfordeling per tidsluke')
    expect(html).toContain('<b>Lærer 1A (<u>1</u> / 0)</b>')
    expect(html).toContain('id="discussion-schedule-table"')
    expect(html).toContain('id="teacher-schedule-table"')
    expect(html).toContain("copyScheduleTable(this, 'discussion-schedule-table')")
    expect(html).toContain("copyScheduleTable(this, 'teacher-schedule-table')")
    expect(html).toContain('Møteoversikt per lærer')
    expect(html).toContain('id="teacher-meeting-table"')
    expect(html).toContain('id="teacher-meeting-excel"')
    expect(html).toContain("copyScheduleTable(this, 'teacher-meeting-table')")
    expect(html).toContain('toggleMeetingCounts(this)')
    expect(html).toContain('Vis antall elever')
    expect(html).toContain('data-count=')
  })
})
