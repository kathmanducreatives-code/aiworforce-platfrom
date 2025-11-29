import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, Users, FileText, Search, Sparkles, TrendingUp, CheckCircle2, Filter, ArrowLeft } from "lucide-react";
import { deepSearchApi } from "@/services/deepSearchApi";
import { Input } from "@/components/ui/input";
import { CandidateCard } from "@/components/lead-scraper/CandidateCard";
import { AnalyzedCandidateCard } from "@/components/lead-scraper/AnalyzedCandidateCard";

interface LinkedInCandidate {
  id: string;
  candidate_name: string;
  job_title: string | null;
  company: string | null;
  linkedin_url: string | null;
  experience_level: string | null;
}

interface ResumeCandidate {
  id: string;
  candidate_name: string;
  email: string | null;
  recruitment_name: string | null;
  fit_score: any;
  current_stage: string | null;
}

export default function DeepSearch() {
  const navigate = useNavigate();
  const [linkedInCandidates, setLinkedInCandidates] = useState<LinkedInCandidate[]>([]);
  const [resumeCandidates, setResumeCandidates] = useState<ResumeCandidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [analyzedCandidates, setAnalyzedCandidates] = useState<Set<string>>(new Set());
  const [showResults, setShowResults] = useState(false);
  const [viewMode, setViewMode] = useState<"select" | "analyzed">("select");
  const [allAnalyzedResults, setAllAnalyzedResults] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"linkedin" | "resume">("linkedin");
  const { toast } = useToast();
  const lastAnalysisToastTime = useRef(0);

  // Debounced analysis fetch
  const debouncedFetchAnalysis = useCallback(() => {
    const now = Date.now();
    if (now - lastAnalysisToastTime.current > 3000) {
      fetchAnalyzedResults();
      toast({
        title: "Analysis Complete! ✨",
        description: "New deep search results are available.",
      });
      lastAnalysisToastTime.current = now;
    } else {
      // Just fetch without toast if too frequent
      fetchAnalyzedResults();
    }
  }, []);

  const handleAnalysisUpdate = useCallback((payload: any) => {
    console.log('New deep search result:', payload);
    debouncedFetchAnalysis();
  }, [debouncedFetchAnalysis]);

  useEffect(() => {
    fetchCandidates();
    fetchAnalyzedResults();
    
    // Optimized realtime subscription
    const channel = supabase
      .channel('deep-search-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'deep_search_results',
        },
        handleAnalysisUpdate
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleAnalysisUpdate]);

  const fetchCandidates = async () => {
    try {
      setLoading(true);
      
      // Fetch LinkedIn candidates
      const { data: linkedInData, error: linkedInError } = await supabase
        .from('linkedin_leads')
        .select('id, candidate_name, job_title, company, linkedin_url, experience_level')
        .order('scraped_at', { ascending: false });

      if (linkedInError) throw linkedInError;
      setLinkedInCandidates(linkedInData || []);

      // Fetch resume candidates
      const { data: resumeData, error: resumeError } = await supabase
        .from('resume_analyses')
        .select('id, candidate_name, email, recruitment_name, fit_score, current_stage')
        .order('created_at', { ascending: false });

      if (resumeError) throw resumeError;
      setResumeCandidates(resumeData || []);

    } catch (error) {
      console.error('Error fetching candidates:', error);
      toast({
        title: "Error",
        description: "Failed to load candidates",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalyzedResults = async () => {
    try {
      const { data, error } = await supabase
        .from('deep_search_results')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAllAnalyzedResults(data || []);
    } catch (error) {
      console.error('Error fetching analyzed results:', error);
      toast({
        title: "Error",
        description: "Failed to load analyzed candidates",
        variant: "destructive",
      });
    }
  };

  const handleSelectCandidate = useCallback((candidateId: string, checked: boolean) => {
    setSelectedCandidates(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(candidateId);
      } else {
        next.delete(candidateId);
      }
      return next;
    });
  }, []);

  const handleRunDeepSearch = useCallback(async () => {
    if (selectedCandidates.size === 0) {
      toast({
        title: "No candidates selected",
        description: "Please select at least one candidate to analyze",
        variant: "destructive",
      });
      return;
    }

    try {
      setProcessing(true);
      const allCandidates = [...linkedInCandidates, ...resumeCandidates];
      
      for (const candidateId of selectedCandidates) {
        const candidate = allCandidates.find(c => c.id === candidateId);
        if (!candidate) continue;

        const isLinkedIn = linkedInCandidates.some(c => c.id === candidateId);
        
        await deepSearchApi.runDeepSearch({
          candidateId: candidate.id,
          candidateName: candidate.candidate_name,
          linkedinUrl: isLinkedIn ? (candidate as LinkedInCandidate).linkedin_url || undefined : undefined,
          company: isLinkedIn ? (candidate as LinkedInCandidate).company || undefined : undefined,
        });
      }

      toast({
        title: "Deep Search Initiated",
        description: `AI analysis started for ${selectedCandidates.size} candidate(s). Results will appear shortly.`,
      });

      setShowResults(true);
      setViewMode("analyzed");
      setSelectedCandidates(new Set());
      fetchAnalyzedResults();
    } catch (error) {
      console.error('Error running deep search:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to initiate deep search",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  }, [selectedCandidates, linkedInCandidates, resumeCandidates, toast]);

  // Memoize filtered candidates to prevent unnecessary recalculations
  const filteredLinkedInCandidates = useMemo(() => 
    linkedInCandidates.filter(c =>
      c.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.company?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [linkedInCandidates, searchTerm]
  );

  const filteredResumeCandidates = useMemo(() =>
    resumeCandidates.filter(c =>
      c.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.recruitment_name?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [resumeCandidates, searchTerm]
  );

  const getFitScore = useCallback((fitScore: any): number => {
    if (typeof fitScore === 'number') return fitScore;
    if (typeof fitScore === 'object' && fitScore?.score) return fitScore.score;
    return 0;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading candidates...</p>
        </div>
      </div>
    );
  }

  const totalCandidates = linkedInCandidates.length + resumeCandidates.length;
  const totalAnalyzed = allAnalyzedResults.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <div className="border-b border-border/50 bg-card/30 backdrop-blur-lg sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-6">
          {/* Top row - Logo and Title */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/dashboard")}
                className="hover:bg-primary/10"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-lg shadow-primary/20">
                <Brain className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-primary via-cyan-500 to-primary bg-clip-text text-transparent animate-fade-in-down">
                  Deep Search AI
                </h1>
                <p className="text-muted-foreground text-sm">
                  Advanced candidate intelligence powered by AI
                </p>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{totalCandidates}</p>
                  <p className="text-xs text-muted-foreground">Total Candidates</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-cyan-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{selectedCandidates.size}</p>
                  <p className="text-xs text-muted-foreground">Selected for Analysis</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{totalAnalyzed}</p>
                  <p className="text-xs text-muted-foreground">Analyzed Profiles</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* View Toggle */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-12">
              <TabsTrigger value="select" className="gap-2 text-base">
                <Filter className="w-4 h-4" />
                Select Candidates
              </TabsTrigger>
              <TabsTrigger value="analyzed" className="gap-2 text-base">
                <Brain className="w-4 h-4" />
                Analyzed Results ({totalAnalyzed})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 relative">
        {viewMode === "select" ? (
          <div className="space-y-6">
            {/* Search and Filter Bar */}
            <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name, company, role..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const allIds = new Set([
                          ...(activeTab === 'linkedin' ? filteredLinkedInCandidates : filteredResumeCandidates).map(c => c.id)
                        ]);
                        setSelectedCandidates(allIds);
                      }}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCandidates(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Source Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="linkedin" className="gap-2">
                  <Users className="w-4 h-4" />
                  LinkedIn ({filteredLinkedInCandidates.length})
                </TabsTrigger>
                <TabsTrigger value="resume" className="gap-2">
                  <FileText className="w-4 h-4" />
                  Resume ({filteredResumeCandidates.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="linkedin" className="space-y-0">
                {filteredLinkedInCandidates.length === 0 ? (
                  <Card className="border-dashed border-2 bg-card/30 backdrop-blur-sm">
                    <CardContent className="text-center py-16">
                      <Users className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold mb-2">No LinkedIn Candidates</h3>
                      <p className="text-muted-foreground max-w-md mx-auto">
                        {searchTerm 
                          ? "No candidates match your search. Try adjusting your filters."
                          : "Import candidates from LinkedIn to get started with AI-powered analysis."}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredLinkedInCandidates.map((candidate) => (
                      <CandidateCard
                        key={candidate.id}
                        id={candidate.id}
                        name={candidate.candidate_name}
                        title={candidate.job_title}
                        company={candidate.company}
                        experienceLevel={candidate.experience_level}
                        linkedinUrl={candidate.linkedin_url}
                        isSelected={selectedCandidates.has(candidate.id)}
                        isAnalyzed={analyzedCandidates.has(candidate.id)}
                        onSelect={handleSelectCandidate}
                        type="linkedin"
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="resume" className="space-y-0">
                {filteredResumeCandidates.length === 0 ? (
                  <Card className="border-dashed border-2 bg-card/30 backdrop-blur-sm">
                    <CardContent className="text-center py-16">
                      <FileText className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold mb-2">No Resume Candidates</h3>
                      <p className="text-muted-foreground max-w-md mx-auto">
                        {searchTerm 
                          ? "No candidates match your search. Try adjusting your filters."
                          : "Upload resumes to start screening candidates with AI assistance."}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredResumeCandidates.map((candidate) => (
                      <CandidateCard
                        key={candidate.id}
                        id={candidate.id}
                        name={candidate.candidate_name}
                        recruitmentName={candidate.recruitment_name}
                        email={candidate.email}
                        fitScore={getFitScore(candidate.fit_score)}
                        currentStage={candidate.current_stage}
                        isSelected={selectedCandidates.has(candidate.id)}
                        isAnalyzed={analyzedCandidates.has(candidate.id)}
                        onSelect={handleSelectCandidate}
                        type="resume"
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="space-y-6">
            {allAnalyzedResults.length === 0 ? (
              <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                <CardContent className="py-12 text-center">
                  <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No analyzed candidates yet</p>
                  <p className="text-sm text-muted-foreground/70 mt-2">
                    Select candidates and run deep search to see AI-powered insights
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Brain className="w-6 h-6 text-primary" />
                    Analysis Results
                  </h2>
                  <Badge variant="secondary" className="px-4 py-2">
                    {allAnalyzedResults.length} Candidate{allAnalyzedResults.length !== 1 ? 's' : ''} Analyzed
                  </Badge>
                </div>
                
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {allAnalyzedResults.map((result) => (
                    <AnalyzedCandidateCard
                      key={result.id}
                      {...result}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Floating Action Panel */}
        {viewMode === "select" && selectedCandidates.size > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-20 animate-slide-in-bottom">
            <div className="container mx-auto px-4 py-4">
              <Card className="border-2 border-primary shadow-2xl shadow-primary/25 bg-card backdrop-blur-lg">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-lg">
                          {selectedCandidates.size} Candidate{selectedCandidates.size !== 1 ? 's' : ''} Selected
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Ready for AI-powered deep search analysis
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        onClick={() => setSelectedCandidates(new Set())}
                      >
                        Clear Selection
                      </Button>
                      <Button
                        onClick={handleRunDeepSearch}
                        disabled={processing}
                        size="lg"
                        className="gap-2 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 shadow-lg shadow-primary/25"
                      >
                        {processing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            Run Deep Search
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
