// The editable tabs of the Company Brain page. Every value edits in place and
// saves through `onSaveFields` (the drawer's own patch builder); longer forms —
// the size range, company identity — still open the section drawer.

import type { ReactNode } from 'react';
import { ArrowRightLeft, Pencil, Quote } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { companySizeLabel } from '@/lib/companyBrainInsights';
import type { SectionHealth, SectionKey } from '@/lib/companyBrainSections';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import type { SaveFields } from '@/lib/companyBrainPatch';
import { HealthBadge, InlineChips, InlineText, type ChipTone } from './InlineEdit';
import { useBrainEditable } from './brainEditable';

interface PanelProps {
  brain: CompanyBrainV2;
  health: Record<SectionKey, SectionHealth>;
  saved: SectionKey | null;
  onEdit: (s: SectionKey) => void;
  onSaveFields: SaveFields;
}

function SectionCard({ section, kicker, title, description, health, saved, aside, children, className }: {
  section: SectionKey; kicker: string; title: string; description: string;
  health: Record<SectionKey, SectionHealth>; saved: SectionKey | null; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn('brain-card brain-section', saved === section && 'is-saved', className)} aria-label={title}>
      <div className="brain-card-head">
        <div>
          <p className="brain-kicker">{kicker}</p>
          <h3 className="brain-card-title">{title}</h3>
          <p className="brain-card-desc">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{aside}<HealthBadge state={health[section]} /></div>
      </div>
      {children}
    </section>
  );
}

/** A list field bound to one drawer field. */
function Field({ section, field, values, onSaveFields, ...rest }: {
  section: SectionKey; field: string; values: string[]; onSaveFields: SaveFields;
  label: string; hint?: string; variant?: 'chips' | 'rows' | 'people'; tone?: ChipTone; addLabel?: string; emptyText?: string;
  actions?: (value: string) => ReactNode;
}) {
  return <InlineChips values={values} onCommit={(next) => onSaveFields(section, { [field]: next })} {...rest} />;
}

// ── Who we sell to ─────────────────────────────────────────────────────────

export function MarketPanel({ brain, health, saved, onEdit, onSaveFields }: PanelProps) {
  const t = brain.target_customer;
  const f = { section: 'targeting' as const, onSaveFields };
  const size = companySizeLabel(brain);
  const editable = useBrainEditable();
  return (
    <div className="brain-stack">
      <SectionCard section="targeting" kicker="01 · Target market" title="Companies worth researching"
        description="The account profile your team searches for and prioritizes." health={health} saved={saved}>
        <div className="brain-field-grid">
          <Field {...f} field="industries" label="Industries" values={t.industries} emptyText="No industries yet — this is the most important filter." />
          <Field {...f} field="business_models" label="Business models" values={t.business_models} />
          <Field {...f} field="geography" label="Regions" values={t.geography} />
          <Field {...f} field="funding_stage" label="Funding stages" values={t.funding_stage} />
          <div className="brain-field">
            <div className="brain-field-head"><span className="brain-field-label">Company size</span></div>
            {editable ? (
              <button type="button" className={cn('brain-text-view', !size && 'is-empty')} onClick={() => onEdit('targeting')}>
                <span className="min-w-0 flex-1">{size || 'Set an employee range'}</span>
                <Pencil size={13} className="brain-text-pencil" aria-hidden /><span className="sr-only">Edit company size</span>
              </button>
            ) : <p className={cn('brain-text-view is-static', !size && 'is-empty')}>{size || 'Not set'}</p>}
          </div>
        </div>
        <div className="brain-divider" />
        <div className="brain-field-grid">
          <Field {...f} field="must_have" label="Must have" tone="positive" hint="A company is only a fit if these are true." values={t.must_have} variant="rows" />
          <Field {...f} field="nice_to_have" label="Nice to have" hint="Raises priority, never required." values={t.nice_to_have} variant="rows" />
        </div>
        <div className="brain-divider" />
        <Field {...f} field="positive_examples" label="Examples of great-fit customers" variant="rows" tone="positive" addLabel="Add example"
          values={brain.positive_examples} hint="Real customers or lookalikes your team should find more of." emptyText="No examples yet." />
      </SectionCard>

      <SectionCard section="buyers" kicker="02 · Buyer profile" title="People who feel the problem"
        description="The roles inside an account worth speaking to, and what keeps them up at night." health={health} saved={saved}>
        <Field section="buyers" field="buyer_personas" onSaveFields={onSaveFields} label="Buyer roles" variant="people" addLabel="Add role" values={brain.buyer_personas}
          emptyText="Add the job titles that sign off on a purchase." />
        <div className="brain-divider" />
        <Field section="buyers" field="pain_points" onSaveFields={onSaveFields} label="Pains they feel" variant="rows" addLabel="Add pain" values={brain.pain_points}
          emptyText="Pain points give outreach a reason to exist." />
      </SectionCard>
    </div>
  );
}

// ── Buying moments ─────────────────────────────────────────────────────────

export function MomentsPanel({ brain, health, saved, onSaveFields }: PanelProps) {
  const f = { section: 'signals' as const, onSaveFields };
  return (
    <SectionCard section="signals" kicker="03 · Buying moments" title="When an account is worth contacting now"
      description="Timing signals that make outreach relevant instead of random." health={health} saved={saved}>
      <div className="brain-field-grid">
        <Field {...f} field="triggers" label="Trigger events" variant="rows" addLabel="Add event" values={brain.triggers}
          hint="Things that happen to a company — a new hire, a funding round, an expansion." emptyText="No trigger events yet." />
        <Field {...f} field="jobs_to_watch" label="Roles to watch for" addLabel="Add role" values={brain.jobs_to_watch}
          hint="Open roles that show a company is investing in the problem you solve." emptyText="No roles yet." />
      </div>
    </SectionCard>
  );
}

// ── Qualification ──────────────────────────────────────────────────────────

const LANES = [
  { field: 'required_evidence', title: 'Must be true', hint: 'Evidence required before a company qualifies.', tone: 'positive' },
  { field: 'manual_review_if', title: 'Send to review', hint: 'Not a no — a person should look first.', tone: 'caution' },
  { field: 'reject_if', title: 'Reject', hint: 'Stops research on the company immediately.', tone: 'negative' },
] as const;
type LaneField = (typeof LANES)[number]['field'];

export function RulesPanel({ brain, health, saved, onSaveFields }: PanelProps) {
  const rules = brain.qualification_rules;
  const d = brain.target_customer.disqualifiers;
  const f = { section: 'disqualifiers' as const, onSaveFields };
  const laneValues: Record<LaneField, string[]> = {
    required_evidence: rules.required_evidence, manual_review_if: rules.manual_review_if, reject_if: rules.reject_if,
  };
  // One patch removes the rule from its lane and adds it to the target lane.
  const move = (value: string, from: LaneField, to: LaneField) => onSaveFields('disqualifiers', {
    [from]: laneValues[from].filter((v) => v !== value),
    [to]: laneValues[to].includes(value) ? laneValues[to] : [...laneValues[to], value],
  });

  return (
    <div className="brain-stack">
      <SectionCard section="disqualifiers" kicker="04 · Qualification" title="How a company earns a yes"
        description="Every researched company passes through these three gates, left to right." health={health} saved={saved}>
        <div className="brain-lanes">
          {LANES.map((lane, i) => (
            <div key={lane.field} className="brain-lane" data-tone={lane.tone}>
              <div className="brain-lane-head"><span className="brain-lane-step">{i + 1}</span>{lane.title}</div>
              <Field {...f} field={lane.field} label={lane.title} hint={lane.hint} tone={lane.tone} variant="rows" addLabel="Add rule"
                values={laneValues[lane.field]} emptyText="No rules here."
                actions={(v) => <MoveMenu value={v} from={lane.field} onMove={move} />} />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard section="disqualifiers" kicker="Guardrails" title="Never target"
        description="Anything matching these is excluded before research starts." health={health} saved={null}>
        <div className="brain-field-grid">
          <Field {...f} field="disq_industries" label="Industries" tone="negative" values={d.industries} />
          <Field {...f} field="disq_company_types" label="Company types" tone="negative" values={d.company_types} />
          <Field {...f} field="disq_keywords" label="Keywords" tone="negative" values={d.keywords} />
          <Field {...f} field="disq_titles" label="Job titles" tone="negative" values={d.titles} />
        </div>
        <div className="brain-divider" />
        <Field {...f} field="negative_examples" label="Examples of poor fits" variant="rows" addLabel="Add example" values={brain.negative_examples}
          hint="Real companies or descriptions your team should learn to avoid." emptyText="No examples yet." />
      </SectionCard>
    </div>
  );
}

function MoveMenu({ value, from, onMove }: { value: string; from: LaneField; onMove: (v: string, from: LaneField, to: LaneField) => Promise<boolean> }) {
  if (!useBrainEditable()) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="brain-chip-x" aria-label={`Move ${value} to another gate`}><ArrowRightLeft size={12} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {LANES.filter((l) => l.field !== from).map((l) => (
          <DropdownMenuItem key={l.field} onSelect={() => void onMove(value, from, l.field)}>{l.title}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Voice & positioning ────────────────────────────────────────────────────

export function VoicePanel({ brain, health, saved, onSaveFields }: PanelProps) {
  const f = { section: 'messaging' as const, onSaveFields };
  const p = brain.positioning;
  const v = brain.brand_voice;
  return (
    <div className="brain-stack">
      <SectionCard section="messaging" kicker="05 · Positioning" title="Why customers choose you"
        description="The value every message and post is built around." health={health} saved={saved}>
        <InlineText label="Core promise" size="statement" value={p.promise} placeholder="Say what you deliver, in one sentence."
          onCommit={(next) => onSaveFields('messaging', { promise: next })} />
        <div className="brain-divider" />
        <div className="brain-field-grid">
          <Field {...f} field="differentiators" label="What makes you different" variant="rows" values={p.differentiators} emptyText="No differentiators yet." />
          <Field {...f} field="proof_points" label="Proof points" variant="rows" tone="positive" values={p.proof_points}
            hint="Customer results and numbers." emptyText="No proof points yet." />
        </div>
        <div className="brain-divider" />
        <div className="brain-field-grid">
          <InlineText label="Offer" value={p.offer} placeholder="What a new customer gets — a pilot, a trial, a package."
            onCommit={(next) => onSaveFields('messaging', { offer: next })} />
          <InlineText label="Pricing" value={p.pricing} placeholder="How you price, as you'd say it to a buyer."
            onCommit={(next) => onSaveFields('messaging', { pricing: next })} />
          <Field {...f} field="use_cases" label="Use cases" variant="rows" values={p.use_cases} emptyText="No use cases yet." />
          <Field {...f} field="avoid_positioning" label="Never position as" tone="negative" variant="rows" values={p.avoid_positioning}
            hint="Comparisons or claims to stay away from." emptyText="Nothing ruled out yet." />
        </div>
        <div className="brain-divider" />
        <Field {...f} field="content_angles" label="Content angles" values={brain.content_angles} emptyText="No content angles yet." />
      </SectionCard>

      <SectionCard section="messaging" kicker="Brand voice" title="How you sound"
        description="Tone and boundaries for anything written on your behalf." health={health} saved={null}>
        <div className="brain-field-grid">
          <InlineText label="Tone" value={v.tone} placeholder="e.g. Direct, warm, no jargon"
            onCommit={(next) => onSaveFields('messaging', { tone: next })} />
          <Field {...f} field="tags" label="Personality" values={v.tags} />
          <Field {...f} field="style_rules" label="Always" tone="positive" variant="rows" addLabel="Add rule" values={v.style_rules} emptyText="No style rules yet." />
          <Field {...f} field="avoid" label="Never" tone="negative" variant="rows" addLabel="Add rule" values={v.avoid} emptyText="Nothing to avoid yet." />
        </div>
        {v.example_message && (
          <figure className="brain-example">
            <Quote size={14} className="brain-example-mark" aria-hidden />
            <blockquote>{v.example_message}</blockquote>
            <figcaption>Example message from setup</figcaption>
          </figure>
        )}
      </SectionCard>
    </div>
  );
}

// ── Company context (Overview) ─────────────────────────────────────────────

export function CompanyContextCard({ brain, saved, onSaveFields }: Pick<PanelProps, 'brain' | 'saved' | 'onSaveFields'>) {
  const f = { section: 'company' as const, onSaveFields };
  const fo = brain.founder;
  const text = (field: string) => (next: string) => onSaveFields('company', { [field]: next });
  return (
    <section className={cn('brain-card brain-section brain-context', saved === 'company' && 'is-saved')} aria-label="Company context">
      <div className="brain-card-head">
        <div>
          <p className="brain-kicker">Company context</p>
          <h3 className="brain-card-title">Your market and your story</h3>
          <p className="brain-card-desc">Who you compete with, what your buyers already use, and who is behind the company.</p>
        </div>
      </div>
      <div className="brain-field-grid">
        <Field {...f} field="competitors" label="Competitors" values={brain.competitors} emptyText="No competitors yet." />
        <Field {...f} field="tools" label="Tools your buyers use" values={brain.tools} emptyText="No tools yet." />
      </div>
      <div className="brain-divider" />
      <div className="brain-field-grid">
        <InlineText label="Founder" value={fo.name} placeholder="Name" onCommit={text('founder_name')} />
        <InlineText label="Founder role" value={fo.role} placeholder="e.g. CEO & co-founder" onCommit={text('founder_role')} />
        <InlineText label="Founder background" value={fo.background} placeholder="The experience that makes them credible to buyers." onCommit={text('founder_background')} />
        <InlineText label="Founder LinkedIn" value={fo.linkedin_url} placeholder="https://linkedin.com/in/…" onCommit={text('founder_linkedin_url')} />
      </div>
      <div className="brain-divider" />
      <Field {...f} field="founder_credibility" label="Credibility signals" variant="rows" tone="positive" addLabel="Add signal"
        values={fo.credibility_signals} hint="Exits, past roles, press — what earns a reply." emptyText="No credibility signals yet." />
    </section>
  );
}
