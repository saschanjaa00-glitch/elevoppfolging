# Oppfølging Project Instructions

## Project Overview

Oppfølging is a student absence and performance tracking web application. It allows educators to import Excel files containing student absence data and warning letter information, then analyze and export reports.

## Technology Stack

- **Frontend**: React 19 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Data Parsing**: XLSX library
- **Icons**: Lucide React

## Project Structure

```
src/
├── components/
│   ├── FileUpload.tsx       # Excel file import and parsing
│   ├── ClassSelector.tsx    # Class selection dropdown
│   ├── StudentList.tsx      # List of at-risk students
│   ├── StudentDetail.tsx    # Individual student details
│   └── ReportExport.tsx     # CSV report generation
├── App.tsx                  # Main application component
├── types.ts                 # TypeScript type definitions
├── main.tsx                 # Application entry point
└── index.css                # Tailwind CSS configuration
```

## Key Features

1. **Excel Import**
   - Parses absence and warning letter files
   - Column mapping: Navn, Klasse, Fagnavn, H1+H2 % udok. fravær, H1+H2 timer udok. fravær, Lærer, Avbrudd
   - Supports multiple subjects per student

2. **Class Management**
   - Filter students by class (1STA, 2STA, etc.)
   - Dynamically extracts class list from imported data

3. **Absence Analysis**
   - Adjustable threshold (default 7.5%)
   - Color-coded risk levels (Amber >threshold, Red >15%)
   - Special handling for "Avbrudd" (discontinued) students

4. **Student Details**
   - Per-subject absence information
   - Teacher contact details
   - Warning letter counts by type
   - Aggregated absence data

5. **Report Export**
   - CSV format export for selected classes
   - Customizable absence threshold
   - Preview table before export

## Data Model

- **AbsenceRecord**: Individual subject absence record
- **WarningRecord**: Warning letters issued to a student
- **GradeRecord**: (Prepared for future integration) Term grades
- **DataStore**: Top-level data container

## Development Guidelines

1. **Component Organization**
   - One component per file
   - Props are typed with interfaces
   - Use React hooks (useState, useMemo) for state management

2. **TypeScript Usage**
   - All functions and components are typed
   - Use type-only imports for type definitions
   - Enable strict mode checking

3. **Styling**
   - Use Tailwind CSS utilities exclusively
   - Custom components in @layer components
   - Consistent color scheme with sky palette for primary colors

4. **Data Flow**
   - State managed at App.tsx level
   - Passed down via props to child components
   - No external database - purely client-side

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Excel File Format

### Required Columns (Absence File)
- Navn (Student name)
- Klasse (Class)
- Fagnavn (Subject name)
- H1+H2 % udok. fravær (Absence %)
- H1+H2 timer udok. fravær (Hours absent)
- Lærer (Teacher)
- Avbrudd (Discontinued status)

### Optional Columns (Warning File)
- Navn (Student name)
- Klasse (Class)
- Varselbrev totalt (Total warnings)
- Varselbrev karakter (Grade warnings)
- Varselbrev fravær (Absence warnings)

## Future Enhancement Areas

1. Grade data integration (Term 1 grades)
2. Absence trend analysis over time
3. Email notifications for at-risk students
4. Historical data tracking and comparison
5. Custom reporting templates
6. Data persistence with localStorage or IndexedDB
7. Dark mode support

## Important Notes

- All data is stored in-browser memory only
- No network requests are made
- Data is cleared when browser is closed unless explicitly saved
- CSV exports preserve data for future reference
