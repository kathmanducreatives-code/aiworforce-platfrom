import React, { useRef, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Folder, FileText, Target, ShieldAlert, Trophy, CheckCircle, AlertTriangle, Brain, TrendingUp, ChevronDown, Eye, Mail, X, BarChart3 } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { ResumeAnalysis, CandidateStatus, TimelineEvent, CandidateNote } from "@/types/ResumeAnalysis";

interface CandidateAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: ResumeAnalysis | null;
}

export const CandidateAnalysisDialog = ({ open, onOpenChange, candidate }: CandidateAnalysisDialogProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const lastScrollTop = useRef(0);
  const [strengthsOpen, setStrengthsOpen] = useState(true);
  const [weaknessesOpen, setWeaknessesOpen] = useState(true);
  const { toast } = useToast();
  
  // Status tracking
  const [currentStatus, setCurrentStatus] = useState<CandidateStatus>('new');
  
  // Timeline & Notes
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [notes, setNotes] = useState<CandidateNote[]>([]);
  const [newNote, setNewNote] = useState("");
  
  // Comparison data
  const [comparisonData, setComparisonData] = useState({
    avgFitScore: 0,
    avgOverallScore: 0,
    percentileRank: 0,
    totalCandidates: 0,
    higherScoringCount: 0,
    folderAvgScore: 0
  });

  // Status config helper
  const getStatusConfig = (status: CandidateStatus) => {
    const configs = {
      new: { label: 'New', color: 'bg-blue-100 text-blue-700 border-blue-300', icon: <FileText className="h-3 w-3" /> },
      reviewing: { label: 'Reviewing', color: 'bg-purple-100 text-purple-700 border-purple-300', icon: <Eye className="h-3 w-3" /> },
      contacted: { label: 'Contacted', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: <Mail className="h-3 w-3" /> },
      interview_scheduled: { label: 'Interview Scheduled', color: 'bg-indigo-100 text-indigo-700 border-indigo-300', icon: <Calendar className="h-3 w-3" /> },
      interviewed: { label: 'Interviewed', color: 'bg-teal-100 text-teal-700 border-teal-300', icon: <CheckCircle className="h-3 w-3" /> },
      offer_extended: { label: 'Offer Extended', color: 'bg-green-100 text-green-700 border-green-300', icon: <Trophy className="h-3 w-3" /> },
      hired: { label: 'Hired', color: 'bg-emerald-100 text-emerald-700 border-emerald-300', icon: <CheckCircle className="h-3 w-3" /> },
      rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700 border-red-300', icon: <X className="h-3 w-3" /> }
    };
    return configs[status] || configs.new;
  };

  // Fetch comparison data
  useEffect(() => {
    if (!candidate?.id || !open) return;
    
    const fetchComparisonData = async () => {
      try {
        const { data: allCandidates, error } = await supabase
          .from('resume_analyses')
          .select('fit_score, overall_factor, recruitment_name');
        
        if (error) throw error;
        
        const totalCount = allCandidates.length;
        const avgFit = allCandidates.reduce((sum, c) => {
          const fitScore = typeof c.fit_score === 'object' ? (c.fit_score as any)?.score || 0 : c.fit_score || 0;
          return sum + fitScore;
        }, 0) / totalCount;
        
        const avgOverall = allCandidates.reduce((sum, c) => {
          const overallScore = typeof c.overall_factor === 'object' ? (c.overall_factor as any)?.score || 0 : c.overall_factor || 0;
          return sum + overallScore;
        }, 0) / totalCount;
        
        const higherScoring = allCandidates.filter(c => {
          const score = typeof c.overall_factor === 'object' ? (c.overall_factor as any)?.score || 0 : c.overall_factor || 0;
          return score > (candidate.overallScore || 0);
        }).length;
        
        const percentile = Math.round((1 - higherScoring / totalCount) * 100);
        
        let folderAvg = 0;
        if (candidate.recruitmentName) {
          const folderCandidates = allCandidates.filter(c => c.recruitment_name === candidate.recruitmentName);
          folderAvg = folderCandidates.reduce((sum, c) => {
            const score = typeof c.overall_factor === 'object' ? (c.overall_factor as any)?.score || 0 : c.overall_factor || 0;
            return sum + score;
          }, 0) / (folderCandidates.length || 1);
        }
        
        setComparisonData({
          avgFitScore: Math.round(avgFit * 10) / 10,
          avgOverallScore: Math.round(avgOverall * 10) / 10,
          percentileRank: percentile,
          totalCandidates: totalCount,
          higherScoringCount: higherScoring,
          folderAvgScore: Math.round(folderAvg * 10) / 10
        });
      } catch (error) {
        console.error('Error fetching comparison data:', error);
      }
    };
    
    fetchComparisonData();
  }, [candidate, open]);

  // Fetch timeline and notes
  useEffect(() => {
    if (!candidate?.id || !open) return;
    
    const events: TimelineEvent[] = [];
    
    if (candidate.date) {
      events.push({
        id: '1',
        type: 'resume_uploaded',
        title: 'Resume Submitted',
        description: 'Candidate uploaded their resume for review',
        timestamp: candidate.date
      });
      
      events.push({
        id: '2',
        type: 'analysis_completed',
        title: 'AI Analysis Completed',
        description: `Overall score: ${candidate.overallScore}/10`,
        timestamp: candidate.date
      });
    }
    
    if (candidate.status && candidate.statusUpdatedAt) {
      events.push({
        id: `status-${candidate.status}`,
        type: 'status_change',
        title: 'Status Updated',
        description: `Changed to ${getStatusConfig(candidate.status).label}`,
        timestamp: candidate.statusUpdatedAt
      });
    }
    
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setTimeline(events);
    
    fetchNotes();
  }, [candidate, open]);

  const fetchNotes = async () => {
    if (!candidate?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('candidate_notes')
        .select('*')
        .eq('candidate_id', candidate.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setNotes(data || []);
    } catch (error) {
      console.error('Error fetching notes:', error);
    }
  };

  const handleStatusChange = async (newStatus: CandidateStatus) => {
    if (!candidate?.id) return;
    
    try {
      const { error } = await supabase
        .from('resume_analyses')
        .update({ 
          status: newStatus,
          status_updated_at: new Date().toISOString()
        })
        .eq('id', candidate.id);
      
      if (error) throw error;
      
      setCurrentStatus(newStatus);
      toast({
        title: "Status Updated",
        description: `Candidate status changed to ${getStatusConfig(newStatus).label}`,
        className: "bg-emerald-50 border-emerald-200"
      });
    } catch (error) {
      toast({
        title: "Update Failed",
        description: "Failed to update status. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !candidate?.id) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('candidate_notes')
        .insert({
          candidate_id: candidate.id,
          content: newNote.trim(),
          created_by: user?.id,
          created_by_name: user?.email?.split('@')[0] || 'Team Member'
        })
        .select()
        .single();
      
      if (error) throw error;
      
      setNotes([data, ...notes]);
      setNewNote("");
      
      toast({
        title: "Note Added",
        description: "Your comment has been saved successfully.",
        className: "bg-emerald-50 border-emerald-200"
      });
    } catch (error) {
      toast({
        title: "Failed to Add Note",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      const scrollTop = scrollElement.scrollTop;
      const scrollDelta = scrollTop - lastScrollTop.current;
      
      // Only trigger changes if there's meaningful scroll movement (at least 10px)
      if (Math.abs(scrollDelta) < 10) {
        return;
      }
      
      const scrollingDown = scrollDelta > 0;
      setIsScrollingDown(scrollingDown);
      
      // Show header when at top (within 80px) or scrolling up
      // Hide header when scrolling down and past threshold
      if (scrollTop < 80) {
        setShowHeader(true);
      } else if (scrollingDown) {
        setShowHeader(false);
      } else {
        setShowHeader(true);
      }
      
      lastScrollTop.current = scrollTop;
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, []);
  
  useEffect(() => {
    if (candidate?.status) {
      setCurrentStatus(candidate.status);
    }
  }, [candidate]);

  if (!candidate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-none w-screen h-screen p-0 gap-0 flex flex-col bg-background overflow-hidden m-0 rounded-none">
        {/* Collapsing Header with Mini Mode */}
        <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-sm">
          <DialogHeader className={`px-8 lg:px-16 xl:px-24 transition-all duration-300 ${showHeader ? 'py-8' : 'py-3'} relative`}>
            {/* Close Button - Top Right */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="absolute top-4 right-4 h-10 w-10 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors z-50"
            >
              <X className="h-5 w-5" />
            </Button>

            <div className="flex items-center justify-between gap-8 pr-12">
              {/* Mini Mode - Always visible */}
              <div className="flex items-center gap-6 min-w-0">
                <DialogTitle className={`font-semibold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent tracking-tight transition-all duration-300 truncate ${showHeader ? 'text-2xl' : 'text-lg'}`}>
                  {candidate.candidateName}
                </DialogTitle>
                {!showHeader && candidate.overallScore !== undefined && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-gradient-to-br from-cyan-50 to-teal-50 dark:from-cyan-950/30 dark:to-teal-950/30 rounded-full border border-cyan-200 dark:border-cyan-800 transition-opacity duration-300">
                    <span className="text-sm font-medium text-muted-foreground">Score:</span>
                    <span className="text-lg font-semibold bg-gradient-to-br from-cyan-600 to-teal-600 bg-clip-text text-transparent">
                      {candidate.overallScore}/10
                    </span>
                  </div>
                )}
              </div>

              {/* Full Header Content - Hidden in mini mode */}
              <div className={`flex-1 transition-all duration-300 ${showHeader ? 'opacity-100 max-h-[500px]' : 'opacity-0 max-h-0 overflow-hidden'}`}>
                <div className="flex items-start justify-between gap-8">
                  {/* Candidate Info */}
                  <div className="flex-1 space-y-6">
                    <div className="space-y-2">
                      <DialogDescription className="text-base text-muted-foreground flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                        {candidate.email}
                      </DialogDescription>
                    </div>
                    
                    {/* Status Selector */}
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-muted-foreground">Status:</span>
                      <Select value={currentStatus} onValueChange={(value) => handleStatusChange(value as CandidateStatus)}>
                        <SelectTrigger className={`w-[200px] ${getStatusConfig(currentStatus).color} border-2`}>
                          <div className="flex items-center gap-2">
                            {getStatusConfig(currentStatus).icon}
                            <SelectValue />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              New
                            </div>
                          </SelectItem>
                          <SelectItem value="reviewing">
                            <div className="flex items-center gap-2">
                              <Eye className="h-4 w-4" />
                              Reviewing
                            </div>
                          </SelectItem>
                          <SelectItem value="contacted">
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4" />
                              Contacted
                            </div>
                          </SelectItem>
                          <SelectItem value="interview_scheduled">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              Interview Scheduled
                            </div>
                          </SelectItem>
                          <SelectItem value="interviewed">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-4 w-4" />
                              Interviewed
                            </div>
                          </SelectItem>
                          <SelectItem value="offer_extended">
                            <div className="flex items-center gap-2">
                              <Trophy className="h-4 w-4" />
                              Offer Extended
                            </div>
                          </SelectItem>
                          <SelectItem value="hired">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-4 w-4" />
                              Hired
                            </div>
                          </SelectItem>
                          <SelectItem value="rejected">
                            <div className="flex items-center gap-2">
                              <X className="h-4 w-4" />
                              Rejected
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {candidate.date && (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>
                            {new Date(candidate.date).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric' 
                            })}
                          </span>
                        </div>
                      )}
                      
                      {candidate.recruitmentName && (
                        <div className="flex items-center gap-2">
                          <Folder className="h-4 w-4" />
                          <span>{candidate.recruitmentName}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Overall Score - Full mode */}
                  {candidate.overallScore !== undefined && (
                    <div className="flex flex-col items-end gap-1">
                      <div className="text-sm font-medium text-muted-foreground">Overall Score</div>
                      <div className="text-4xl font-semibold bg-gradient-to-br from-cyan-600 to-teal-600 bg-clip-text text-transparent">
                        {candidate.overallScore}<span className="text-xl text-muted-foreground">/10</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>
          
        {/* Scrollable Content Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/20">
          <div className="w-full h-full px-6 lg:px-12 py-8">
            <Tabs defaultValue="overview" className="w-full h-full">
              <TabsList className="inline-flex h-11 items-center justify-center rounded-lg bg-muted/30 p-1 text-muted-foreground mb-12">
                <TabsTrigger 
                  value="overview" 
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-6 py-2 text-sm font-medium transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-sm hover:bg-cyan-50"
                >
                  Overview
                </TabsTrigger>
                <TabsTrigger 
                  value="timeline" 
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-6 py-2 text-sm font-medium transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-sm hover:bg-cyan-50"
                >
                  Timeline & Notes
                </TabsTrigger>
                <TabsTrigger 
                  value="ai-insights" 
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-6 py-2 text-sm font-medium transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-sm hover:bg-cyan-50"
                >
                  AI Insights
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-12">
                {/* Score Metrics Grid */}
                <div className="grid grid-cols-3 gap-6">
                  {/* Fit Score Card */}
                  <Card className="bg-background border-cyan-300/30 hover:border-cyan-400/50 hover:shadow-lg hover:shadow-cyan-500/10 transition-all duration-300 group bg-gradient-to-br from-cyan-50/50 to-transparent animate-fade-in-up hover-lift">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-cyan-100/50 rounded-lg group-hover:bg-cyan-200/50 transition-all duration-300 group-hover:scale-110">
                          <Target className="h-5 w-5 text-cyan-600" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                          Fit Score
                        </CardTitle>
                      </div>
                      <div className="space-y-4">
                        <div className="text-4xl font-bold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent">
                          {candidate.fitScore}<span className="text-xl text-muted-foreground">/10</span>
                        </div>
                        <Progress 
                          value={(candidate.fitScore || 0) * 10} 
                          className="h-2"
                        />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {candidate.fitScore >= 8 ? 'Excellent match for the role' : 
                         candidate.fitScore >= 6 ? 'Good potential fit' : 
                         candidate.fitScore >= 4 ? 'Moderate alignment' : 'Needs consideration'}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Risk Factor Card */}
                  <Card className="bg-background border-destructive/30 hover:border-destructive/50 hover:shadow-lg hover:shadow-destructive/10 transition-all duration-300 group bg-gradient-to-br from-destructive/5 to-transparent animate-fade-in-up animate-delay-100 hover-lift">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-destructive/10 rounded-lg group-hover:bg-destructive/20 transition-all duration-300 group-hover:scale-110">
                          <ShieldAlert className="h-5 w-5 text-destructive" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse"></span>
                          Risk Factor
                        </CardTitle>
                      </div>
                      <div className="text-4xl font-bold text-destructive capitalize">
                        {candidate.riskScore || candidate.riskFactor}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground">Assessment of potential concerns</p>
                    </CardContent>
                  </Card>

                  {/* Reward Factor Card */}
                  <Card className="bg-background border-teal-300/30 hover:border-teal-400/50 hover:shadow-lg hover:shadow-teal-500/10 transition-all duration-300 group bg-gradient-to-br from-teal-50/50 to-transparent animate-fade-in-up animate-delay-200 hover-lift">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-teal-100/50 rounded-lg group-hover:bg-teal-200/50 transition-all duration-300 group-hover:scale-110">
                          <Trophy className="h-5 w-5 text-teal-600" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
                          Reward Factor
                        </CardTitle>
                      </div>
                      <div className="text-4xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent capitalize">
                        {candidate.rewardScore || candidate.rewardFactor}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground">Potential value and impact</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Comparison Chart */}
                <Card className="bg-background border-primary/30 hover:border-primary/50 transition-all duration-300 bg-gradient-to-br from-primary/5 to-transparent animate-fade-in-up animate-delay-300">
                  <CardHeader className="pb-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-primary/10 rounded-lg">
                          <BarChart3 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-lg font-semibold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            Comparative Performance
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            How this candidate compares to {comparisonData.totalCandidates} others
                          </p>
                        </div>
                      </div>
                      <Badge className="bg-primary/10 text-primary border-primary/30">
                        {comparisonData.percentileRank}th Percentile
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div className="space-y-4">
                        {/* This Candidate */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-foreground">This Candidate</span>
                            <span className="text-lg font-semibold text-primary">
                              {candidate.overallScore}/10
                            </span>
                          </div>
                          <div className="relative h-8 bg-muted rounded-full overflow-hidden">
                            <div 
                              className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-full transition-all duration-1000 flex items-center justify-end pr-3"
                              style={{ width: `${(candidate.overallScore || 0) * 10}%` }}
                            >
                              <span className="text-xs font-medium text-white">●</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Average Candidate */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-muted-foreground">Average Candidate</span>
                            <span className="text-lg font-semibold text-muted-foreground">
                              {comparisonData.avgOverallScore}/10
                            </span>
                          </div>
                          <div className="relative h-6 bg-muted rounded-full overflow-hidden">
                            <div 
                              className="absolute inset-y-0 left-0 bg-slate-400 rounded-full transition-all duration-1000"
                              style={{ width: `${comparisonData.avgOverallScore * 10}%` }}
                            />
                          </div>
                        </div>
                        
                        {/* Folder Average (if applicable) */}
                        {candidate.recruitmentName && comparisonData.folderAvgScore > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-muted-foreground">
                                Folder Average ({candidate.recruitmentName})
                              </span>
                              <span className="text-lg font-semibold text-muted-foreground">
                                {comparisonData.folderAvgScore}/10
                              </span>
                            </div>
                            <div className="relative h-6 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="absolute inset-y-0 left-0 bg-purple-400 rounded-full transition-all duration-1000"
                                style={{ width: `${comparisonData.folderAvgScore * 10}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Stats Grid */}
                      <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">
                            {comparisonData.percentileRank}th
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">Percentile Rank</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-cyan-600">
                            {comparisonData.totalCandidates - comparisonData.higherScoringCount - 1}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">Ranked Below</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-teal-600">
                            {comparisonData.higherScoringCount}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">Ranked Above</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Strengths & Weaknesses Section */}
                <div className="space-y-6">
                  {/* Strengths */}
                  {candidate.strengths?.length > 0 && (
                    <Collapsible open={strengthsOpen} onOpenChange={setStrengthsOpen}>
                      <Card className="bg-background border-cyan-300/30 hover:border-cyan-400/50 transition-all duration-300 overflow-hidden bg-gradient-to-br from-cyan-50/30 to-teal-50/30 animate-fade-in-up animate-delay-300 hover-lift">
                        <CollapsibleTrigger className="w-full">
                          <CardHeader className="cursor-pointer hover:bg-cyan-50/50 transition-colors duration-300">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="p-2.5 bg-cyan-100/50 rounded-lg group-hover:scale-110 transition-transform duration-300">
                                  <CheckCircle className="h-5 w-5 text-cyan-600" />
                                </div>
                                <div className="text-left">
                                  <CardTitle className="text-lg font-semibold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
                                    <span className="w-1 h-6 rounded-full bg-gradient-to-b from-cyan-500 to-teal-500"></span>
                                    Key Strengths
                                  </CardTitle>
                                  <p className="text-sm text-muted-foreground mt-1">Positive attributes identified</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className="text-sm px-3 py-1 border-cyan-300/50 text-cyan-700 bg-cyan-50/50">
                                  {candidate.strengths.length}
                                </Badge>
                                <ChevronDown className={`h-5 w-5 text-cyan-600 transition-transform duration-300 ${strengthsOpen ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-6 pb-8">
                            <p className="text-base text-foreground leading-relaxed">
                              {candidate.strengths.join('. ')}.
                            </p>
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  )}

                  {/* Development Areas */}
                  {candidate.weaknesses?.length > 0 && (
                    <Collapsible open={weaknessesOpen} onOpenChange={setWeaknessesOpen}>
                      <Card className="bg-background border-destructive/30 hover:border-destructive/50 transition-all duration-300 overflow-hidden bg-gradient-to-br from-destructive/5 to-transparent animate-fade-in-up animate-delay-500 hover-lift">
                        <CollapsibleTrigger className="w-full">
                          <CardHeader className="cursor-pointer hover:bg-destructive/10 transition-colors duration-300">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="p-2.5 bg-destructive/10 rounded-lg group-hover:scale-110 transition-transform duration-300">
                                  <AlertTriangle className="h-5 w-5 text-destructive" />
                                </div>
                                <div className="text-left">
                                  <CardTitle className="text-lg font-semibold text-destructive flex items-center gap-2">
                                    <span className="w-1 h-6 rounded-full bg-destructive"></span>
                                    Development Areas
                                  </CardTitle>
                                  <p className="text-sm text-muted-foreground mt-1">Growth opportunities identified</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className="text-sm px-3 py-1 border-destructive/30 text-destructive">
                                  {candidate.weaknesses.length}
                                </Badge>
                                <ChevronDown className={`h-5 w-5 text-destructive transition-transform duration-300 ${weaknessesOpen ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-6 pb-8">
                            <p className="text-base text-foreground leading-relaxed">
                              {candidate.weaknesses.join('. ')}.
                            </p>
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  )}
                </div>

                {/* Resume Access */}
                {candidate.resume && (
                  <Card className="bg-background border-cyan-300/30 hover:border-cyan-400/50 transition-all duration-300 animate-fade-in-up animate-delay-700 hover-lift">
                    <CardContent className="p-8">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2.5 bg-muted rounded-lg">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="font-semibold text-foreground text-base">Resume Document</div>
                            <p className="text-sm text-muted-foreground mt-1">Original submission for detailed review</p>
                          </div>
                        </div>
                        <Button
                          onClick={() => window.open(candidate.resume, '_blank')}
                          className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white shadow-lg hover:shadow-cyan-500/25 transition-all duration-300 relative overflow-hidden group"
                        >
                          <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-teal-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
                          <span className="relative z-10">Open Resume</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Timeline & Notes Tab */}
              <TabsContent value="timeline" className="space-y-8">
                {/* Activity Timeline */}
                <Card className="bg-background border-cyan-300/30 hover:border-cyan-400/50 transition-all duration-300">
                  <CardHeader className="pb-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-cyan-100/50 rounded-lg">
                          <Calendar className="h-5 w-5 text-cyan-600" />
                        </div>
                        <div>
                          <CardTitle className="text-lg font-semibold text-foreground">
                            Activity Timeline
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            Complete candidate journey and interactions
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-sm">
                        {timeline.length} events
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px] pr-4">
                      <div className="space-y-4">
                        {timeline.map((event, index) => (
                          <div key={event.id} className="flex gap-4 relative">
                            {/* Timeline connector line */}
                            {index !== timeline.length - 1 && (
                              <div className="absolute left-[19px] top-10 w-0.5 h-[calc(100%+16px)] bg-gradient-to-b from-cyan-300 to-transparent" />
                            )}
                            
                            {/* Event icon */}
                            <div className={`
                              flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center z-10
                              ${event.type === 'status_change' ? 'bg-blue-100 text-blue-600' : ''}
                              ${event.type === 'note_added' ? 'bg-purple-100 text-purple-600' : ''}
                              ${event.type === 'email_sent' ? 'bg-green-100 text-green-600' : ''}
                              ${event.type === 'resume_uploaded' ? 'bg-cyan-100 text-cyan-600' : ''}
                              ${event.type === 'analysis_completed' ? 'bg-teal-100 text-teal-600' : ''}
                            `}>
                              {event.type === 'status_change' && <Target className="h-5 w-5" />}
                              {event.type === 'note_added' && <FileText className="h-5 w-5" />}
                              {event.type === 'email_sent' && <Mail className="h-5 w-5" />}
                              {event.type === 'resume_uploaded' && <FileText className="h-5 w-5" />}
                              {event.type === 'analysis_completed' && <Brain className="h-5 w-5" />}
                            </div>
                            
                            {/* Event content */}
                            <div className="flex-1 pb-6">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <h4 className="text-base font-semibold text-foreground mb-1">
                                    {event.title}
                                  </h4>
                                  <p className="text-sm text-muted-foreground mb-2">
                                    {event.description}
                                  </p>
                                  {event.userName && (
                                    <p className="text-xs text-muted-foreground">
                                      by {event.userName}
                                    </p>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
                
                {/* Notes & Comments Section */}
                <Card className="bg-background border-purple-300/30 hover:border-purple-400/50 transition-all duration-300">
                  <CardHeader className="pb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-purple-100/50 rounded-lg">
                        <FileText className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-foreground">
                          Team Notes & Comments
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          Collaborative feedback and observations
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Existing Notes */}
                    <ScrollArea className="max-h-[300px]">
                      <div className="space-y-4">
                        {notes.map((note) => (
                          <div 
                            key={note.id} 
                            className="border-l-4 border-purple-400 bg-purple-50/50 dark:bg-purple-950/20 p-4 rounded-r-lg hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-purple-200 dark:bg-purple-800 flex items-center justify-center text-sm font-semibold text-purple-700 dark:text-purple-200">
                                  {note.created_by_name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-foreground">
                                    {note.created_by_name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-foreground leading-relaxed">
                              {note.content}
                            </p>
                          </div>
                        ))}
                        
                        {notes.length === 0 && (
                          <div className="text-center py-8">
                            <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">
                              No notes yet. Add the first comment below.
                            </p>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                    
                    {/* Add New Note */}
                    <div className="space-y-4 pt-6 border-t border-purple-200 dark:border-purple-800">
                      <Label htmlFor="new-note" className="text-base font-semibold text-foreground">
                        Add a note
                      </Label>
                      <Textarea
                        id="new-note"
                        placeholder="Share your thoughts about this candidate..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        className="min-h-[120px] resize-none border-purple-200 dark:border-purple-800 focus:border-purple-400 dark:focus:border-purple-600 focus:ring-purple-400 dark:focus:ring-purple-600"
                      />
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-xs text-muted-foreground flex-1">
                          Notes are visible to all team members
                        </p>
                        <Button 
                          onClick={handleAddNote}
                          disabled={!newNote.trim()}
                          className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed px-6"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Add Note
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* AI Insights Tab */}
              <TabsContent value="ai-insights" className="space-y-12">
                {/* AI Analysis */}
                {candidate.justification && (
                  <Card className="bg-background border-accent/30 hover:border-accent/50 transition-all duration-300 relative overflow-hidden bg-gradient-to-br from-accent/5 via-primary/5 to-transparent">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-accent/10 rounded-full blur-3xl"></div>
                    <div className="absolute bottom-0 left-0 w-40 h-40 bg-primary/10 rounded-full blur-3xl"></div>
                    <CardHeader className="pb-6 relative">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-accent/20 to-primary/20 rounded-lg">
                          <Brain className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                          <CardTitle className="text-lg font-semibold bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent flex items-center gap-2">
                            <span className="w-1 h-6 rounded-full bg-gradient-to-b from-accent to-primary"></span>
                            AI-Powered Analysis
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            Comprehensive evaluation and intelligent recommendations
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="relative">
                      <div className="p-6 bg-gradient-to-br from-accent/5 to-primary/5 rounded-lg border border-accent/20">
                        <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap">
                          {candidate.justification}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* AI Summary Cards */}
                <div className="grid grid-cols-3 gap-6">
                  <Card className="bg-background border-accent/30 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10 transition-all duration-300 bg-gradient-to-br from-accent/5 to-transparent">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-accent/10 rounded-lg">
                          <CheckCircle className="h-5 w-5 text-accent" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                          Strengths
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-5xl font-semibold text-accent mb-2">
                        {candidate.strengths?.length || 0}
                      </div>
                      <p className="text-sm text-muted-foreground">Key strengths identified</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-background border-destructive/30 hover:border-destructive/50 hover:shadow-lg hover:shadow-destructive/10 transition-all duration-300 bg-gradient-to-br from-destructive/5 to-transparent">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-destructive/10 rounded-lg">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-destructive"></span>
                          Growth Areas
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-5xl font-semibold text-destructive mb-2">
                        {candidate.weaknesses?.length || 0}
                      </div>
                      <p className="text-sm text-muted-foreground">Areas for development</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-background border-primary/30 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300 bg-gradient-to-br from-primary/5 to-transparent">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-primary/10 rounded-lg">
                          <TrendingUp className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                          Overall Score
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-5xl font-semibold text-primary mb-2">
                        {candidate.overallScore}<span className="text-2xl text-muted-foreground">/10</span>
                      </div>
                      <p className="text-sm text-muted-foreground">Comprehensive rating</p>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
