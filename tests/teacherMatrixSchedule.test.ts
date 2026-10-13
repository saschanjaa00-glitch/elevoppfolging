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

  it('limits meetings by student count, keeps contact classes, and breaks ties alphabetically', () => {
    const classNames = ['1A', '1B', '1C', '1D']
    const contactRecord = absence('1A', 'Felles Lærer', 1)
    contactRecord.kontaktlaerer = 'Felles Lærer'
    const absences = [
      contactRecord,
      ...Array.from({ length: 5 }, (_, index) => absence('1B', 'Felles Lærer', index + 10)),
      ...Array.from({ length: 5 }, (_, index) => absence('1C', 'Felles Lærer', index + 20)),
      ...Array.from({ length: 3 }, (_, index) => absence('1D', 'Felles Lærer', index + 30)),
    ]
    const presets = classNames.flatMap(className => [
      preset(`Rådgiver ${className}`, 'Rådgiver', [className]),
      preset(`Leder ${className}`, 'Avdelingsleder', [className]),
    ])

    const schedule = buildDiscussionSchedule(absences, classNames, presets, null, 2)
    const teacherClasses = schedule?.slots
      .flatMap(slot => slot.assignments)
      .filter(assignment => assignment.teacherKeys?.some(key => key.includes('felles')))
      .map(assignment => assignment.className)
      .sort()

    expect(schedule?.maxMeetings).toBe(2)
    expect(teacherClasses).toEqual(['1A', '1B'])
    const overview = buildTeacherMeetingOverview(schedule!)
    expect(overview.teachers.find(teacher => teacher.name === 'Felles Lærer')?.total)
      .toBeLessThanOrEqual(2)
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
    const schedule = buildDiscussionSchedule(absences, classNames, presets)

    const html = buildTeacherMatrixHtml(sections, schedule)

    expect(html).not.toContain('Lærernes klassefordeling')
    expect(html).toContain('Forslag til tidsplan for klasselærerråd')
    expect(html).toContain('Rom 1')
    expect(html).toContain('Trinnleder/avdelingsleder: <span class="pname" data-real="Leder A" data-anon="Leder 1">Leder A</span>')
    expect(html).toContain('u/kollisjon')
    expect(html).toContain('m/kollisjon')
    expect(html).toContain('total ·')
    expect(html).toContain('class="schedule-table hide-collisions"')
    expect(html).toContain('onchange="toggleCollisions(this)"')
    expect(html).toContain('Vis kollisjoner')
    expect(html).toContain('Lærerfordeling per tidsluke')
    expect(html).toContain('<strong>1A<span class="paren"> (0+1)</span></strong>')
    expect(html).toContain('<b><span class="pname" data-real="Lærer 1A" data-anon="Lærer 1">Lærer 1A</span><span class="paren"> (<u>1</u> / 0)</span></b>')
    expect(html).toContain("toggleParentheses(this, 'teacher-schedule-table')")
    expect(html).toContain('Vis tall i parentes')
    expect(html).toContain('class="schedule-table teacher-schedule-table hide-paren"')
    expect(html).toContain('contenteditable="true"')
    expect(html).toContain('Klikk på et rom- eller tidsnavn for å endre det.')
    expect(html).toContain('data-sync-group="room"')
    expect(html).toContain('oninput="syncLabel(this)"')
    expect(html).toContain('data-sync-group="slot" data-sync-index="0"')
    expect(html).toContain('id="discussion-schedule-table"')
    expect(html).toContain('id="teacher-schedule-table"')
    expect(html).toContain("copyScheduleTable(this, 'discussion-schedule-table')")
    expect(html).toContain("copyScheduleTable(this, 'teacher-schedule-table')")
    expect(html).toContain('Møteoversikt per lærer')
    expect(html).toContain('id="teacher-meeting-table"')
    expect(html).toContain("copyScheduleTable(this, 'teacher-meeting-table')")
    expect(html).toContain('toggleMeetingCounts(this)')
    expect(html).toContain('Vis antall elever')
    expect(html).toContain('data-count=')
  })

  it('offers anonymisation plus copy and Excel export on every table', () => {
    const classNames = ['1A', '1B']
    const absences = [
      absence('1A', 'Anne Berg', 1),
      absence('1B', 'Bjørn Dahl', 2),
    ]
    const presets = [
      preset('Rådgiver A', 'Rådgiver', ['1A']),
      preset('Rådgiver B', 'Rådgiver', ['1B']),
      preset('Leder A', 'Avdelingsleder', ['1A']),
      preset('Leder B', 'Trinnleder', ['1B']),
    ]
    const sections = buildTeacherMatrixSections(absences, classNames)
    const schedule = buildDiscussionSchedule(absences, classNames, presets)

    const html = buildTeacherMatrixHtml(sections, schedule)

    expect(html).toContain('toggleAnonymous(this)')
    expect(html).toContain('Anonymiser')
    expect(html).toContain('data-anon="Elev 1"')
    expect(html).toContain('data-anon="Lærer 1"')
    expect(html).toContain('data-anon="Rådgiver 1"')
    expect(html).toContain('data-anon="Leder 1"')

    const tableIds = [
      'matrix-table-0',
      'matrix-table-1',
      'discussion-schedule-table',
      'teacher-schedule-table',
      'teacher-meeting-table',
    ]
    tableIds.forEach(tableId => {
      expect(html).toContain(`id="${tableId}"`)
      if (tableId.startsWith('matrix-table-')) {
        expect(html).not.toContain(`copyTableAsPng(this, '${tableId}')`)
        expect(html).not.toContain(`copyScheduleTable(this, '${tableId}')`)
        expect(html).not.toContain(`exportTableToExcel(this, '${tableId}'`)
      } else {
        expect(html).toContain(`copyScheduleTable(this, '${tableId}')`)
        expect(html).toContain(`exportTableToExcel(this, '${tableId}'`)
      }
    })
    expect(html).not.toContain('renderTablePng')
  })
})
