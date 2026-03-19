import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  count: number;
}

const ImportanceAlertStrip = ({ count }: Props) => {
  if (count === 0) return null;

  return (
    <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 mb-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="text-sm font-medium text-foreground">
          {count} high importance signal{count !== 1 ? 's' : ''} need{count === 1 ? 's' : ''} your attention
        </span>
      </div>
      <Button size="sm" variant="outline" className="text-xs rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10">
        Review Now
      </Button>
    </div>
  );
};

export default ImportanceAlertStrip;
