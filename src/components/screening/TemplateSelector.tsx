import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Star, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Template {
  id: string;
  name: string;
  description: string | null;
  role_focus: string | null;
  is_default: boolean;
  question_count?: number;
  category_counts?: Record<string, number>;
}

interface TemplateSelectorProps {
  selectedTemplateId: string | null;
  onSelect: (templateId: string) => void;
}

const categoryColors: Record<string, string> = {
  ambiguity: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  accountability: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  time_pressure: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  competing_priorities: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  conflict_resolution: "bg-rose-500/10 text-rose-600 border-rose-500/20",
};

const categoryLabels: Record<string, string> = {
  ambiguity: "Ambiguity",
  accountability: "Accountability",
  time_pressure: "Time Pressure",
  competing_priorities: "Competing Priorities",
  conflict_resolution: "Conflict Resolution",
};

export function TemplateSelector({ selectedTemplateId, onSelect }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const { data: templatesData, error: templatesError } = await supabase
        .from("screening_templates")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });

      if (templatesError) throw templatesError;

      const { data: questionsData, error: questionsError } = await supabase
        .from("screening_template_questions")
        .select("template_id, category");

      if (questionsError) throw questionsError;

      const templateCounts: Record<string, { total: number; categories: Record<string, number> }> = {};
      questionsData?.forEach((q) => {
        if (!templateCounts[q.template_id]) {
          templateCounts[q.template_id] = { total: 0, categories: {} };
        }
        templateCounts[q.template_id].total++;
        templateCounts[q.template_id].categories[q.category] = 
          (templateCounts[q.template_id].categories[q.category] || 0) + 1;
      });

      const enrichedTemplates = templatesData?.map((t) => ({
        ...t,
        question_count: templateCounts[t.id]?.total || 0,
        category_counts: templateCounts[t.id]?.categories || {},
      })) || [];

      setTemplates(enrichedTemplates);

      // Auto-select default template if none selected
      if (!selectedTemplateId && enrichedTemplates.length > 0) {
        const defaultTemplate = enrichedTemplates.find(t => t.is_default);
        if (defaultTemplate) {
          onSelect(defaultTemplate.id);
        } else {
          onSelect(enrichedTemplates[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching templates:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <Card className="py-8">
        <CardContent className="text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No templates available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <RadioGroup value={selectedTemplateId || ""} onValueChange={onSelect} className="space-y-3">
      {templates.map((template) => (
        <div key={template.id}>
          <RadioGroupItem
            value={template.id}
            id={template.id}
            className="peer sr-only"
          />
          <Label htmlFor={template.id} className="cursor-pointer">
            <Card className={`transition-all ${
              selectedTemplateId === template.id 
                ? "border-primary ring-2 ring-primary/20" 
                : "hover:border-primary/50"
            }`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{template.name}</span>
                    {template.is_default && (
                      <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                    )}
                  </div>
                  {template.role_focus && (
                    <Badge variant="secondary" className="text-xs">
                      {template.role_focus}
                    </Badge>
                  )}
                </div>
                {template.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-1">
                    {template.description}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {template.question_count} questions
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(template.category_counts || {}).slice(0, 3).map(([category, count]) => (
                      <Badge
                        key={category}
                        variant="outline"
                        className={`text-xs ${categoryColors[category] || ""}`}
                      >
                        {categoryLabels[category]?.split(" ")[0] || category}: {count}
                      </Badge>
                    ))}
                    {Object.keys(template.category_counts || {}).length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{Object.keys(template.category_counts || {}).length - 3}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}
