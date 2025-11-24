import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Brain, TrendingUp, TrendingDown, Target, Building2, Gauge, GraduationCap, Award, X, Linkedin, Mail, Briefcase } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
  education: any;
  certifications: any;
  status: string | null;
  raw_analysis: any;
  created_at: string;
  updated_at: string;
  profile_picture_url: string | null;
}

interface DeepSearchResultsProps {
  candidateId: string;
  candidateName?: string;
  profilePictureUrl?: string | null;
  onClose?: () => void;
}

export const DeepSearchResults = ({ candidateId, candidateName, profilePictureUrl, onClose }: DeepSearchResultsProps) => {
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
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-blue-600";
    if (score >= 40) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreGradient = (score: number | null) => {
    if (!score) return "from-muted to-muted";
    if (score >= 80) return "from-green-500 to-emerald-600";
    if (score >= 60) return "from-blue-500 to-cyan-600";
    if (score >= 40) return "from-yellow-500 to-orange-500";
    return "from-red-500 to-rose-600";
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-center">
        <Brain className="w-16 h-16 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No deep search results found for this candidate.</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-gradient-to-br from-background via-background to-primary/5">
      {/* Close Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="fixed top-4 right-4 z-50 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background shadow-lg"
      >
        <X className="w-5 h-5" />
      </Button>

      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-cyan-500/10 to-background border-b border-border/50">
        <div className="max-w-7xl mx-auto px-8 py-12">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
            {/* Profile Picture */}
            <Avatar className="w-32 h-32 border-4 border-primary/20 shadow-2xl shadow-primary/20 ring-4 ring-background">
              <AvatarImage src={result.profile_picture_url || profilePictureUrl || undefined} alt={result.candidate_name} />
              <AvatarFallback className="bg-gradient-to-br from-primary via-cyan-500 to-blue-600 text-white font-bold text-3xl">
                {getInitials(result.candidate_name)}
              </AvatarFallback>
            </Avatar>

            {/* Name and Info */}
            <div className="flex-1 text-center md:text-left">
              <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                {result.candidate_name}
              </h1>
              {result.company && (
                <p className="text-xl text-muted-foreground mb-1 flex items-center gap-2 justify-center md:justify-start">
                  <Briefcase className="w-5 h-5" />
                  {result.company}
                </p>
              )}
              {result.linkedin_url && (
                <a 
                  href={result.linkedin_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors mt-2"
                >
                  <Linkedin className="w-4 h-4" />
                  View LinkedIn Profile
                </a>
              )}
            </div>

            {/* Fit Score Circle */}
            <div className="flex flex-col items-center justify-center">
              <div className={`relative w-40 h-40 rounded-full bg-gradient-to-br ${getScoreGradient(result.fit_score)} p-1 shadow-2xl`}>
                <div className="w-full h-full rounded-full bg-background flex flex-col items-center justify-center">
                  <Gauge className={`w-8 h-8 mb-2 ${getScoreColor(result.fit_score)}`} />
                  <div className={`text-5xl font-bold ${getScoreColor(result.fit_score)}`}>
                    {result.fit_score || 0}
                  </div>
                  <div className="text-sm text-muted-foreground font-medium">FIT SCORE</div>
                </div>
              </div>
              {result.ai_confidence_level && (
                <p className="text-sm text-muted-foreground mt-3">
                  {result.ai_confidence_level}% AI Confidence
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* AI Summary */}
            {result.ai_summary && (
              <Card className="border-primary/20 bg-card/80 backdrop-blur-xl shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Brain className="h-6 w-6 text-primary" />
                    AI Analysis Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg text-foreground/90 leading-relaxed">{result.ai_summary}</p>
                </CardContent>
              </Card>
            )}

            {/* Strengths & Weaknesses Side by Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Strengths */}
              {result.strengths && result.strengths.length > 0 && (
                <Card className="border-green-500/20 bg-gradient-to-br from-green-500/5 to-transparent backdrop-blur-xl shadow-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-600">
                      <TrendingUp className="h-5 w-5" />
                      Key Strengths
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {result.strengths.map((strength, index) => (
                        <li key={index} className="flex items-start gap-3">
                          <span className="text-green-500 mt-0.5 text-lg">✓</span>
                          <span className="text-foreground/90 flex-1">{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Weaknesses */}
              {result.weaknesses && result.weaknesses.length > 0 && (
                <Card className="border-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent backdrop-blur-xl shadow-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-600">
                      <TrendingDown className="h-5 w-5" />
                      Areas for Development
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {result.weaknesses.map((weakness, index) => (
                        <li key={index} className="flex items-start gap-3">
                          <span className="text-red-500 mt-0.5 text-lg">•</span>
                          <span className="text-foreground/90 flex-1">{weakness}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Education */}
            {result.education && (
              <Card className="border-primary/20 bg-card/80 backdrop-blur-xl shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-primary" />
                    Education
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {Array.isArray(result.education) ? (
                    <div className="space-y-6">
                      {result.education.map((edu: any, idx: number) => (
                        <div key={idx} className="relative pl-6 border-l-2 border-primary/30">
                          <div className="absolute w-3 h-3 bg-primary rounded-full -left-[7px] top-1"></div>
                          {edu.degree && (
                            <p className="font-semibold text-lg text-foreground">{edu.degree}</p>
                          )}
                          {edu.institution && (
                            <p className="text-foreground/80 mt-1">{edu.institution}</p>
                          )}
                          {edu.field && (
                            <p className="text-sm text-foreground/70 mt-1">Field: {edu.field}</p>
                          )}
                          {edu.year && (
                            <p className="text-sm text-muted-foreground mt-1">{edu.year}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-foreground/90 whitespace-pre-wrap">
                      {typeof result.education === 'string' 
                        ? result.education 
                        : JSON.stringify(result.education, null, 2)}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Certifications */}
            {result.certifications && (
              <Card className="border-primary/20 bg-card/80 backdrop-blur-xl shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Award className="h-5 w-5 text-primary" />
                    Certifications
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {Array.isArray(result.certifications) ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {result.certifications.map((cert: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-3 p-4 rounded-xl bg-secondary/30 border border-border/50 hover:border-primary/50 transition-colors">
                          <Award className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            {typeof cert === 'string' ? (
                              <p className="text-foreground/90 font-medium">{cert}</p>
                            ) : (
                              <>
                                {cert.name && (
                                  <p className="font-semibold text-foreground">{cert.name}</p>
                                )}
                                {cert.issuer && (
                                  <p className="text-sm text-foreground/80 mt-1">{cert.issuer}</p>
                                )}
                                {cert.year && (
                                  <p className="text-sm text-muted-foreground mt-1">{cert.year}</p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-foreground/90 whitespace-pre-wrap">
                      {typeof result.certifications === 'string' 
                        ? result.certifications 
                        : JSON.stringify(result.certifications, null, 2)}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Ideal Roles */}
            {result.ideal_roles && result.ideal_roles.length > 0 && (
              <Card className="border-primary/20 bg-card/80 backdrop-blur-xl shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    Ideal Roles
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {result.ideal_roles.map((role, index) => (
                      <Badge 
                        key={index} 
                        className="text-sm px-4 py-2 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 transition-opacity"
                      >
                        {role}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Company Match Notes */}
            {result.company_match_notes && (
              <Card className="border-primary/20 bg-card/80 backdrop-blur-xl shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    Company Match Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground/90 leading-relaxed">{result.company_match_notes}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <Card className="border-primary/20 bg-card/80 backdrop-blur-xl shadow-xl sticky top-6">
              <CardHeader>
                <CardTitle className="text-lg">Quick Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.company && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Company</p>
                    <p className="text-foreground font-medium">{result.company}</p>
                  </div>
                )}
                {result.linkedin_url && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">LinkedIn</p>
                    <a 
                      href={result.linkedin_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors text-sm"
                    >
                      <Linkedin className="w-4 h-4" />
                      View Profile
                    </a>
                  </div>
                )}
                {result.ai_confidence_level && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">AI Confidence</p>
                    <div className="flex items-center gap-2">
                      <Progress value={result.ai_confidence_level} className="h-2 flex-1" />
                      <span className="text-sm font-medium">{result.ai_confidence_level}%</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <Card className="border-primary/20 bg-card/80 backdrop-blur-xl shadow-xl">
              <CardHeader>
                <CardTitle className="text-lg">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90">
                  <Mail className="w-4 h-4 mr-2" />
                  Contact Candidate
                </Button>
                <Button variant="outline" className="w-full">
                  <Briefcase className="w-4 h-4 mr-2" />
                  Add to Pipeline
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
