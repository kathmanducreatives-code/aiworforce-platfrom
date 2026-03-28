import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DEPT_COLORS, type PromptConfig } from '@/data/agent-studio';
import { cn } from '@/lib/utils';

interface PromptConfiguratorProps {
  prompt: PromptConfig;
  onChange: (prompt: PromptConfig) => void;
  deptColor?: string;
}

interface SectionDef {
  key: keyof PromptConfig;
  label: string;
  hint: string;
  rows: number;
  mono?: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    key: 'system',
    label: 'System Prompt',
    hint: 'The core instructions that define this agent\'s identity, behavior, and primary capabilities.',
    rows: 6,
    mono: true,
  },
  {
    key: 'objectives',
    label: 'Objectives',
    hint: 'What this agent should achieve. Define clear, measurable goals.',
    rows: 3,
  },
  {
    key: 'tone',
    label: 'Tone & Communication Style',
    hint: 'How this agent should communicate. Define voice, formality, and personality.',
    rows: 2,
  },
  {
    key: 'constraints',
    label: 'Constraints & Boundaries',
    hint: 'What this agent should NOT do. Define limitations, restrictions, and safety rails.',
    rows: 3,
  },
  {
    key: 'escalation',
    label: 'Escalation Rules',
    hint: 'When should this agent hand off to a human or another agent? Define triggers and thresholds.',
    rows: 2,
  },
  {
    key: 'outputStyle',
    label: 'Output Format',
    hint: 'How this agent should format its responses. Define structure, style, and delivery format.',
    rows: 2,
  },
];

const PromptConfigurator = ({ prompt, onChange, deptColor = 'teal' }: PromptConfiguratorProps) => {
  const colors = DEPT_COLORS[deptColor] || DEPT_COLORS.teal;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const updateField = (key: keyof PromptConfig, value: string) => {
    onChange({ ...prompt, [key]: value });
  };

  const toggleCollapse = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const isCollapsed = collapsed[section.key] || false;
        const value = prompt[section.key] || '';
        const isSystem = section.key === 'system';

        return (
          <div
            key={section.key}
            className={cn(
              'rounded-xl border overflow-hidden transition-all',
              isSystem ? 'border-border/40 bg-[#080A0C]' : 'border-border/20 bg-card/10',
            )}
          >
            {/* Section header */}
            <button
              onClick={() => !isSystem && toggleCollapse(section.key)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 text-left transition-colors',
                !isSystem && 'hover:bg-muted/10 cursor-pointer',
                isSystem && 'cursor-default',
              )}
            >
              <div className="flex items-center gap-2">
                {!isSystem && (
                  isCollapsed
                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />
                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/30" />
                )}
                <span className={cn(
                  'text-xs font-semibold',
                  isSystem ? 'text-foreground' : 'text-muted-foreground/70',
                )}>
                  {section.label}
                </span>
                {isSystem && (
                  <span className={cn('text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded', colors.bg, colors.text)}>
                    Primary
                  </span>
                )}
              </div>
              {value && (
                <span className="text-[10px] text-muted-foreground/25 tabular-nums">
                  {value.length} chars
                </span>
              )}
            </button>

            {/* Section content */}
            {(!isCollapsed || isSystem) && (
              <div className="px-4 pb-4">
                <p className="text-[10px] text-muted-foreground/30 mb-2 leading-relaxed">
                  {section.hint}
                </p>
                <textarea
                  value={value}
                  onChange={(e) => updateField(section.key, e.target.value)}
                  rows={section.rows}
                  spellCheck={false}
                  className={cn(
                    'w-full resize-y rounded-lg border border-border/20 bg-transparent px-3 py-2.5',
                    'text-sm text-foreground/80 leading-relaxed',
                    'placeholder:text-muted-foreground/20',
                    'focus:outline-none focus:border-border/40 focus:ring-1',
                    colors.ring,
                    'transition-all',
                    section.mono && 'font-mono text-[13px]',
                  )}
                  placeholder={`Enter ${section.label.toLowerCase()}...`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PromptConfigurator;
