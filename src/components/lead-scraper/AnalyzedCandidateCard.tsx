import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, ChevronRight, Gauge, Trash2, RefreshCw, Clock, Star } from "lucide-react";
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
import { formatDistanceToNow } from "date-fns";

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
    if (score >= 80) return "bg-green-500/10 border-green-500/30";
    if (score >= 60) return "bg-blue-500/10 border-blue-500/30";
    if (score >= 40) return "bg-yellow-500/10 border-yellow-500/30";
    return "bg-red-500/10 border-red-500/30";
  };

  const getScoreLabel = (score: number | null) => {
    if (!score) return "Not Rated";
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Low";
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const topSkills = Array.isArray(strengths) 
    ? strengths.slice(0, 3) 
    : [];

  return (
    <TooltipProvider delayDuration={300}>
      <>
        <Card 
          className="group relative border-2 border-border/50 hover:border-primary/40 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1 overflow-hidden"
          role="article"
          aria-label={`Analysis for ${candidate_name}`}
        >
          {/* Top gradient bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-cyan-500 to-primary opacity-60 group-hover:opacity-100 transition-opacity" />

          <CardHeader className="pb-3 pt-5">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <Avatar className="w-14 h-14 border-2 border-primary/20 shadow-lg ring-2 ring-background">
                <AvatarImage src={profile_picture_url || undefined} alt={candidate_name} />
                <AvatarFallback className="bg-gradient-to-br from-primary to-cyan-500 text-white font-bold text-sm">
                  {getInitials(candidate_name)}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold truncate group-hover:text-primary transition-colors">
                  {candidate_name}
                </h3>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>
                    Analyzed {formatDistanceToNow(new Date(created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>

              {/* Fit Score Badge - Compact */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`flex flex-col items-center justify-center px-3 py-2 rounded-xl border-2 ${getScoreBgColor(fit_score)} transition-all cursor-help`}>
                    <div className={`text-2xl font-bold ${getScoreColor(fit_score)}`}>
                      {fit_score || 0}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                      Fit
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4" />
                    <span>{getScoreLabel(fit_score)} Match</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* AI Summary - Truncated */}
            {ai_summary && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Brain className="w-4 h-4 text-primary" />
                  <span>Key Insights</span>
                </div>
                <p className="text-sm text-foreground/80 line-clamp-2 leading-relaxed">
                  {ai_summary}
                </p>
              </div>
            )}

            {/* Top Skills - Horizontal scroll */}
            {topSkills.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <Star className="w-3 h-3 text-primary" />
                  <span>Top Skills</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {topSkills.map((skill: string, idx: number) => (
                    <Badge 
                      key={idx} 
                      variant="secondary" 
                      className="text-xs bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors"
                    >
                      {skill}
                    </Badge>
                  ))}
                  {Array.isArray(strengths) && strengths.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{strengths.length - 3}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button 
                onClick={() => setShowFullAnalysis(true)}
                className="flex-1 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 group/btn shadow-lg shadow-primary/20"
                aria-label={`View full analysis for ${candidate_name}`}
              >
                <span>View Analysis</span>
                <ChevronRight className="w-4 h-4 ml-1 group-hover/btn:translate-x-1 transition-transform" />
              </Button>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-primary/10 hover:border-primary/30 hover:text-primary"
                    aria-label="Re-analyze candidate"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Re-analyze</TooltipContent>
              </Tooltip>

              <AlertDialog>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="hover:text-destructive hover:border-destructive hover:bg-destructive/10"
                        disabled={isDeleting}
                        aria-label={`Delete analysis for ${candidate_name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
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

        {/* Full Analysis Dialog */}
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
    </TooltipProvider>
  );
};
