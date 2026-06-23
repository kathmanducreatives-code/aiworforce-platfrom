import { useMemo } from 'react';
import { ChevronRight, Sparkles, AlertCircle, Target, Search, Link2 } from 'lucide-react';
import type { WorkbenchData } from './useWorkbenchData';
import type { LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';
import { normalizeFirecrawl } from './normalize';

interface Props {
  data: WorkbenchData;
  panel?: LeadResultsPanelMeta | null;
}

export default function InsightsView({ data, panel }: Props) {
  const output = data.toolCall?.output_json ?? (data.task as any)?.output ?? null;
  const taskPayload = (data.task?.payload ?? {}) as Record<string, any>;

  const found = useMemo(() => {
    if (panel) {
      const n = panel.lead_count ?? 0;
      const type = (panel.source_type ?? '').replace(/_/g, ' ');
      return `${data.agentName ?? 'Scout'} found ${n} ${n === 1 ? 'opportunity' : 'opportunities'}${type ? ` from ${type}` : ''}.`;
    }
    return data.task?.description || data.planTitle || 'Execution complete.';
  }, [panel, data]);

  const whyMatters = useMemo(() => {
    if (panel) {
      const t = panel.source_type ?? '';
      if (t.includes('job') || t.includes('hiring')) {
        return 'Hiring signals often indicate growth pressure, fresh budget, and active pipeline expansion — strong timing for outbound.';
      }
      if (t.includes('intent') || t.includes('news')) {
        return 'Intent signals show the account is actively researching or moving — outreach now has higher reply probability.';
      }
      return 'These accounts match your ICP and show recent activity worth investigating.';
    }
    return null;
  }, [panel]);

  const missing = useMemo(() => {
    if (!panel) return [];
    const m: string[] = [];
    if (panel.contact_status === 'needs_contact') m.push('Decision-maker contacts are not attached yet.');
    if (panel.lead_count && panel.enrichable_count != null && panel.enrichable_count < panel.lead_count) {
      m.push(`${panel.lead_count - (panel.enrichable_count ?? 0)} account${panel.lead_count - (panel.enrichable_count ?? 0) === 1 ? '' : 's'} missing a verified website.`);
    }
    if (!panel.recommended_persona?.primary) m.push('Recommended persona not inferred yet — rank to clarify.');
    return m;
  }, [panel]);

  const rec = panel?.recommended_next_action ?? panel?.next_action ?? null;

  const strategy = useMemo<{ query: string | null; broadening: string[] } | null>(() => {
    const q = taskPayload.query ?? taskPayload.search_query ?? taskPayload.task_title ?? null;
    const query = q != null ? String(q) : null;
    const raw = taskPayload.role_keywords ?? taskPayload.keywords ?? null;
    const broadening = Array.isArray(raw) ? raw.map((x) => String(x)) : [];
    if (!query && broadening.length === 0) return null;
    return { query, broadening };
  }, [taskPayload]);

  const firecrawl = useMemo(() => normalizeFirecrawl(output), [output]);
  const sourceCount = (firecrawl.citations?.length ?? 0) + (firecrawl.url ? 1 : 0);

  // AI Source Planner — outcome + quality summary (emitted by run-agent on the panel).
  const outcome = panel?.outcome ?? null;
  const ins = panel?.insights ?? null;
  const acceptRate = (ins && typeof ins.raw_reviewed === 'number' && ins.raw_reviewed > 0 && typeof ins.accepted === 'number')
    ? Math.round((ins.accepted / ins.raw_reviewed) * 100) : null;
  const outcomeTone = outcome?.status === 'complete' ? 'good' : outcome?.status === 'partial' ? 'warn' : outcome?.status === 'failed' ? 'warn' : 'default';

  return (
    <div className="space-y-3">
      <Card icon={Sparkles} eyebrow="What was found">
        <p className="text-[13px] text-[#E6EDF3] leading-relaxed">{found}</p>
      </Card>

      {outcome?.line && (
        <Card icon={Target} eyebrow="Result" tone={outcomeTone as 'default' | 'good' | 'warn'}>
          <p className="text-[13px] text-[#F0F6FC] font-medium">{outcome.line}</p>
          {Array.isArray(outcome.quality_lines) && outcome.quality_lines.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {outcome.quality_lines.map((l, i) => (
                <li key={i} className="text-[12px] text-[#9aa4af]">{l}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {ins && (typeof ins.raw_reviewed === 'number' || typeof ins.accepted === 'number') && (
        <Card icon={Search} eyebrow="Quality summary">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <Stat k="Raw reviewed" v={ins.raw_reviewed ?? '—'} />
            <Stat k="Accepted" v={ins.accepted ?? '—'} />
            <Stat k="Rejected" v={ins.rejected ?? '—'} />
            <Stat k="Duplicates" v={ins.duplicates ?? '—'} />
            {acceptRate != null && <Stat k="Acceptance" v={`${acceptRate}%`} />}
            {ins.planner && <Stat k="Input planner" v={ins.planner === 'ai' ? 'Claude' : String(ins.planner)} />}
          </div>
          {Array.isArray(ins.main_reject_reasons) && ins.main_reject_reasons.length > 0 && (
            <div className="text-[12px] text-[#C9D1D9] mt-2"><span className="text-[#7D8590]">Main reject reason:</span> {ins.main_reject_reasons.join(', ')}</div>
          )}
          {Array.isArray(ins.attempts) && ins.attempts.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {ins.attempts.map((a, i) => <div key={i} className="text-[11px] text-[#9aa4af]">{a}</div>)}
            </div>
          )}
        </Card>
      )}

      {whyMatters && (
        <Card icon={Target} eyebrow="Why it matters">
          <p className="text-[13px] text-[#E6EDF3] leading-relaxed">{whyMatters}</p>
        </Card>
      )}

      {missing.length > 0 && (
        <Card icon={AlertCircle} eyebrow="What's missing" tone="warn">
          <ul className="space-y-1.5">
            {missing.map((m, i) => (
              <li key={i} className="text-[13px] text-[#E6EDF3] flex gap-2">
                <span className="text-amber-400/80 mt-1">•</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rec && (
        <Card icon={ChevronRight} eyebrow="Recommended next" tone="good">
          <div className="text-[13px] text-[#F0F6FC] font-medium">{rec.label}</div>
          <div className="text-[12px] text-[#9aa4af] mt-1">{rec.reason}</div>
          {(rec as any).estimated_credits != null && (
            <div className="text-[11px] text-emerald-300/80 mt-1.5 font-mono">~{(rec as any).estimated_credits} credits</div>
          )}
        </Card>
      )}

      {strategy && (
        <Card icon={Search} eyebrow="Search strategy">
          {strategy.query && (
            <div className="text-[12px] text-[#C9D1D9]">
              <span className="text-[#7D8590]">Query:</span>{' '}
              <span className="font-mono text-[#E6EDF3]">{String(strategy.query)}</span>
            </div>
          )}
          {strategy.broadening && Array.isArray(strategy.broadening) && strategy.broadening.length > 0 && (
            <div className="text-[12px] text-[#C9D1D9] mt-1.5">
              <span className="text-[#7D8590]">Broadening:</span>{' '}
              <span className="font-mono text-[#E6EDF3]">{(strategy.broadening as string[]).join(', ')}</span>
            </div>
          )}
        </Card>
      )}

      {sourceCount > 0 && (
        <Card icon={Link2} eyebrow="Sources used">
          <details>
            <summary className="cursor-pointer text-[12px] text-[#C9D1D9] hover:text-[#F0F6FC] select-none">
              {sourceCount} source link{sourceCount === 1 ? '' : 's'} · click to view
            </summary>
            <ul className="mt-2 space-y-1">
              {firecrawl.url && (
                <li className="text-[11px] truncate">
                  <a href={firecrawl.url} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline font-mono">{firecrawl.url}</a>
                </li>
              )}
              {(firecrawl.citations ?? []).slice(0, 25).map((c, i) => (
                <li key={i} className="text-[11px] truncate">
                  <a href={c} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline font-mono">{c}</a>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[#7D8590]">{k}</span>
      <span className="text-[#E6EDF3] font-mono">{v}</span>
    </div>
  );
}

function Card({ icon: Icon, eyebrow, children, tone = 'default' }: { icon: any; eyebrow: string; children: any; tone?: 'default' | 'good' | 'warn' }) {
  const ring =
    tone === 'good' ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
    : tone === 'warn' ? 'border-amber-500/20 bg-amber-500/[0.04]'
    : 'border-white/[0.06] bg-white/[0.02]';
  const iconCls =
    tone === 'good' ? 'text-emerald-300'
    : tone === 'warn' ? 'text-amber-300'
    : 'text-[#9aa4af]';
  return (
    <div className={`rounded-xl border ${ring} p-3.5`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`h-3.5 w-3.5 ${iconCls}`} />
        <span className="text-[10px] uppercase tracking-widest text-[#7D8590] font-semibold">{eyebrow}</span>
      </div>
      {children}
    </div>
  );
}
