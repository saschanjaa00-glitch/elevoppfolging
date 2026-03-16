import type { DataStore } from './types'
import { normalizeMatch } from './studentInfoUtils'

const FIRST_NAMES: string[] = [
  'James', 'Emma', 'Oliver', 'Sophia', 'William', 'Ava', 'Benjamin', 'Isabella',
  'Lucas', 'Mia', 'Henry', 'Charlotte', 'Alexander', 'Amelia', 'Mason', 'Harper',
  'Ethan', 'Evelyn', 'Daniel', 'Abigail', 'Michael', 'Emily', 'Logan', 'Elizabeth',
  'Jackson', 'Mila', 'Sebastian', 'Ella', 'Jack', 'Scarlett', 'Aiden', 'Grace',
  'Owen', 'Chloe', 'Samuel', 'Victoria', 'Matthew', 'Riley', 'Joseph', 'Aria',
  'Liam', 'Lily', 'Noah', 'Layla', 'Elijah', 'Zoe', 'Jayden', 'Natalie',
  'Gabriel', 'Madison', 'Carter', 'Hannah', 'Julian', 'Addison', 'Wyatt', 'Aubrey',
  'Luke', 'Ellie', 'Isaac', 'Stella', 'Dylan', 'Violet', 'Anthony', 'Penelope',
  'Leo', 'Claire', 'Lincoln', 'Aurora', 'Jaxon', 'Nora', 'Asher', 'Skylar',
  'Christopher', 'Sofia', 'Joshua', 'Eleanor', 'Andrew', 'Paisley', 'Caleb', 'Savannah',
  'Ryan', 'Anna', 'Nathan', 'Hazel', 'Aaron', 'Isla', 'Christian', 'Willow',
  'Landon', 'Leah', 'Hunter', 'Lillian', 'Connor', 'Lucy', 'Eli', 'Alice',
  'David', 'Bella', 'Charlie', 'Brooklyn', 'Jonathan', 'Alexa', 'Colton', 'Naomi',
  'Evan', 'Caroline', 'Hudson', 'Elena', 'Dominic', 'Maya', 'Tucker', 'Julia',
  'Xavier', 'Ariana', 'Levi', 'Aaliyah', 'Adrian', 'Madelyn', 'Gavin', 'Eva',
  'Nolan', 'Quinn', 'Camden', 'Piper', 'Tyler', 'Serenity', 'Kayden', 'Valentina',
  'Robert', 'Lydia', 'Brayden', 'Eliana', 'Jordan', 'Marcus', 'Isabel', 'Finn',
  'Zara', 'Oscar', 'Freya', 'Theo', 'Ivy', 'Felix', 'Ruby',
]

const LAST_NAMES: string[] = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Turner', 'Phillips', 'Evans', 'Collins', 'Edwards', 'Stewart',
  'Morris', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper',
  'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward',
  'Richardson', 'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray',
  'Mendoza', 'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel',
  'Myers', 'Long', 'Ross', 'Foster', 'Jimenez', 'Powell', 'Jenkins', 'Perry',
  'Russell', 'Sullivan', 'Bell', 'Coleman', 'Butler', 'Henderson', 'Barnes', 'Fisher',
  'Vasquez', 'Simmons', 'Romero', 'Jordan', 'Patterson', 'Alexander', 'Hamilton',
  'Graham', 'Reynolds', 'Griffin', 'Wallace', 'Moreno', 'West', 'Cole', 'Hayes',
  'Bryant', 'Herrera', 'Gibson', 'Ford', 'Ellis', 'Harrison', 'Stone', 'Murray',
  'Marshall', 'Owens', 'McDonald', 'Kennedy', 'Wells', 'Dixon', 'Robertson', 'Black',
  'Dunn', 'Daniels', 'Palmer', 'Fuller', 'Bradley', 'Lawrence', 'Newman', 'Howell',
  'Burke', 'Webb', 'Austin', 'Grant', 'Harvey', 'Nichols', 'Garrett', 'Oliver',
  'Weaver', 'Stevens', 'Mason', 'Warren', 'Walsh', 'Lane', 'Shaw', 'Freeman',
  'Logan', 'Hicks', 'Norris', 'Knight', 'Pearson', 'Flynn', 'Wade', 'Hampton',
  'Sharp', 'Carroll', 'Ryan', 'Diaz', 'Watts', 'Barker', 'Chambers', 'Fox',
  'Porter', 'Cunningham', 'Reid', 'Carr', 'Fleming', 'Spencer', 'Holland', 'Hawkins',
  'Ferguson', 'Park', 'Bishop', 'Lynch', 'Barton', 'Spencer', 'Craig', 'Goodwin',
  'Santos', 'Murray', 'Price', 'Moss', 'Burns', 'Warren', 'Gardner', 'Fowler',
]

function buildFakeName(index: number): string {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]
  const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]
  return `${first} ${last}`
}

export function anonymizeData(data: DataStore): DataStore {
  // Collect all unique student names
  const studentNamesSet = new Set<string>()
  data.absences.forEach(r => { if (r.navn) studentNamesSet.add(r.navn) })
  data.warnings.forEach(r => { if (r.navn) studentNamesSet.add(r.navn) })
  data.grades.forEach(r => { if (r.navn) studentNamesSet.add(r.navn) })
  data.studentInfo.forEach(r => { if (r.navn) studentNamesSet.add(r.navn) })

  // Collect all unique teacher names
  const teacherNamesSet = new Set<string>()
  data.absences.forEach(r => { if (r.teacher) teacherNamesSet.add(r.teacher) })
  data.grades.forEach(r => { if (r.subjectTeacher) teacherNamesSet.add(r.subjectTeacher) })

  // Build normalized → canonical real name maps (avoid duplicates from casing/spacing)
  const studentCanonical = new Map<string, string>()
  studentNamesSet.forEach(name => {
    const key = normalizeMatch(name)
    if (!studentCanonical.has(key)) studentCanonical.set(key, name)
  })

  const teacherCanonical = new Map<string, string>()
  teacherNamesSet.forEach(name => {
    const key = normalizeMatch(name)
    if (!teacherCanonical.has(key)) teacherCanonical.set(key, name)
  })

  // Shuffle index offsets so names appear random
  const studentNames = Array.from(studentCanonical.keys())
  const teacherNames = Array.from(teacherCanonical.keys())

  // Assign fake names
  const studentMap = new Map<string, string>()
  studentNames.forEach((normName, i) => {
    studentMap.set(normName, buildFakeName(i))
  })

  const teacherMap = new Map<string, string>()
  teacherNames.forEach((normName, i) => {
    teacherMap.set(normName, buildFakeName((i + 37) % (FIRST_NAMES.length * LAST_NAMES.length)))
  })

  const fakeStudent = (name: string): string =>
    studentMap.get(normalizeMatch(name)) ?? name

  const fakeTeacher = (name: string): string =>
    teacherMap.get(normalizeMatch(name)) ?? name

  return {
    absences: data.absences.map(r => ({
      ...r,
      navn: fakeStudent(r.navn),
      teacher: r.teacher ? fakeTeacher(r.teacher) : r.teacher,
    })),
    warnings: data.warnings.map(r => ({
      ...r,
      navn: fakeStudent(r.navn),
    })),
    grades: data.grades.map(r => ({
      ...r,
      navn: fakeStudent(r.navn),
      subjectTeacher: r.subjectTeacher ? fakeTeacher(r.subjectTeacher) : r.subjectTeacher,
    })),
    studentInfo: data.studentInfo.map(r => {
      const fake = fakeStudent(r.navn)
      const parts = fake.split(' ')
      const fornavn = parts[0] ?? r.fornavn
      const etternavn = parts.slice(1).join(' ') || r.etternavn
      return {
        ...r,
        navn: fake,
        fornavn,
        etternavn,
      }
    }),
    warningFileCreatedDate: data.warningFileCreatedDate,
  }
}
