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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuidedSetup } from '@/components/onboarding/GuidedSetup';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { companyBrainKey } from '@/hooks/useCompanyBrain';
import { safeReturnPath } from '@/lib/routeGuard';
import { toast } from 'sonner';

import {
  emptyCompanyForm, emptyFounderForm, type CompanyForm, type FounderForm,
  isLinkedInCompanyUrl, buildDraftInput, buildSavePatch, previewBrain,
} from '@/lib/onboardingV3';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import { preserveSetupEdits } from '@/lib/guidedSetup';

const FN = 'generate-company-brain-draft';

export default function OnboardingCompanyBrain() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Recovered: return to wherever ProtectedRoute gated the user FROM,
  // instead of always landing on /dashboard once onboarding is done.
  const returnPath = safeReturnPath(searchParams.get('next')) ?? '/dashboard';


  const [founder, setFounder] = useState<FounderForm>(emptyFounderForm());
  const [company, setCompany] = useState<CompanyForm>(emptyCompanyForm());

  const [founderResearch, setFounderResearch] = useState<any>(null);
  const [companyResearch, setCompanyResearch] = useState<any>(null);
  const [companyLinkedIn, setCompanyLinkedIn] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [edited, setEdited] = useState<CompanyBrainV2 | null>(null);
  const [activated, setActivated] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [restoredWorkspace, setRestoredWorkspace] = useState<string | null>(null);
  const [sessionSaved, setSessionSaved] = useState(false);
  const snapshot = JSON.stringify({ founder, company, draft, edited, founderResearch, companyResearch, companyLinkedIn, setupStep });

  useEffect(() => {
    if (!workspaceId) return;
    try {
      const raw = sessionStorage.getItem(`agentory:guided-setup:${workspaceId}`);
      if (raw) {
        const value = JSON.parse(raw);
        if (value.version === 1 && value.founder && value.company) {
          setFounder({ ...emptyFounderForm(), ...value.founder });
          setCompany({ ...emptyCompanyForm(), ...value.company });
          setDraft(value.draft ?? null); setEdited(value.edited ?? null);
          setFounderResearch(value.founderResearch ?? null);
          setCompanyResearch(value.companyResearch ?? null);
          setCompanyLinkedIn(value.companyLinkedIn ?? null);
          setSetupStep(Math.max(0, Math.min(5, Number(value.setupStep) || 0)));
        }
      }
    } catch { /* Storage can be unavailable; the in-memory setup still works. */ }
    setRestoredWorkspace(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || restoredWorkspace !== workspaceId) return;
    setSessionSaved(false);
    const timer = window.setTimeout(() => {
      try {
        if (activated) sessionStorage.removeItem(`agentory:guided-setup:${workspaceId}`);
        else sessionStorage.setItem(`agentory:guided-setup:${workspaceId}`, JSON.stringify({ version: 1, ...JSON.parse(snapshot) }));
        setSessionSaved(true);
      } catch { setSessionSaved(false); }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [snapshot, workspaceId, restoredWorkspace, activated]);

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



  // ----------------------------------------------------- backend handlers ---

  async function analyzeFounder() {
    // ONE RUN AT A TIME. The button is disabled while busy, but a double click
    // in the same tick beats the re-render — and each extra run is a provider
    // call somebody pays for.
    if (busy) return;
    setBusy('founder'); setError(null);
    try {
      const r = await call('research_founder', {
        linkedin_url: founder.linkedin_url,
        consent: founder.enrichment_consent,
      });
      if (r?.ok && r.research) {
        setFounderResearch(r.research);
        toast.success('Founder profile analyzed', {
          description: r.provider_mode === 'mock'
            ? `Local fixture — no provider was called. Confidence: ${r.research.confidence}`
            : `Confidence: ${r.research.confidence}`,
        });
      } else {
        if (r?.research) setFounderResearch(r.research); // sparse: keep for honesty
        setError({ title: 'Founder analysis unavailable', body: explain(r?.reason ?? r?.error, 'founder') });
      }
    } catch {
      setError({ title: 'Founder analysis failed', body: 'You can continue and fill this in by hand.' });
    } finally { setBusy(null); }
  }

  async function analyzeCompany() {
    if (busy) return;
    setBusy('company'); setError(null);
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
        toast.success('Company analyzed', {
          description: r.provider_mode === 'mock'
            ? `Local fixture — no provider was called. ${r.pages_fetched} page(s) read`
            : `${r.pages_fetched} page(s) read`,
        });
      } else {
        if (r?.company_research) setCompanyResearch(r.company_research);
        setError({ title: 'Company analysis unavailable', body: explain(r?.reason ?? r?.error, 'company') });
      }
    } catch {
      setError({ title: 'Company analysis failed', body: 'You can continue and fill this in by hand.' });
    } finally { setBusy(null); }
  }

  async function draftBrain() {
    if (busy) return false;
    setBusy('draft'); setError(null);
    try {
      const r = await call('draft', buildDraftInput({
        founder, company, founderResearch, companyResearch, companyLinkedIn,
      }));
      if (r?.ok && r.draft) {
        if (edited) setEdited(preserveSetupEdits(previewBrain(draft).brain, edited, previewBrain(r.draft).brain));
        setDraft(r.draft);
        // Preserve user-confirmed context when regenerating an AI draft.
        toast.success('Draft Company Brain ready', { description: 'Review the suggested audience and signals.' });
        return true;
      } else {
        setError({ title: 'Could not draft the Brain', body: explain(r?.reason ?? r?.error, 'draft') });
      }
    } catch {
      setError({ title: 'Draft failed', body: 'You can still fill the Brain in by hand.' });
    } finally { setBusy(null); }
    return false;
  }

  async function persist(activate: boolean) {
    if (busy) return;
    setBusy(activate ? 'activate' : 'save'); setError(null);
    try {
      const patch = buildSavePatch({ founder, company, brain });
      patch.founder = { ...(patch.founder as object), first_help_goal: founder.first_help_goal };
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
        setError({
          title: "A few decisions left",
          body: (r?.blocked_reasons ?? []).join('; ') || 'Confirm the highlighted decisions. Your draft is saved.',
        });
        return;
      }
      if (!activate && r?.ok === false) throw new Error('Draft save rejected');
      setSavedSnapshot(snapshot);
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
        setActivated(true);
      }
    } catch {
      setError({ title: 'Save failed', body: 'Nothing was lost — try again.' });
    } finally { setBusy(null); }
  }

  // --------------------------------------------------------------- render ---

  return <GuidedSetup
    step={setupStep} onStep={step => { setError(null); setSetupStep(step); window.scrollTo({ top: 0, behavior: 'instant' }); }}
    founder={founder} onFounder={setFounder} company={company} onCompany={setCompany}
    brain={brain} onBrain={setEdited} completeness={completeness}
    busy={busy} error={error} activated={activated} hasDraft={!!draft}
    saved={activated ? 'Company Brain saved' : busy === 'save' ? 'Saving draft…' : savedSnapshot === snapshot ? 'Draft saved' : sessionSaved ? 'Saved in this tab' : 'Unsaved changes'}
    companyResearched={!!companyResearch} founderResearched={!!founderResearch}
    onResearchCompany={analyzeCompany} onResearchFounder={analyzeFounder} onDraft={draftBrain}
    onSave={() => persist(false)} onActivate={() => persist(true)}
    onDestination={path => navigate(safeReturnPath(path) ?? returnPath)}
  />;
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
    case 'apify_not_configured':
      return 'LinkedIn research is unavailable in this workspace. Continue with your own details or try again later.';
    case 'firecrawl_not_configured':
      return 'Website research is unavailable in this workspace. Continue with your own details or try again later.';
    case 'no_pages_fetched': return 'That website could not be reached, so nothing was read from it.';
    case 'llm_not_configured': return 'AI drafting is not configured yet. You can still fill the Brain in by hand.';
    case 'invalid_website_url': return 'Enter a full website URL starting with https://';
    case 'sparse_profile_data': return 'Limited public LinkedIn data found. You can continue and fill this in by hand.';
    default:
      return ctx === 'draft'
        ? 'Could not draft the Brain from the available evidence.'
        : 'Nothing could be read from that source. You can continue by hand.';
  }
}
