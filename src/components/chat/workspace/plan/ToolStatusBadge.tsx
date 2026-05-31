import type { DBToolCall } from '@/lib/orchestration';
import { AlertCircle, CheckCircle2, Clock, Loader2, PlugZap, ShieldAlert, XCircle } from 'lucide-react';

const TOOL_LABEL: Record<string, string> = {
  research_web: 'Web research',
  scrape_url: 'Scrape URL',
  send_email: 'Send email',
  summarize_text: 'Summarize',
  extract_structured: 'Extract',
};

const TOOL_PROVIDER_HINT: Record<string, string> = {
  research_web: 'Perplexity',
  scrape_url: 'Firecrawl',
  send_email: 'Resend',
  summarize_text: 'Gemini',
  extract_structured: 'Gemini',
};

interface Props {
  toolNeeded?: string | null;
  latestCall?: DBToolCall | null;
  connectorMissing?: boolean;
}

export default function ToolStatusBadge({ toolNeeded, latestCall, connectorMissing }: Props) {
  if (!toolNeeded && !latestCall) return null;
  const name = toolNeeded ?? latestCall?.tool_name ?? '';
  const label = TOOL_LABEL[name] ?? name;
  const providerHint = TOOL_PROVIDER_HINT[name];

  const status = latestCall?.status;
  const provider = latestCall?.provider;
  const citationsCount = Array.isArray((latestCall?.output_json as any)?.citations)
    ? (latestCall?.output_json as any).citations.length
    : 0;

  let tone: 'idle' | 'ok' | 'warn' | 'err' | 'running' = 'idle';
  let icon = <PlugZap className="h-3 w-3" />;
  let text = `${label}${providerHint ? ` · ${providerHint}` : ''}`;

  if (connectorMissing && !latestCall) {
    tone = 'warn';
    icon = <ShieldAlert className="h-3 w-3" />;
    text = `${providerHint ?? label} required`;
  } else if (status === 'succeeded') {
    tone = 'ok'; icon = <CheckCircle2 className="h-3 w-3" />;
    text = `${label} · ${provider ?? 'ok'}${citationsCount ? ` · ${citationsCount} citations` : ''}`;
  } else if (status === 'running') {
    tone = 'running'; icon = <Loader2 className="h-3 w-3 animate-spin" />;
    text = `${label} · running`;
  } else if (status === 'queued') {
    tone = 'idle'; icon = <Clock className="h-3 w-3" />;
    text = `${label} · queued`;
  } else if (status === 'awaiting_approval') {
    tone = 'warn'; icon = <ShieldAlert className="h-3 w-3" />;
    text = `${label} · awaiting approval`;
  } else if (status === 'failed') {
    tone = 'err'; icon = <XCircle className="h-3 w-3" />;
    text = `${label} failed${latestCall?.error ? ` · ${latestCall.error.slice(0, 60)}` : ''}`;
  } else if (status === 'unavailable') {
    tone = 'warn'; icon = <AlertCircle className="h-3 w-3" />;
    text = `${providerHint ?? label} unavailable`;
  }

  const toneClass = {
    idle:    'bg-white/[0.04] text-[#7D8590] border-white/[0.06]',
    ok:      'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    warn:    'bg-amber-500/10 text-amber-300 border-amber-500/20',
    err:     'bg-rose-500/10 text-rose-300 border-rose-500/20',
    running: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${toneClass}`}>
      {icon}{text}
    </span>
  );
}
