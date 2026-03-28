import { useNavigate } from 'react-router-dom';
import { Briefcase, Search, Brain, ArrowRight } from 'lucide-react';

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  href: string;
  badge?: string;
}

const ACTIONS: QuickAction[] = [
  { icon: <Briefcase className="h-4 w-4" />, label: 'Create Job', href: '/screening-jobs' },
  { icon: <Search className="h-4 w-4" />, label: 'Source Candidates', href: '/lead-scraper' },
  { icon: <Brain className="h-4 w-4" />, label: 'Update Company Brain', href: '/interview-settings', badge: '4 incomplete' },
];

const QuickActions = () => {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Quick Actions</h3>
      <div className="space-y-2">
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => navigate(action.href)}
            className="flex items-center gap-3 w-full px-3 py-3 rounded-xl border border-border/60 hover:border-primary/20 hover:bg-muted/50 transition-all group text-left"
          >
            <div className="p-2 rounded-lg bg-muted/80 group-hover:bg-primary/10 transition-colors text-muted-foreground group-hover:text-primary">
              {action.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{action.label}</p>
            </div>
            {action.badge && (
              <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">{action.badge}</span>
            )}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary transition-colors flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default QuickActions;
