import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import FileUpload from './components/FileUpload'
import ClassSelector from './components/ClassSelector'
import StudentList from './components/StudentList'
import ReportExport from './components/ReportExport'
import type { DataStore } from './types'
import './index.css'

function App() {
  const [data, setData] = useState<DataStore>({
    absences: [],
    warnings: [],
    grades: [],
  })

  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [absenceThreshold, setAbsenceThreshold] = useState<number>(7.5)
  const [view, setView] = useState<'list' | 'report'>('list')

  const handleDataImport = (importedData: DataStore) => {
    setData(importedData)
    setSelectedClasses([])
  }

  const hasData = data.absences.length > 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Header */}
      <header className="no-print border-b border-slate-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-sky-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">Ø</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Oppfølging</h1>
            </div>
            <p className="text-sm text-slate-600">
              Student Absence & Performance Tracker
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!hasData ? (
          <FileUpload onDataImport={handleDataImport} />
        ) : (
          <div className="space-y-6">
            {/* Navigation Tabs */}
            <div className="flex space-x-2 border-b border-slate-200">
              <button
                onClick={() => setView('list')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                  view === 'list'
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Student List
              </button>
              <button
                onClick={() => setView('report')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                  view === 'report'
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Export Report
              </button>
              <button
                onClick={() => {
                  setData({ absences: [], warnings: [], grades: [] })
                  setSelectedClasses([])
                  setView('list')
                }}
                className="ml-auto px-4 py-2 text-slate-600 hover:text-slate-900 font-medium transition-colors"
              >
                Upload New Files
              </button>
            </div>

            {/* Settings Panel */}
            {view === 'list' && (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <aside className="lg:col-span-1 no-print">
                  {/* Presets */}
                  <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                      Teacher Presets
                    </h3>
                    <div className="space-y-2">
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '3STA', '3STB', '3STC', '3STD', '3STE', '3STF',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Anja
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1STA', '1STB', '1STC', '1STD', '1STE', '1STF',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Christin
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1STA', '2STA', '3STA',
                            '1TID', '2TID', '3TID',
                            '1TMT', '2TMT', '3TMT',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Sigurd
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '1IDA', '1IDB', '2IDA', '2IDB', '3IDA', '3IDB',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Jørund
                      </button>
                      <button
                        onClick={() =>
                          setSelectedClasses([
                            '2STA', '2STB', '2STC', '2STD', '2STE', '2STF',
                          ])
                        }
                        className="w-full px-3 py-2 text-xs text-left font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 rounded transition-colors"
                      >
                        Siri
                      </button>
                    </div>
                  </div>

                  <ClassSelector
                    data={data}
                    selectedClasses={selectedClasses}
                    onClassChange={setSelectedClasses}
                  />
                </aside>

                <section className="lg:col-span-3 space-y-6">
                  <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
                    <div className="w-full sm:w-72">
                      <label className="block text-sm font-medium text-slate-900 mb-2">
                        Absence Threshold (%)
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="range"
                          min="0"
                          max="20"
                          step="0.5"
                          value={absenceThreshold}
                          onChange={e =>
                            setAbsenceThreshold(parseFloat(e.target.value))
                          }
                          className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-lg font-semibold text-sky-600 min-w-12">
                          {absenceThreshold.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {selectedClasses.length > 0 && (
                    <StudentList
                      data={data}
                      selectedClasses={selectedClasses}
                      threshold={absenceThreshold}
                    />
                  )}

                  {selectedClasses.length === 0 && (
                    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-12 text-center">
                      <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-slate-600">
                        Please select one or more classes to view the student
                        list
                      </p>
                    </div>
                  )}
                </section>
              </div>
            )}

            {view === 'report' && <ReportExport data={data} />}
          </div>
        )}
      </main>
    </div>
  )
}

export default App
