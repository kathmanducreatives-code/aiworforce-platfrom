import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Users, Star, MapPin, Calendar, User, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";

const FolderView = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<ResumeAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCandidates = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('resume_analyses')
          .select('*')
          .eq('recruitment_name', folderName)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching candidates:', error);
        } else {
          // Map database fields to interface structure
          const mappedCandidates = (data || []).map(item => {
            // Parse JSON strings
            const parseJsonString = (jsonStr: string | null): string[] => {
              if (!jsonStr) return [];
              try {
                return JSON.parse(jsonStr);
              } catch {
                return [];
              }
            };

            return {
              id: item.id,
              candidateName: item.candidate_name,
              email: item.email || '',
              resume: item.resume || '',
              strengths: parseJsonString(item.strengths),
              weaknesses: parseJsonString(item.weaknesses),
              fitScore: typeof item.fit_score === 'number' ? item.fit_score : 
                       (typeof item.fit_score === 'object' && item.fit_score !== null ? 
                        (item.fit_score as any) || 0 : 0),
              overallFactor: typeof item.overall_factor === 'number' ? item.overall_factor : 
                            (typeof item.overall_factor === 'object' && item.overall_factor !== null ? 
                             (item.overall_factor as any) || 0 : 0),
              riskFactor: typeof item.risk_factor === 'number' ? item.risk_factor : 
                         (typeof item.risk_factor === 'object' && item.risk_factor !== null ? 
                          (item.risk_factor as any).score || 0 : 0),
              rewardFactor: typeof item.reward_factor === 'number' ? item.reward_factor : 
                           (typeof item.reward_factor === 'object' && item.reward_factor !== null ? 
                            (item.reward_factor as any).score || 0 : 0),
              justification: item.justification || '',
              recruitmentName: item.recruitment_name || '',
              date: item.created_at
            } as ResumeAnalysis;
          });
          setCandidates(mappedCandidates);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    if (folderName) {
      fetchCandidates();
    }
  }, [folderName]);

  const getStatusColor = (score: number) => {
    if (score >= 8) return "bg-green-100 text-green-800";
    if (score >= 6) return "bg-blue-100 text-blue-800";
    if (score >= 4) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getStatusText = (score: number) => {
    if (score >= 8) return "Excellent Match";
    if (score >= 6) return "Good Match";
    if (score >= 4) return "Fair Match";
    return "Poor Match";
  };

  const extractSkills = (strengths: string[]): string[] => {
    // Extract technology names from strength descriptions
    const skills: string[] = [];
    strengths.forEach((strength: string) => {
      const techMatches = strength.match(/\b(React|TypeScript|Node\.js|Python|Django|Vue\.js|JavaScript|CSS|TensorFlow|PyTorch|AWS|Azure|GCP|AI|Machine Learning)\b/gi);
      if (techMatches) {
        skills.push(...techMatches);
      }
    });
    return [...new Set(skills)].slice(0, 4); // Remove duplicates and limit to 4
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50">
        <Header />
        <div className="container mx-auto px-6 py-8 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading candidates...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-white to-cyan-50">
      <Header />
      
      <main className="container mx-auto px-4 sm:px-6 py-8 pt-24 animate-fade-in max-w-7xl">
        {/* Header Section */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="hover:bg-slate-100 hover:scale-105 transition-all duration-200 rounded-xl p-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-slate-800 mb-2">
                {folderName} Candidates
              </h1>
              <p className="text-slate-600">
                {candidates.length} candidates in this recruitment folder
              </p>
            </div>
          </div>

          {/* Push to Email Sequence Button */}
          {candidates.length > 0 && (
            <Button
              onClick={() => navigate(`/email-sequence/${encodeURIComponent(folderName || '')}`)}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 rounded-xl font-medium px-6 py-3 group"
            >
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 group-hover:scale-110 transition-transform duration-200" />
                <span>Push to Email Sequence</span>
                <div className="flex items-center gap-1 ml-2 bg-white/20 rounded-full px-2 py-1 text-sm font-semibold">
                  <Users className="h-4 w-4" />
                  {candidates.length}
                </div>
              </div>
            </Button>
          )}
        </div>

        {/* No candidates message */}
        {candidates.length === 0 ? (
          <div className="text-center py-12">
            <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md mx-auto">
              <div className="mb-4">
                <Users className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-slate-700 mb-2">No candidates found</h3>
                <p className="text-slate-500">
                  No candidates have been analyzed for the "{folderName}" recruitment yet.
                </p>
              </div>
              <Button 
                onClick={() => navigate("/")}
                variant="outline"
                className="mt-4"
              >
                Back to Dashboard
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {candidates.map((candidate, index) => {
              const skills = extractSkills(candidate.strengths || []);
              const fitScore = candidate.fitScore || 0;
              const status = getStatusText(fitScore);
              
              return (
                <Card 
                  key={candidate.id}
                  className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 hover:scale-[1.02] hover:border-cyan-200 rounded-2xl cursor-pointer"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-800 text-lg mb-1 group-hover:text-cyan-600 transition-colors duration-200">
                          {candidate.candidateName}
                        </h3>
                        <p className="text-slate-600 text-sm mb-2">
                          {folderName} Candidate
                        </p>
                        <Badge className={`${getStatusColor(fitScore)} text-xs font-medium`}>
                          {status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-amber-500">
                        <Star className="h-4 w-4 fill-current" />
                        <span className="text-sm font-medium text-slate-700">
                          {fitScore}/10
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      {candidate.email && (
                        <div className="flex items-center gap-2 text-slate-600 text-sm">
                          <User className="h-4 w-4" />
                          {candidate.email}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-slate-600 text-sm">
                        <Calendar className="h-4 w-4" />
                        Applied: {candidate.date ? formatDate(candidate.date) : 'Unknown'}
                      </div>
                    </div>

                    <div className="mb-4">
                      <p className="text-sm text-slate-600 mb-2">Key Skills</p>
                      {skills.length > 0 ? (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {skills.map((skill, i) => (
                            <span 
                              key={i}
                              className="px-2 py-1 bg-cyan-50 text-cyan-700 rounded-lg text-xs font-medium"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 mb-2">Skills extracted from analysis</p>
                      )}
                      <p className="text-xs text-slate-500">
                        Overall Factor: {candidate.overallFactor}/10
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline" 
                        size="sm"
                        className="flex-1 hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700 transition-all duration-200"
                        onClick={() => window.open(candidate.resume, '_blank')}
                      >
                        View Resume
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white transition-all duration-200"
                      >
                        Contact
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
             })}
          </div>
        )}
      </main>
    </div>
  );
};

export default FolderView;