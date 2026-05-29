import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

const getSafeErrorMessage = (error: Error | null) =>
  error?.message?.replace(/https?:\/\/[^\s)]+/g, '[request-url]') || 'The chat surface failed to render safely.';

export default class ChatErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ChatErrorBoundary]', error, info.componentStack);
    }
  }

  private reset = () => this.setState({ error: null });
  private goDashboard = () => window.location.assign('/dashboard');

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full rounded-xl border border-border bg-card p-5 text-center">
          <AlertTriangle className="h-5 w-5 text-warning mx-auto mb-3" />
          <div className="text-sm font-medium text-foreground mb-1">Chat hit an error</div>
          <div className="text-xs text-muted-foreground mb-4 break-words">
            {getSafeErrorMessage(this.state.error)}
          </div>
          <div className="flex justify-center gap-2">
            <button
              onClick={this.goDashboard}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <Home className="h-3 w-3" /> Dashboard
            </button>
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
