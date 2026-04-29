import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SKILLS, type SkillField } from './constants';

interface Props {
  equipped: string[];
  config: Record<string, Record<string, any>>;
  onToggle: (key: string) => void;
  onConfigChange: (skill: string, patch: Record<string, any>) => void;
}

function FieldInput({ field, value, onChange }: { field: SkillField; value: any; onChange: (v: any) => void }) {
  switch (field.type) {
    case 'number':
      return <Input type="number" value={value ?? field.default ?? ''} min={field.min} max={field.max} onChange={(e) => onChange(Number(e.target.value))} className="h-8 text-xs bg-background/60" />;
    case 'text':
      return <Input value={value ?? field.default ?? ''} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs bg-background/60" />;
    case 'textarea':
      return <Textarea value={value ?? field.default ?? ''} onChange={(e) => onChange(e.target.value)} className="min-h-[60px] text-xs bg-background/60" />;
    case 'toggle':
      return <Switch checked={value ?? field.default ?? false} onCheckedChange={onChange} />;
    case 'slider':
      return (
        <div className="flex items-center gap-3">
          <Slider value={[value ?? field.default ?? field.min ?? 0]} min={field.min} max={field.max} step={1} onValueChange={(v) => onChange(v[0])} className="flex-1" />
          <span className="text-xs font-mono w-6 text-right tabular-nums">{value ?? field.default}</span>
        </div>
      );
    case 'select':
      return (
        <Select value={value ?? field.default} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs bg-background/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case 'multiselect': {
      const arr: string[] = Array.isArray(value) ? value : (field.default ?? []);
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options?.map((o) => {
            const on = arr.includes(o);
            return (
              <button
                key={o}
                onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
                className={cn(
                  'text-[10px] px-2 py-1 rounded-full border font-medium',
                  on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-card/40 text-muted-foreground border-border/60',
                )}
              >{o}</button>
            );
          })}
        </div>
      );
    }
    default: return null;
  }
}

function SkillCard({ skill, equipped, config, onToggle, onChange }: {
  skill: typeof SKILLS[number];
  equipped: boolean;
  config: Record<string, any>;
  onToggle: () => void;
  onChange: (patch: Record<string, any>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn(
      'rounded-2xl border p-4 transition-all',
      equipped ? 'border-emerald-500/50 bg-emerald-500/[0.05]' : 'border-border/60 bg-card/40',
    )}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-white/[0.06] border border-border/60 flex items-center justify-center text-xl shrink-0">{skill.emoji}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-foreground">{skill.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{skill.description}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="w-3 h-3" /> Configure
          <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
        </button>
        <button
          onClick={onToggle}
          className={cn(
            'text-xs font-bold px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1.5',
            equipped
              ? 'bg-emerald-500 text-background hover:bg-emerald-400'
              : 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.12]',
          )}
        >
          {equipped && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
          {equipped ? 'Equipped' : 'Equip'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-4 mt-3 border-t border-border/40 space-y-3">
              {skill.fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{f.label}</label>
                  <FieldInput field={f} value={config?.[f.key]} onChange={(v) => onChange({ [f.key]: v })} />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Step7Skills({ equipped, config, onToggle, onConfigChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
          What skills does this agent have?
        </h2>
        <p className="text-sm text-muted-foreground">
          Skills are specific things this agent is trained to do exceptionally well.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SKILLS.map((s) => (
          <SkillCard
            key={s.key}
            skill={s}
            equipped={equipped.includes(s.key)}
            config={config[s.key] ?? {}}
            onToggle={() => onToggle(s.key)}
            onChange={(patch) => onConfigChange(s.key, patch)}
          />
        ))}
      </div>
    </div>
  );
}
