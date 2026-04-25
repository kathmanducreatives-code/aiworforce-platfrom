import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

const MIN = 50;

export default function Step3RolePrompt({ value, onChange, error }: Props) {
  const len = value.length;
  const ok = len >= MIN;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="role-prompt">Role & instructions</Label>
        <Textarea
          id="role-prompt"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="You are a senior LinkedIn content strategist. You write punchy, founder-voice posts that drive replies and bookings…"
          className="min-h-[200px] resize-none"
        />
        <div className="flex items-center justify-between text-xs">
          <span className={cn(ok ? 'text-emerald-400' : 'text-muted-foreground')}>
            {len}/{MIN} characters minimum
          </span>
          {error && <span className="text-rose-400">{error}</span>}
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 p-3 flex gap-2.5">
        <Lightbulb className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Be specific about the agent's voice, expertise, and constraints. The clearer the role, the better the output.
        </p>
      </div>
    </div>
  );
}
