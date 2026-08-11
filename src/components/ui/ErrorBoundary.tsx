import { Component, type ReactNode } from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional reset key — change this to force the error boundary to clear. */
  resetKey?: string | number
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { hasError: true, error } }
  componentDidCatch(error: Error) {
    console.error('App Crashed:', error)
    // A stale service worker (from a previous deploy) served a hashed
    // chunk URL that no longer exists on the server (e.g.
    // SchedulePage-<old-hash>.js). Retrying the same import can never
    // succeed — the chunk is gone. A hard reload fetches the fresh
    // index.html, activates the new service worker (skipWaiting), and
    // loads the current chunk hashes. Guard with sessionStorage to
    // prevent a reload loop if the new build is also broken.
    const isChunkError =
      error instanceof TypeError &&
      /Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported/i.test(error.message)
    if (isChunkError && !sessionStorage.getItem('momentum-reloaded-on-chunk-error')) {
      sessionStorage.setItem('momentum-reloaded-on-chunk-error', '1')
      window.location.reload()
    } else {
      sessionStorage.removeItem('momentum-reloaded-on-chunk-error')
    }
  }
  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null })
    }
  }
  retry = () => this.setState({ hasError: false, error: null })
  render() {
    if (this.state.hasError) {
      const stack = this.state.error?.stack ?? ''
      return (
        <div className="flex h-screen flex-col items-center justify-center p-4 text-center">
          <h1 className="text-xl font-bold text-red-600">Something went wrong</h1>
          <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300">
            {this.state.error?.message ?? 'Unknown error'}
          </p>
          {stack && (
            <details className="mt-2 max-w-md text-left text-xs text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer select-none">Stack trace</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-left text-[10px] dark:bg-slate-800">{stack}</pre>
            </details>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
              onClick={this.retry}
            >
              Try Again
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}