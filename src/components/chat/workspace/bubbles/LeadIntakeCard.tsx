import { useState } from 'react';
import { Target, Sparkles, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// Mirrors the backend `LeadIntakeForm` payload (metadata.ui_form).
interface FormField {
  key: string;
  label: string;
  type: 'select' | 'text' | 'toggle';
  required?: boolean;
  options?: string[];
  value: string | boolean | null;
  placeholder?: string;
}
export interface LeadIntakeFormPayload {
  kind: 'lead_intake';
  title: string;
  subtitle: string;
  safety_note: string;
  brain_used?: boolean;
  brain_missing?: boolean;
  fields: FormField[];
}

import { dispatchChatAction } from '@/lib/chatActions';

type Mode = 'people' | 'companies' | 'signals' | 'competitor_engagement' | 'hiring';
function modeFromLabel(label: string): Mode {
  const l = label.toLowerCase();
  if (l.includes('compan') && !l.includes('hiring')) return 'companies';
  if (l.includes('hiring')) return 'hiring';
  if (l.includes('competitor')) return 'competitor_engagement';
  if (l.includes('linkedin') || l.includes('conversation')) return 'signals';
  return 'people';
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(25, Math.max(1, Math.floor(n)));
}

// Build a complete, unambiguous instruction the classifier runs directly
// (no re-clarification). Mirrors backend leadRequestToInstruction.
function buildInstruction(v: Record<string, string | boolean>): string {
  const mode = modeFromLabel(String(v.mode ?? 'People / profiles'));
  const count = clampCount(parseInt(String(v.count ?? '5'), 10));
  const role = String(v.target_role ?? '').trim();
  const industry = String(v.industry ?? '').trim();
  const location = String(v.location ?? '').trim();
  const category = String(v.company_category ?? '').trim();
  const outreach = v.outreach === true;

  const who = [role, category].filter(Boolean).join(' ');
  const where = location && !/^any/i.test(location) ? ` in ${location}` : '';
  const ind = industry ? ` in ${industry}` : '';
  const subject =
    mode === 'hiring' ? `companies hiring ${role || 'GTM'} roles${ind}${where}`
    : mode === 'companies' ? `${category || 'companies'}${ind}${where}`
    : mode === 'signals' ? `LinkedIn posts about ${category || industry || who || 'your space'}${where}`
    : mode === 'competitor_engagement' ? `people engaging with competitors${ind}${where}`
    : `${who || 'founders'}${ind}${where}`;
  const tail = outreach
    ? ' Save them to Signal Feed and draft outreach for approval (do not send).'
    : ' Save them to Signal Feed. Do not send any outreach.';
  return `Find ${count} ${subject}.${tail}`;
}

export default function LeadIntakeCard({ payload }: { payload: LeadIntakeFormPayload }) {
  const initial: Record<string, string | boolean> = {};
  for (const f of payload.fields) {
    initial[f.key] = f.type === 'toggle' ? Boolean(f.value) : (f.value == null ? '' : String(f.value));
  }
  const [values, setValues] = useState<Record<string, string | boolean>>(initial);
  const [submitted, setSubmitted] = useState(false);
  const set = (k: string, val: string | boolean) => setValues((p) => ({ ...p, [k]: val }));

  const field = (k: string) => payload.fields.find((f) => f.key === k);
  const modeMissing = !values.mode;

  const submit = (recommended: boolean) => {
    const v = { ...values };
    if (recommended && !v.mode) v.mode = 'People / profiles';
    send(buildInstruction(v));
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-[13px] text-[#C9D1D9]">
        Brief sent to Scout — results will save to the Signal Feed. Nothing will be sent.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.05] to-transparent p-4 max-w-[560px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-6 w-6 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
          <Target className="h-3.5 w-3.5 text-emerald-300" />
        </span>
        <div className="text-[13px] font-semibold text-[#F0F6FC]">{payload.title}</div>
      </div>
      <p className="text-[12px] text-[#7D8590] leading-relaxed mb-3">{payload.subtitle}</p>
      {payload.brain_missing && (
        <p className="text-[11px] text-amber-300/80 mb-3">
          Tip: completing your Company Brain lets Scout prefill this and rank results to your ICP.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {payload.fields.map((f) => {
          if (f.type === 'toggle') {
            return (
              <div key={f.key} className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 sm:col-span-2">
                <div>
                  <Label className="text-[12px] text-[#C9D1D9]">{f.label}</Label>
                  <div className="text-[11px] text-[#7D8590]">
                    {values[f.key] ? 'Also draft outreach (Penn, approval required — no send)' : 'Just find leads'}
                  </div>
                </div>
                <Switch checked={Boolean(values[f.key])} onCheckedChange={(c) => set(f.key, c)} />
              </div>
            );
          }
          if (f.type === 'select') {
            return (
              <div key={f.key} className="space-y-1">
                <Label className="text-[12px] text-[#C9D1D9]">{f.label}{f.required ? ' *' : ''}</Label>
                <Select value={String(values[f.key] ?? '')} onValueChange={(val) => set(f.key, val)}>
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder={`Select ${f.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o} value={o} className="text-[13px]">{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          return (
            <div key={f.key} className="space-y-1">
              <Label className="text-[12px] text-[#C9D1D9]">{f.label}</Label>
              <Input
                value={String(values[f.key] ?? '')}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
                className="h-9 text-[13px]"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-4">
        <Button
          size="sm"
          disabled={modeMissing}
          onClick={() => submit(false)}
          className="bg-emerald-500/90 hover:bg-emerald-500 text-[#03100a] font-semibold"
        >
          Find leads
        </Button>
        <Button size="sm" variant="outline" onClick={() => submit(true)} className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Use recommended search
        </Button>
      </div>
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[#7D8590]">
        <ShieldCheck className="h-3 w-3 text-emerald-400/70" /> {payload.safety_note}
      </div>
    </div>
  );
}
