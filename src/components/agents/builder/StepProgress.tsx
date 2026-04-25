import { cn } from '@/lib/utils';

interface Props {
  current: number; // 1-based
  total: number;
}

export default function StepProgress({ current, total }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const idx = i + 1;
        const completed = idx < current;
        const active = idx === current;
        return (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              completed ? 'bg-emerald-500' : active ? 'bg-emerald-400/60' : 'bg-muted',
            )}
          />
        );
      })}
    </div>
  );
}
