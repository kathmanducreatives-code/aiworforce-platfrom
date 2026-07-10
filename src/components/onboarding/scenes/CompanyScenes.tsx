// Company phase scenes — one focused ask per screen.
//   5. company_description → the founder's own one sentence (a strong AI anchor)
//   6. company_website     → website URL (+ optional collapsed LinkedIn)
//   7. company_research    → Firecrawl progress (calls research_company)
//   8. company_verify      → clean Company Understanding card, confirm or edit

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ResearchTimeline, type TimelineStage } from '@/components/onboarding/ResearchTimeline';
import { EditDrawer } from '@/components/onboarding/EditDrawer';
import { SceneFrame } from '@/components/onboarding/SceneFrame';
import { SceneInput, SceneFooter, SummaryRow, ReadChips } from './sceneKit';
import { canAnalyzeCompany, isHttpUrl, type CompanyForm } from '@/lib/onboardingV3';

const READ_PAGES = ['Homepage', 'Product', 'Pricing', 'Features', 'About', 'Customers'];

// --------------------------------------------------- Scene 5: one sentence ---

export function CompanyDescriptionScene({ value, onChange, onContinue, onBack }: {
  value: CompanyForm; onChange: (c: CompanyForm) => void; onContinue: () => void; onBack: () => void;
}) {
  const ready = value.description.trim().length > 0 || value.name.trim().length > 0;
  return (
    <SceneFrame
      eyebrow="Step 2 of 5 · Company"
      title="In one sentence, what does your company do?"
      helper="Your own words are the strongest anchor for Agentory’s research."
      footer={<SceneFooter onBack={onBack} primaryLabel="Continue" onPrimary={onContinue} primaryDisabled={!ready} />}
    >
      <div className="space-y-4">
        <SceneInput label="Company name" value={value.name} onChange={(v) => onChange({ ...value, name: v })} placeholder="Agentory" autoFocus />
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">What you do</p>
          <Textarea
            rows={3}
            value={value.description}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            placeholder="We help [who] do [what outcome]."
            className="resize-none rounded-xl border-border/60 bg-background/50 text-base transition-shadow focus-visible:border-primary/50 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
          />
          <p className="mt-2 text-xs text-muted-foreground/70">
            Example: We help B2B founders find signal-based leads before hiring SDRs.
          </p>
        </div>
      </div>
    </SceneFrame>
  );
}

// -------------------------------------------------------- Scene 6: website ---

export function CompanyWebsiteScene({ value, onChange, onAnalyze, onBack }: {
  value: CompanyForm; onChange: (c: CompanyForm) => void; onAnalyze: () => void; onBack: () => void;
}) {
  const [showLinkedIn, setShowLinkedIn] = useState(!!value.linkedin_url);
  return (
    <SceneFrame
      eyebrow="Step 2 of 5 · Company"
      title="Where should Agentory read your company?"
      helper="We’ll read key product pages, separate examples from facts, and draft your ICP."
      footer={<SceneFooter onBack={onBack} primaryLabel="Analyze company" onPrimary={onAnalyze} primaryDisabled={!canAnalyzeCompany(value)} />}
    >
      <div className="space-y-4">
        <SceneInput label="Website URL" value={value.website_url} onChange={(v) => onChange({ ...value, website_url: v })} placeholder="https://agentory.space" autoFocus />

        {showLinkedIn ? (
          <SceneInput label="Company LinkedIn URL (optional)" value={value.linkedin_url} onChange={(v) => onChange({ ...value, linkedin_url: v })} placeholder="https://linkedin.com/company/agentory" />
        ) : (
          <button type="button" onClick={() => setShowLinkedIn(true)} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5" /> Add a company LinkedIn URL
          </button>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1">
          {READ_PAGES.map((p) => (
            <span key={p} className="rounded-full border border-border/50 bg-background/40 px-2.5 py-1 text-[11px] text-foreground/70">{p}</span>
          ))}
        </div>
      </div>
    </SceneFrame>
  );
}

// -------------------------------------------------------- Scene 7: research --

export function CompanyResearchScene({ busy, research, onContinue, onBack }: {
  busy: boolean; research: any; onContinue: () => void; onBack: () => void;
}) {
  const done = !!research && !busy;
  const u = research?.understanding ?? null;
  const stages: TimelineStage[] = [
    { id: 'map', label: 'Mapping your website', status: done ? 'done' : busy ? 'active' : 'pending' },
    { id: 'select', label: 'Selecting product pages', status: done ? 'done' : busy ? 'active' : 'pending' },
    { id: 'read', label: 'Reading homepage and product', detail: `${research?.source_pages?.length ?? 0} page(s)`, status: done ? 'done' : 'pending' },
    { id: 'facts', label: 'Separating facts from examples', detail: u ? `${u.examples_detected?.length ?? 0} example(s) set aside` : undefined, status: done ? 'done' : 'pending' },
    { id: 'market', label: 'Understanding your market', status: done ? 'done' : 'pending' },
    { id: 'view', label: 'Drafting your company view', status: done ? 'done' : 'pending' },
  ];
  return (
    <SceneFrame
      eyebrow="Step 2 of 5 · Company"
      title={busy ? 'Reading your company…' : done ? 'Agentory has read your company' : 'Ready when you are'}
      width="lg"
      footer={<SceneFooter onBack={onBack} primaryLabel="Continue" onPrimary={onContinue} primaryBusy={busy} />}
    >
      <ResearchTimeline stages={stages} running={busy} />
      {done && u && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Product claims" value={String((u.key_features?.length ?? 0) + (research?.proof_points?.length ?? 0))} />
          <Stat label="Examples detected" value={String(u.examples_detected?.length ?? 0)} />
          <Stat label="Missing evidence" value={String(u.missing_evidence?.length ?? research?.missing_evidence?.length ?? 0)} />
        </div>
      )}
    </SceneFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/30 px-3 py-2.5 text-center">
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------- Scene 8: verify --

export function CompanyVerifyScene({ value, research, onChange, onConfirm, onBack }: {
  value: CompanyForm; research: any;
  onChange: (c: CompanyForm) => void; onConfirm: () => void; onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const u = research?.understanding ?? null;
  const summary = value.description || u?.one_line_summary || research?.description || '';
  const category = u?.product_category || research?.product_category || '';
  const model = u?.business_model || research?.business_model || '';
  const hints = u?.target_customer_hints ?? research?.target_users_guess ?? [];
  const features = u?.key_features ?? research?.features ?? [];
  const needs = u?.needs_confirmation ?? research?.needs_confirmation ?? [];

  return (
    <SceneFrame
      eyebrow="Step 2 of 5 · Company"
      title="Is this what Agentory understands?"
      helper="Confirm the company view before we draft your ICP, or edit it."
      width="lg"
      footer={
        <SceneFooter
          onBack={onBack}
          primaryLabel="Confirm and continue"
          onPrimary={onConfirm}
          secondary={<Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="text-muted-foreground">Edit</Button>}
        />
      }
    >
      <div className="rounded-2xl border border-border/50 bg-background/30 p-5">
        <SummaryRow label="Summary" value={summary} />
        <SummaryRow label="Category" value={category} />
        <SummaryRow label="Business model" value={model} />
        <div className="pt-3"><ReadChips label="Target customer hint" values={hints} empty="Not inferred yet" /></div>
        <div className="pt-3"><ReadChips label="Key features" values={features} empty="None extracted" max={6} /></div>
        {needs.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-amber-300">Needs your confirmation</p>
            <p className="mt-1 text-xs text-amber-100/80">{needs.slice(0, 3).map((n: string) => n.replace(/[:_]/g, ' ')).join(' · ')}</p>
          </div>
        )}
      </div>

      <EditDrawer open={editing} onOpenChange={setEditing} title="Edit company details" description="Your edits always win over the scraped pages.">
        <SceneInput label="Company name" value={value.name} onChange={(v) => onChange({ ...value, name: v })} placeholder="Agentory" />
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Description</p>
          <Textarea rows={3} value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} className="resize-none rounded-xl border-border/60 bg-background/50" />
        </div>
        <SceneInput label="Stage" value={value.stage} onChange={(v) => onChange({ ...value, stage: v })} placeholder="seed" />
        <SceneInput label="Team size" value={value.team_size} onChange={(v) => onChange({ ...value, team_size: v })} placeholder="2-5" />
      </EditDrawer>
    </SceneFrame>
  );
}
