import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Brain, TrendingUp, TrendingDown, Target, Building2, Gauge } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface DeepSearchResult {
  id: string;
  fit_score: number;
  ai_summary: string;
  strengths: string[];
  weaknesses: string[];
  ideal_roles: string[];
  company_match_notes: string;
  ai_confidence_level: number;
  status: string;
  created_at: string;
}

interface DeepSearchResultsProps {
  candidateId: string;
}

export const DeepSearchResults = ({ candidateId }: DeepSearchResultsProps) => {
  const [result, setResult] = useState<DeepSearchResult | null>(null);
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
          filter: `candidate_id=eq.${candidateId}`,
        },
        (payload) => {
          console.log('Deep search update:', payload);
          if (payload.new) {
            setResult(payload.new as DeepSearchResult);
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
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      setResult(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching deep search result:', error);
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-500";
    if (score >= 60) return "text-blue-500";
    if (score >= 40) return "text-yellow-500";
    return "text-red-500";
  };

  const getScoreGradient = (score: number) => {
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

  if (result.status === 'pending') {
    return (
      <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Deep search in progress...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Fit Score Card */}
      <Card className="border-primary/20 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Fit Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className={`text-6xl font-bold ${getScoreColor(result.fit_score)}`}>
                {result.fit_score}
              </span>
              <span className="text-muted-foreground text-sm">out of 100</span>
            </div>
            <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${getScoreGradient(result.fit_score)} transition-all duration-1000 ease-out`}
                style={{ width: `${result.fit_score}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Summary */}
      <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            AI Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
            {result.ai_summary}
          </p>
        </CardContent>
      </Card>

      {/* Strengths and Weaknesses */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-green-500/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500">
              <TrendingUp className="h-5 w-5" />
              Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {result.strengths?.map((strength, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">•</span>
                  <span className="text-foreground/80">{strength}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-orange-500/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-500">
              <TrendingDown className="h-5 w-5" />
              Weaknesses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {result.weaknesses?.map((weakness, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-orange-500 mt-1">•</span>
                  <span className="text-foreground/80">{weakness}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Ideal Roles */}
      <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Ideal Roles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {result.ideal_roles?.map((role, idx) => (
              <Badge key={idx} variant="secondary" className="px-3 py-1">
                {role}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Company Match Notes */}
      <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Company Match Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-foreground/80 leading-relaxed">
            {result.company_match_notes}
          </p>
        </CardContent>
      </Card>

      {/* AI Confidence Level */}
      <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            AI Confidence Level
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-semibold text-primary">
                {result.ai_confidence_level}%
              </span>
              <span className="text-sm text-muted-foreground">Confidence</span>
            </div>
            <Progress value={result.ai_confidence_level} className="h-2" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
