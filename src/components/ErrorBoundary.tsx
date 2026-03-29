import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GuiAgo crash:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '2rem',
          background: '#fafaf9', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🗺️</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#1c1917', marginBottom: '0.5rem' }}>
            Algo fue mal
          </h1>
          <p style={{ color: '#78716c', fontSize: '0.875rem', textAlign: 'center', marginBottom: '1.5rem', maxWidth: '20rem' }}>
            Ha ocurrido un error inesperado. Recarga la app para continuar.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#F97316', color: 'white', border: 'none', borderRadius: '1rem',
              padding: '0.875rem 2rem', fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(249,115,22,0.3)'
            }}
          >
            Recargar GuiAgo
          </button>
          {this.state.error && (
            <p style={{ color: '#a8a29e', fontSize: '0.7rem', marginTop: '1.5rem', maxWidth: '20rem', textAlign: 'center', wordBreak: 'break-all' }}>
              {this.state.error.message}
            </p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
