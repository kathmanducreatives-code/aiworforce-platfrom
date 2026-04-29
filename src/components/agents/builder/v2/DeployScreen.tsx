import { motion } from 'framer-motion';
import { Loader2, Rocket, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CharacterCard from './CharacterCard';
import type { BuilderForm } from './types';
import { DEPARTMENTS, SKILLS, getSwatch } from './constants';
import { cn } from '@/lib/utils';

interface Props {
  form: BuilderForm;
  submitting: boolean;
  onDeploy: () => void;
  onBack: () => void;
}

export default function DeployScreen({ form, submitting, onDeploy, onBack }: Props) {
  const dept = DEPARTMENTS.find((d) => d.key === form.department);
  const swatch = getSwatch(form.color);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-8 p-8">
      <div className="rounded-2xl border border-border/60 bg-card/30">
        <CharacterCard form={form} completedSteps={7} large />
      </div>

      <div className="space-y-6">
        <div>
          <span className="inline-block text-[11px] uppercase tracking-[0.18em] text-emerald-400 font-bold mb-2">Final review</span>
          <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
            Ready to deploy {form.name}?
          </h2>
          <p className="text-sm text-muted-foreground">Once deployed, {form.name} joins your workforce immediately and will be discoverable by the orchestrator.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Section label="Identity">
            <div className="flex items-center gap-2">
              <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs', swatch.bg)}>
                {form.name[0]?.toUpperCase()}
              </span>
              <span className="text-sm font-bold text-foreground">{form.name}</span>
            </div>
            <span className={cn('mt-2 inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full', dept?.accent, 'bg-white/[0.04] border', dept?.border)}>
              {dept?.label}
            </span>
          </Section>

          <Section label="Brain">
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {form.rolePrompt.slice(0, 120)}{form.rolePrompt.length > 120 ? '…' : ''}
            </p>
          </Section>

          <Section label="Capabilities" wide>
            <div className="flex flex-wrap gap-1.5">
              {form.capabilities.filter((c) => c.capability.trim()).map((c, i) => (
                <span key={i} className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', swatch.badgeBg, swatch.badgeText)}>
                  {c.capability}
                </span>
              ))}
            </div>
          </Section>

          <Section label="Equipped Skills" wide>
            {form.skills.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">No skills equipped</span>
            ) : (
              <div className="space-y-2">
                {form.skills.map((sk) => {
                  const s = SKILLS.find((x) => x.key === sk);
                  if (!s) return null;
                  const cfg = form.skillConfig[sk] ?? {};
                  const summary = Object.entries(cfg).slice(0, 3).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' · ');
                  return (
                    <div key={sk} className="flex items-start gap-2">
                      <span className="text-base leading-none mt-0.5">{s.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-foreground">{s.name}</div>
                        {summary && <div className="text-[10px] text-muted-foreground truncate">{summary}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button variant="ghost" onClick={onBack} disabled={submitting}>Back</Button>
          <motion.div
            className="flex-1"
            animate={{ scale: [1, 1.015, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Button
              onClick={onDeploy}
              disabled={submitting}
              className="w-full h-12 bg-emerald-500 hover:bg-emerald-400 text-background font-bold text-base shadow-[0_0_30px_-5px_rgba(16,185,129,0.6)]"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deploying…</>
              ) : (
                <><Rocket className="w-4 h-4 mr-2" /> Deploy Agent</>
              )}
            </Button>
          </motion.div>
        </div>

        <p className="text-[10px] text-muted-foreground text-center inline-flex items-center gap-1 justify-center w-full">
          <Sparkles className="w-3 h-3 text-emerald-400" /> Company Brain inherited automatically
        </p>
      </div>
    </div>
  );
}

function Section({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-border/60 bg-card/40 p-3', wide && 'col-span-2')}>
      <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">{label}</div>
      {children}
    </div>
  );
}
