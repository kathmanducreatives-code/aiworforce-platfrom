import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

const safeMessage = (e: Error | null) =>
  e?.message?.replace(/https?:\/\/[^\s)]+/g, '[request-url]') || 'This page hit an unexpected error.';

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[RouteErrorBoundary]', error, info.componentStack);
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card/90 backdrop-blur-xl p-6 text-center shadow-2xl">
          <AlertTriangle className="h-6 w-6 text-warning mx-auto mb-3" />
          <div className="text-base font-medium mb-1 text-foreground">This page hit a problem</div>
          <div className="text-xs text-muted-foreground mb-5 break-words">
            {safeMessage(this.state.error)}
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
