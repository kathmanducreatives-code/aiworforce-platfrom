import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

const getSafeErrorMessage = (error: Error | null) => {
  if (!error?.message) return 'An unexpected interface error occurred.';
  return error.message.replace(/https?:\/\/[^\s)]+/g, '[request-url]');
};

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[AppErrorBoundary]', error, info.componentStack);
    }
  }

  private reload = () => window.location.reload();
  private goDashboard = () => window.location.assign('/dashboard');
  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card/90 backdrop-blur-xl p-6 text-center shadow-2xl">
          <AlertTriangle className="h-6 w-6 text-warning mx-auto mb-3" />
          <div className="text-base font-medium mb-1">The app encountered a problem</div>
          <div className="text-xs text-muted-foreground mb-5 break-words">
            {getSafeErrorMessage(this.state.error)}
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              Dismiss
            </button>
            <button
              onClick={this.goDashboard}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <Home className="h-3 w-3" /> Go to dashboard
            </button>
            <button
              onClick={this.reload}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-3 w-3" /> Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
