// Company Brain Onboarding — progressive, AI-guided setup.
//
// The user sees ONE focused scene at a time (16 internal scenes) grouped into
// the five high-level phases shown in the top progress bar. This is a
// presentation architecture over the SAME backend: every call still goes to
//   invoke('generate-company-brain-draft', { action, workspace_id, ... })
// with actions: status | research_founder | research_company | draft |
// save_draft | activate. Providers run ONLY on an explicit click, founder
// enrichment also requires consent, nothing sends automatically, and no Scout
// Radar scan is triggered.

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { companyBrainKey } from '@/hooks/useCompanyBrain';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Cpu, Loader2 } from 'lucide-react';

import { ProgressiveBackground } from '@/components/onboarding/ProgressiveBackground';
import { FloatingBrainCard } from '@/components/onboarding/FloatingBrainCard';
import { StepProgress } from '@/components/onboarding/StepProgress';
import { ErrorState } from '@/components/onboarding/ErrorState';
import {
  FounderNameScene, FounderLinkedInScene, FounderResearchScene, FounderVerifyScene,
} from '@/components/onboarding/scenes/FounderScenes';
import {
  CompanyDescriptionScene, CompanyWebsiteScene, CompanyResearchScene, CompanyVerifyScene,
} from '@/components/onboarding/scenes/CompanyScenes';
import { DraftBrainScene, DraftSummaryScene } from '@/components/onboarding/scenes/ResearchScenes';
import { DecisionReviewScene } from '@/components/onboarding/scenes/DecisionReviewScene';
import { ActivateScene } from '@/components/onboarding/scenes/ActivateScene';

import {
  STEPS,
  emptyCompanyForm, emptyFounderForm, type CompanyForm, type FounderForm,
  isLinkedInCompanyUrl, buildDraftInput, buildSavePatch, previewBrain,
} from '@/lib/onboardingV3';
import {
  SCENES, type SceneId, sceneIndex, sceneAt, phaseIndexOf, brainStateFor,
  firstSceneOfPhase, REVIEW_SCENES, reviewSceneForMissingStep,
} from '@/lib/onboardingScenes';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';

const FN = 'generate-company-brain-draft';

export default function OnboardingCompanyBrain() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [scene, setScene] = useState<SceneId>('founder_name');

  const [founder, setFounder] = useState<FounderForm>(emptyFounderForm());
  const [company, setCompany] = useState<CompanyForm>(emptyCompanyForm());

  const [founderResearch, setFounderResearch] = useState<any>(null);
  const [companyResearch, setCompanyResearch] = useState<any>(null);
  const [companyLinkedIn, setCompanyLinkedIn] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [suggestedFixes, setSuggestedFixes] = useState<Record<string, unknown> | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [edited, setEdited] = useState<CompanyBrainV2 | null>(null);
  const [activated, setActivated] = useState(false);

  // Same live-preview merge as before: draft + user edits + typed values.
  // Preserves suggested_fixes / claims / signal_preferences etc. by keeping the
  // raw draft object intact and only layering edits on top for the patch.
  const rawProfile = useMemo(() => ({
    ...(draft ?? {}),
    ...(edited ? toRaw(edited) : {}),
    company: {
      ...((draft?.company as object) ?? {}),
      ...(edited ? edited.company : {}),
      ...(company.name ? { name: company.name } : {}),
      ...(company.website_url ? { website_url: company.website_url } : {}),
      ...(company.description ? { description: company.description } : {}),
    },
    founder: {
      ...((draft?.founder as object) ?? {}),
      ...(edited ? edited.founder : {}),
      ...(founder.name ? { name: founder.name } : {}),
      ...(founder.role ? { role: founder.role } : {}),
      ...(founder.linkedin_url ? { linkedin_url: founder.linkedin_url } : {}),
    },
  }), [draft, edited, company, founder]);

  const { brain, completeness } = useMemo(() => previewBrain(rawProfile), [rawProfile]);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!workspaceId) throw new Error('No workspace');
    const { data, error } = await supabase.functions.invoke(FN, {
      body: { action, workspace_id: workspaceId, ...payload },
    });
    if (error) throw error;
    return data as any;
  }, [workspaceId]);

  // ----------------------------------------------------------- navigation ---

  const idx = sceneIndex(scene);
  const goto = (s: SceneId) => { setError(null); setScene(s); };
  const next = () => goto(sceneAt(Math.min(SCENES.length - 1, idx + 1)).id);
  const back = () => goto(sceneAt(Math.max(0, idx - 1)).id);

  const phaseIndex = phaseIndexOf(scene);
  const brainState = brainStateFor(scene, { activated });
  const orbSize = scene === 'activate_ready' ? 168
    : (brainState.mode === 'thinking' ? 148 : 92);

  // ----------------------------------------------------- backend handlers ---

  async function analyzeFounder() {
    setBusy('founder'); setError(null);
    goto('founder_research');
    try {
      const r = await call('research_founder', {
        linkedin_url: founder.linkedin_url,
        consent: founder.enrichment_consent,
      });
      if (r?.ok && r.research) {
        setFounderResearch(r.research);
        toast.success('Founder profile analyzed', { description: `Confidence: ${r.research.confidence}` });
      } else {
        if (r?.research) setFounderResearch(r.research); // sparse: keep for honesty
        setError({ title: 'Founder analysis unavailable', body: explain(r?.reason ?? r?.error, 'founder') });
      }
    } catch {
      setError({ title: 'Founder analysis failed', body: 'You can continue and fill this in by hand.' });
    } finally { setBusy(null); }
  }

  async function analyzeCompany() {
    setBusy('company'); setError(null);
    goto('company_research');
    try {
      const r = await call('research_company', {
        website_url: company.website_url,
        linkedin_url: isLinkedInCompanyUrl(company.linkedin_url) ? company.linkedin_url : '',
        name: company.name,
        description: company.description,
      });
      if (r?.ok && r.company_research) {
        setCompanyResearch(r.company_research);
        setCompanyLinkedIn(r.company_linkedin ?? null);
        toast.success('Company analyzed', { description: `${r.pages_fetched} page(s) read` });
      } else {
        if (r?.company_research) setCompanyResearch(r.company_research);
        setError({ title: 'Company analysis unavailable', body: explain(r?.reason ?? r?.error, 'company') });
      }
    } catch {
      setError({ title: 'Company analysis failed', body: 'You can continue and fill this in by hand.' });
    } finally { setBusy(null); }
  }

  async function draftBrain() {
    setBusy('draft'); setError(null);
    try {
      const r = await call('draft', buildDraftInput({
        founder, company, founderResearch, companyResearch, companyLinkedIn,
      }));
      if (r?.ok && r.draft) {
        setDraft(r.draft);
        setEdited(null);
        goto('draft_summary');
        toast.success('Draft Company Brain ready', { description: 'Review one decision group at a time.' });
      } else {
        setError({ title: 'Could not draft the Brain', body: explain(r?.reason ?? r?.error, 'draft') });
      }
    } catch {
      setError({ title: 'Draft failed', body: 'You can still fill the Brain in by hand.' });
    } finally { setBusy(null); }
  }

  async function persist(activate: boolean) {
    setBusy(activate ? 'activate' : 'save'); setError(null);
    try {
      const patch = buildSavePatch({ founder, company, brain });
      // These are the user's own typed/confirmed company values — an explicit
      // seller confirmation, the one non-manual origin allowed to write seller
      // identity. Without this the save boundary treats it as an automated
      // refresh and only fills empty fields.
      const r = await call(activate ? 'activate' : 'save_draft', {
        patch,
        change_origin: 'onboarding_seller_confirmation',
      });
      if (activate && !r?.activated) {
        // Blocked: keep the additive suggested_fixes so the user can accept them.
        setSuggestedFixes(r?.suggested_fixes ?? null);
        setError({
          title: "A few decisions left",
          body: (r?.blocked_reasons ?? []).join('; ') || 'Confirm the highlighted decisions. Your draft is saved.',
        });
        return;
      }
      if (activate) { setActivated(true); }
      toast.success(activate ? 'Company Brain activated' : 'Draft saved', {
        description: activate
          ? 'Leads, Signal Radar, Content, Agents and Outreach now use it.'
          : 'You can finish later.',
      });
      if (activate) {
        // THE ACTIVATION HAS TO REACH THE CACHE, NOT JUST THE DATABASE.
        //
        // `useCompanyBrain` holds this row with a five-minute staleTime and no
        // refetch on focus — both deliberate, and both correct for a value that
        // almost never changes. But it DOES change here, exactly once, and this
        // is the moment.
        //
        // Without this the row on the client stayed `onboarding_completed:
        // false` while the database said true, so `OnboardingGate` read its own
        // stale cache and bounced the user straight back to onboarding. The
        // dashboard was visible for the moment between navigation and the
        // gate's decision, which made it look like a loop rather than a
        // redirect.
        //
        // `await` before navigating: refetching after the route change would
        // race the gate and reintroduce the same bounce, just less often.
        await queryClient.invalidateQueries({ queryKey: companyBrainKey(workspaceId) });
        setTimeout(() => navigate('/dashboard'), 900);
      }
    } catch {
      setError({ title: 'Save failed', body: 'Nothing was lost — try again.' });
    } finally { setBusy(null); }
  }

  // --------------------------------------------------------------- render ---

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip text-foreground">
      <ProgressiveBackground />

      {/* Top bar */}
      <header className="z-20 shrink-0">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary shadow-[0_0_16px_hsl(var(--primary)/0.25)]">
              <Cpu className="h-4 w-4" />
            </div>
            <p className="text-xs font-semibold tracking-tight">
              Agentory <span className="mx-1 text-muted-foreground/50">·</span>
              <span className="text-muted-foreground/90">Company Brain</span>
            </p>
          </div>
          <Button
            size="sm" variant="ghost"
            onClick={() => persist(false)}
            disabled={!!busy || !workspaceId}
            className="h-8 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {busy === 'save' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save draft
          </Button>
        </div>
      </header>

      {/* 5-phase progress — compact, it guides without dominating */}
      <div className="mx-auto w-full max-w-lg shrink-0 px-4 pt-1.5 sm:px-6">
        <StepProgress index={phaseIndex} steps={STEPS} />
      </div>

      {/* Scene stage — orb and card composed as one hero object */}
      <main className="flex flex-1 flex-col items-center justify-start gap-4 px-4 py-6 sm:py-8">
        {/* The draft_brain (busy) and draft_summary scenes own their own orb +
            workforce animation, so the shell orb is hidden there to avoid
            duplication. */}
        {!(scene === 'draft_brain' && busy === 'draft') && scene !== 'draft_summary' && (
          <FloatingBrainCard
            label={brainState.label}
            mode={brainState.mode}
            size={orbSize}
          />
        )}

        <div className="w-full">
          {error && (
            <div className="mx-auto mb-4 w-full max-w-[760px]">
              <ErrorState
                title={error.title}
                body={error.body}
                onRetry={
                  scene === 'founder_research' ? analyzeFounder :
                  scene === 'company_research' ? analyzeCompany :
                  scene === 'draft_brain' ? draftBrain :
                  undefined
                }
                onContinue={
                  scene === 'founder_research' || scene === 'company_research'
                    ? () => { setError(null); next(); }
                    : undefined
                }
              />
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <SceneRouter
              key={scene}
              scene={scene}
              founder={founder} setFounder={setFounder}
              company={company} setCompany={setCompany}
              founderResearch={founderResearch}
              companyResearch={companyResearch}
              brain={brain} completeness={completeness}
              busy={busy}
              onEditBrain={setEdited}
              analyzeFounder={analyzeFounder}
              analyzeCompany={analyzeCompany}
              draftBrain={draftBrain}
              persist={persist}
              goto={goto} next={next} back={back}
            />
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- router ----

function SceneRouter(props: {
  scene: SceneId;
  founder: FounderForm; setFounder: (f: FounderForm) => void;
  company: CompanyForm; setCompany: (c: CompanyForm) => void;
  founderResearch: any; companyResearch: any;
  brain: CompanyBrainV2; completeness: ReturnType<typeof previewBrain>['completeness'];
  busy: string | null;
  onEditBrain: (b: CompanyBrainV2) => void;
  analyzeFounder: () => void; analyzeCompany: () => void; draftBrain: () => void;
  persist: (activate: boolean) => void;
  goto: (s: SceneId) => void; next: () => void; back: () => void;
}) {
  const {
    scene, founder, setFounder, company, setCompany, founderResearch, companyResearch,
    brain, completeness, busy, onEditBrain, analyzeFounder, analyzeCompany, draftBrain,
    persist, goto, next, back,
  } = props;

  switch (scene) {
    case 'founder_name':
      return <FounderNameScene value={founder} onChange={setFounder} onContinue={next} />;
    case 'founder_linkedin':
      return <FounderLinkedInScene value={founder} onChange={setFounder} onAnalyze={analyzeFounder} onSkip={() => goto('founder_verify')} onBack={back} />;
    case 'founder_research':
      return <FounderResearchScene busy={busy === 'founder'} research={founderResearch} onContinue={next} onBack={() => goto('founder_linkedin')} />;
    case 'founder_verify':
      return <FounderVerifyScene value={founder} research={founderResearch} onChange={setFounder} onConfirm={next} onBack={back} />;

    case 'company_description':
      return <CompanyDescriptionScene value={company} onChange={setCompany} onContinue={next} onBack={back} />;
    case 'company_website':
      return <CompanyWebsiteScene value={company} onChange={setCompany} onAnalyze={analyzeCompany} onBack={back} />;
    case 'company_research':
      return <CompanyResearchScene busy={busy === 'company'} research={companyResearch} onContinue={next} onBack={() => goto('company_website')} />;
    case 'company_verify':
      return <CompanyVerifyScene value={company} research={companyResearch} onChange={setCompany} onConfirm={next} onBack={back} />;

    case 'draft_brain':
      return <DraftBrainScene busy={busy === 'draft'} onDraft={draftBrain} onBack={back} />;
    case 'draft_summary':
      return <DraftSummaryScene brain={brain} onReview={() => goto('review_targeting')} onBack={() => goto('draft_brain')} />;

    case 'review_targeting':
    case 'review_buyers':
    case 'review_signals':
    case 'review_safety':
    case 'review_messaging': {
      const isLast = scene === REVIEW_SCENES[REVIEW_SCENES.length - 1];
      return (
        <DecisionReviewScene
          scene={scene}
          brain={brain}
          confidence={completeness.confidence}
          onEditBrain={onEditBrain}
          onContinue={() => (isLast ? goto('activate_ready') : next())}
          onBack={back}
          isLast={isLast}
        />
      );
    }

    case 'activate_ready':
      return (
        <ActivateScene
          completeness={completeness}
          busy={busy === 'activate' ? 'activate' : busy === 'save' ? 'save' : null}
          onActivate={() => persist(true)}
          onSaveDraft={() => persist(false)}
          onGoToMissing={(step) => goto(reviewSceneForMissingStep(step))}
          onBack={() => goto('review_messaging')}
        />
      );
  }
}

/** Project a normalized Brain back onto a raw profile patch for previewing. */
function toRaw(b: CompanyBrainV2): Record<string, unknown> {
  return {
    target_customer: b.target_customer,
    buyer_personas: b.buyer_personas, triggers: b.triggers, jobs_to_watch: b.jobs_to_watch,
    competitors: b.competitors, tools: b.tools, pain_points: b.pain_points,
    positive_examples: b.positive_examples, negative_examples: b.negative_examples,
    content_angles: b.content_angles, positioning: b.positioning, brand_voice: b.brand_voice,
    qualification_rules: b.qualification_rules, evidence: b.evidence,
  };
}

function explain(reason: string | undefined, ctx: 'founder' | 'company' | 'draft'): string {
  switch (reason) {
    case 'consent_not_given': return 'Turn on the consent toggle to enrich from LinkedIn.';
    case 'invalid_linkedin_profile_url': return 'That does not look like a linkedin.com/in/… profile URL.';
    case 'invalid_linkedin_company_url': return 'That does not look like a linkedin.com/company/… URL.';
    case 'apify_not_configured': return 'LinkedIn enrichment is not configured yet. Continue and fill this in by hand.';
    case 'firecrawl_not_configured': return 'Website research is not configured yet. Continue and fill this in by hand.';
    case 'llm_not_configured': return 'AI drafting is not configured yet. You can still fill the Brain in by hand.';
    case 'invalid_website_url': return 'Enter a full website URL starting with https://';
    case 'sparse_profile_data': return 'Limited public LinkedIn data found. You can continue and fill this in by hand.';
    default:
      return ctx === 'draft'
        ? 'Could not draft the Brain from the available evidence.'
        : 'Nothing could be read from that source. You can continue by hand.';
  }
}
