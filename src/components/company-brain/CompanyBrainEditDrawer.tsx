// Right-side edit drawer for a single Company Brain section.
// Each section maps to a fixed set of top-level `company_brain.profile` keys.
// Save emits a partial patch that the parent shallow-merges onto the raw
// profile, so we never overwrite fields we don't render (evidence, claims,
// signal_preferences, legacy top-level keys, etc.).

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain, Check, Crosshair, Loader2, Megaphone, Radar, ShieldAlert, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from '@/components/onboarding/ChipInput';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import type { BrainProfile } from '@/lib/companyBrainView';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import {
  loadDraft, saveDraft, clearDraft, isDirty,
  DRAFT_SCHEMA_VERSION, UNSAVED_RESTORED_NOTICE, BACKGROUND_UPDATE_NOTICE,
  type SectionDraftValues,
} from '@/lib/companyBrainDrafts';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Long enough that typing is not a write per keystroke, short enough to be safe. */
const DRAFT_DEBOUNCE_MS = 500;

export type SectionKey = 'company' | 'targeting' | 'buyers' | 'signals' | 'disqualifiers' | 'messaging';

interface Props {
  open: boolean;
  section: SectionKey | null;
  brain: CompanyBrainV2;
  onOpenChange: (v: boolean) => void;
  onSave: (patch: BrainProfile) => Promise<void> | void;
  /** Server version this edit started from, for background-update detection. */
  serverUpdatedAt?: string | null;
}

const TITLES: Record<SectionKey, { title: string; description: string; influences: string; icon: ComponentType<{ className?: string }> }> = {
  company:       { title: 'Company understanding', description: 'What Agentory tells other agents about your company.', influences: 'Grounds every agent in what you do and who you sell to.', icon: Brain },
  targeting:     { title: 'ICP / targeting',       description: 'Who counts as a fit worth researching.', influences: 'Filters and ranks every lead Scout and Find Leads return.', icon: Crosshair },
  buyers:        { title: 'Buyer personas',        description: 'The roles you sell to and the pains you solve.', influences: 'Focuses outreach on the right decision-makers.', icon: Users },
  signals:       { title: 'Buying signals',        description: 'What Scout Radar should watch for.', influences: 'Decides which timing signals are worth surfacing.', icon: Radar },
  disqualifiers: { title: 'Disqualifiers & safety', description: 'Who and what to never target.', influences: 'Stops bad-fit leads and banned claims before anything sends.', icon: ShieldAlert },
  messaging:     { title: 'Messaging & positioning', description: 'How Agentory should sound on your behalf.', influences: 'Shapes outreach drafts, content, and brand voice.', icon: Megaphone },
};

export default function CompanyBrainEditDrawer({ open, section, brain, onOpenChange, onSave, serverUpdatedAt }: Props) {
  const reduce = useReducedMotion();
  const { workspaceId } = useWorkspace();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState<any>(null);
  /** The saved values this edit started from — dirty is measured against THIS. */
  const [base, setBase] = useState<SectionDraftValues | null>(null);
  const [restored, setRestored] = useState(false);
  const [backgroundUpdate, setBackgroundUpdate] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // Newest `brain` reachable without making it an effect dependency.
  const brainRef = useRef(brain);
  useEffect(() => { brainRef.current = brain; }, [brain]);

  const scope = { userId, workspaceId, sectionId: section };
  const dirty = !!state && !!base && isDirty(state as SectionDraftValues, base);

  // `brain` is deliberately NOT a dependency. It gets a new object identity on
  // every refetch, and including it is exactly what used to wipe unsaved edits
  // when the tab regained focus. Initialisation is keyed on IDENTITY —
  // which section, which workspace, which user — not on data arriving.
  useEffect(() => {
    if (!open || !section) return;

    const serverValues = initialFor(section, brainRef.current) as SectionDraftValues;
    const draft = loadDraft({ userId, workspaceId, sectionId: section });

    if (draft && draft.dirty) {
      // A draft wins over server values: it is the user's own unsaved work.
      setState(draft.values);
      setBase(serverValues);
      setRestored(true);
    } else {
      setState(serverValues);
      setBase(serverValues);
      setRestored(false);
    }
    setBackgroundUpdate(false);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, section, workspaceId, userId]);

  // A clean editor may accept fresh server values; a dirty one must not be
  // touched. Instead it says so, and keeps the user's work.
  useEffect(() => {
    if (!open || !section) return;
    const serverValues = initialFor(section, brain) as SectionDraftValues;
    if (dirty) {
      if (base && isDirty(serverValues, base)) setBackgroundUpdate(true);
      return;
    }
    setState(serverValues);
    setBase(serverValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain]);

  // Persist only AFTER the form is dirty, debounced so typing is not a write
  // per keystroke. A clean form clears its draft rather than storing a phantom.
  useEffect(() => {
    if (!open || !section || !userId || !workspaceId || !state || !base) return;
    const t = setTimeout(() => {
      if (dirty) {
        saveDraft({
          schemaVersion: DRAFT_SCHEMA_VERSION,
          userId, workspaceId, sectionId: section,
          brainVersion: serverUpdatedAt ?? null,
          values: state as SectionDraftValues,
          dirty: true,
          drawerOpen: true,
          activeSection: section,
          expandedGroups: [],
          scrollPosition: typeof window !== 'undefined' ? window.scrollY : 0,
          draftUpdatedAt: new Date().toISOString(),
          baseServerUpdatedAt: serverUpdatedAt ?? null,
        });
      } else {
        clearDraft(scope);
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, dirty, open, section, userId, workspaceId, serverUpdatedAt]);

  // Native reload/close warning ONLY while there is unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function discard() {
    clearDraft(scope);
    if (section) {
      const serverValues = initialFor(section, brainRef.current) as SectionDraftValues;
      setState(serverValues);
      setBase(serverValues);
    }
    setRestored(false);
    setBackgroundUpdate(false);
    setConfirmClose(false);
    onOpenChange(false);
  }

  function requestClose(next: boolean) {
    if (busy) return;
    if (!next && dirty) { setConfirmClose(true); return; }
    onOpenChange(next);
  }

  if (!section || !state) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full border-border/30 bg-card/40 backdrop-blur-3xl sm:max-w-md" />
        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits are kept for this browser session. They are not saved to Company Brain yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmClose(false)}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmClose(false); onOpenChange(false); }}
            >
              Leave and keep draft
            </AlertDialogAction>
            <AlertDialogAction
              onClick={discard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
    );
  }

  const meta = TITLES[section];
  const Icon = meta.icon;

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(buildPatch(section!, state, brain));
      // The work is now on the server; the draft would only be a stale copy.
      clearDraft({ userId, workspaceId, sectionId: section });
      setBase(state as SectionDraftValues);
      setRestored(false);
      setBackgroundUpdate(false);
      setSaved(true);
      // Brief confirmation glow before closing.
      setTimeout(() => onOpenChange(false), reduce ? 0 : 600);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      {/* Premium glassmorphic drawer surface */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden border-border/25 bg-card/38 backdrop-blur-3xl backdrop-saturate-[1.4] sm:max-w-lg"
        style={{
          boxShadow: saved
            ? 'inset 0 0 0 1px hsl(160 84% 52% / 0.5), 0 0 60px -10px hsl(160 84% 52% / 0.4)'
            : 'inset 0 0 0 1px hsl(160 84% 52% / 0.14), 0 -30px 80px -20px rgba(0,0,0,0.6)',
        }}
      >
        {/* emerald gradient border accent on the left edge */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-px"
          style={{ background: 'linear-gradient(to bottom, transparent, hsl(160 84% 52% / 0.40), transparent)' }}
        />
        {/* top hairline */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px"
          style={{ background: 'linear-gradient(to right, transparent, hsl(160 84% 52% / 0.50), transparent)' }}
        />

        {saved && (
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 border-b border-emerald-400/25 bg-emerald-400/[0.08] px-5 py-2.5 text-[12.5px] text-emerald-300"
          >
            <Check className="h-4 w-4" /> Saved — your Company Brain is updated.
          </motion.div>
        )}

        <SheetHeader className="gap-0 border-b border-border/25 px-5 pb-4 pt-5 text-left">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/[0.08]"
              style={{ boxShadow: '0 0 18px -6px hsl(160 84% 52% / 0.5), inset 0 1px 0 hsl(var(--foreground) / 0.06)' }}
            >
              <Icon className="h-[18px] w-[18px] text-emerald-300" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-[17px] tracking-tight">{meta.title}</SheetTitle>
              <SheetDescription className="mt-0.5 text-[12.5px]">{meta.description}</SheetDescription>
            </div>
          </div>
          <p className="mt-3 rounded-lg border border-border/25 bg-background/20 px-3 py-2 text-[11.5px] leading-snug text-muted-foreground/80">
            <span className="font-medium text-foreground/75">Influences: </span>{meta.influences}
          </p>
        </SheetHeader>

        {/* Small, non-blocking notices. Deliberately not banners — the visual
            design of the drawer is unchanged. */}
        {restored && (
          <div className="px-5 pb-1 text-[11.5px] text-emerald-300/90">{UNSAVED_RESTORED_NOTICE}</div>
        )}
        {backgroundUpdate && (
          <div className="px-5 pb-1 text-[11.5px] text-amber-200/90">{BACKGROUND_UPDATE_NOTICE}</div>
        )}

        <div className="-mr-1 mt-4 flex-1 space-y-5 overflow-y-auto px-5 pr-6">
          {section === 'company' && <CompanyEditor state={state} setState={setState} />}
          {section === 'targeting' && <TargetingEditor state={state} setState={setState} />}
          {section === 'buyers' && <BuyersEditor state={state} setState={setState} />}
          {section === 'signals' && <SignalsEditor state={state} setState={setState} />}
          {section === 'disqualifiers' && <DisqualifiersEditor state={state} setState={setState} />}
          {section === 'messaging' && <MessagingEditor state={state} setState={setState} />}
        </div>

        {/* Floating dock-style save area */}
        <div className="relative border-t border-border/20 px-5 py-4">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{ background: 'linear-gradient(to right, transparent, hsl(var(--border) / 0.30), transparent)' }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => requestClose(false)}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={busy}
              className="gap-2 bg-gradient-to-b from-primary to-[hsl(var(--primary)/0.82)] shadow-[0_1px_0_hsl(var(--foreground)/0.12)_inset,0_8px_24px_-10px_hsl(var(--primary)/0.5)] transition-all hover:shadow-[0_1px_0_hsl(var(--foreground)/0.15)_inset,0_12px_32px_-10px_hsl(var(--primary)/0.65),0_0_24px_hsl(var(--primary)/0.2)]"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Saving…' : dirty ? 'Save changes •' : 'Save changes'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --------------------------------------------------------------- editors ----

function CompanyEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <Field label="Company name">
        <Input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
      </Field>
      <Field label="Website">
        <Input value={state.website_url} onChange={(e) => setState({ ...state, website_url: e.target.value })} placeholder="https://" />
      </Field>
      <Field label="Category">
        <Input value={state.category} onChange={(e) => setState({ ...state, category: e.target.value })} />
      </Field>
      <Field label="Short description">
        <Textarea rows={3} value={state.description} onChange={(e) => setState({ ...state, description: e.target.value })} />
      </Field>
      <Field label="Business model">
        <Input value={state.business_model} onChange={(e) => setState({ ...state, business_model: e.target.value })} />
      </Field>
      <Field label="Stage">
        <Input value={state.stage} onChange={(e) => setState({ ...state, stage: e.target.value })} />
      </Field>
      <Field label="Team size">
        <Input value={state.team_size} onChange={(e) => setState({ ...state, team_size: e.target.value })} />
      </Field>
    </div>
  );
}

function TargetingEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Industries" values={state.industries} onChange={(v) => setState({ ...state, industries: v })} placeholder="e.g. B2B SaaS" />
      <ChipInput label="Business models" values={state.business_models} onChange={(v) => setState({ ...state, business_models: v })} />
      <ChipInput label="Geography" values={state.geography} onChange={(v) => setState({ ...state, geography: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company size (min)">
          <Input inputMode="numeric" value={state.size_min} onChange={(e) => setState({ ...state, size_min: e.target.value })} />
        </Field>
        <Field label="Company size (max)">
          <Input inputMode="numeric" value={state.size_max} onChange={(e) => setState({ ...state, size_max: e.target.value })} />
        </Field>
      </div>
      <Field label="Company size label">
        <Input value={state.size_label} onChange={(e) => setState({ ...state, size_label: e.target.value })} placeholder="11–50" />
      </Field>
      <ChipInput label="Must-have traits" values={state.must_have} onChange={(v) => setState({ ...state, must_have: v })} />
      <ChipInput label="Nice-to-have traits" values={state.nice_to_have} onChange={(v) => setState({ ...state, nice_to_have: v })} />
      <ChipInput label="Funding stage" values={state.funding_stage} onChange={(v) => setState({ ...state, funding_stage: v })} />
    </div>
  );
}

function BuyersEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Buyer roles" values={state.buyer_personas} onChange={(v) => setState({ ...state, buyer_personas: v })} placeholder="e.g. Head of RevOps" />
      <ChipInput label="Pain points" values={state.pain_points} onChange={(v) => setState({ ...state, pain_points: v })} />
    </div>
  );
}

function SignalsEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Buying triggers" values={state.triggers} onChange={(v) => setState({ ...state, triggers: v })} />
      <ChipInput label="Jobs to watch" values={state.jobs_to_watch} onChange={(v) => setState({ ...state, jobs_to_watch: v })} />
    </div>
  );
}

function DisqualifiersEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Industries to avoid" values={state.disq_industries} onChange={(v) => setState({ ...state, disq_industries: v })} />
      <ChipInput label="Company types to avoid" values={state.disq_company_types} onChange={(v) => setState({ ...state, disq_company_types: v })} />
      <ChipInput label="Keywords to avoid" values={state.disq_keywords} onChange={(v) => setState({ ...state, disq_keywords: v })} />
      <ChipInput label="Titles to avoid" values={state.disq_titles} onChange={(v) => setState({ ...state, disq_titles: v })} />
      <ChipInput label="Required evidence" values={state.required_evidence} onChange={(v) => setState({ ...state, required_evidence: v })} />
      <ChipInput label="Reject if" values={state.reject_if} onChange={(v) => setState({ ...state, reject_if: v })} />
      <ChipInput label="Manual review if" values={state.manual_review_if} onChange={(v) => setState({ ...state, manual_review_if: v })} />
      <ChipInput label="Negative examples" values={state.negative_examples} onChange={(v) => setState({ ...state, negative_examples: v })} />
    </div>
  );
}

function MessagingEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <Field label="Positioning promise">
        <Textarea rows={2} value={state.promise} onChange={(e) => setState({ ...state, promise: e.target.value })} />
      </Field>
      <ChipInput label="Differentiators" values={state.differentiators} onChange={(v) => setState({ ...state, differentiators: v })} />
      <ChipInput label="Proof points" values={state.proof_points} onChange={(v) => setState({ ...state, proof_points: v })} />
      <ChipInput label="Content angles" values={state.content_angles} onChange={(v) => setState({ ...state, content_angles: v })} />
      <Field label="Brand voice / tone">
        <Input value={state.tone} onChange={(e) => setState({ ...state, tone: e.target.value })} />
      </Field>
      <ChipInput label="Voice tags" values={state.tags} onChange={(v) => setState({ ...state, tags: v })} />
      <ChipInput label="Style rules" values={state.style_rules} onChange={(v) => setState({ ...state, style_rules: v })} />
      <ChipInput label="Avoid / banned claims" values={state.avoid} onChange={(v) => setState({ ...state, avoid: v })} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

// -------------------------------------------------- initial state + patch ---

function initialFor(section: SectionKey, b: CompanyBrainV2): any {
  switch (section) {
    case 'company': return {
      name: b.company.name, website_url: b.company.website_url, category: b.company.category,
      description: b.company.description, business_model: b.company.business_model,
      stage: b.company.stage, team_size: b.company.team_size,
    };
    case 'targeting': return {
      industries: [...b.target_customer.industries],
      business_models: [...b.target_customer.business_models],
      geography: [...b.target_customer.geography],
      must_have: [...b.target_customer.must_have],
      nice_to_have: [...b.target_customer.nice_to_have],
      funding_stage: [...b.target_customer.funding_stage],
      size_min: b.target_customer.company_size.min?.toString() ?? '',
      size_max: b.target_customer.company_size.max?.toString() ?? '',
      size_label: b.target_customer.company_size.label ?? '',
    };
    case 'buyers': return {
      buyer_personas: [...b.buyer_personas],
      pain_points: [...b.pain_points],
    };
    case 'signals': return {
      triggers: [...b.triggers],
      jobs_to_watch: [...b.jobs_to_watch],
    };
    case 'disqualifiers': return {
      disq_industries: [...b.target_customer.disqualifiers.industries],
      disq_company_types: [...b.target_customer.disqualifiers.company_types],
      disq_keywords: [...b.target_customer.disqualifiers.keywords],
      disq_titles: [...b.target_customer.disqualifiers.titles],
      required_evidence: [...b.qualification_rules.required_evidence],
      reject_if: [...b.qualification_rules.reject_if],
      manual_review_if: [...b.qualification_rules.manual_review_if],
      negative_examples: [...b.negative_examples],
    };
    case 'messaging': return {
      promise: b.positioning.promise,
      differentiators: [...b.positioning.differentiators],
      proof_points: [...b.positioning.proof_points],
      content_angles: [...b.content_angles],
      tone: b.brand_voice.tone,
      tags: [...b.brand_voice.tags],
      style_rules: [...b.brand_voice.style_rules],
      avoid: [...b.brand_voice.avoid],
    };
  }
}

function buildPatch(section: SectionKey, s: any, b: CompanyBrainV2): BrainProfile {
  switch (section) {
    case 'company':
      return { company: { ...b.company, ...s } };
    case 'targeting': {
      const min = s.size_min === '' ? null : Number(s.size_min);
      const max = s.size_max === '' ? null : Number(s.size_max);
      return {
        target_customer: {
          ...b.target_customer,
          industries: s.industries, business_models: s.business_models, geography: s.geography,
          must_have: s.must_have, nice_to_have: s.nice_to_have, funding_stage: s.funding_stage,
          company_size: {
            min: Number.isFinite(min as number) ? (min as number) : null,
            max: Number.isFinite(max as number) ? (max as number) : null,
            label: s.size_label,
          },
        },
      };
    }
    case 'buyers':
      return { buyer_personas: s.buyer_personas, pain_points: s.pain_points };
    case 'signals':
      return { triggers: s.triggers, jobs_to_watch: s.jobs_to_watch };
    case 'disqualifiers':
      return {
        target_customer: {
          ...b.target_customer,
          disqualifiers: {
            ...b.target_customer.disqualifiers,
            industries: s.disq_industries, company_types: s.disq_company_types,
            keywords: s.disq_keywords, titles: s.disq_titles,
          },
        },
        qualification_rules: {
          ...b.qualification_rules,
          required_evidence: s.required_evidence,
          reject_if: s.reject_if,
          manual_review_if: s.manual_review_if,
        },
        negative_examples: s.negative_examples,
      };
    case 'messaging':
      return {
        positioning: {
          ...b.positioning,
          promise: s.promise, differentiators: s.differentiators, proof_points: s.proof_points,
        },
        content_angles: s.content_angles,
        brand_voice: {
          ...b.brand_voice,
          tone: s.tone, tags: s.tags, style_rules: s.style_rules, avoid: s.avoid,
        },
      };
  }
}
