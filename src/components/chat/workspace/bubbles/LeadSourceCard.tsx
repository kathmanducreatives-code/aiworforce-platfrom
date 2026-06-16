import { useState } from 'react';
import {
  Target, Briefcase, MessageSquare, MessagesSquare, Swords, UserSearch, Building2, ShieldCheck, ArrowLeft, Sparkles,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// Mirrors the backend `LeadSourceSelector` payload (metadata.ui_form).
type LeadSourceType =
  | 'icp_search' | 'hiring_signal' | 'linkedin_posts' | 'linkedin_comments'
  | 'competitor_engagement' | 'people_profiles' | 'company_search' | 'memory_refine';

interface FormField {
  key: string; label: string; type: 'select' | 'text' | 'toggle';
  required?: boolean; options?: string[]; value: string | boolean | null; placeholder?: string;
}
interface LeadSourceOption {
  source_type: LeadSourceType; mode: string; title: string; description: string;
  examples: string[]; available: boolean; fallback_note: string | null; fields: FormField[];
}
export interface LeadSourceSelectorPayload {
  kind: 'lead_source_selector';
  title: string; subtitle: string; safety_note: string;
  brain_used?: boolean; brain_missing?: boolean; suggested_source?: LeadSourceType;
  sources: LeadSourceOption[];
}

const ICONS: Record<LeadSourceType, any> = {
  icp_search: Target, hiring_signal: Briefcase, linkedin_posts: MessageSquare,
  linkedin_comments: MessagesSquare, competitor_engagement: Swords,
  people_profiles: UserSearch, company_search: Building2, memory_refine: Target,
};

function send(text: string) {
  window.dispatchEvent(new CustomEvent('chat:send', { detail: text }));
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(25, Math.max(1, Math.floor(n)));
}

// Build a complete, correctly-routing instruction per source type. Mirrors the
// backend leadRequestToInstruction so the classifier runs it directly.
function buildInstruction(source: LeadSourceType, v: Record<string, string>, available: boolean): string {
  const n = clampCount(parseInt(v.count ?? '5', 10));
  const role = (v.target_role ?? '').trim();
  const industry = (v.industry ?? '').trim();
  const location = (v.location ?? '').trim();
  const category = (v.company_category ?? '').trim();
  const topic = (v.topic ?? '').trim();
  const competitors = (v.competitors ?? '').trim();
  const postUrl = (v.post_url ?? '').trim();
  const stage = (v.stage ?? '').trim();
  const where = location && !/^any/i.test(location) ? ` in ${location}` : '';
  const ind = industry ? ` in ${industry}` : '';
  const tail = ' Save them to Signal Feed. Do not send any outreach.';

  switch (source) {
    case 'hiring_signal':
      return `Find ${n} companies hiring ${role || 'GTM'} roles${ind}${where}${stage ? ` (${stage})` : ''}.${tail}`;
    case 'company_search':
      return `Find ${n} ${category || 'companies'} companies${ind}${where}${stage ? ` (${stage})` : ''}.${tail}`;
    case 'linkedin_posts':
      return `Find ${n} LinkedIn posts about ${topic || category || industry || 'your space'}${where}.${tail}`;
    case 'linkedin_comments':
      // No URL / actor unavailable → fall back to LinkedIn post search.
      if (available && postUrl) return `Find ${n} people commenting on this LinkedIn post: ${postUrl}.${tail}`;
      return `Find ${n} LinkedIn posts about ${topic || category || 'your category'}${where}.${tail}`;
    case 'competitor_engagement':
      return `Find ${n} people talking about ${competitors || category || 'competitors'}${ind}.${tail}`;
    case 'people_profiles': {
      const who = [role, category].filter(Boolean).join(' ') || 'founders';
      return `Find ${n} ${who}${ind}${where}.${tail}`;
    }
    case 'icp_search':
    default: {
      const isCompanies = (v.mode ?? '').toLowerCase().includes('compan');
      if (isCompanies) return `Find ${n} ${category || 'companies'} companies${ind}${where}.${tail}`;
      const who = [role, category].filter(Boolean).join(' ') || 'people';
      return `Find ${n} ${who}${ind}${where}.${tail}`;
    }
  }
}

function Brief({ option, onBack }: { option: LeadSourceOption; onBack: () => void }) {
  const init: Record<string, string> = {};
  for (const f of option.fields) init[f.key] = f.value == null ? '' : String(f.value);
  const [v, setV] = useState<Record<string, string>>(init);
  const [sent, setSent] = useState(false);
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const required = option.fields.filter((f) => f.required);
  const missing = required.some((f) => !v[f.key]);

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-[13px] text-[#C9D1D9]">
        Brief sent to Scout ({option.title}) — results will save to the Signal Feed. Nothing will be sent.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.05] to-transparent p-4 max-w-[560px]">
      <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-[#7D8590] hover:text-emerald-300 mb-2">
        <ArrowLeft className="h-3 w-3" /> Back to sources
      </button>
      <div className="text-[13px] font-semibold text-[#F0F6FC] mb-0.5">Lead Search Brief · {option.title}</div>
      <p className="text-[12px] text-[#7D8590] mb-3">{option.description}</p>
      {!option.available && option.fallback_note && (
        <p className="text-[11px] text-amber-300/80 mb-3">{option.fallback_note}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {option.fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-[12px] text-[#C9D1D9]">{f.label}{f.required ? ' *' : ''}</Label>
            {f.type === 'select' ? (
              <Select value={v[f.key] ?? ''} onValueChange={(val) => set(f.key, val)}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder={`Select ${f.label.toLowerCase()}`} /></SelectTrigger>
                <SelectContent>{(f.options ?? []).map((o) => <SelectItem key={o} value={o} className="text-[13px]">{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={v[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} className="h-9 text-[13px]" />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-4">
        <Button size="sm" disabled={missing} onClick={() => { send(buildInstruction(option.source_type, v, option.available)); setSent(true); }} className="bg-emerald-500/90 hover:bg-emerald-500 text-[#03100a] font-semibold">
          Find leads
        </Button>
        <Button size="sm" variant="outline" onClick={() => { send(buildInstruction(option.source_type, v, option.available)); setSent(true); }} className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Use recommended
        </Button>
      </div>
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[#7D8590]">
        <ShieldCheck className="h-3 w-3 text-emerald-400/70" /> Nothing will be sent.
      </div>
    </div>
  );
}

export default function LeadSourceCard({ payload }: { payload: LeadSourceSelectorPayload }) {
  // Client-side transition: selector → chosen source's brief. Context preserved
  // (same card, same message) — no new chat, no repeated questions.
  const [picked, setPicked] = useState<LeadSourceType | null>(null);
  const option = picked ? payload.sources.find((s) => s.source_type === picked) ?? null : null;

  if (option) return <Brief option={option} onBack={() => setPicked(null)} />;

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.05] to-transparent p-4 max-w-[600px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-6 w-6 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
          <Target className="h-3.5 w-3.5 text-emerald-300" />
        </span>
        <div className="text-[13px] font-semibold text-[#F0F6FC]">{payload.title}</div>
      </div>
      <p className="text-[12px] text-[#7D8590] leading-relaxed mb-3">{payload.subtitle}</p>
      {payload.brain_missing && (
        <p className="text-[11px] text-amber-300/80 mb-3">Completing your Company Brain lets Scout prefill these and rank results to your ICP.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {payload.sources.map((s) => {
          const Icon = ICONS[s.source_type] ?? Target;
          const suggested = payload.suggested_source === s.source_type;
          return (
            <button
              key={s.source_type}
              type="button"
              onClick={() => setPicked(s.source_type)}
              className={`group text-left rounded-lg border px-3 py-2.5 transition-colors flex items-start gap-3 ${
                suggested ? 'border-emerald-500/40 bg-emerald-500/[0.07]' : 'border-white/[0.08] bg-white/[0.02] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30'
              }`}
            >
              <span className="h-7 w-7 rounded-md bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#F0F6FC] flex items-center gap-1.5">
                  {s.title}
                  {suggested && <span className="text-[9px] uppercase tracking-wide text-emerald-300/90 border border-emerald-500/30 rounded px-1">suggested</span>}
                  {!s.available && <span className="text-[9px] uppercase tracking-wide text-amber-300/80 border border-amber-500/30 rounded px-1">fallback</span>}
                </div>
                <div className="text-[11px] text-[#7D8590] mt-0.5 leading-snug">{s.description}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 mt-3 text-[11px] text-[#7D8590]">
        <ShieldCheck className="h-3 w-3 text-emerald-400/70" /> {payload.safety_note}
      </div>
    </div>
  );
}
