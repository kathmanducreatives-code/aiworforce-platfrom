import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Search, 
  FileText, 
  Copy, 
  Trash2, 
  Edit,
  ArrowLeft,
  Star
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Template {
  id: string;
  name: string;
  description: string | null;
  role_focus: string | null;
  is_default: boolean;
  created_at: string;
  question_count?: number;
  category_counts?: Record<string, number>;
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

export default function ScreeningTemplates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      // Fetch templates
      const { data: templatesData, error: templatesError } = await supabase
        .from("screening_templates")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });

      if (templatesError) throw templatesError;

      // Fetch question counts for each template
      const { data: questionsData, error: questionsError } = await supabase
        .from("screening_template_questions")
        .select("template_id, category");

      if (questionsError) throw questionsError;

      // Calculate counts per template
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
    } catch (error) {
      console.error("Error fetching templates:", error);
      toast.error("Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicate = async (template: Template) => {
    try {
      // Create new template
      const { data: newTemplate, error: templateError } = await supabase
        .from("screening_templates")
        .insert({
          name: `${template.name} (Copy)`,
          description: template.description,
          role_focus: template.role_focus,
          is_default: false,
        })
        .select()
        .single();

      if (templateError) throw templateError;

      // Copy questions
      const { data: questions, error: questionsError } = await supabase
        .from("screening_template_questions")
        .select("*")
        .eq("template_id", template.id);

      if (questionsError) throw questionsError;

      if (questions && questions.length > 0) {
        const newQuestions = questions.map((q) => ({
          template_id: newTemplate.id,
          scenario_id: q.scenario_id,
          category: q.category,
          question_text: q.question_text,
          follow_up_prompts: q.follow_up_prompts,
          difficulty_level: q.difficulty_level,
          sort_order: q.sort_order,
          is_custom: q.is_custom,
        }));

        const { error: insertError } = await supabase
          .from("screening_template_questions")
          .insert(newQuestions);

        if (insertError) throw insertError;
      }

      toast.success("Template duplicated successfully");
      fetchTemplates();
    } catch (error) {
      console.error("Error duplicating template:", error);
      toast.error("Failed to duplicate template");
    }
  };

  const handleDelete = async () => {
    if (!templateToDelete) return;

    try {
      const { error } = await supabase
        .from("screening_templates")
        .delete()
        .eq("id", templateToDelete.id);

      if (error) throw error;

      toast.success("Template deleted successfully");
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
      fetchTemplates();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error("Failed to delete template");
    }
  };

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.role_focus?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/behavioral-screening")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Screening Templates</h1>
              <p className="text-muted-foreground">
                Create and manage behavioral screening question templates
              </p>
            </div>
          </div>
          <Button onClick={() => navigate("/behavioral-screening/templates/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Create Template
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Templates Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-5 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2 mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-20 bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <Card className="py-12">
            <CardContent className="text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No templates found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery
                  ? "Try adjusting your search"
                  : "Get started by creating your first template"}
              </p>
              {!searchQuery && (
                <Button onClick={() => navigate("/behavioral-screening/templates/new")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Template
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <Card
                key={template.id}
                className="group hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/behavioral-screening/templates/${template.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {template.name}
                        {template.is_default && (
                          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        )}
                      </CardTitle>
                      {template.role_focus && (
                        <Badge variant="secondary" className="text-xs">
                          {template.role_focus}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/behavioral-screening/templates/${template.id}`);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicate(template);
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {!template.is_default && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTemplateToDelete(template);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {template.description || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      {template.question_count} questions
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(template.category_counts || {}).map(([category, count]) => (
                        <Badge
                          key={category}
                          variant="outline"
                          className={`text-xs ${categoryColors[category] || ""}`}
                        >
                          {categoryLabels[category] || category}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{templateToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
