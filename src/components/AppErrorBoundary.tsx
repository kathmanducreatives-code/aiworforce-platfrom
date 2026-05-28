import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  private reload = () => window.location.reload();
  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md w-full rounded-2xl border border-white/[0.08] bg-[#0A0A0A]/85 backdrop-blur-xl p-6 text-center shadow-2xl">
          <AlertTriangle className="h-6 w-6 text-amber-400 mx-auto mb-3" />
          <div className="text-base font-medium mb-1">Something went wrong</div>
          <div className="text-xs text-neutral-400 mb-5 break-words">
            {this.state.error.message || 'Unknown error'}
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-white/[0.08] text-neutral-300 hover:bg-white/[0.04]"
            >
              Dismiss
            </button>
            <button
              onClick={this.reload}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-500/90 hover:bg-emerald-500 text-white"
            >
              <RefreshCw className="h-3 w-3" /> Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
