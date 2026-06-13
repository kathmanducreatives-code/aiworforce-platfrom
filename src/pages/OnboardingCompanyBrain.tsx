import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { ArrowRight, Loader2, Plus, Trash2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getBrainDefaults, BRAND_VOICE_TAGS, type StructuredBrain } from '@/lib/companyBrainSchema';
import { Switch } from '@/components/ui/switch';

const GOAL_OPTIONS = [
  { value: 'leads', label: 'Find clients/leads' },
  { value: 'hiring', label: 'Hire candidates' },
  { value: 'competitors', label: 'Research competitors' },
  { value: 'outreach', label: 'Run outreach' },
  { value: 'content', label: 'Create content' },
  { value: 'other', label: 'Other' },
];

const SOURCE_TYPES = [
  { value: 'website', label: 'Company website' },
  { value: 'linkedin_company', label: 'LinkedIn company page' },
  { value: 'founder_linkedin', label: 'Founder LinkedIn' },
  { value: 'careers_page', label: 'Careers page' },
  { value: 'competitor', label: 'Competitor' },
  { value: 'case_study', label: 'Case study / portfolio' },
  { value: 'booking', label: 'Booking / calendar' },
  { value: 'document', label: 'ICP / doc' },
  { value: 'other', label: 'Other' },
];

interface SourceRow { source_type: string; url: string; label?: string }

async function call(action: string, workspace_id: string, payload: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('setup-company-brain', {
    body: { action, workspace_id, ...payload },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data;
}

export default function OnboardingCompanyBrain() {
  const navigate = useNavigate();
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const { data: brain, refresh } = useCompanyBrain();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [basics, setBasics] = useState({
    company_name: '', website_url: '', linkedin_company_url: '',
    founder_linkedin_url: '', short_description: '', current_primary_goal: 'leads',
  });
  // Step 2
  const [sources, setSources] = useState<SourceRow[]>([
    { source_type: 'website', url: '' },
    { source_type: 'linkedin_company', url: '' },
  ]);
  // Step 3
  const [analyzeWarnings, setAnalyzeWarnings] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, any>>({});
  // Step 4
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  // Step 5 — structured refine (ICP / goals / voice / approval)
  const [structured, setStructured] = useState<StructuredBrain>(getBrainDefaults());

  useEffect(() => {
    if (brain?.profile && Object.keys(brain.profile).length) {
      setBasics((b) => ({ ...b, ...Object.fromEntries(Object.entries(brain.profile).filter(([k]) => k in b)) }));
      // Hydrate structured groups from existing profile when present.
      const defaults = getBrainDefaults();
      setStructured({
        icp: { ...defaults.icp, ...(brain.profile.icp ?? {}) },
        goals: { ...defaults.goals, ...(brain.profile.goals ?? {}) },
        positioning: { ...defaults.positioning, ...(brain.profile.positioning ?? {}) },
        brand_voice: { ...defaults.brand_voice, ...(brain.profile.brand_voice ?? {}) },
        competitors: { ...defaults.competitors, ...(brain.profile.competitors ?? {}) },
        approval_rules: { ...defaults.approval_rules, ...(brain.profile.approval_rules ?? {}) },
      });
    }
  }, [brain?.onboarding_completed]);

  if (wsLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }
  if (!workspaceId) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">No workspace available.</div>;
  }

  async function saveBasicsAndNext() {
    if (!basics.company_name.trim()) { toast.error('Company name is required'); return; }
    setSaving(true);
    try {
      await call('save_basics', workspaceId!, basics);
      setStep(2);
    } catch (e: any) { toast.error(e.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function saveSourcesAndNext() {
    setSaving(true);
    try {
      const clean = sources.filter((s) => s.url.trim());
      await call('save_sources', workspaceId!, { sources: clean });
      setStep(3);
      await runAnalyze();
    } catch (e: any) { toast.error(e.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function runAnalyze() {
    setSaving(true);
    try {
      const res: any = await call('analyze', workspaceId!);
      setAnalyzeWarnings(res?.warnings ?? []);
      setDraft({ ...(res?.profile ?? {}), ...(res?.draft ?? {}) });
    } catch (e: any) {
      toast.error('Analysis failed — you can still continue manually.');
      setAnalyzeWarnings(['AI enrichment failed. Your inputs are saved; continue manually.']);
    } finally { setSaving(false); }
  }

  async function saveDraftAndNext() {
    setSaving(true);
    try {
      await call('save_basics', workspaceId!, draft);
      const res: any = await call('generate_followups', workspaceId!);
      const qs: string[] = (res?.questions ?? []).slice(0, 5);
      setQuestions(qs);
      setAnswers(qs.map(() => ''));
      setStep(4);
    } catch (e: any) { toast.error(e.message ?? 'Failed'); }
    finally { setSaving(false); }
  }

  async function saveFollowupsAndContinue() {
    setSaving(true);
    try {
      const qa = questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' }));
      await call('save_followups', workspaceId!, { qa });
      setStep(5);
    } catch (e: any) { toast.error(e.message ?? 'Failed'); }
    finally { setSaving(false); }
  }

  async function saveRefineAndFinish() {
    setSaving(true);
    try {
      await call('save_structured', workspaceId!, structured);
      await call('finalize', workspaceId!, {});
      refresh();
      setStep(6);
    } catch (e: any) { toast.error(e.message ?? 'Failed'); }
    finally { setSaving(false); }
  }

  function toggleArrayValue(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function sendPrefill(text: string) {
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text } }));
    navigate('/dashboard');
  }

  return (
    <div className="min-h-screen w-full bg-background text-foreground py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold tracking-widest text-primary uppercase">Company Brain Setup</span>
        </div>
        <h1 className="text-3xl font-bold mb-2">Teach your AI workforce about your company</h1>
        <p className="text-muted-foreground mb-8">Step {Math.min(step, 6)} of 6</p>

        {step !== 6 && (
          <div className="flex gap-2 mb-8">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-primary' : 'bg-muted'}`} />
            ))}
          </div>
        )}

        {step === 1 && (
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-semibold">Company basics</h2>
            <div>
              <Label>Company name *</Label>
              <Input value={basics.company_name} onChange={(e) => setBasics({ ...basics, company_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Website URL</Label><Input placeholder="https://..." value={basics.website_url} onChange={(e) => setBasics({ ...basics, website_url: e.target.value })} /></div>
              <div><Label>LinkedIn company URL</Label><Input value={basics.linkedin_company_url} onChange={(e) => setBasics({ ...basics, linkedin_company_url: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Founder LinkedIn (optional)</Label><Input value={basics.founder_linkedin_url} onChange={(e) => setBasics({ ...basics, founder_linkedin_url: e.target.value })} /></div>
            </div>
            <div>
              <Label>Short description</Label>
              <Textarea rows={3} value={basics.short_description} onChange={(e) => setBasics({ ...basics, short_description: e.target.value })} />
            </div>
            <div>
              <Label>Current primary goal</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                {GOAL_OPTIONS.map((g) => (
                  <button key={g.value} type="button" onClick={() => setBasics({ ...basics, current_primary_goal: g.value })}
                    className={`text-sm rounded-lg border px-3 py-2 text-left ${basics.current_primary_goal === g.value ? 'border-primary bg-primary/10' : 'border-border'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => navigate('/dashboard')}>Skip for now</Button>
              <Button onClick={saveBasicsAndNext} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4 ml-1" /></>}</Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-semibold">Sources & references</h2>
            <p className="text-sm text-muted-foreground">All optional. Add URLs we can use to learn about your company, customers, and competitors.</p>
            {sources.map((s, i) => (
              <div key={i} className="grid grid-cols-[180px_1fr_auto] gap-2 items-center">
                <select value={s.source_type} onChange={(e) => setSources(sources.map((x, j) => j === i ? { ...x, source_type: e.target.value } : x))}
                  className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                  {SOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <Input placeholder="https://..." value={s.url} onChange={(e) => setSources(sources.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
                <Button variant="ghost" size="icon" onClick={() => setSources(sources.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setSources([...sources, { source_type: 'competitor', url: '' }])}>
              <Plus className="h-4 w-4 mr-1" /> Add source
            </Button>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={saveSourcesAndNext} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4 ml-1" /></>}</Button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-semibold">AI company understanding</h2>
            {saving && <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</div>}
            {analyzeWarnings.map((w, i) => (
              <div key={i} className="flex gap-2 items-start rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" /> <span>{w}</span>
              </div>
            ))}
            {!saving && Object.keys(draft).length > 0 && (
              <div className="space-y-3">
                {['company_summary', 'target_customer_profile', 'target_candidate_profile', 'offer_summary', 'positioning', 'brand_voice', 'outreach_style', 'agent_instructions'].map((k) => (
                  <div key={k}>
                    <Label className="capitalize">{k.replace(/_/g, ' ')}</Label>
                    <Textarea rows={2} value={typeof draft[k] === 'string' ? draft[k] : (draft[k] ? JSON.stringify(draft[k]) : '')}
                      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                  </div>
                ))}
                <div>
                  <Label>Competitors (comma-separated)</Label>
                  <Input value={Array.isArray(draft.competitors) ? draft.competitors.join(', ') : (draft.competitors ?? '')}
                    onChange={(e) => setDraft({ ...draft, competitors: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                </div>
              </div>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={runAnalyze} disabled={saving}>Re-run analysis</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                <Button onClick={saveDraftAndNext} disabled={saving}>Continue <ArrowRight className="h-4 w-4 ml-1" /></Button>
              </div>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-semibold">A few questions from Pilot</h2>
            {questions.length === 0 && <div className="text-sm text-muted-foreground">Loading questions…</div>}
            {questions.map((q, i) => (
              <div key={i}>
                <Label>{q}</Label>
                <Textarea rows={2} value={answers[i] ?? ''} onChange={(e) => setAnswers(answers.map((a, j) => j === i ? e.target.value : a))} />
              </div>
            ))}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={saveFollowupsAndContinue} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4 ml-1" /></>}</Button>
            </div>
          </Card>
        )}

        {step === 5 && (
          <Card className="p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Refine ICP, goals, voice & safety</h2>
              <p className="text-sm text-muted-foreground mt-1">All optional — leave anything blank and we'll ask later. We never invent details about your company.</p>
            </div>

            {/* ICP */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">ICP</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Buyer roles (comma-separated)</Label>
                  <Input value={structured.icp.buyer_roles.join(', ')}
                    onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, buyer_roles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} />
                </div>
                <div>
                  <Label>Company size</Label>
                  <Input placeholder="e.g. 50–500 employees" value={structured.icp.company_size}
                    onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, company_size: e.target.value } })} />
                </div>
                <div>
                  <Label>Industries (comma-separated)</Label>
                  <Input value={structured.icp.industries.join(', ')}
                    onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, industries: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} />
                </div>
                <div>
                  <Label>Geography</Label>
                  <Input placeholder="e.g. US + EU" value={structured.icp.geography}
                    onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, geography: e.target.value } })} />
                </div>
              </div>
              <div>
                <Label>Pain points (one per line)</Label>
                <Textarea rows={2} value={structured.icp.pain_points.join('\n')}
                  onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, pain_points: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })} />
              </div>
            </div>

            {/* Goals */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">Goals</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['gtm', 'content', 'outreach', 'competitor_tracking'] as const).map((k) => (
                  <div key={k}>
                    <Label className="capitalize">{k.replace(/_/g, ' ')}</Label>
                    <Input value={structured.goals[k]} onChange={(e) => setStructured({ ...structured, goals: { ...structured.goals, [k]: e.target.value } })} />
                  </div>
                ))}
              </div>
            </div>

            {/* Positioning */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">Positioning</h3>
              <div>
                <Label>Main promise</Label>
                <Input value={structured.positioning.promise} onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, promise: e.target.value } })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Differentiators (comma-separated)</Label>
                  <Input value={structured.positioning.differentiators.join(', ')}
                    onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, differentiators: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} />
                </div>
                <div>
                  <Label>Use cases (comma-separated)</Label>
                  <Input value={structured.positioning.use_cases.join(', ')}
                    onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, use_cases: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} />
                </div>
              </div>
              <div>
                <Label>Proof points (one per line)</Label>
                <Textarea rows={2} value={structured.positioning.proof_points.join('\n')}
                  onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, proof_points: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })} />
              </div>
            </div>

            {/* Brand voice */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">Brand voice</h3>
              <div className="flex flex-wrap gap-2">
                {BRAND_VOICE_TAGS.map((tag) => {
                  const active = structured.brand_voice.tags.includes(tag);
                  return (
                    <button key={tag} type="button"
                      onClick={() => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, tags: toggleArrayValue(structured.brand_voice.tags, tag) } })}
                      className={`text-xs rounded-full border px-3 py-1.5 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                      {tag}
                    </button>
                  );
                })}
              </div>
              <div>
                <Label>Things to avoid (comma-separated)</Label>
                <Input placeholder="hype, emojis, jargon…" value={structured.brand_voice.avoid.join(', ')}
                  onChange={(e) => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, avoid: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} />
              </div>
            </div>

            {/* Competitors */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">Competitors</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Known competitors</Label>
                  <Input value={structured.competitors.known.join(', ')}
                    onChange={(e) => setStructured({ ...structured, competitors: { ...structured.competitors, known: e.target.value.split(',').map(s => s.trim()).filter(Boolean), unknown: false } })} />
                </div>
                <div>
                  <Label>Adjacent tools</Label>
                  <Input value={structured.competitors.adjacent.join(', ')}
                    onChange={(e) => setStructured({ ...structured, competitors: { ...structured.competitors, adjacent: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={structured.competitors.unknown}
                  onChange={(e) => setStructured({ ...structured, competitors: { ...structured.competitors, unknown: e.target.checked } })} />
                I'm not sure who my competitors are yet
              </label>
            </div>

            {/* Approval rules */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">Approval & safety</h3>
              <p className="text-xs text-muted-foreground">Agents always default to draft-only. You can loosen later in settings.</p>
              {([
                ['draft_only', 'Draft only — never send without my approval'],
                ['email_requires_approval', 'Email requires my approval before sending'],
                ['linkedin_manual_only', 'LinkedIn comments & DMs are manual only'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <span className="text-sm">{label}</span>
                  <Switch checked={structured.approval_rules[key]}
                    onCheckedChange={(v) => setStructured({ ...structured, approval_rules: { ...structured.approval_rules, [key]: v } })} />
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(4)}>Back</Button>
              <Button onClick={saveRefineAndFinish} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Finish setup'}</Button>
            </div>
          </Card>
        )}

        {step === 6 && (
          <Card className="p-8 text-center space-y-6">
            <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
            <h2 className="text-2xl font-bold">Your AI workforce is ready.</h2>
            <ul className="text-sm text-muted-foreground space-y-1 inline-block text-left">
              <li>• Scout knows who to find</li>
              <li>• Aria knows how to rank</li>
              <li>• Penn knows how to write</li>
              <li>• Hawk knows what to watch</li>
              <li>• Scribe knows your voice</li>
            </ul>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto pt-4">
              {[
                'Brief me on today',
                'Find leads like my ICP',
                'Analyze my competitors',
                'Draft outreach to my ICP',
                'Create a hiring plan',
              ].map((p) => (
                <Button key={p} variant="outline" onClick={() => sendPrefill(p)}>{p}</Button>
              ))}
            </div>
            <Button onClick={() => navigate('/dashboard')}>Go to dashboard</Button>
          </Card>
        )}
      </div>
    </div>
  );
}
