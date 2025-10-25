import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Brain, TrendingUp, TrendingDown, Target, Building2, Gauge } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface DeepSearchAnalysis {
  id: string;
  candidate_name: string;
  overall_fit_rating: number;
  experience_summary: string;
  key_skills: any;
  soft_skills_and_traits: string;
  current_role_and_company: string;
  education: any;
  certifications: any;
  languages: any;
  recruiter_insight: string;
  created_at: string;
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
          table: 'deep_search_analysis',
        },
        (payload) => {
          console.log('Deep search update:', payload);
          if (payload.new) {
            setResult(payload.new as DeepSearchAnalysis);
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
      const { data, error } = await (supabase as any)
        .from('deep_search_analysis')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      setResult(data as DeepSearchAnalysis | null);
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

  return (
    <div className="space-y-6">
      {/* Overall Fit Rating Card */}
      <Card className="border-primary/20 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Overall Fit Rating
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className={`text-6xl font-bold ${getScoreColor(result.overall_fit_rating || 0)}`}>
                {result.overall_fit_rating || 0}
              </span>
              <span className="text-muted-foreground text-sm">out of 100</span>
            </div>
            <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${getScoreGradient(result.overall_fit_rating || 0)} transition-all duration-1000 ease-out`}
                style={{ width: `${result.overall_fit_rating || 0}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Role & Company */}
      {result.current_role_and_company && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Current Role & Company
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground/90 leading-relaxed">
              {result.current_role_and_company}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Experience Summary */}
      {result.experience_summary && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Experience Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {result.experience_summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Key Skills */}
      {result.key_skills && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Key Skills
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Array.isArray(result.key_skills) ? (
                result.key_skills.map((skill: string, idx: number) => (
                  <Badge key={idx} variant="secondary" className="px-3 py-1">
                    {skill}
                  </Badge>
                ))
              ) : (
                <p className="text-foreground/80">{JSON.stringify(result.key_skills)}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Soft Skills and Traits */}
      {result.soft_skills_and_traits && (
        <Card className="border-green-500/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500">
              <TrendingUp className="h-5 w-5" />
              Soft Skills & Traits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground/80 leading-relaxed">
              {result.soft_skills_and_traits}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Education & Certifications */}
      <div className="grid md:grid-cols-2 gap-6">
        {result.education && (
          <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Education</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-foreground/80">
                {Array.isArray(result.education) ? (
                  <ul className="space-y-2">
                    {result.education.map((edu: any, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-primary mt-1">•</span>
                        <span>{typeof edu === 'string' ? edu : JSON.stringify(edu)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{JSON.stringify(result.education)}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {result.certifications && (
          <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Certifications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-foreground/80">
                {Array.isArray(result.certifications) ? (
                  <ul className="space-y-2">
                    {result.certifications.map((cert: any, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-primary mt-1">•</span>
                        <span>{typeof cert === 'string' ? cert : JSON.stringify(cert)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{JSON.stringify(result.certifications)}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Languages */}
      {result.languages && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Languages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Array.isArray(result.languages) ? (
                result.languages.map((lang: any, idx: number) => (
                  <Badge key={idx} variant="outline" className="px-3 py-1">
                    {typeof lang === 'string' ? lang : JSON.stringify(lang)}
                  </Badge>
                ))
              ) : (
                <p className="text-foreground/80">{JSON.stringify(result.languages)}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recruiter Insight */}
      {result.recruiter_insight && (
        <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Recruiter Insight
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {result.recruiter_insight}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
