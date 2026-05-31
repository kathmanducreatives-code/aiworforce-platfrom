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

  useEffect(() => {
    if (brain?.profile && Object.keys(brain.profile).length) {
      setBasics((b) => ({ ...b, ...Object.fromEntries(Object.entries(brain.profile).filter(([k]) => k in b)) }));
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

  async function saveFollowupsAndFinish() {
    setSaving(true);
    try {
      const qa = questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' }));
      await call('save_followups', workspaceId!, { qa });
      await call('finalize', workspaceId!, {});
      refresh();
      setStep(5);
    } catch (e: any) { toast.error(e.message ?? 'Failed'); }
    finally { setSaving(false); }
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
        <p className="text-muted-foreground mb-8">Step {Math.min(step, 5)} of 5</p>

        {step !== 5 && (
          <div className="flex gap-2 mb-8">
            {[1, 2, 3, 4].map((n) => (
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
              <Button onClick={saveFollowupsAndFinish} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Finish setup'}</Button>
            </div>
          </Card>
        )}

        {step === 5 && (
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
