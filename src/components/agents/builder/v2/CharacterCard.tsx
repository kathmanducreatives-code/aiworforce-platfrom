import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getSwatch, DEPARTMENTS, MODELS, SKILLS, TOOLS } from './constants';
import ReadinessRing from './ReadinessRing';
import type { BuilderForm } from './types';
import { AI_MODELS } from '@/data/aiModelLogos';
import { Brain } from 'lucide-react';

interface Props {
  form: BuilderForm;
  hoverColor?: string | null;
  completedSteps: number; // 0..7
  /** layoutId for the avatar so it can fly to the dock on deploy */
  avatarLayoutId?: string;
  large?: boolean;
}

const reveal = {
  initial: { opacity: 0, y: 10, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit:    { opacity: 0, y: -6, scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 260, damping: 24 },
};

export default function CharacterCard({ form, hoverColor, completedSteps, avatarLayoutId, large }: Props) {
  const colorKey = hoverColor ?? form.color;
  const swatch = getSwatch(colorKey);
  const dept = DEPARTMENTS.find((d) => d.key === form.department);
  const model = MODELS.find((m) => m.key === form.model);
  const initial = (form.name.trim()[0] ?? '?').toUpperCase();

  const showName       = completedSteps >= 1 && form.name.trim().length > 0;
  const showDept       = completedSteps >= 2 && !!dept;
  const showBrain      = completedSteps >= 3 && form.rolePrompt.trim().length >= 50;
  const showModel      = completedSteps >= 4 && !!model;
  const showCaps       = completedSteps >= 5 && form.capabilities.some((c) => c.capability.trim());
  const showTools      = completedSteps >= 6 && form.tools.length > 0;
  const showSkills     = completedSteps >= 7 && form.skills.length > 0;

  const avatarSize = large ? 200 : 160;

  return (
    <div className="h-full flex flex-col items-center justify-between py-8 px-6 text-center">
      <div className="w-full flex flex-col items-center gap-5 flex-1">
        {/* Avatar */}
        <motion.div
          layoutId={avatarLayoutId}
          className={cn(
            'relative rounded-full flex items-center justify-center transition-shadow duration-500',
            swatch.bg,
            swatch.glow,
          )}
          style={{ width: avatarSize, height: avatarSize }}
          animate={!showName ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={!showName ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : { type: 'spring' as const, stiffness: 200, damping: 18 }}
        >
          <span
            className="font-display font-black text-white select-none"
            style={{ fontSize: avatarSize * 0.42, lineHeight: 1 }}
          >
            {initial}
          </span>
          <span className="absolute inset-0 rounded-full ring-2 ring-white/10 pointer-events-none" />
        </motion.div>

        {/* Name */}
        <AnimatePresence mode="wait">
          {showName ? (
            <motion.h2
              key="name"
              {...reveal}
              className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight"
            >
              {form.name}
            </motion.h2>
          ) : (
            <motion.h2 key="placeholder" {...reveal} className="text-2xl font-display font-black text-muted-foreground/50 italic">
              Unnamed Agent
            </motion.h2>
          )}
        </AnimatePresence>

        {/* Department */}
        <AnimatePresence>
          {showDept && (
            <motion.div
              key="dept"
              {...reveal}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold',
                dept!.border,
                dept!.accent,
                'bg-white/[0.02]',
              )}
            >
              <span>{dept!.emoji}</span>
              <span>{dept!.label}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Model */}
        <AnimatePresence>
          {showModel && (
            <motion.div key="model" {...reveal} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border/60 bg-card/60 text-xs">
              <span className="w-4 h-4 rounded-sm bg-white/90 flex items-center justify-center overflow-hidden">
                <img src={AI_MODELS[model!.key].logo} alt={model!.name} className="w-3.5 h-3.5 object-contain" />
              </span>
              <span className="font-semibold text-foreground">{model!.name}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Brain excerpt */}
        <AnimatePresence>
          {showBrain && (
            <motion.div
              key="brain"
              {...reveal}
              className="w-full max-w-xs rounded-xl border border-border/50 bg-card/40 p-3 text-left"
            >
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-1.5">
                <Brain className="h-3 w-3" /> Brain
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                {form.rolePrompt.trim().slice(0, 180)}{form.rolePrompt.length > 180 ? '…' : ''}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Capabilities */}
        <AnimatePresence>
          {showCaps && (
            <motion.div key="caps" {...reveal} className="w-full max-w-xs">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">Capabilities</div>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {form.capabilities.filter((c) => c.capability.trim()).slice(0, 8).map((c, i) => (
                  <span key={i} className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', swatch.badgeBg, swatch.badgeText)}>
                    {c.capability}
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tools */}
        <AnimatePresence>
          {showTools && (
            <motion.div key="tools" {...reveal} className="w-full max-w-xs">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">Tools</div>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {form.tools.map((tk) => {
                  const t = TOOLS.find((x) => x.key === tk);
                  if (!t) return null;
                  return (
                    <span key={tk} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-border/50 text-foreground/80 inline-flex items-center gap-1">
                      <span>{t.emoji}</span>{t.name}
                    </span>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Skills */}
        <AnimatePresence>
          {showSkills && (
            <motion.div key="skills" {...reveal} className="w-full max-w-xs">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">Skills equipped</div>
              <div className="grid grid-cols-4 gap-2 justify-items-center">
                {form.skills.map((sk) => {
                  const s = SKILLS.find((x) => x.key === sk);
                  if (!s) return null;
                  return (
                    <div key={sk} title={s.name} className="w-9 h-9 rounded-lg bg-white/[0.04] border border-border/50 flex items-center justify-center text-base">
                      {s.emoji}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pt-4">
        <ReadinessRing value={completedSteps / 7} />
      </div>
    </div>
  );
}
