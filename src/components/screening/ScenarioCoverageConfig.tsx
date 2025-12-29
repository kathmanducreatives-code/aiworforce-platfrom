import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Sliders } from "lucide-react";

export interface ScenarioConfig {
  total_limit: number;
  category_limits: Record<string, number>;
}

interface ScenarioCoverageConfigProps {
  value: ScenarioConfig;
  onChange: (value: ScenarioConfig) => void;
  templateCategoryCounts?: Record<string, number>;
}

const CATEGORIES = [
  { id: "ambiguity", label: "Ambiguity", description: "Handling unclear situations", color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  { id: "accountability", label: "Accountability", description: "Taking responsibility", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  { id: "time_pressure", label: "Time Pressure", description: "Working under deadlines", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  { id: "competing_priorities", label: "Competing Priorities", description: "Managing multiple demands", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  { id: "conflict_resolution", label: "Conflict Resolution", description: "Handling disagreements", color: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
];

export function ScenarioCoverageConfig({ 
  value, 
  onChange,
  templateCategoryCounts = {}
}: ScenarioCoverageConfigProps) {
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => {
    const enabled = new Set<string>();
    Object.entries(value.category_limits).forEach(([cat, limit]) => {
      if (limit > 0) enabled.add(cat);
    });
    // If none are enabled, enable all by default
    if (enabled.size === 0) {
      CATEGORIES.forEach(c => enabled.add(c.id));
    }
    return enabled;
  });

  // Calculate total selected questions
  const totalSelected = Object.values(value.category_limits).reduce((sum, n) => sum + n, 0);

  const handleCategoryToggle = (categoryId: string, enabled: boolean) => {
    const newEnabled = new Set(enabledCategories);
    const newLimits = { ...value.category_limits };
    
    if (enabled) {
      newEnabled.add(categoryId);
      // Set default limit based on template or 1
      newLimits[categoryId] = Math.min(templateCategoryCounts[categoryId] || 1, 2);
    } else {
      newEnabled.delete(categoryId);
      newLimits[categoryId] = 0;
    }
    
    setEnabledCategories(newEnabled);
    onChange({ ...value, category_limits: newLimits });
  };

  const handleLimitChange = (categoryId: string, limit: number) => {
    onChange({
      ...value,
      category_limits: { ...value.category_limits, [categoryId]: limit }
    });
  };

  const handleTotalLimitChange = (totalLimit: number) => {
    onChange({ ...value, total_limit: totalLimit });
  };

  // Warning if selected > total limit
  const showWarning = totalSelected > value.total_limit;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Sliders className="w-4 h-4" />
        <span>Configure which behavioral categories to assess and question limits.</span>
      </div>

      <div className="space-y-2">
        <Label>Total Question Limit</Label>
        <Select 
          value={String(value.total_limit)} 
          onValueChange={(v) => handleTotalLimitChange(parseInt(v))}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[2, 3, 4, 5, 6].map((n) => (
              <SelectItem key={n} value={String(n)}>{n} questions</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Category Limits</Label>
        <div className="space-y-3 mt-2">
          {CATEGORIES.map((category) => {
            const isEnabled = enabledCategories.has(category.id);
            const maxAvailable = templateCategoryCounts[category.id] || 3;
            const currentLimit = value.category_limits[category.id] || 0;

            return (
              <div 
                key={category.id} 
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  isEnabled ? "bg-card" : "bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => handleCategoryToggle(category.id, checked)}
                  />
                  <div>
                    <Badge variant="outline" className={category.color}>
                      {category.label}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {category.description}
                    </p>
                  </div>
                </div>
                
                {isEnabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Max:</span>
                    <Select 
                      value={String(currentLimit)} 
                      onValueChange={(v) => handleLimitChange(category.id, parseInt(v))}
                    >
                      <SelectTrigger className="w-16 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: maxAvailable + 1 }, (_, i) => (
                          <SelectItem key={i} value={String(i)}>{i}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`flex items-center gap-2 p-3 rounded-lg ${
        showWarning ? "bg-destructive/10 text-destructive" : "bg-muted/50"
      }`}>
        {showWarning && <AlertCircle className="w-4 h-4" />}
        <span className="text-sm">
          Selected: <strong>{totalSelected}</strong> questions 
          {showWarning ? (
            <span> (exceeds limit of {value.total_limit})</span>
          ) : (
            <span className="text-muted-foreground"> / {value.total_limit} limit</span>
          )}
        </span>
      </div>
    </div>
  );
}
