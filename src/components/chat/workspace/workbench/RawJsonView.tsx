import { useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function RawJsonView({ data, defaultOpen = false }: { data: any; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const json = (() => {
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
  })();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen(!open)}
          className="text-[11px] uppercase tracking-wider text-[#7D8590] hover:text-[#C9D1D9]"
        >
          {open ? 'Hide' : 'Show'} raw JSON
        </button>
        <button
          onClick={() => { navigator.clipboard.writeText(json); toast.success('Copied JSON'); }}
          className="inline-flex items-center gap-1 text-[11px] text-[#7D8590] hover:text-[#C9D1D9]"
        >
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>
      {open && (
        <pre className="text-[11px] bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 overflow-auto max-h-[480px] text-[#C9D1D9] whitespace-pre-wrap break-words">
          {json}
        </pre>
      )}
    </div>
  );
}
