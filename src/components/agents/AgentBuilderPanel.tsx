import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import SlideOverPanel from '@/components/shared/SlideOverPanel';
import StepProgress from './builder/StepProgress';
import Step1Identity from './builder/Step1Identity';
import Step2Department from './builder/Step2Department';
import Step3RolePrompt from './builder/Step3RolePrompt';
import Step4Model from './builder/Step4Model';
import Step5Capabilities, { type CapabilityRow } from './builder/Step5Capabilities';
import Step6Tools from './builder/Step6Tools';
import SuccessScreen from './builder/SuccessScreen';
import { useAgentBuilder } from '@/hooks/useAgentBuilder';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createAgent } from '@/lib/orchestration';
import type { AgentDept } from '@/data/agentProfiles';
import { ChevronLeft, ChevronRight, Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';

const STEP_TITLES = [
  'Identity',
  'Department',
  'Role & instructions',
  'Model',
  'Capabilities',
  'Tools',
];

const TOTAL = 6;

interface FormData {
  name: string;
  color: string;
  department: AgentDept | null;
  rolePrompt: string;
  model: string;
  capabilities: CapabilityRow[];
  tools: string[];
}

const initialForm = (prefillDept?: AgentDept): FormData => ({
  name: '',
  color: 'emerald',
  department: prefillDept ?? null,
  rolePrompt: '',
  model: 'claude-sonnet-4-5-20251001',
  capabilities: [{ capability: '', input_type: '', output_type: '' }],
  tools: [],
});

export default function AgentBuilderPanel() {
  const { open, prefill, closeBuilder } = useAgentBuilder();
  const { workspaceId } = useWorkspace();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(() => initialForm(prefill.department));
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<FormData | null>(null);

  // Reset wizard whenever the panel re-opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setForm(initialForm(prefill.department));
      setError(undefined);
      setSuccess(null);
    }
  }, [open, prefill.department]);

  const validate = (s: number): string | null => {
    if (s === 1) {
      const n = form.name.trim();
      if (n.length < 1) return 'Name is required';
      if (n.length > 60) return 'Name must be 60 characters or fewer';
      return null;
    }
    if (s === 2) {
      if (!form.department) return 'Pick a department';
      return null;
    }
    if (s === 3) {
      if (form.rolePrompt.trim().length < 50) return 'At least 50 characters';
      return null;
    }
    if (s === 4) {
      if (!form.model) return 'Choose a model';
      return null;
    }
    if (s === 5) {
      const valid = form.capabilities.filter(
        (c) => c.capability.trim() && c.input_type.trim() && c.output_type.trim(),
      );
      if (valid.length < 1) return 'Add at least one fully-filled capability';
      return null;
    }
    return null; // step 6 optional
  };

  const next = () => {
    const err = validate(step);
    if (err) { setError(err); return; }
    setError(undefined);
    setStep((s) => Math.min(TOTAL, s + 1));
  };

  const back = () => { setError(undefined); setStep((s) => Math.max(1, s - 1)); };

  const deploy = async () => {
    if (!workspaceId) { toast.error('Workspace not ready'); return; }
    // re-validate all steps
    for (let s = 1; s <= 5; s++) {
      const e = validate(s);
      if (e) { setStep(s); setError(e); return; }
    }
    setSubmitting(true);
    try {
      const validCaps = form.capabilities.filter(
        (c) => c.capability.trim() && c.input_type.trim() && c.output_type.trim(),
      );
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
      setSuccess(form);
      toast.success(`${form.name} is deployed`);
    } catch (e) {
      toast.error('Could not deploy agent', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverPanel
      open={open}
      onClose={closeBuilder}
      title={success ? 'Agent deployed' : 'Build a new agent'}
      description={success ? undefined : `Step ${step} of ${TOTAL} · ${STEP_TITLES[step - 1]}`}
      width="lg"
      footer={
        success ? null : (
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={back} disabled={step === 1 || submitting}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {step < TOTAL ? (
              <Button onClick={next} className="bg-emerald-500 hover:bg-emerald-600 text-background font-semibold">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={deploy} disabled={submitting} className="bg-emerald-500 hover:bg-emerald-600 text-background font-semibold">
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deploying…</>
                ) : (
                  <><Rocket className="h-4 w-4 mr-2" /> Deploy Agent</>
                )}
              </Button>
            )}
          </div>
        )
      }
    >
      {success ? (
        <SuccessScreen
          name={success.name}
          color={success.color}
          department={success.department || ''}
          model={success.model}
          capabilityCount={success.capabilities.filter((c) => c.capability.trim()).length}
          toolsCount={success.tools.length}
          onClose={closeBuilder}
        />
      ) : (
        <div className="space-y-6">
          <StepProgress current={step} total={TOTAL} />
          <div>
            {step === 1 && (
              <Step1Identity
                name={form.name}
                color={form.color}
                onName={(name) => setForm((f) => ({ ...f, name }))}
                onColor={(color) => setForm((f) => ({ ...f, color }))}
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
              <Step3RolePrompt
                value={form.rolePrompt}
                onChange={(rolePrompt) => setForm((f) => ({ ...f, rolePrompt }))}
                error={error}
              />
            )}
            {step === 4 && (
              <Step4Model
                value={form.model}
                onChange={(model) => setForm((f) => ({ ...f, model }))}
                error={error}
              />
            )}
            {step === 5 && (
              <Step5Capabilities
                rows={form.capabilities}
                onChange={(capabilities) => setForm((f) => ({ ...f, capabilities }))}
                error={error}
              />
            )}
            {step === 6 && (
              <Step6Tools
                value={form.tools}
                onChange={(tools) => setForm((f) => ({ ...f, tools }))}
                onSkip={deploy}
              />
            )}
          </div>
        </div>
      )}
    </SlideOverPanel>
  );
}
