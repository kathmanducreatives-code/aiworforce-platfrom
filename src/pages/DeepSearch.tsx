import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Brain, Loader2, Users, FileText, Search, Sparkles, TrendingUp, 
  CheckCircle2, Filter, ArrowLeft, Target, X, Keyboard, SortAsc,
  ChevronDown, LayoutGrid, List
} from "lucide-react";
import { deepSearchApi } from "@/services/deepSearchApi";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CandidateCard } from "@/components/lead-scraper/CandidateCard";
import { AnalyzedCandidateCard } from "@/components/lead-scraper/AnalyzedCandidateCard";
import { SavedSearches } from "@/components/lead-scraper/SavedSearches";
import PremiumBackground from "@/components/landing/PremiumBackground";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LinkedInCandidate {
  id: string;
  candidate_name: string;
  job_title: string | null;
  company: string | null;
  linkedin_url: string | null;
  experience_level: string | null;
  session_id: string | null;
}

interface ResumeCandidate {
  id: string;
  candidate_name: string;
  email: string | null;
  recruitment_name: string | null;
  fit_score: any;
  current_stage: string | null;
}

type SortOption = 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc' | 'score-desc' | 'score-asc';

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [evaluationPrompt, setEvaluationPrompt] = useState("");
  const [analyzedSortBy, setAnalyzedSortBy] = useState<SortOption>('date-desc');
  const [showKeyboardHints, setShowKeyboardHints] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const lastAnalysisToastTime = useRef(0);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A to select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && viewMode === 'select') {
        e.preventDefault();
        const allIds = new Set([
          ...(activeTab === 'linkedin' ? filteredLinkedInCandidates : filteredResumeCandidates).map(c => c.id)
        ]);
        setSelectedCandidates(allIds);
        toast({ title: `Selected ${allIds.size} candidates` });
      }
      // Ctrl/Cmd + F to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Ctrl/Cmd + Enter to run deep search
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && selectedCandidates.size > 0) {
        e.preventDefault();
        openPromptDialog();
      }
      // Escape to clear selection
      if (e.key === 'Escape' && selectedCandidates.size > 0) {
        setSelectedCandidates(new Set());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, activeTab, selectedCandidates.size]);

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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'linkedin_leads',
        },
        () => {
          fetchCandidates();
          setRefreshTrigger((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleAnalysisUpdate]);

  const fetchCandidates = async (sessionId?: string | null) => {
    try {
      setLoading(true);
      
      let linkedInQuery = supabase
        .from('linkedin_leads')
        .select('id, candidate_name, job_title, company, linkedin_url, experience_level, session_id')
        .order('scraped_at', { ascending: false });

      if (sessionId) {
        linkedInQuery = linkedInQuery.eq('session_id', sessionId);
        
        const { data: sessionData } = await supabase
          .from("scraping_sessions")
          .select("name, search_criteria")
          .eq("id", sessionId)
          .maybeSingle();
        
        if (sessionData) {
          setActiveSessionName(
            sessionData.name || 
            (sessionData.search_criteria as any)?.searchQuery || 
            "Untitled Search"
          );
        }
      } else {
        setActiveSessionName(null);
      }

      const { data: linkedInData, error: linkedInError } = await linkedInQuery;

      if (linkedInError) throw linkedInError;
      setLinkedInCandidates(linkedInData || []);
      setActiveSessionId(sessionId || null);

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

  const openPromptDialog = useCallback(() => {
    if (selectedCandidates.size === 0) {
      toast({
        title: "No candidates selected",
        description: "Please select at least one candidate to analyze",
        variant: "destructive",
      });
      return;
    }
    setShowPromptDialog(true);
  }, [selectedCandidates.size, toast]);

  const handleRunDeepSearch = useCallback(async () => {
    try {
      setProcessing(true);
      setShowPromptDialog(false);
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
          evaluationPrompt: evaluationPrompt.trim() || undefined,
        });
      }

      toast({
        title: "Deep Search Initiated",
        description: `AI analysis started for ${selectedCandidates.size} candidate(s). Results will appear shortly.`,
      });

      setShowResults(true);
      setViewMode("analyzed");
      setSelectedCandidates(new Set());
      setEvaluationPrompt("");
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
  }, [selectedCandidates, linkedInCandidates, resumeCandidates, evaluationPrompt, toast]);

  // Memoized filtered candidates
  const filteredLinkedInCandidates = useMemo(() => 
    linkedInCandidates.filter(c =>
      c.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.job_title?.toLowerCase().includes(searchTerm.toLowerCase())
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

  // Sorted analyzed results
  const sortedAnalyzedResults = useMemo(() => {
    const results = [...allAnalyzedResults];
    switch (analyzedSortBy) {
      case 'name-asc':
        return results.sort((a, b) => a.candidate_name.localeCompare(b.candidate_name));
      case 'name-desc':
        return results.sort((a, b) => b.candidate_name.localeCompare(a.candidate_name));
      case 'date-asc':
        return results.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'date-desc':
        return results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case 'score-desc':
        return results.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
      case 'score-asc':
        return results.sort((a, b) => (a.fit_score || 0) - (b.fit_score || 0));
      default:
        return results;
    }
  }, [allAnalyzedResults, analyzedSortBy]);

  const getFitScore = useCallback((fitScore: any): number => {
    if (typeof fitScore === 'number') return fitScore;
    if (typeof fitScore === 'object' && fitScore?.score) return fitScore.score;
    return 0;
  }, []);

  const currentCandidates = activeTab === 'linkedin' ? filteredLinkedInCandidates : filteredResumeCandidates;
  const estimatedTime = Math.ceil(selectedCandidates.size * 0.5);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-label="Loading candidates">
        <div className="text-center space-y-4">
          <div className="relative">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div className="absolute inset-0 h-12 w-12 mx-auto rounded-full bg-primary/20 animate-ping" />
          </div>
          <p className="text-muted-foreground animate-pulse">Loading candidates...</p>
        </div>
      </div>
    );
  }

  const totalCandidates = linkedInCandidates.length + resumeCandidates.length;
  const totalAnalyzed = allAnalyzedResults.length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background relative overflow-hidden">
        <PremiumBackground />

        {/* Compact Header */}
        <header className="border-b border-border/50 bg-card/30 backdrop-blur-lg sticky top-0 z-10 shadow-sm">
          <div className="container mx-auto px-4 py-4">
            {/* Top row */}
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate("/dashboard")}
                      className="hover:bg-primary/10"
                      aria-label="Go back to dashboard"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Back to Dashboard</TooltipContent>
                </Tooltip>
                
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center shadow-lg shadow-primary/20">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-cyan-500 to-primary bg-clip-text text-transparent">
                    Deep Search AI
                  </h1>
                  <p className="text-muted-foreground text-xs">
                    Advanced candidate intelligence
                  </p>
                </div>
              </div>

              {/* Compact Stats */}
              <div className="hidden md:flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/50 border border-border/50">
                  <Users className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">{totalCandidates}</span>
                  <span className="text-xs text-muted-foreground">candidates</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/50 border border-border/50">
                  <CheckCircle2 className="w-4 h-4 text-cyan-500" />
                  <span className="text-sm font-medium">{selectedCandidates.size}</span>
                  <span className="text-xs text-muted-foreground">selected</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/50 border border-border/50">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium">{totalAnalyzed}</span>
                  <span className="text-xs text-muted-foreground">analyzed</span>
                </div>
                
                {/* Keyboard shortcuts hint */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setShowKeyboardHints(!showKeyboardHints)}
                      aria-label="Show keyboard shortcuts"
                    >
                      <Keyboard className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                      <p><kbd className="px-1 bg-muted rounded">Ctrl+A</kbd> Select all</p>
                      <p><kbd className="px-1 bg-muted rounded">Ctrl+F</kbd> Focus search</p>
                      <p><kbd className="px-1 bg-muted rounded">Ctrl+Enter</kbd> Run deep search</p>
                      <p><kbd className="px-1 bg-muted rounded">Esc</kbd> Clear selection</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* View Toggle */}
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-10">
                <TabsTrigger value="select" className="gap-2 text-sm">
                  <Filter className="w-4 h-4" />
                  Select Candidates
                  {selectedCandidates.size > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                      {selectedCandidates.size}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="analyzed" className="gap-2 text-sm">
                  <Brain className="w-4 h-4" />
                  Analyzed Results
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {totalAnalyzed}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </header>

        <main className="container mx-auto px-4 py-6 relative">
          {viewMode === "select" ? (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Left Sidebar - Saved Searches */}
              <aside className="lg:col-span-1" aria-label="Saved searches">
                <SavedSearches
                  activeSessionId={activeSessionId}
                  onSessionSelect={fetchCandidates}
                  refreshTrigger={refreshTrigger}
                />
              </aside>

              {/* Main Content */}
              <div className="lg:col-span-3 space-y-4">
                {/* Search and Filter Bar */}
                <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-3">
                    <div className="flex flex-col md:flex-row gap-3">
                      <div className="flex-1">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            ref={searchInputRef}
                            placeholder="Search by name, company, role..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 h-9"
                            aria-label="Search candidates"
                          />
                          {searchTerm && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                              onClick={() => setSearchTerm("")}
                              aria-label="Clear search"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const allIds = new Set(currentCandidates.map(c => c.id));
                            setSelectedCandidates(allIds);
                          }}
                          className="h-9"
                        >
                          Select All ({currentCandidates.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedCandidates(new Set())}
                          disabled={selectedCandidates.size === 0}
                          className="h-9"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    
                    {/* Active filters */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {activeSessionName && (
                        <Badge variant="secondary" className="gap-1 pr-1">
                          <span>Folder: {activeSessionName}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 ml-1 hover:bg-transparent"
                            onClick={() => fetchCandidates(null)}
                            aria-label="Clear folder filter"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </Badge>
                      )}
                      {searchTerm && (
                        <Badge variant="outline" className="text-xs">
                          {currentCandidates.length} results for "{searchTerm}"
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Source Tabs */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-4 h-9">
                    <TabsTrigger value="linkedin" className="gap-2 text-sm">
                      <Users className="w-4 h-4" />
                      LinkedIn ({filteredLinkedInCandidates.length})
                    </TabsTrigger>
                    <TabsTrigger value="resume" className="gap-2 text-sm">
                      <FileText className="w-4 h-4" />
                      Resume ({filteredResumeCandidates.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="linkedin" className="space-y-0 mt-0">
                    {filteredLinkedInCandidates.length === 0 ? (
                      <Card className="border-dashed border-2 bg-card/30 backdrop-blur-sm">
                        <CardContent className="text-center py-12">
                          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                            <Users className="w-8 h-8 text-muted-foreground/50" />
                          </div>
                          <h3 className="text-lg font-semibold mb-2">No LinkedIn Candidates</h3>
                          <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
                            {searchTerm 
                              ? "No candidates match your search. Try adjusting your filters."
                              : activeSessionName 
                                ? "No candidates in this search folder."
                                : "Import candidates from LinkedIn to get started."}
                          </p>
                          {!searchTerm && !activeSessionName && (
                            <Button 
                              variant="outline" 
                              onClick={() => navigate("/lead-scraper")}
                              className="gap-2"
                            >
                              <Users className="w-4 h-4" />
                              Go to Lead Scraper
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      <div 
                        className="grid md:grid-cols-2 xl:grid-cols-3 gap-3"
                        role="list"
                        aria-label="LinkedIn candidates"
                      >
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

                  <TabsContent value="resume" className="space-y-0 mt-0">
                    {filteredResumeCandidates.length === 0 ? (
                      <Card className="border-dashed border-2 bg-card/30 backdrop-blur-sm">
                        <CardContent className="text-center py-12">
                          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                            <FileText className="w-8 h-8 text-muted-foreground/50" />
                          </div>
                          <h3 className="text-lg font-semibold mb-2">No Resume Candidates</h3>
                          <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
                            {searchTerm 
                              ? "No candidates match your search. Try adjusting your filters."
                              : "Upload resumes to start screening candidates."}
                          </p>
                          {!searchTerm && (
                            <Button 
                              variant="outline" 
                              onClick={() => navigate("/candidates")}
                              className="gap-2"
                            >
                              <FileText className="w-4 h-4" />
                              Upload Resumes
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      <div 
                        className="grid md:grid-cols-2 xl:grid-cols-3 gap-3"
                        role="list"
                        aria-label="Resume candidates"
                      >
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
            </div>
          ) : (
            <div className="space-y-4">
              {allAnalyzedResults.length === 0 ? (
                <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                  <CardContent className="py-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Brain className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">No Analyzed Candidates Yet</h3>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
                      Select candidates and run deep search to see AI-powered insights
                    </p>
                    <Button 
                      variant="outline" 
                      onClick={() => setViewMode("select")}
                      className="gap-2"
                    >
                      <Users className="w-4 h-4" />
                      Select Candidates
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Results Header with Sort */}
                   <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <Brain className="w-5 h-5 text-primary" />
                        Analysis Results
                      </h2>
                      <Badge variant="secondary" className="px-3">
                        {allAnalyzedResults.length} analyzed
                      </Badge>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Select value={analyzedSortBy} onValueChange={(v) => setAnalyzedSortBy(v as SortOption)}>
                        <SelectTrigger className="w-[160px] h-9">
                          <SortAsc className="w-4 h-4 mr-2" />
                          <SelectValue placeholder="Sort by" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="date-desc">Newest First</SelectItem>
                          <SelectItem value="date-asc">Oldest First</SelectItem>
                          <SelectItem value="score-desc">Highest Score</SelectItem>
                          <SelectItem value="score-asc">Lowest Score</SelectItem>
                          <SelectItem value="name-asc">Name A-Z</SelectItem>
                          <SelectItem value="name-desc">Name Z-A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div 
                    className="grid md:grid-cols-2 lg:grid-cols-3 gap-4"
                    role="list"
                    aria-label="Analyzed candidates"
                  >
                    {sortedAnalyzedResults.map((result) => (
                      <AnalyzedCandidateCard
                        key={result.id}
                        {...result}
                        onDeleted={fetchAnalyzedResults}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Floating Action Panel */}
          {viewMode === "select" && selectedCandidates.size > 0 && (
            <div 
              className="fixed bottom-0 left-0 right-0 z-20 animate-slide-in-bottom"
              role="region"
              aria-label="Selection actions"
            >
              <div className="container mx-auto px-4 py-3">
                <Card className="border-2 border-primary shadow-2xl shadow-primary/25 bg-card/95 backdrop-blur-lg">
                  <CardContent className="p-3">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-semibold">
                            {selectedCandidates.size} Candidate{selectedCandidates.size !== 1 ? 's' : ''} Selected
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Est. {estimatedTime} min{estimatedTime !== 1 ? 's' : ''} to analyze
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCandidates(new Set())}
                          className="hidden sm:flex"
                        >
                          Clear
                        </Button>
                        <Button
                          onClick={openPromptDialog}
                          disabled={processing}
                          className="gap-2 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 shadow-lg shadow-primary/25"
                        >
                          {processing ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span className="hidden sm:inline">Analyzing...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              <span className="hidden sm:inline">Run Deep Search</span>
                              <span className="sm:hidden">Analyze</span>
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

          {/* Evaluation Prompt Dialog */}
          <Dialog open={showPromptDialog} onOpenChange={setShowPromptDialog}>
            <DialogContent className="sm:max-w-[550px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  Customize Your Search
                </DialogTitle>
                <DialogDescription className="text-sm pt-2">
                  What specific skills or qualities are you looking for in these {selectedCandidates.size} candidate{selectedCandidates.size !== 1 ? 's' : ''}?
                </DialogDescription>
              </DialogHeader>
              
              <div className="py-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="evaluation-prompt" className="text-sm font-medium">
                      Evaluation Criteria
                    </Label>
                    <span className="text-xs text-muted-foreground">Optional</span>
                  </div>
                  <Textarea
                    id="evaluation-prompt"
                    placeholder="e.g., Looking for strong leadership experience, expertise in React and Node.js, experience with agile methodologies..."
                    value={evaluationPrompt}
                    onChange={(e) => setEvaluationPrompt(e.target.value)}
                    className="min-h-[100px] resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    This helps our AI focus on what matters most to you.
                  </p>
                </div>

                {/* Quick Suggestions */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Quick suggestions:</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      "Leadership skills",
                      "Technical expertise",
                      "Startup experience",
                      "Team management",
                      "Problem solving",
                      "Communication skills",
                      "Remote work experience"
                    ].map((suggestion) => (
                      <Button
                        key={suggestion}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs hover:bg-primary/10 hover:border-primary/30"
                        onClick={() => setEvaluationPrompt(prev => 
                          prev ? `${prev}, ${suggestion.toLowerCase()}` : suggestion
                        )}
                      >
                        + {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Estimated time */}
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                  <Brain className="w-4 h-4 text-primary" />
                  <span className="text-sm text-muted-foreground">
                    Estimated analysis time: ~{estimatedTime} minute{estimatedTime !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setShowPromptDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRunDeepSearch}
                  disabled={processing}
                  className="gap-2 bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Brain className="w-4 h-4" />
                      Start Deep Search
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </TooltipProvider>
  );
}
