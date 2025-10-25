import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, Users, FileText, Search, Sparkles } from "lucide-react";
import { deepSearchApi } from "@/services/deepSearchApi";
import { DeepSearchResults } from "@/components/lead-scraper/DeepSearchResults";
import { Input } from "@/components/ui/input";

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
  const { toast } = useToast();

  useEffect(() => {
    fetchCandidates();
    fetchAnalyzedResults();
    
    // Subscribe to real-time updates for deep search analysis
    const channel = supabase
      .channel('deep-search-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'deep_search_analysis',
        },
        (payload) => {
          console.log('New deep search result:', payload);
          fetchAnalyzedResults();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
      const { data, error } = await (supabase as any)
        .from('deep_search_analysis')
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

  const handleSelectCandidate = (candidateId: string, checked: boolean) => {
    setSelectedCandidates(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(candidateId);
      } else {
        next.delete(candidateId);
      }
      return next;
    });
  };

  const handleRunDeepSearch = async () => {
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
  };

  const filteredLinkedInCandidates = linkedInCandidates.filter(c =>
    c.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.company?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredResumeCandidates = resumeCandidates.filter(c =>
    c.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.recruitment_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getFitScore = (fitScore: any): number => {
    if (typeof fitScore === 'number') return fitScore;
    if (typeof fitScore === 'object' && fitScore?.score) return fitScore.score;
    return 0;
  };

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <div className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-cyan-500 bg-clip-text text-transparent">
                  Deep Search
                </h1>
                <p className="text-muted-foreground text-sm">
                  AI-powered candidate intelligence analysis
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-auto">
                <TabsList>
                  <TabsTrigger value="select">Select Candidates</TabsTrigger>
                  <TabsTrigger value="analyzed">
                    View Analyzed ({allAnalyzedResults.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              
              {viewMode === "select" && (
                <>
                  <Badge variant="secondary" className="px-4 py-2 text-sm">
                    <Users className="w-4 h-4 mr-2" />
                    {selectedCandidates.size} selected
                  </Badge>
                  <Button
                    onClick={handleRunDeepSearch}
                    disabled={selectedCandidates.size === 0 || processing}
                    size="lg"
                    className="gap-2 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90"
                  >
                    {processing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Run Deep Search
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {viewMode === "select" ? (
          <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" />
                Select Candidates for Analysis
              </CardTitle>
              <CardDescription>
                Choose candidates from LinkedIn scraper or resume screener to run AI-powered deep search analysis
              </CardDescription>
              
              <div className="pt-4">
                <Input
                  placeholder="Search candidates by name, company, or role..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-md"
                />
              </div>
            </CardHeader>

            <CardContent>
              <Tabs defaultValue="linkedin" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="linkedin" className="gap-2">
                    <Users className="w-4 h-4" />
                    LinkedIn Candidates ({filteredLinkedInCandidates.length})
                  </TabsTrigger>
                  <TabsTrigger value="resume" className="gap-2">
                    <FileText className="w-4 h-4" />
                    Resume Candidates ({filteredResumeCandidates.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="linkedin" className="space-y-3">
                  {filteredLinkedInCandidates.length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No LinkedIn candidates found</p>
                    </div>
                  ) : (
                    filteredLinkedInCandidates.map((candidate) => (
                      <Card
                        key={candidate.id}
                        className={`border transition-all ${
                          selectedCandidates.has(candidate.id)
                            ? 'border-primary bg-primary/5'
                            : 'border-border/50 hover:border-primary/50'
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <Checkbox
                              checked={selectedCandidates.has(candidate.id)}
                              onCheckedChange={(checked) =>
                                handleSelectCandidate(candidate.id, checked as boolean)
                              }
                              className="mt-1"
                            />
                            
                            <div className="flex-1">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <h3 className="font-semibold text-lg">{candidate.candidate_name}</h3>
                                  <p className="text-muted-foreground text-sm">
                                    {candidate.job_title || "No title"} {candidate.company && `at ${candidate.company}`}
                                  </p>
                                </div>
                                {analyzedCandidates.has(candidate.id) && (
                                  <Badge variant="secondary" className="gap-1">
                                    <Brain className="w-3 h-3" />
                                    Analyzed
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="flex gap-2 mt-2">
                                {candidate.experience_level && (
                                  <Badge variant="outline" className="capitalize">
                                    {candidate.experience_level}
                                  </Badge>
                                )}
                                {candidate.linkedin_url && (
                                  <Badge variant="outline">LinkedIn Profile</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="resume" className="space-y-3">
                  {filteredResumeCandidates.length === 0 ? (
                    <div className="text-center py-12">
                      <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No resume candidates found</p>
                    </div>
                  ) : (
                    filteredResumeCandidates.map((candidate) => (
                      <Card
                        key={candidate.id}
                        className={`border transition-all ${
                          selectedCandidates.has(candidate.id)
                            ? 'border-primary bg-primary/5'
                            : 'border-border/50 hover:border-primary/50'
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <Checkbox
                              checked={selectedCandidates.has(candidate.id)}
                              onCheckedChange={(checked) =>
                                handleSelectCandidate(candidate.id, checked as boolean)
                              }
                              className="mt-1"
                            />
                            
                            <div className="flex-1">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <h3 className="font-semibold text-lg">{candidate.candidate_name}</h3>
                                  <p className="text-muted-foreground text-sm">
                                    {candidate.recruitment_name || "General recruitment"}
                                  </p>
                                </div>
                                {analyzedCandidates.has(candidate.id) && (
                                  <Badge variant="secondary" className="gap-1">
                                    <Brain className="w-3 h-3" />
                                    Analyzed
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="flex gap-2 mt-2">
                                {candidate.fit_score && (
                                  <Badge variant="outline">
                                    Fit Score: {getFitScore(candidate.fit_score)}
                                  </Badge>
                                )}
                                {candidate.current_stage && (
                                  <Badge variant="outline" className="capitalize">
                                    {candidate.current_stage.replace(/_/g, ' ')}
                                  </Badge>
                                )}
                                {candidate.email && (
                                  <Badge variant="outline">Email Available</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
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
              allAnalyzedResults.map((result) => (
                <div key={result.id} className="space-y-4">
                  <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-primary" />
                        {result.candidate_name}
                      </CardTitle>
                      <CardDescription>
                        Analyzed on {new Date(result.created_at).toLocaleDateString()}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                  <DeepSearchResults candidateId={result.id} />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
