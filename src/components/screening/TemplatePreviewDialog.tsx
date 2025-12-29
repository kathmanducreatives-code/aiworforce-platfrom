import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FileText, MessageCircle } from "lucide-react";

interface Question {
  id: string;
  question_text: string;
  category: string;
  difficulty_level: number | null;
  follow_up_prompts: unknown[] | null;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  role_focus: string | null;
}

interface TemplatePreviewDialogProps {
  templateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function TemplatePreviewDialog({ templateId, open, onOpenChange }: TemplatePreviewDialogProps) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && templateId) {
      fetchTemplateDetails();
    }
  }, [open, templateId]);

  const fetchTemplateDetails = async () => {
    if (!templateId) return;
    
    setLoading(true);
    try {
      const { data: templateData, error: templateError } = await supabase
        .from("screening_templates")
        .select("*")
        .eq("id", templateId)
        .single();

      if (templateError) throw templateError;
      setTemplate(templateData);

      const { data: questionsData, error: questionsError } = await supabase
        .from("screening_template_questions")
        .select("*")
        .eq("template_id", templateId)
        .order("sort_order", { ascending: true });

      if (questionsError) throw questionsError;
      
      // Parse follow_up_prompts from JSON if needed
      const parsedQuestions: Question[] = questionsData?.map(q => ({
        id: q.id,
        question_text: q.question_text,
        category: q.category,
        difficulty_level: q.difficulty_level,
        follow_up_prompts: Array.isArray(q.follow_up_prompts) 
          ? q.follow_up_prompts 
          : null
      })) || [];
      
      setQuestions(parsedQuestions);
    } catch (error) {
      console.error("Error fetching template details:", error);
    } finally {
      setLoading(false);
    }
  };

  // Group questions by category
  const questionsByCategory = questions.reduce<Record<string, Question[]>>((acc, q) => {
    if (!acc[q.category]) acc[q.category] = [];
    acc[q.category].push(q);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            {template?.name || "Template Preview"}
          </DialogTitle>
          <DialogDescription>
            {template?.description || "Read-only preview of template questions"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{questions.length} questions across {Object.keys(questionsByCategory).length} categories</span>
              </div>

              <Accordion type="multiple" className="w-full">
                {Object.entries(questionsByCategory).map(([category, categoryQuestions]) => (
                  <AccordionItem key={category} value={category}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={categoryColors[category] || ""}>
                          {categoryLabels[category] || category}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          ({categoryQuestions.length} questions)
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pl-2">
                        {categoryQuestions.map((question, idx) => (
                          <div key={question.id} className="border-l-2 border-muted pl-4 py-2">
                            <p className="text-sm font-medium mb-1">
                              {idx + 1}. {question.question_text}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                              <span>Difficulty: {question.difficulty_level ?? 1}/5</span>
                            </div>
                            {question.follow_up_prompts && question.follow_up_prompts.length > 0 && (
                              <div className="mt-2 bg-muted/30 rounded-md p-2">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                                  <MessageCircle className="w-3 h-3" />
                                  <span>Follow-up prompts:</span>
                                </div>
                              <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                                  {question.follow_up_prompts.map((prompt, i) => (
                                    <li key={i}>{String(prompt)}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
