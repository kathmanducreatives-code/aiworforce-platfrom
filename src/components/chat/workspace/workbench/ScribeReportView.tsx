import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import RawJsonView from './RawJsonView';

export default function ScribeReportView({ output }: { output: any }) {
  const text =
    typeof output === 'string'
      ? output
      : output?.report ?? output?.markdown ?? output?.text ?? output?.content ?? output?.summary ?? '';

  return (
    <div className="space-y-3">
      {text ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-[#7D8590]">Report</div>
            <button
              onClick={() => { navigator.clipboard.writeText(text); toast.success('Copied'); }}
              className="inline-flex items-center gap-1 text-[11px] text-[#7D8590] hover:text-[#C9D1D9]"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
          <div className="text-[13px] text-[#C9D1D9] whitespace-pre-wrap leading-relaxed">{text}</div>
        </div>
      ) : (
        <div className="text-[12px] text-[#7D8590]">No report content yet.</div>
      )}
      <RawJsonView data={output} />
    </div>
  );
}
