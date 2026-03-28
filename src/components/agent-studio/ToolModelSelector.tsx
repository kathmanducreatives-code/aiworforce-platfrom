import { Check } from 'lucide-react';
import { STUDIO_TOOLS, TOOL_CATEGORIES, DEPT_COLORS, type AITool } from '@/data/agent-studio';
import { cn } from '@/lib/utils';

interface ToolModelSelectorProps {
  selectedTools: string[];
  onChange: (tools: string[]) => void;
  deptColor?: string;
}

const ToolModelSelector = ({ selectedTools, onChange, deptColor = 'teal' }: ToolModelSelectorProps) => {
  const colors = DEPT_COLORS[deptColor] || DEPT_COLORS.teal;

  const toggleTool = (toolId: string) => {
    onChange(
      selectedTools.includes(toolId)
        ? selectedTools.filter(t => t !== toolId)
        : [...selectedTools, toolId]
    );
  };

  const categories = Object.entries(TOOL_CATEGORIES) as [AITool['category'], string][];

  return (
    <div className="space-y-6">
      {categories.map(([catKey, catLabel]) => {
        const tools = STUDIO_TOOLS.filter(t => t.category === catKey);
        const isModelCategory = catKey === 'ai-models';

        return (
          <div key={catKey}>
            <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-3">
              {catLabel}
            </p>
            <div className={cn(
              'grid gap-2',
              isModelCategory ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2',
            )}>
              {tools.map((tool) => {
                const isActive = selectedTools.includes(tool.id);
                const Icon = tool.icon;

                return (
                  <button
                    key={tool.id}
                    onClick={() => toggleTool(tool.id)}
                    className={cn(
                      'flex items-start gap-3 w-full p-3 rounded-xl border text-left transition-all duration-200',
                      isActive
                        ? cn(colors.bg, colors.border, 'ring-1', colors.ring)
                        : 'border-border/30 hover:border-border/60 hover:bg-card/20',
                    )}
                  >
                    {/* Icon */}
                    <div className={cn(
                      'p-2 rounded-lg border flex-shrink-0 transition-colors',
                      isActive
                        ? cn(colors.bg, colors.border)
                        : 'bg-muted/30 border-border/30',
                    )}>
                      <Icon className={cn('h-4 w-4', isActive ? colors.text : 'text-muted-foreground/50')} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={cn('text-sm font-medium', isActive ? 'text-foreground' : 'text-muted-foreground/70')}>
                          {tool.name}
                        </p>
                        {tool.provider && (
                          <span className="text-[9px] font-medium text-muted-foreground/30 bg-muted/30 px-1.5 py-0.5 rounded">
                            {tool.provider}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground/40 mt-0.5 line-clamp-1">
                        {tool.description}
                      </p>
                    </div>

                    {/* Toggle indicator */}
                    <div className={cn(
                      'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all',
                      isActive ? cn(colors.border, colors.bg) : 'border-border/40',
                    )}>
                      {isActive && <Check className={cn('h-3 w-3', colors.text)} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-[10px] text-muted-foreground/30 pt-2 border-t border-border/20">
        {selectedTools.length} of {STUDIO_TOOLS.length} tools enabled
      </p>
    </div>
  );
};

export default ToolModelSelector;
