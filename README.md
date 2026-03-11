# Oppfølging - Student Absence & Performance Tracker

A modern web application for tracking student absences and warning letters issued. Built with React, TypeScript, and Tailwind CSS.

## Features

- **Excel Import**: Upload student absence data and warning letter information
- **Class Selection**: Filter by class (1STA, 2STA, etc.)
- **Customizable Threshold**: Adjust the absence percentage threshold (default: 7.5%)
- **Student List View**: See all students at risk of excessive absences
  - Displays absence percentage and total hours
  - Shows subjects where students have high absence
  - Marks students with "Avbrudd" status
  - Displays warning letter counts
- **Student Detail View**: Click on any student to see:
  - Detailed subject-level absence information
  - Teacher contact information
  - Warning letters issued (total, by absence, by grades)
  - Color-coded risk levels (Red: >15%, Amber: >threshold)
- **Report Export**: Generate CSV reports for selected classes
  - Customizable absence threshold per report
  - Preview before export
  - Includes all relevant student and absence data

## Data Structure

### Expected Excel Columns

**Absence File** (Required):
- `Navn` - Student name
- `Klasse` - Class name
- `Fagnavn` - Subject name
- `H1+H2 % udok. fravær (X, M)` - Absence percentage
- `H1+H2 timer udok. fravær (X, M)` - Hours absent
- `Lærer` - Teacher name
- `Avbrudd` - Student break status (Yes/No)

**Warning Letters File** (Optional):
- `Navn` - Student name
- `Klasse` - Class name
- `Varselbrev totalt` - Total warning letters
- `Varselbrev karakter` - Warnings due to grades
- `Varselbrev fravær` - Warnings due to absence

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Development Server**:
   ```bash
   npm run dev
   ```

3. **Build for Production**:
   ```bash
   npm run build
   ```

4. **Preview Production Build**:
   ```bash
   npm run preview
   ```

## Usage

1. Open the application at `http://localhost:5174`
2. Click "Select Excel Files" to import your data
3. Upload the required Excel files in the correct format
4. Select a class from the dropdown
5. Adjust the absence threshold using the slider
6. View the student list with at-risk students
7. Click on any student to see detailed information
8. Go to "Export Report" tab to generate reports for selected classes

## Technology Stack

- **React 19** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Vite** - Fast build tool and dev server
- **XLSX** - Excel file parsing
- **Lucide React** - Icons

## Data Storage

All data is stored locally in your browser. No data is sent to external servers or databases. Closing the browser will clear the data - use the "Export Report" feature to save important information.

## Configuration

The absence threshold can be adjusted:
- Via the slider in the Settings panel (0-20%)
- Default: 7.5%
- Independent threshold per view/report

## Browser Compatibility

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

Modern browsers with ES2020+ support required.

## Future Enhancements

Planned features:
- Term 1 grade data integration
- Additional data sheets support
- Absence trend analysis
- Email notifications
- Historical data tracking
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
