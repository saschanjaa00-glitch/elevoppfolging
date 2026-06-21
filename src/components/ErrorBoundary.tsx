import React from 'react'

type Props = { children: React.ReactNode }
type State = { hasError: boolean; message?: string }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message }
  }

  componentDidCatch(error: Error, info: unknown) {
    // Could log to telemetry here
    // console.error('ErrorBoundary caught', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card p-6 bg-rose-50 border border-rose-200 rounded-lg">
          <h3 className="text-lg font-semibold text-rose-700">Feil i visning</h3>
          <p className="text-sm text-rose-700 mt-2">Det oppstod en feil ved lasting av innholdet: {this.state.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
