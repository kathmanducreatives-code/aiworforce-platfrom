import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Users, Star, MapPin, Calendar, User, Phone, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import Header from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";

const FolderView = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [candidates, setCandidates] = useState<ResumeAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());

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

  // Selection handlers
  const handleSelectCandidate = (candidateId: string, checked: boolean) => {
    const newSelected = new Set(selectedCandidates);
    if (checked) {
      newSelected.add(candidateId);
    } else {
      newSelected.delete(candidateId);
    }
    setSelectedCandidates(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedCandidates.size === candidates.length) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(candidates.map(c => c.id!)));
    }
  };

  const handlePushToEmailSequence = () => {
    if (selectedCandidates.size === 0) {
      toast({
        title: "No Candidates Selected",
        description: "Please select at least one candidate to push to email sequence.",
        variant: "destructive"
      });
      return;
    }

    const selectedCandidatesList = candidates.filter(c => selectedCandidates.has(c.id!));
    
    // Navigate to email sequence setup page with selected candidates
    navigate(`/email-sequence/${encodeURIComponent(folderName || '')}`, { 
      state: { selectedCandidates: selectedCandidatesList } 
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
      
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-8 pt-20 sm:pt-24 animate-fade-in max-w-7xl">
        {/* Header Section - Mobile Optimized */}
        <div className="space-y-4 sm:space-y-6 mb-6 sm:mb-8">
          {/* Top Row - Back Button and Title */}
          <div className="flex items-start gap-3 sm:gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/dashboard")}
              className="hover:bg-slate-100 hover:scale-105 transition-all duration-200 rounded-xl p-2 flex-shrink-0 mt-1"
            >
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800 mb-1 sm:mb-2 leading-tight">
                {folderName} Candidates
              </h1>
              <p className="text-sm sm:text-base text-slate-600">
                {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} in this folder
              </p>
            </div>
          </div>

          {/* Selection Controls & Push to Email Sequence */}
          {candidates.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              {/* Selection Controls */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start sm:items-center">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="select-all"
                    checked={selectedCandidates.size === candidates.length && candidates.length > 0}
                    onCheckedChange={handleSelectAll}
                    className="border-slate-300 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                  />
                  <label 
                    htmlFor="select-all" 
                    className="text-sm sm:text-base font-medium text-slate-700 cursor-pointer"
                  >
                    Select All ({candidates.length})
                  </label>
                </div>
                
                {selectedCandidates.size > 0 && (
                  <div className="flex items-center gap-2 bg-cyan-50 border border-cyan-200 rounded-lg px-3 py-2">
                    <CheckSquare className="h-4 w-4 text-cyan-600" />
                    <span className="text-sm font-medium text-cyan-700">
                      {selectedCandidates.size} selected
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedCandidates(new Set())}
                      className="h-6 w-6 p-0 hover:bg-cyan-100 ml-1"
                    >
                      ×
                    </Button>
                  </div>
                )}
              </div>

              {/* Push to Email Sequence Button */}
              <div className="w-full">
                <Button
                  onClick={handlePushToEmailSequence}
                  disabled={selectedCandidates.size === 0}
                  className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 rounded-xl font-medium px-4 sm:px-6 py-3 group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-center gap-2 text-sm sm:text-base">
                    <Mail className="h-4 w-4 sm:h-5 sm:w-5 group-hover:scale-110 transition-transform duration-200" />
                    <span className="hidden sm:inline">Push Selected to Email Sequence</span>
                    <span className="sm:hidden">Push to Email</span>
                    <div className="flex items-center gap-1 ml-2 bg-white/20 rounded-full px-2 py-1 text-xs sm:text-sm font-semibold">
                      <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                      {selectedCandidates.size}
                    </div>
                  </div>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* No candidates message */}
        {candidates.length === 0 ? (
          <div className="text-center py-8 sm:py-12 px-4">
            <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 max-w-md mx-auto">
              <div className="mb-4">
                <Users className="h-12 w-12 sm:h-16 sm:w-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg sm:text-xl font-semibold text-slate-700 mb-2">No candidates found</h3>
                <p className="text-sm sm:text-base text-slate-500">
                  No candidates have been analyzed for the "{folderName}" recruitment yet.
                </p>
              </div>
              <Button 
                onClick={() => navigate("/dashboard")}
                variant="outline"
                className="mt-4 w-full sm:w-auto"
              >
                Back to Dashboard
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4 lg:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((candidate, index) => {
              const skills = extractSkills(candidate.strengths || []);
              const fitScore = candidate.fitScore || 0;
              const status = getStatusText(fitScore);
              
              return (
                <Card 
                  key={candidate.id}
                  className={`group backdrop-blur-sm bg-white/80 border shadow-lg hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 hover:scale-[1.02] rounded-xl cursor-pointer ${
                    selectedCandidates.has(candidate.id!) 
                      ? 'border-cyan-400 bg-cyan-50/50 shadow-cyan-200/50' 
                      : 'border-slate-200/50 hover:border-cyan-200'
                  }`}
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <CardContent className="p-4 sm:p-5 lg:p-6">
                    {/* Selection Checkbox */}
                    <div className="flex items-center justify-between mb-3">
                      <Checkbox
                        id={`candidate-${candidate.id}`}
                        checked={selectedCandidates.has(candidate.id!)}
                        onCheckedChange={(checked) => handleSelectCandidate(candidate.id!, checked as boolean)}
                        onClick={(e) => e.stopPropagation()}
                        className="border-slate-300 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                      />
                      {selectedCandidates.has(candidate.id!) && (
                        <div className="flex items-center gap-1 bg-cyan-100 text-cyan-700 px-2 py-1 rounded-full text-xs font-medium">
                          <CheckSquare className="h-3 w-3" />
                          Selected
                        </div>
                      )}
                    </div>

                    {/* Mobile-optimized header */}
                    <div className="flex items-start justify-between mb-3 gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-slate-800 text-base sm:text-lg mb-1 group-hover:text-cyan-600 transition-colors duration-200 truncate pr-2">
                          {candidate.candidateName}
                        </h3>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-2">
                          <Badge className={`${getStatusColor(fitScore)} text-xs font-medium w-fit`}>
                            {status}
                          </Badge>
                          <span className="text-xs text-slate-500 truncate">
                            {folderName}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-amber-500 flex-shrink-0">
                        <Star className="h-4 w-4 fill-current" />
                        <span className="text-sm font-medium text-slate-700">
                          {fitScore}/10
                        </span>
                      </div>
                    </div>

                    {/* Essential info - always visible */}
                    <div className="space-y-2 mb-3 sm:mb-4">
                      {candidate.email && (
                        <div className="flex items-center gap-2 text-slate-600 text-sm">
                          <User className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">{candidate.email}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-slate-600 text-sm">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 flex-shrink-0" />
                          <span className="text-xs sm:text-sm">
                            {candidate.date ? formatDate(candidate.date) : 'Unknown'}
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          Overall: {candidate.overallFactor}/10
                        </span>
                      </div>
                    </div>

                    {/* Skills section - mobile optimized */}
                    <div className="mb-3 sm:mb-4">
                      <p className="text-sm text-slate-600 mb-2">Key Skills</p>
                      {skills.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {skills.slice(0, 2).map((skill, i) => (
                            <span 
                              key={i}
                              className="px-2 py-1 bg-cyan-50 text-cyan-700 rounded-lg text-xs font-medium"
                            >
                              {skill}
                            </span>
                          ))}
                          {skills.length > 2 && (
                            <span className="px-2 py-1 bg-slate-50 text-slate-600 rounded-lg text-xs">
                              +{skills.length - 2} more
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 mb-2">Skills extracted from analysis</p>
                      )}
                    </div>

                    {/* Action buttons - mobile optimized */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline" 
                        size="sm"
                        className="flex-1 hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700 transition-all duration-200 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(candidate.resume, '_blank');
                        }}
                      >
                        <span className="truncate">Resume</span>
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white transition-all duration-200 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.location.href = `mailto:${candidate.email}`;
                        }}
                      >
                        <span className="truncate">Contact</span>
                      </Button>
                      <Button
                        variant={selectedCandidates.has(candidate.id!) ? "default" : "outline"}
                        size="sm"
                        className={`px-3 transition-all duration-200 text-xs ${
                          selectedCandidates.has(candidate.id!) 
                            ? 'bg-cyan-500 hover:bg-cyan-600 text-white' 
                            : 'hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectCandidate(candidate.id!, !selectedCandidates.has(candidate.id!));
                        }}
                      >
                        {selectedCandidates.has(candidate.id!) ? (
                          <CheckSquare className="h-4 w-4" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
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