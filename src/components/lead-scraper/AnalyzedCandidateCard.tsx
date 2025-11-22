import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, ChevronRight, Gauge } from "lucide-react";
import { useState } from "react";
import { DeepSearchResults } from "./DeepSearchResults";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AnalyzedCandidateCardProps {
  id: string;
  candidate_name: string;
  fit_score: number | null;
  ai_summary: string | null;
  strengths: string[] | null;
  created_at: string;
}

export const AnalyzedCandidateCard = ({
  id,
  candidate_name,
  fit_score,
  ai_summary,
  strengths,
  created_at
}: AnalyzedCandidateCardProps) => {
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);

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
              {/* Avatar */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {getInitials(candidate_name)}
              </div>
              
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

          {/* View Full Analysis Button */}
          <Button 
            onClick={() => setShowFullAnalysis(true)}
            className="w-full mt-2 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 group"
          >
            View Full Analysis
            <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
          </Button>
        </CardContent>
      </Card>

      {/* Full Analysis Dialog */}
      <Dialog open={showFullAnalysis} onOpenChange={setShowFullAnalysis}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Brain className="w-6 h-6 text-primary" />
              Deep Search Analysis: {candidate_name}
            </DialogTitle>
          </DialogHeader>
          <DeepSearchResults candidateId={id} />
        </DialogContent>
      </Dialog>
    </>
  );
};
