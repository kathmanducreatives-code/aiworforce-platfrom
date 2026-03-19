import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  unreadCount: number;
  children: ReactNode;
}

const SignalGroupSection = ({ title, unreadCount, children }: Props) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          <span className="text-sm font-semibold text-foreground uppercase tracking-wider">{title}</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="h-5 min-w-[20px] text-[10px] px-1.5 bg-primary/10 text-primary">
              {unreadCount}
            </Badge>
          )}
        </div>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
};

export default SignalGroupSection;
