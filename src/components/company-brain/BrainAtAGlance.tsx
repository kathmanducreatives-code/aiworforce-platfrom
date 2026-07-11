// Brain-at-a-glance — a premium summary band under the hero.
//
// Shows only the most valuable confirmed information: positioning, target
// customers, primary buyers, top signals, and the system areas this Brain
// powers. Unified glass surface, small intelligence cards — never a metrics
// dashboard and never large percentage scores.

import { motion, useReducedMotion } from 'framer-motion';
import { Compass, Users, Radar, Sparkles, Layers } from 'lucide-react';
import { Pill, type PillTone } from '@/components/company-brain/Pill';
import { EmptyState } from '@/components/company-brain/EmptyState';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';

interface Props {
  brain: CompanyBrainV2;
}

interface GlanceTile {
  icon: typeof Compass;
  label: string;
  body?: string | null;
  pills?: string[];
  tone?: PillTone;
  empty: string;
}

function topN(values: string[], n: number): string[] {
  return values.slice(0, n);
}

const POWERS = ['Leads', 'Scout Radar', 'Content', 'Agents', 'Outreach'];

export function BrainAtAGlance({ brain }: Props) {
  const reduce = useReducedMotion();
  const t = brain.target_customer;

  const tiles: GlanceTile[] = [
    {
      icon: Compass,
      label: 'Positioning',
      body: brain.positioning.promise || null,
      empty: 'Set a positioning promise to anchor messaging.',
    },
    {
      icon: Layers,
      label: 'Target customers',
      pills: topN([...t.industries, ...t.business_models], 4),
      tone: 'emerald',
      empty: 'Add target industries and business models.',
    },
    {
      icon: Users,
      label: 'Primary buyers',
      pills: topN(brain.buyer_personas, 3),
      tone: 'neutral',
      empty: 'Add buyer roles to focus outreach.',
    },
    {
      icon: Radar,
      label: 'Top signals',
      pills: topN([...brain.triggers, ...brain.jobs_to_watch], 4),
      tone: 'signal',
      empty: 'Add buying signals so Scout Radar knows what to watch.',
    },
  ];

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[20px] border border-border/50 bg-card/35 backdrop-blur-xl"
      style={{ boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.05), 0 30px 60px -48px rgba(0,0,0,0.7)' }}
    >
      <div className="border-b border-border/40 px-5 py-3 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">Brain at a glance</p>
      </div>

      <div className="grid grid-cols-1 divide-y divide-border/40 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Ic = tile.icon;
          return (
            <div key={tile.label} className="min-w-0 px-5 py-4 sm:px-6">
              <div className="mb-2 flex items-center gap-2">
                <Ic className="h-3.5 w-3.5 text-primary/70" />
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tile.label}</p>
              </div>
              {tile.body ? (
                <p className="text-[14px] font-medium leading-snug text-foreground/90">“{tile.body}”</p>
              ) : tile.pills && tile.pills.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {tile.pills.map((v) => (
                    <Pill key={v} tone={tile.tone}>{v}</Pill>
                  ))}
                </div>
              ) : (
                <EmptyState hint={tile.empty} className="!py-1" />
              )}
            </div>
          );
        })}
      </div>

      {/* Powers strip */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/40 px-5 py-3 sm:px-6">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <Sparkles className="h-3.5 w-3.5 text-primary/60" /> Powers
        </span>
        {POWERS.map((p) => (
          <Pill key={p} tone="neutral" className="!px-2 !py-[2px] !text-[11px]">{p}</Pill>
        ))}
      </div>
    </motion.section>
  );
}
