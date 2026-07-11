import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  title: string;
  subtitle?: string;
  onEdit?: () => void;
  children: ReactNode;
}

export default function CompanyBrainSectionCard({ title, subtitle, onEdit, children }: Props) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5 flex flex-col gap-4 h-full">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit} className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground">
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
          </Button>
        )}
      </header>
      <div className="text-sm text-foreground/90 flex-1 min-w-0">{children}</div>
    </section>
  );
}

export function ChipList({ values, empty = 'Not set' }: { values: string[]; empty?: string }) {
  if (!values.length) return <p className="text-xs text-muted-foreground italic">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center rounded-lg border border-border/50 bg-background/50 px-2 py-0.5 text-xs text-foreground/90">
          {v}
        </span>
      ))}
    </div>
  );
}

export function LabelValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground/90 mt-0.5 break-words">{value || <span className="text-muted-foreground italic">Not set</span>}</p>
    </div>
  );
}
