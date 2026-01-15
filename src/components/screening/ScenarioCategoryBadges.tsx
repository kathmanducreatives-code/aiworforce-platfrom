import { Badge } from "@/components/ui/badge";
import { 
  HelpCircle, 
  Target, 
  Clock, 
  GitBranch, 
  Users 
} from "lucide-react";

type ScenarioCategory = 'ambiguity' | 'accountability' | 'time_pressure' | 'competing_priorities' | 'conflict_resolution';

interface CategoryCount {
  category: ScenarioCategory;
  count: number;
}

interface ScenarioCategoryBadgesProps {
  categories: CategoryCount[];
  showCounts?: boolean;
  size?: 'sm' | 'md';
}

const categoryConfig: Record<ScenarioCategory, { label: string; icon: any; className: string }> = {
  ambiguity: {
    label: 'Ambiguity',
    icon: HelpCircle,
    className: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
  accountability: {
    label: 'Accountability',
    icon: Target,
    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  time_pressure: {
    label: 'Time Pressure',
    icon: Clock,
    className: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  },
  competing_priorities: {
    label: 'Competing Priorities',
    icon: GitBranch,
    className: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  },
  conflict_resolution: {
    label: 'Conflict Resolution',
    icon: Users,
    className: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  },
};

const ScenarioCategoryBadges = ({ categories, showCounts = false, size = 'sm' }: ScenarioCategoryBadgesProps) => {
  if (!categories || categories.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 max-w-full overflow-hidden">
      {categories.map(({ category, count }) => {
        const config = categoryConfig[category];
        if (!config) return null;

        const Icon = config.icon;
        const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
        const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1';
        const text = size === 'sm' ? 'text-xs' : 'text-sm';

        return (
          <Badge 
            key={category} 
            className={`${config.className} ${padding} ${text} whitespace-nowrap flex-shrink-0`}
          >
            <Icon className={`${iconSize} mr-1 flex-shrink-0`} />
            <span className="truncate">{config.label}</span>
            {showCounts && count > 0 && (
              <span className="ml-1 font-bold flex-shrink-0">({count})</span>
            )}
          </Badge>
        );
      })}
    </div>
  );
};

export default ScenarioCategoryBadges;
