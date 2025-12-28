import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Plus, Trash2, GripVertical, X } from "lucide-react";
import { toast } from "sonner";

interface Question {
  id: string;
  template_id: string;
  scenario_id: string | null;
  category: string;
  question_text: string;
  follow_up_prompts: string[];
  difficulty_level: number;
  sort_order: number;
  is_custom: boolean;
}

interface ExistingScenario {
  id: string;
  name: string;
  category: string;
  scenario_prompt: string;
  follow_up_prompts: string[];
  difficulty_level: number;
}

const categories = [
  { value: "ambiguity", label: "Ambiguity", color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  { value: "accountability", label: "Accountability", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  { value: "time_pressure", label: "Time Pressure", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  { value: "competing_priorities", label: "Competing Priorities", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  { value: "conflict_resolution", label: "Conflict Resolution", color: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
];

export default function TemplateEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [roleFocus, setRoleFocus] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [existingScenarios, setExistingScenarios] = useState<ExistingScenario[]>([]);
  
  // Add question dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogCategory, setAddDialogCategory] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [customQuestionText, setCustomQuestionText] = useState("");
  const [isCustomQuestion, setIsCustomQuestion] = useState(false);

  // Edit question dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editQuestionText, setEditQuestionText] = useState("");
  const [editFollowUps, setEditFollowUps] = useState<string[]>([]);
  const [editDifficulty, setEditDifficulty] = useState(1);

  useEffect(() => {
    fetchExistingScenarios();
    if (!isNew && id) {
      fetchTemplate();
    }
  }, [id, isNew]);

  const fetchExistingScenarios = async () => {
    const { data, error } = await supabase
      .from("screening_scenarios")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true });

    if (error) {
      console.error("Error fetching scenarios:", error);
      return;
    }

    const mapped: ExistingScenario[] = (data || []).map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      scenario_prompt: s.scenario_prompt,
      follow_up_prompts: Array.isArray(s.follow_up_prompts) 
        ? (s.follow_up_prompts as unknown as string[])
        : [],
      difficulty_level: s.difficulty_level ?? 1,
    }));

    setExistingScenarios(mapped);
  };

  const fetchTemplate = async () => {
    try {
      const { data: template, error: templateError } = await supabase
        .from("screening_templates")
        .select("*")
        .eq("id", id)
        .single();

      if (templateError) throw templateError;

      setTemplateName(template.name);
      setTemplateDescription(template.description || "");
      setRoleFocus(template.role_focus || "");

      const { data: questionsData, error: questionsError } = await supabase
        .from("screening_template_questions")
        .select("*")
        .eq("template_id", id)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true });

      if (questionsError) throw questionsError;

      const mappedQuestions: Question[] = (questionsData || []).map(q => ({
        id: q.id,
        template_id: q.template_id,
        scenario_id: q.scenario_id,
        category: q.category,
        question_text: q.question_text,
        follow_up_prompts: Array.isArray(q.follow_up_prompts)
          ? (q.follow_up_prompts as unknown as string[])
          : [],
        difficulty_level: q.difficulty_level ?? 1,
        sort_order: q.sort_order ?? 0,
        is_custom: q.is_custom ?? false,
      }));

      setQuestions(mappedQuestions);
    } catch (error) {
      console.error("Error fetching template:", error);
      toast.error("Failed to load template");
      navigate("/behavioral-screening/templates");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }

    setSaving(true);
    try {
      let templateId = id;

      if (isNew) {
        const { data, error } = await supabase
          .from("screening_templates")
          .insert({
            name: templateName,
            description: templateDescription || null,
            role_focus: roleFocus || null,
          })
          .select()
          .single();

        if (error) throw error;
        templateId = data.id;
      } else {
        const { error } = await supabase
          .from("screening_templates")
          .update({
            name: templateName,
            description: templateDescription || null,
            role_focus: roleFocus || null,
          })
          .eq("id", id);

        if (error) throw error;

        // Delete existing questions and re-insert
        await supabase
          .from("screening_template_questions")
          .delete()
          .eq("template_id", id);
      }

      // Insert all questions
      if (questions.length > 0) {
        const questionsToInsert = questions.map((q, index) => ({
          template_id: templateId,
          scenario_id: q.scenario_id,
          category: q.category,
          question_text: q.question_text,
          follow_up_prompts: q.follow_up_prompts,
          difficulty_level: q.difficulty_level,
          sort_order: index,
          is_custom: q.is_custom,
        }));

        const { error } = await supabase
          .from("screening_template_questions")
          .insert(questionsToInsert);

        if (error) throw error;
      }

      toast.success(isNew ? "Template created successfully" : "Template saved successfully");
      navigate("/behavioral-screening/templates");
    } catch (error) {
      console.error("Error saving template:", error);
      toast.error("Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const openAddDialog = (category: string) => {
    setAddDialogCategory(category);
    setSelectedScenarioId("");
    setCustomQuestionText("");
    setIsCustomQuestion(false);
    setAddDialogOpen(true);
  };

  const handleAddQuestion = () => {
    if (isCustomQuestion) {
      if (!customQuestionText.trim()) {
        toast.error("Please enter a question");
        return;
      }

      const newQuestion: Question = {
        id: crypto.randomUUID(),
        template_id: id || "",
        scenario_id: null,
        category: addDialogCategory,
        question_text: customQuestionText,
        follow_up_prompts: [],
        difficulty_level: 1,
        sort_order: questions.filter(q => q.category === addDialogCategory).length,
        is_custom: true,
      };

      setQuestions([...questions, newQuestion]);
    } else {
      if (!selectedScenarioId) {
        toast.error("Please select a scenario");
        return;
      }

      const scenario = existingScenarios.find(s => s.id === selectedScenarioId);
      if (!scenario) return;

      // Check if already added
      if (questions.some(q => q.scenario_id === selectedScenarioId)) {
        toast.error("This scenario is already in the template");
        return;
      }

      const newQuestion: Question = {
        id: crypto.randomUUID(),
        template_id: id || "",
        scenario_id: scenario.id,
        category: scenario.category,
        question_text: scenario.scenario_prompt,
        follow_up_prompts: scenario.follow_up_prompts,
        difficulty_level: scenario.difficulty_level || 1,
        sort_order: questions.filter(q => q.category === scenario.category).length,
        is_custom: false,
      };

      setQuestions([...questions, newQuestion]);
    }

    setAddDialogOpen(false);
  };

  const openEditDialog = (question: Question) => {
    setEditingQuestion(question);
    setEditQuestionText(question.question_text);
    setEditFollowUps([...question.follow_up_prompts]);
    setEditDifficulty(question.difficulty_level);
    setEditDialogOpen(true);
  };

  const handleSaveQuestion = () => {
    if (!editingQuestion) return;

    setQuestions(questions.map(q => 
      q.id === editingQuestion.id
        ? {
            ...q,
            question_text: editQuestionText,
            follow_up_prompts: editFollowUps,
            difficulty_level: editDifficulty,
          }
        : q
    ));

    setEditDialogOpen(false);
    setEditingQuestion(null);
  };

  const handleDeleteQuestion = (questionId: string) => {
    setQuestions(questions.filter(q => q.id !== questionId));
  };

  const addFollowUp = () => {
    setEditFollowUps([...editFollowUps, ""]);
  };

  const updateFollowUp = (index: number, value: string) => {
    const updated = [...editFollowUps];
    updated[index] = value;
    setEditFollowUps(updated);
  };

  const removeFollowUp = (index: number) => {
    setEditFollowUps(editFollowUps.filter((_, i) => i !== index));
  };

  const getQuestionsByCategory = (category: string) => {
    return questions.filter(q => q.category === category);
  };

  const getAvailableScenariosForCategory = (category: string) => {
    return existingScenarios.filter(
      s => s.category === category && !questions.some(q => q.scenario_id === s.id)
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/behavioral-screening/templates")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-foreground">
              {isNew ? "Create Template" : "Edit Template"}
            </h1>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Template"}
          </Button>
        </div>

        {/* Template Details */}
        <Card>
          <CardHeader>
            <CardTitle>Template Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Template Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Senior Engineer Screening"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role Focus (optional)</Label>
                <Input
                  id="role"
                  placeholder="e.g., Engineering, Sales, Management"
                  value={roleFocus}
                  onChange={(e) => setRoleFocus(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Describe what this template is used for..."
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Questions by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Screening Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" defaultValue={categories.map(c => c.value)} className="space-y-2">
              {categories.map((category) => {
                const categoryQuestions = getQuestionsByCategory(category.value);
                return (
                  <AccordionItem 
                    key={category.value} 
                    value={category.value}
                    className="border rounded-lg px-4"
                  >
                    <AccordionTrigger className="hover:no-underline py-4">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className={category.color}>
                          {category.label}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {categoryQuestions.length} question{categoryQuestions.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4">
                      <div className="space-y-3">
                        {categoryQuestions.map((question) => (
                          <div
                            key={question.id}
                            className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg group"
                          >
                            <GripVertical className="h-5 w-5 text-muted-foreground mt-0.5 cursor-grab" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm line-clamp-2">{question.question_text}</p>
                              <div className="flex items-center gap-2 mt-2">
                                <Badge variant="secondary" className="text-xs">
                                  Difficulty: {question.difficulty_level}
                                </Badge>
                                {question.follow_up_prompts.length > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    {question.follow_up_prompts.length} follow-ups
                                  </Badge>
                                )}
                                {question.is_custom && (
                                  <Badge variant="outline" className="text-xs">
                                    Custom
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditDialog(question)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteQuestion(question.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => openAddDialog(category.value)}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Question
                        </Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      </div>

      {/* Add Question Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Question</DialogTitle>
            <DialogDescription>
              Add a question from existing scenarios or create a custom one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Button
                variant={!isCustomQuestion ? "default" : "outline"}
                size="sm"
                onClick={() => setIsCustomQuestion(false)}
              >
                From Scenarios
              </Button>
              <Button
                variant={isCustomQuestion ? "default" : "outline"}
                size="sm"
                onClick={() => setIsCustomQuestion(true)}
              >
                Custom Question
              </Button>
            </div>

            {!isCustomQuestion ? (
              <div className="space-y-2">
                <Label>Select Scenario</Label>
                <Select value={selectedScenarioId} onValueChange={setSelectedScenarioId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a scenario..." />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableScenariosForCategory(addDialogCategory).map((scenario) => (
                      <SelectItem key={scenario.id} value={scenario.id}>
                        <span className="line-clamp-1">{scenario.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedScenarioId && (
                  <div className="p-3 bg-muted rounded-lg text-sm">
                    {existingScenarios.find(s => s.id === selectedScenarioId)?.scenario_prompt}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Question Text</Label>
                <Textarea
                  placeholder="Enter your custom question..."
                  value={customQuestionText}
                  onChange={(e) => setCustomQuestionText(e.target.value)}
                  rows={4}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddQuestion}>Add Question</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Question Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Question Text</Label>
              <Textarea
                value={editQuestionText}
                onChange={(e) => setEditQuestionText(e.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label>Difficulty Level</Label>
              <Select 
                value={editDifficulty.toString()} 
                onValueChange={(v) => setEditDifficulty(parseInt(v))}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((level) => (
                    <SelectItem key={level} value={level.toString()}>
                      Level {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Follow-up Prompts</Label>
                <Button variant="outline" size="sm" onClick={addFollowUp}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {editFollowUps.map((prompt, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={prompt}
                      onChange={(e) => updateFollowUp(index, e.target.value)}
                      placeholder={`Follow-up ${index + 1}...`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFollowUp(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {editFollowUps.length === 0 && (
                  <p className="text-sm text-muted-foreground">No follow-up prompts</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveQuestion}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
