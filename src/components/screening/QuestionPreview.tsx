import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, ChevronDown, Pencil, Check, Loader2, Sparkles } from "lucide-react";
import type { RequirementsData } from "./RequirementsForm";

export interface GeneratedQuestion {
  category: string;
  question_text: string;
  follow_up_prompts: string[];
  difficulty_level: number;
}

interface QuestionPreviewProps {
  requirements: RequirementsData;
  questions: GeneratedQuestion[];
  onQuestionsChange: (questions: GeneratedQuestion[]) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  accountability: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  culture_fit: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  red_flag: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
};

function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category] || "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30";
}

function formatCategory(category: string) {
  return category.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function QuestionPreview({ requirements, questions, onQuestionsChange }: QuestionPreviewProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    if (questions.length === 0 && requirements.role_title && requirements.required_skills.length > 0) {
      generateQuestions();
    }
  }, []);

  const generateQuestions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-screening-questions', {
        body: {
          role_title: requirements.role_title,
          required_skills: requirements.required_skills,
          experience_level: requirements.experience_level || 'mid',
          culture_keywords: requirements.culture_keywords,
          industry: requirements.industry,
          free_text_description: requirements.free_text,
        },
      });

      if (error) throw error;

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (data?.questions) {
        onQuestionsChange(data.questions);
        toast.success(`${data.questions.length} questions generated`);
      }
    } catch (err: any) {
      console.error('Question generation failed:', err);
      toast.error('Failed to generate questions. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditText(questions[index].question_text);
  };

  const saveEdit = (index: number) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], question_text: editText };
    onQuestionsChange(updated);
    setEditingIndex(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>AI is generating custom questions for <strong>{requirements.role_title}</strong>...</span>
        </div>
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">
            {questions.length} questions generated for this screening
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={generateQuestions} disabled={isLoading}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Regenerate
        </Button>
      </div>

      <div className="space-y-2">
        {questions.map((q, idx) => (
          <Collapsible key={idx}>
            <div className="border border-border rounded-lg overflow-hidden">
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/30 transition-colors">
                  <span className="text-xs font-mono text-muted-foreground mt-0.5 min-w-[1.5rem]">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    {editingIndex === idx ? (
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="text-sm"
                          autoFocus
                        />
                        <Button size="icon" variant="ghost" onClick={() => saveEdit(idx)} className="shrink-0">
                          <Check className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{q.question_text}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className={`text-[10px] ${getCategoryColor(q.category)}`}>
                        {formatCategory(q.category)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        Difficulty: {"●".repeat(q.difficulty_level)}{"○".repeat(5 - q.difficulty_level)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); startEditing(idx); }}
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-3 pt-1 border-t border-border/50 bg-muted/20">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Follow-up prompts:</p>
                  <ul className="space-y-1">
                    {q.follow_up_prompts.map((fp, fpIdx) => (
                      <li key={fpIdx} className="text-xs text-muted-foreground pl-3 relative before:content-['→'] before:absolute before:left-0">
                        {fp}
                      </li>
                    ))}
                  </ul>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
