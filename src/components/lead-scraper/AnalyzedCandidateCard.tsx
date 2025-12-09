import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, ChevronRight, Gauge, Trash2 } from "lucide-react";
import { useState } from "react";
import { DeepSearchResults } from "./DeepSearchResults";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AnalyzedCandidateCardProps {
  id: string;
  candidate_name: string;
  fit_score: number | null;
  ai_summary: string | null;
  strengths: string[] | null;
  created_at: string;
  profile_picture_url?: string | null;
  onDeleted?: () => void;
}

export const AnalyzedCandidateCard = ({
  id,
  candidate_name,
  fit_score,
  ai_summary,
  strengths,
  created_at,
  profile_picture_url,
  onDeleted
}: AnalyzedCandidateCardProps) => {
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      const { error } = await supabase
        .from('deep_search_results')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Analysis Deleted",
        description: `${candidate_name}'s analysis has been removed.`,
      });

      onDeleted?.();
    } catch (error) {
      console.error('Error deleting analysis:', error);
      toast({
        title: "Error",
        description: "Failed to delete analysis",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getScoreColor = (score: number | null) => {
    if (!score) return "text-muted-foreground";
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-blue-600";
    if (score >= 40) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBgColor = (score: number | null) => {
    if (!score) return "bg-muted/50 border-muted";
    if (score >= 80) return "bg-green-50 border-green-200";
    if (score >= 60) return "bg-blue-50 border-blue-200";
    if (score >= 40) return "bg-yellow-50 border-yellow-200";
    return "bg-red-50 border-red-200";
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const topSkills = Array.isArray(strengths) 
    ? strengths.slice(0, 3) 
    : [];

  return (
    <>
      <Card className="group border-2 border-border/50 hover:border-primary/50 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {/* Avatar with Profile Picture */}
              <Avatar className="w-14 h-14 border-2 border-primary/20 shadow-lg">
                <AvatarImage src={profile_picture_url || undefined} alt={candidate_name} />
                <AvatarFallback className="bg-gradient-to-br from-primary to-cyan-500 text-white font-bold text-sm">
                  {getInitials(candidate_name)}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg truncate group-hover:text-primary transition-colors">
                  {candidate_name}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Analyzed {formatDate(created_at)}
                </p>
              </div>
            </div>

            {/* Fit Score Badge */}
            <div className={`flex flex-col items-center justify-center px-4 py-2 rounded-xl border-2 ${getScoreBgColor(fit_score)}`}>
              <Gauge className={`w-5 h-5 mb-1 ${getScoreColor(fit_score)}`} />
              <div className={`text-2xl font-bold ${getScoreColor(fit_score)}`}>
                {fit_score || 0}
              </div>
              <div className="text-xs text-muted-foreground">Fit Score</div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Experience Summary */}
          {ai_summary && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                Key Highlights
              </h4>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {ai_summary}
              </p>
            </div>
          )}

          {/* Top Skills */}
          {topSkills.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold mb-2 text-muted-foreground">
                TOP SKILLS
              </h4>
              <div className="flex flex-wrap gap-2">
                {topSkills.map((skill: string, idx: number) => (
                  <Badge key={idx} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
                {Array.isArray(strengths) && strengths.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{strengths.length - 3} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 mt-2">
            <Button 
              onClick={() => setShowFullAnalysis(true)}
              className="flex-1 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 group"
            >
              View Full Analysis
              <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="hover:text-destructive hover:border-destructive hover:bg-destructive/10"
                  disabled={isDeleting}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Analysis</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete {candidate_name}'s analysis? This action cannot be undone.
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
        </CardContent>
      </Card>

      {/* Full Analysis Dialog - Full Screen */}
      <Dialog open={showFullAnalysis} onOpenChange={setShowFullAnalysis}>
        <DialogContent className="w-screen max-w-none m-0 p-0 rounded-none animate-fade-in max-h-screen overflow-y-auto">
          <DeepSearchResults 
            candidateId={id} 
            candidateName={candidate_name}
            profilePictureUrl={profile_picture_url}
            onClose={() => setShowFullAnalysis(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
