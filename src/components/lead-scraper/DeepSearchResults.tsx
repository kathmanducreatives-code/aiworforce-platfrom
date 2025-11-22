import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Brain, TrendingUp, TrendingDown, Target, Building2, Gauge } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface DeepSearchAnalysis {
  id: string;
  candidate_id: string | null;
  candidate_name: string;
  linkedin_url: string | null;
  company: string | null;
  fit_score: number | null;
  ai_confidence_level: number | null;
  ai_summary: string | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  ideal_roles: string[] | null;
  company_match_notes: string | null;
  status: string | null;
  raw_analysis: any;
  created_at: string;
  updated_at: string;
}

interface DeepSearchResultsProps {
  candidateId: string;
}

export const DeepSearchResults = ({ candidateId }: DeepSearchResultsProps) => {
  const [result, setResult] = useState<DeepSearchAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDeepSearchResult();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('deep-search-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'deep_search_results',
        },
        (payload) => {
          console.log('Deep search update:', payload);
          const newData = payload.new as DeepSearchAnalysis;
          if (newData && newData.id === candidateId) {
            setResult(newData);
            setLoading(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [candidateId]);

  const fetchDeepSearchResult = async () => {
    try {
      const { data, error } = await supabase
        .from('deep_search_results')
        .select('*')
        .eq('id', candidateId)
        .maybeSingle();

      if (error) throw error;
      
      setResult(data as DeepSearchAnalysis | null);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching deep search result:', error);
      setLoading(false);
    }
  };

  const getScoreColor = (score: number | null) => {
    if (!score) return "text-muted-foreground";
    if (score >= 80) return "text-green-500";
    if (score >= 60) return "text-blue-500";
    if (score >= 40) return "text-yellow-500";
    return "text-red-500";
  };

  const getScoreGradient = (score: number | null) => {
    if (!score) return "from-muted to-muted-foreground";
    if (score >= 80) return "from-green-500 to-emerald-500";
    if (score >= 60) return "from-blue-500 to-cyan-500";
    if (score >= 40) return "from-yellow-500 to-orange-500";
    return "from-red-500 to-rose-500";
  };

  if (loading) {
    return (
      <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Running deep search analysis...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardContent className="py-12 text-center">
          <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No deep search results yet</p>
          <p className="text-sm text-muted-foreground/70 mt-2">
            Click "Run Deep Search" to analyze this candidate
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Fit Rating Card */}
      <Card className="border-primary/20 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Overall Fit Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className={`text-6xl font-bold ${getScoreColor(result.fit_score)}`}>
                {result.fit_score || 0}
              </span>
              <span className="text-muted-foreground text-sm">out of 100</span>
            </div>
            <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${getScoreGradient(result.fit_score)} transition-all duration-1000 ease-out`}
                style={{ width: `${result.fit_score || 0}%` }}
              />
            </div>
            {result.ai_confidence_level && (
              <div className="mt-4 text-sm text-muted-foreground">
                AI Confidence: {result.ai_confidence_level}%
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Company & LinkedIn */}
      {(result.company || result.linkedin_url) && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Professional Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.company && (
              <p className="text-foreground/90"><strong>Company:</strong> {result.company}</p>
            )}
            {result.linkedin_url && (
              <a 
                href={result.linkedin_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-block"
              >
                View LinkedIn Profile →
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Summary */}
      {result.ai_summary && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              AI Analysis Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {result.ai_summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Strengths */}
      {result.strengths && result.strengths.length > 0 && (
        <Card className="border-green-500/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500">
              <TrendingUp className="h-5 w-5" />
              Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {result.strengths.map((strength: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span className="text-foreground/90">{strength}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Weaknesses */}
      {result.weaknesses && result.weaknesses.length > 0 && (
        <Card className="border-red-500/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <TrendingDown className="h-5 w-5" />
              Areas for Development
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {result.weaknesses.map((weakness: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">•</span>
                  <span className="text-foreground/80">{weakness}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Ideal Roles */}
      {result.ideal_roles && result.ideal_roles.length > 0 && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Ideal Roles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {result.ideal_roles.map((role: string, idx: number) => (
                <Badge key={idx} variant="secondary" className="px-3 py-1">
                  {role}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Company Match Notes */}
      {result.company_match_notes && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Company Match Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {result.company_match_notes}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
