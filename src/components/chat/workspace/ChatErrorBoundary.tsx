import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ChatErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for debugging; do not rethrow.
    console.error('[ChatErrorBoundary]', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full rounded-xl border border-white/[0.08] bg-[#131920] p-5 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-400 mx-auto mb-3" />
          <div className="text-sm font-medium text-[#F0F6FC] mb-1">Chat hit an error</div>
          <div className="text-xs text-[#7D8590] mb-4 break-words">
            {this.state.error.message || 'Unknown error'}
          </div>
          <button
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-500/90 hover:bg-emerald-500 text-white"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      </div>
    );
  }
}
