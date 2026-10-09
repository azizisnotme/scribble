import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[scribble] view crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="grid h-screen place-items-center bg-background p-6 text-foreground">
        <section className="w-full max-w-lg rounded-2xl border border-destructive/35 bg-card p-6 text-center shadow-2xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">Scribble hit an unexpected problem</h1>
          <p className="mt-2 break-words text-[13px] text-muted-foreground">{this.state.error.message}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button type="button" onClick={() => window.location.reload()}>
              Restart app
            </Button>
          </div>
        </section>
      </main>
    )
  }
}

