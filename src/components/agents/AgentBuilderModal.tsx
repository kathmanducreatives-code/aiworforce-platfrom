import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { useAgentBuilder } from '@/hooks/useAgentBuilder';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createAgent } from '@/lib/orchestration';
import type { AgentDept } from '@/data/agentProfiles';

import CharacterCard from './builder/v2/CharacterCard';
import StepDots from './builder/v2/StepDots';
import Step1Identity from './builder/v2/Step1Identity';
import Step2Department from './builder/v2/Step2Department';
import Step3Role from './builder/v2/Step3Role';
import Step4Model from './builder/v2/Step4Model';
import Step5Capabilities from './builder/v2/Step5Capabilities';
import Step6Tools from './builder/v2/Step6Tools';
import Step7Skills from './builder/v2/Step7Skills';
import DeployScreen from './builder/v2/DeployScreen';
import { DEPARTMENTS } from './builder/v2/constants';
import { TOTAL_STEPS, type BuilderForm } from './builder/v2/types';

const initialForm = (dept?: AgentDept): BuilderForm => ({
  name: '',
  color: 'emerald',
  department: dept ?? null,
  rolePrompt: '',
  model: 'claude-sonnet',
  capabilities: [{ capability: '', input_type: '', output_type: '' }],
  tools: [],
  toolConfig: {},
  skills: [],
  skillConfig: {},
});

type Phase = 'building' | 'review' | 'deploying' | 'success';

export default function AgentBuilderModal() {
  const { open, prefill, closeBuilder } = useAgentBuilder();
  const { workspaceId } = useWorkspace();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('building');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BuilderForm>(() => initialForm(prefill.department));
  const [hoverColor, setHoverColor] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [direction, setDirection] = useState(1);

  // Reset whenever opened
  useEffect(() => {
    if (open) {
      setPhase('building');
      setStep(1);
      setForm(initialForm(prefill.department));
      setHoverColor(null);
      setError(undefined);
    }
  }, [open, prefill.department]);

  const validate = useCallback((s: number): string | null => {
    if (s === 1) {
      const n = form.name.trim();
      if (n.length < 1) return 'Name is required';
      if (n.length > 60) return 'Name must be 60 characters or fewer';
      return null;
    }
    if (s === 2) return form.department ? null : 'Pick a department';
    if (s === 3) return form.rolePrompt.trim().length >= 50 ? null : 'At least 50 characters';
    if (s === 4) return form.model ? null : 'Pick a model';
    if (s === 5) {
      const valid = form.capabilities.filter((c) => c.capability.trim() && c.input_type.trim() && c.output_type.trim());
      return valid.length >= 1 ? null : 'Add at least one fully-filled capability';
    }
    return null; // 6 & 7 optional
  }, [form]);

  const completed = useMemo(() => {
    return Array.from({ length: TOTAL_STEPS }, (_, i) => {
      const s = i + 1;
      // Step is "completed" if it passes validation AND the user has progressed past it
      // (or for optional steps 6/7, if any value chosen)
      if (s <= 5) return validate(s) === null;
      if (s === 6) return form.tools.length > 0;
      if (s === 7) return form.skills.length > 0;
      return false;
    });
  }, [validate, form.tools.length, form.skills.length]);

  const next = () => {
    const err = validate(step);
    if (err) { setError(err); return; }
    setError(undefined);
    if (step < TOTAL_STEPS) {
      setDirection(1);
      setStep((s) => s + 1);
    } else {
      setPhase('review');
    }
  };

  const back = () => {
    setError(undefined);
    if (phase === 'review') { setPhase('building'); return; }
    if (step > 1) {
      setDirection(-1);
      setStep((s) => s - 1);
    }
  };

  const jump = (s: number) => {
    if (s === step) return;
    setDirection(s > step ? 1 : -1);
    setStep(s);
    setError(undefined);
  };

  const requestExit = () => {
    if (step <= 2 && form.name.trim().length === 0) { closeBuilder(); return; }
    setConfirmExit(true);
  };

  const deploy = async () => {
    if (!workspaceId) { toast.error('Workspace not ready'); return; }
    for (let s = 1; s <= 5; s++) {
      const e = validate(s);
      if (e) { setStep(s); setError(e); setPhase('building'); return; }
    }
    setSubmitting(true);
    setPhase('deploying');
    try {
      const validCaps = form.capabilities.filter((c) => c.capability.trim() && c.input_type.trim() && c.output_type.trim());
      // NOTE: Skills, skill config and tool URL are kept in local UI state only — backend does not yet persist them.
      await createAgent({
        workspaceId,
        name: form.name.trim(),
        department: form.department!,
        rolePrompt: form.rolePrompt.trim(),
        model: form.model,
        avatarColor: form.color,
        tools: form.tools,
        capabilities: validCaps,
      });
      // Brief delay for the deploy animation
      await new Promise((r) => setTimeout(r, 900));
      setPhase('success');
      toast.success(`${form.name} has joined your workforce`);
    } catch (e) {
      setPhase('review');
      toast.error('Could not deploy agent', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (phase !== 'building') return;
      if (e.key === 'Escape') { e.preventDefault(); requestExit(); }
      else if (e.key === 'ArrowLeft') { back(); }
      else if (e.key === 'ArrowRight') { next(); }
      else if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest('textarea, input')) { next(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, step, form]);

  if (!open) return null;

  const dept = DEPARTMENTS.find((d) => d.key === form.department);
  const completedCount = completed.filter(Boolean).length;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
        onClick={requestExit}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-[1280px] h-[calc(100vh-2rem)] max-h-[860px] rounded-3xl border border-border/60 bg-background/95 backdrop-blur-2xl shadow-[0_30px_120px_-20px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col"
        >
          {/* close */}
          <button
            onClick={requestExit}
            className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full border border-border/60 bg-card/60 hover:bg-card text-muted-foreground hover:text-foreground flex items-center justify-center transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          {phase === 'success' ? (
            <SuccessView
              name={form.name}
              department={form.department}
              onGoToRoom={() => { closeBuilder(); navigate(`/department/${form.department}`); }}
              onBuildAnother={() => {
                setPhase('building');
                setStep(1);
                setForm(initialForm());
              }}
              colorKey={form.color}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] flex-1 min-h-0">
              {/* LEFT — character card */}
              <div className="border-b lg:border-b-0 lg:border-r border-border/60 bg-gradient-to-b from-card/40 to-background/30 overflow-auto">
                <CharacterCard
                  form={form}
                  hoverColor={hoverColor}
                  completedSteps={completedCount}
                  avatarLayoutId="builder-avatar"
                />
              </div>

              {/* RIGHT — step engine */}
              <div className="flex flex-col min-h-0">
                {phase === 'building' && (
                  <>
                    <div className="px-8 pt-6 pb-4 border-b border-border/40">
                      <StepDots
                        current={step}
                        completed={completed}
                        onJump={jump}
                        badges={form.skills.length > 0 ? { 7: `${form.skills.length} equipped` } : undefined}
                      />
                    </div>

                    <div className="flex-1 overflow-auto px-8 py-6 relative">
                      <AnimatePresence mode="wait" custom={direction}>
                        <motion.div
                          key={step}
                          custom={direction}
                          initial={{ opacity: 0, x: direction * 40 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -direction * 40 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                        >
                          {step === 1 && (
                            <Step1Identity
                              name={form.name}
                              color={form.color}
                              onName={(name) => setForm((f) => ({ ...f, name }))}
                              onColor={(color) => setForm((f) => ({ ...f, color }))}
                              onHoverColor={setHoverColor}
                              error={error}
                            />
                          )}
                          {step === 2 && (
                            <Step2Department
                              value={form.department}
                              onChange={(department) => setForm((f) => ({ ...f, department }))}
                              error={error}
                            />
                          )}
                          {step === 3 && (
                            <Step3Role
                              value={form.rolePrompt}
                              onChange={(rolePrompt) => setForm((f) => ({ ...f, rolePrompt }))}
                              error={error}
                            />
                          )}
                          {step === 4 && (
                            <Step4Model
                              value={form.model}
                              onChange={(model) => setForm((f) => ({ ...f, model }))}
                              department={form.department}
                              error={error}
                            />
                          )}
                          {step === 5 && (
                            <Step5Capabilities
                              rows={form.capabilities}
                              onChange={(capabilities) => setForm((f) => ({ ...f, capabilities }))}
                              department={form.department}
                              error={error}
                            />
                          )}
                          {step === 6 && (
                            <Step6Tools
                              selected={form.tools}
                              toolConfig={form.toolConfig}
                              onChange={(tools) => setForm((f) => ({ ...f, tools }))}
                              onConfigChange={(key, patch) => setForm((f) => ({
                                ...f, toolConfig: { ...f.toolConfig, [key]: { ...(f.toolConfig[key] ?? {}), ...patch } },
                              }))}
                              onSkip={next}
                            />
                          )}
                          {step === 7 && (
                            <Step7Skills
                              equipped={form.skills}
                              config={form.skillConfig}
                              onToggle={(k) => setForm((f) => ({
                                ...f,
                                skills: f.skills.includes(k) ? f.skills.filter((x) => x !== k) : [...f.skills, k],
                              }))}
                              onConfigChange={(skill, patch) => setForm((f) => ({
                                ...f, skillConfig: { ...f.skillConfig, [skill]: { ...(f.skillConfig[skill] ?? {}), ...patch } },
                              }))}
                            />
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    <div className="px-8 py-4 border-t border-border/40 flex items-center justify-between gap-3">
                      <Button variant="ghost" onClick={back} disabled={step === 1}>
                        <ChevronLeft className="w-4 h-4 mr-1" /> Back
                      </Button>
                      <span className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
                        Step {step} of {TOTAL_STEPS}
                      </span>
                      <Button onClick={next} className="bg-emerald-500 hover:bg-emerald-400 text-background font-bold">
                        {step < TOTAL_STEPS ? <>Next <ChevronRight className="w-4 h-4 ml-1" /></> : <>Review <Sparkles className="w-4 h-4 ml-1.5" /></>}
                      </Button>
                    </div>
                  </>
                )}

                {(phase === 'review' || phase === 'deploying') && (
                  <div className="flex-1 overflow-auto">
                    <DeployScreen
                      form={form}
                      submitting={submitting}
                      onDeploy={deploy}
                      onBack={() => setPhase('building')}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>

      <AlertDialog open={confirmExit} onOpenChange={setConfirmExit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandon this agent?</AlertDialogTitle>
            <AlertDialogDescription>Your progress will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep building</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmExit(false); closeBuilder(); }} className="bg-rose-500 hover:bg-rose-400 text-white">
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SuccessView({ name, department, colorKey, onGoToRoom, onBuildAnother }: {
  name: string;
  department: AgentDept | null;
  colorKey: string;
  onGoToRoom: () => void;
  onBuildAnother: () => void;
}) {
  const dept = DEPARTMENTS.find((d) => d.key === department);
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-12">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 18 }}
        className={`w-32 h-32 rounded-full bg-${colorKey}-500 flex items-center justify-center text-white text-5xl font-display font-black shadow-[0_0_60px_-10px_rgba(16,185,129,0.7)]`}
        style={{ background: 'rgb(16,185,129)' }}
      >
        {name[0]?.toUpperCase()}
      </motion.div>
      <h2 className="mt-6 text-3xl md:text-4xl font-display font-black text-foreground">
        {name} has joined your workforce
      </h2>
      {dept && (
        <p className="mt-2 text-sm text-muted-foreground">
          Deployed to the <span className={`${dept.accent} font-semibold`}>{dept.label}</span> department.
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={onGoToRoom} className="bg-emerald-500 hover:bg-emerald-400 text-background font-bold">
          Go to {dept?.label ?? 'Department'} room
        </Button>
        <Button variant="outline" onClick={onBuildAnother}>Build another agent</Button>
      </div>
    </div>
  );
}
