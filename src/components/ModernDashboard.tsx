import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";
import { CandidateAnalysisDialog } from "@/components/CandidateAnalysisDialog";

// Function to generate consistent colors for recruitment names with teal theme
const getRecruitmentTagColor = (recruitmentName: string): string => {
  if (!recruitmentName) return "bg-muted/30 text-muted-foreground border border-border/50";

  // All tags use teal theme with varying opacity for consistency
  const colors = [
    "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20",
    "bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25",
    "bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20",
    "bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30",
  ];
  
  // Simple hash function to generate consistent color based on string
  let hash = 0;
  for (let i = 0; i < recruitmentName.length; i++) {
    hash = recruitmentName.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
};
import { Search, FileText, TrendingUp, Users, CheckCircle, AlertTriangle, RefreshCw, Filter, MoreVertical, Eye, Download, Trash2, X, Mail, Calendar, ArrowUpRight, Folder, ChevronRight, ShieldAlert, ShieldCheck, Target, Trophy, Brain, BarChart3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
const ModernDashboard = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [resumeData, setResumeData] = useState<ResumeAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCandidate, setSelectedCandidate] = useState<ResumeAnalysis | null>(null);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [selectedCandidateFullView, setSelectedCandidateFullView] = useState<ResumeAnalysis | null>(null);
  const [isFullViewDialogOpen, setIsFullViewDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'folders'>('all');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [filters, setFilters] = useState({
    scoreRange: 'all',
    rewardFactor: 'all',
    dateRange: 'all'
  });
  const {
    toast
  } = useToast();
  const itemsPerPage = 10;
  const handleDeleteCandidate = useCallback(async (candidateId: string) => {
    try {
      const {
        error
      } = await supabase.from('resume_analyses').delete().eq('id', candidateId);
      if (error) {
        console.error('Error deleting candidate:', error);
        toast({
          title: 'Delete Failed',
          description: 'Failed to delete candidate. Please try again.',
          variant: 'destructive'
        });
        return;
      }

      // Remove from local state
      setResumeData(prev => prev.filter(resume => resume.id !== candidateId));
      toast({
        title: 'Candidate Deleted',
        description: 'Candidate has been successfully removed.'
      });
    } catch (error) {
      console.error('Error deleting candidate:', error);
      toast({
        title: 'Delete Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive'
      });
    }
  }, [toast]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedCandidates.size === 0) return;

    try {
      const candidateIds = Array.from(selectedCandidates);
      const { error } = await supabase
        .from('resume_analyses')
        .delete()
        .in('id', candidateIds);

      if (error) {
        console.error('Error deleting candidates:', error);
        toast({
          title: 'Bulk Delete Failed',
          description: 'Failed to delete selected candidates. Please try again.',
          variant: 'destructive'
        });
        return;
      }

      // Remove from local state
      setResumeData(prev => prev.filter(resume => !selectedCandidates.has(resume.id!)));
      setSelectedCandidates(new Set());
      
      toast({
        title: 'Candidates Deleted',
        description: `Successfully removed ${candidateIds.length} candidate${candidateIds.length > 1 ? 's' : ''}.`
      });
    } catch (error) {
      console.error('Error deleting candidates:', error);
      toast({
        title: 'Bulk Delete Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive'
      });
    }
  }, [selectedCandidates, toast]);

  const handleAddToEmailSequence = useCallback(() => {
    if (selectedCandidates.size === 0) return;
    setIsFolderDialogOpen(true);
  }, [selectedCandidates]);

  const handleFolderNameSubmit = useCallback(async () => {
    if (!newFolderName.trim()) {
      toast({
        title: 'Folder Name Required',
        description: 'Please enter a folder name for the selected candidates.',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Update the recruitment_name for all selected candidates
      const candidateIds = Array.from(selectedCandidates);
      const { error } = await supabase
        .from('resume_analyses')
        .update({ recruitment_name: newFolderName.trim() })
        .in('id', candidateIds);

      if (error) {
        console.error('Error updating folder name:', error);
        toast({
          title: 'Update Failed',
          description: 'Failed to assign candidates to folder. Please try again.',
          variant: 'destructive'
        });
        return;
      }

      // Refresh data to show updated folder names
      await fetchResumeData();
      
      toast({
        title: 'Folder Created',
        description: `${candidateIds.length} candidate${candidateIds.length > 1 ? 's' : ''} added to "${newFolderName}".`
      });

      // Close dialog and navigate to email sequence setup
      setIsFolderDialogOpen(false);
      setSelectedCandidates(new Set());
      navigate(`/email-sequence/${encodeURIComponent(newFolderName.trim())}`);
      setNewFolderName("");
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred.',
        variant: 'destructive'
      });
    }
  }, [newFolderName, selectedCandidates, navigate, toast]);

  const fetchResumeData = async () => {
    try {
      setLoading(true);
      const {
        data,
        error
      } = await supabase.from('resume_analyses').select('*').order('created_at', {
        ascending: false
      });
      if (error) {
        throw new Error(`Failed to fetch resume data: ${error.message}`);
      }
      const parseFactorScore = (factor: any): number => {
        if (!factor) return 0;
        if (typeof factor === 'number') return Math.max(0, Math.min(10, Math.round(factor)));
        if (typeof factor === 'string') {
          const num = parseFloat(factor);
          return isNaN(num) ? 0 : Math.max(0, Math.min(10, Math.round(num)));
        }
        return 0;
      };
      const parseListData = (data: any): string[] => {
        if (!data) return [];
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [data];
          } catch {
            return [data];
          }
        }
        if (Array.isArray(data)) return data;
        return [String(data)];
      };
      const rows = Array.isArray(data) ? data : [];
      const extractJSONScore = (factor: any): string => {
        if (!factor) return 'Unknown';
        if (typeof factor === 'string') return factor;
        if (typeof factor === 'object' && factor.score) return factor.score;
        return 'Unknown';
      };
      const normalized: ResumeAnalysis[] = rows.map((row: any, index: number) => {
        const riskScore = parseFactorScore(row.risk_factor);
        const rewardScore = parseFactorScore(row.reward_factor);
        const fitScore = parseFactorScore(row.fit_score);
        const overallScore = parseFactorScore(row.overall_factor) || fitScore;
        return {
          id: row.id ?? `analysis-${index}`,
          date: row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : '',
          resume: row.resume ?? '',
          candidateName: row.candidate_name || 'Unknown',
          email: row.email ?? '',
          strengths: parseListData(row.strengths),
          weaknesses: parseListData(row.weaknesses),
          riskFactor: riskScore,
          rewardFactor: rewardScore,
          fitScore: fitScore,
          overallFactor: overallScore,
          justification: row.justification ?? '',
          recruitmentName: (row.recruitment_name ? String(row.recruitment_name).trim() : '') || 'Uncategorized',
          riskScore: extractJSONScore(row.risk_factor),
          rewardScore: extractJSONScore(row.reward_factor),
          fitScoreText: fitScore.toString(),
          overallScore: overallScore,
          recruitment_name_raw: row.recruitment_name // Add raw value for debugging
        };
      });
      setResumeData(normalized);
    } catch (error) {
      console.error('Error fetching resume data:', error);
      toast({
        title: "Error",
        description: "Failed to load resume analysis data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchResumeData();
  }, []);
  const recruitmentFolders = useMemo(() => {
    const folders = resumeData.reduce((acc, resume) => {
      const folderName = resume.recruitmentName || 'Uncategorized';
      if (!acc[folderName]) {
        acc[folderName] = [];
      }
      acc[folderName].push(resume);
      return acc;
    }, {} as Record<string, ResumeAnalysis[]>);
    return folders;
  }, [resumeData]);
  const filteredResumes = useMemo(() => {
    let filtered = viewMode === 'folders' && selectedFolder ? recruitmentFolders[selectedFolder] || [] : resumeData;
    return filtered.filter(resume => {
      const matchesSearch = resume.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) || resume.email.toLowerCase().includes(searchTerm.toLowerCase()) || resume.resume.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesScore = filters.scoreRange === 'all' || (() => {
        const score = resume.overallScore || 0;
        switch (filters.scoreRange) {
          case 'high':
            return score >= 8;
          case 'medium':
            return score >= 4 && score < 8;
          case 'low':
            return score < 4;
          default:
            return true;
        }
      })();
      const matchesReward = filters.rewardFactor === 'all' || resume.rewardScore?.toLowerCase() === filters.rewardFactor.toLowerCase();
      const matchesDate = filters.dateRange === 'all' || (() => {
        const resumeDate = new Date(resume.date || '');
        const today = new Date();
        const daysDiff = Math.floor((today.getTime() - resumeDate.getTime()) / (1000 * 60 * 60 * 24));
        switch (filters.dateRange) {
          case 'today':
            return daysDiff === 0;
          case 'week':
            return daysDiff <= 7;
          case 'month':
            return daysDiff <= 30;
          default:
            return true;
        }
      })();
      return matchesSearch && matchesScore && matchesReward && matchesDate;
    });
  }, [viewMode, selectedFolder, recruitmentFolders, resumeData, searchTerm, filters]);
  if (loading) {
    return <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center py-20">
          <div className="text-center animate-fade-in-up">
            <div className="relative">
              <RefreshCw className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
              <div className="absolute inset-0 h-12 w-12 bg-primary/10 rounded-full animate-ping mx-auto" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Loading Candidates
            </h2>
            <p className="text-muted-foreground font-medium">Analyzing resume data with AI precision...</p>
          </div>
        </div>
      </div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-0 sm:px-6 py-0 sm:py-8 lg:py-12">
        {/* Header */}
        <div className="mb-6 sm:mb-12">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 sm:mb-12 animate-fade-in-up">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-primary via-cyan-500 to-primary bg-clip-text text-transparent mb-2 sm:mb-3">
                {viewMode === 'folders' && selectedFolder ? selectedFolder : 'Candidate Intelligence Hub'}
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base lg:text-lg font-medium">
                {viewMode === 'folders' && selectedFolder ? `${filteredResumes.length} candidates in ${selectedFolder}` : 'Manage verified candidate intelligence and pipeline status'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
              <Button 
                onClick={() => navigate('/data-dashboard')} 
                variant="outline" 
                className="gap-2 flex-1 sm:flex-none"
                size="sm"
              >
                <BarChart3 className="h-4 w-4" />
                <span className="hidden sm:inline">Data Dashboard</span>
              </Button>
              <Button 
                onClick={() => setViewMode(viewMode === 'all' ? 'folders' : 'all')} 
                variant={viewMode === 'folders' ? 'default' : 'outline'} 
                className="gap-2 flex-1 sm:flex-none"
                size="sm"
              >
                <Folder className="h-4 w-4" />
                {viewMode === 'folders' ? 'Show All' : 'Folders'}
              </Button>
              <Button 
                onClick={fetchResumeData} 
                variant="outline" 
                className="gap-2 flex-1 sm:flex-none"
                size="sm"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>

          {/* Folder View */}
          {viewMode === 'folders' && !selectedFolder && <div className="mb-8 sm:mb-12">
              <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(recruitmentFolders).map(([folderName, candidates]) => <Card 
                  key={folderName} 
                  className="group bg-card/50 backdrop-blur-sm border-border/30 hover:shadow-[0_0_25px_rgba(62,207,142,0.2)] hover:border-primary/50 transition-all duration-300 cursor-pointer animate-fade-in-up"
                  onClick={() => navigate(`/folder/${encodeURIComponent(folderName)}`)}
                >
                    <CardContent className="p-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-all duration-300 group-hover:shadow-glow">
                          <Folder className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{folderName}</h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      </div>
                      
                      {/* Email Sequence Button */}
                      <div className="mt-4 pt-4 border-t border-border">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/email-sequence/${encodeURIComponent(folderName)}`);
                          }}
                          variant="default"
                          className="w-full"
                        >
                          <Mail className="h-4 w-4 mr-2" />
                          Push to Email Sequence
                          <Badge variant="secondary" className="ml-2">
                            {candidates.length}
                          </Badge>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>)}
              </div>
            </div>}

          {/* Breadcrumb for folder navigation */}
          {viewMode === 'folders' && selectedFolder && <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
              <Button variant="ghost" size="sm" onClick={() => setSelectedFolder(null)} className="p-0 h-auto text-sm hover:text-foreground">
                Folders
              </Button>
              <ChevronRight className="h-3 w-3" />
              <span className="font-medium text-foreground">{selectedFolder}</span>
            </div>}

          {/* Search and Filter Bar */}
          <div className={`${viewMode === 'folders' && !selectedFolder ? 'hidden' : ''} space-y-8`}>
            <div className="flex flex-col sm:flex-row gap-6 mb-8">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search candidates, emails, or resume titles..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Filter className="h-4 w-4" />
                    Filters
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">Score Range</Label>
                      <Select value={filters.scoreRange} onValueChange={value => setFilters({
                      ...filters,
                      scoreRange: value
                    })}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Scores</SelectItem>
                          <SelectItem value="high">High (8-10)</SelectItem>
                          <SelectItem value="medium">Medium (4-7)</SelectItem>
                          <SelectItem value="low">Low (0-3)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Reward Factor</Label>
                      <Select value={filters.rewardFactor} onValueChange={value => setFilters({
                      ...filters,
                      rewardFactor: value
                    })}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Rewards</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Date Range</Label>
                      <Select value={filters.dateRange} onValueChange={value => setFilters({
                      ...filters,
                      dateRange: value
                    })}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Time</SelectItem>
                          <SelectItem value="today">Today</SelectItem>
                          <SelectItem value="week">This Week</SelectItem>
                          <SelectItem value="month">This Month</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                 </PopoverContent>
               </Popover>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <Card className="backdrop-blur-sm transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-xl">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{filteredResumes.length}</p>
                      <p className="text-sm text-muted-foreground font-medium">Total Candidates</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="backdrop-blur-sm transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-success/10 rounded-xl">
                      <Trophy className="h-6 w-6 text-success" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {filteredResumes.filter(r => (r.overallScore || 0) >= 8).length}
                      </p>
                      <p className="text-sm text-muted-foreground font-medium">High Performers</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="backdrop-blur-sm transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-accent/10 rounded-xl">
                      <Calendar className="h-6 w-6 text-accent" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {filteredResumes.filter(r => {
                          const today = new Date().toDateString();
                          const resumeDate = r.date ? new Date(r.date).toDateString() : '';
                          return resumeDate === today;
                        }).length}
                      </p>
                      <p className="text-sm text-muted-foreground font-medium">Reviewed Today</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="backdrop-blur-sm transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-xl">
                      <TrendingUp className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {filteredResumes.length > 0 
                          ? (filteredResumes.reduce((acc, r) => acc + (r.overallScore || 0), 0) / filteredResumes.length).toFixed(1)
                          : '0'
                        }
                      </p>
                      <p className="text-sm text-muted-foreground font-medium">Average Score</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Bulk Actions Bar - Appears when candidates are selected */}
            {selectedCandidates.size > 0 && (
              <div className="mb-4 animate-fade-in">
                <Card className="backdrop-blur-sm bg-primary/5 border-primary/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary text-primary-foreground font-bold shadow-glow">
                          {selectedCandidates.size}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">
                            {selectedCandidates.size} {selectedCandidates.size === 1 ? 'candidate' : 'candidates'} selected
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Choose an action to apply to selected candidates
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button
                          onClick={() => setSelectedCandidates(new Set())}
                          variant="outline"
                          className="gap-2"
                        >
                          <X className="h-4 w-4" />
                          Clear Selection
                        </Button>
                        <Button 
                          onClick={handleAddToEmailSequence}
                          variant="default"
                          className="gap-2"
                        >
                          <Mail className="h-4 w-4" />
                          Add to Email Sequence
                        </Button>
                        <Button 
                          onClick={handleBulkDelete}
                          variant="destructive"
                          className="gap-2"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete Selected
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Candidate List */}
            {filteredResumes.length > 0 ? (
              <>
                {/* Desktop Table - Hidden on Mobile */}
                <Card className="hidden lg:block backdrop-blur-sm">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/30 border-b border-border">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="py-4 px-6 font-semibold text-foreground">
                            <Checkbox
                              checked={selectedCandidates.size === filteredResumes.length && filteredResumes.length > 0}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedCandidates(new Set(filteredResumes.map(r => r.id!)));
                                } else {
                                  setSelectedCandidates(new Set());
                                }
                              }}
                              className="border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                            />
                          </TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-foreground">Candidate</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-foreground text-center">Score</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-foreground text-center">Risk & Reward</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-foreground text-center">Date</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-foreground text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResumes.map((resume, index) => {
                          const riskBadge = resume.riskScore?.toLowerCase() === 'high' 
                            ? { color: 'bg-error/10 text-error border-error/30', icon: AlertTriangle }
                            : resume.riskScore?.toLowerCase() === 'medium'
                            ? { color: 'bg-warning/10 text-warning border-warning/30', icon: ShieldAlert }
                            : { color: 'bg-success/10 text-success border-success/30', icon: ShieldCheck };
                          
                          const rewardBadge = resume.rewardScore?.toLowerCase() === 'high'
                            ? { color: 'bg-success/10 text-success border-success/30', icon: Trophy }
                            : resume.rewardScore?.toLowerCase() === 'medium'
                            ? { color: 'bg-primary/10 text-primary border-primary/30', icon: Target }
                            : { color: 'bg-muted/30 text-muted-foreground border-border', icon: Target };

                          return (
                            <TableRow 
                              key={resume.id}
                              className="border-b border-border hover:bg-muted/20 transition-colors duration-200 group cursor-pointer"
                              onClick={() => {
                                setSelectedCandidate(resume);
                                setIsDetailsPanelOpen(true);
                              }}
                            >
                              <TableCell className="py-6 px-6">
                                <Checkbox
                                  checked={selectedCandidates.has(resume.id!)}
                                  onCheckedChange={(checked) => {
                                    const newSelected = new Set(selectedCandidates);
                                    if (checked) {
                                      newSelected.add(resume.id!);
                                    } else {
                                      newSelected.delete(resume.id!);
                                    }
                                    setSelectedCandidates(newSelected);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                />
                              </TableCell>
                              <TableCell className="py-6 px-6">
                                <div className="flex items-center gap-4">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-foreground text-base leading-tight mb-1.5">
                                      {resume.candidateName || 'Unknown Candidate'}
                                    </div>
                                    <div className="text-sm text-muted-foreground leading-tight truncate mb-1.5">
                                      {resume.email}
                                    </div>
                                    {resume.recruitmentName && (
                                      <Badge 
                                        className={`${getRecruitmentTagColor(resume.recruitmentName)} text-xs font-medium mt-1.5 cursor-pointer hover:scale-105 transition-transform duration-200`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigate(`/folder/${encodeURIComponent(resume.recruitmentName!)}`);
                                        }}
                                      >
                                        {resume.recruitmentName}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6 text-center">
                                <div className="flex items-center justify-center gap-3">
                                  <div className="flex-1 min-w-[120px] max-w-[160px]">
                                    <div className="relative">
                                      <Progress 
                                        value={(resume.overallScore || 0) * 10} 
                                        className="h-3 bg-muted rounded-full overflow-hidden"
                                      />
                                    </div>
                                  </div>
                                  <span className="text-sm font-bold text-foreground min-w-[3rem] bg-muted px-2 py-1 rounded-lg">
                                    {resume.overallScore || 0}/10
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6 text-center">
                                <div className="flex flex-col items-center gap-2">
                                  <Badge className={`text-xs px-3 py-1.5 font-semibold rounded-full border flex items-center justify-center gap-2 min-w-[9rem] transition-all duration-300 hover:scale-105 cursor-default ${riskBadge.color}`}>
                                    <riskBadge.icon className="h-3.5 w-3.5" />
                                    Risk: {resume.riskScore || 'Unknown'}
                                  </Badge>
                                  <Badge className={`text-xs px-3 py-1.5 font-semibold rounded-full border flex items-center justify-center gap-2 min-w-[9rem] transition-all duration-300 hover:scale-105 cursor-default ${rewardBadge.color}`}>
                                    <rewardBadge.icon className="h-3.5 w-3.5" />
                                    Reward: {resume.rewardScore || 'Unknown'}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6 text-center">
                                <div className="flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-xl px-3 py-2 font-medium">
                                  <Calendar className="h-4 w-4 mr-2" />
                                  <span>{resume.date ? new Date(resume.date).toLocaleDateString() : 'Unknown'}</span>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6 text-center">
                                <div className="flex items-center justify-center gap-3">
                                  <Button 
                                    size="sm" 
                                    variant="default"
                                    className="h-9 w-9 p-0" 
                                    title="View Full Details"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedCandidateFullView(resume);
                                      setIsFullViewDialogOpen(true);
                                    }}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="h-9 w-9 p-0" 
                                        title="More Actions"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="backdrop-blur-sm">
                                      <DropdownMenuItem 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(resume.resume, '_blank');
                                        }}
                                        className="cursor-pointer"
                                      >
                                        <Download className="h-4 w-4 mr-3" />
                                        Download Resume
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteCandidate(resume.id);
                                        }}
                                        className="text-error cursor-pointer"
                                      >
                                        <Trash2 className="h-4 w-4 mr-3" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Mobile Card Layout - Visible on Mobile */}
                <div className="lg:hidden space-y-3 sm:space-y-4">
                  {filteredResumes.map((resume, index) => (
                    <Card 
                      key={resume.id}
                      className="backdrop-blur-sm hover:shadow-primary transition-all duration-300 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCandidate(resume);
                        setIsDetailsPanelOpen(true);
                      }}
                    >
                      <CardContent className="p-4">
                        {/* Header Section - Name, Score, Recruitment Tag */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-foreground text-base mb-1 truncate">
                              {resume.candidateName || 'Unknown Candidate'}
                            </h3>
                            <p className="text-sm text-muted-foreground truncate mb-2">
                              {resume.email}
                            </p>
                            {resume.recruitmentName && (
                              <Badge 
                                className={`${getRecruitmentTagColor(resume.recruitmentName)} text-xs font-medium`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/folder/${encodeURIComponent(resume.recruitmentName!)}`);
                                }}
                              >
                                {resume.recruitmentName}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                            <Badge 
                              className={`${
                                (resume.overallScore ?? 0) >= 8 ? 'bg-success/10 text-success border-success/30' :
                                (resume.overallScore ?? 0) >= 6 ? 'bg-primary/10 text-primary border-primary/30' :
                                (resume.overallScore ?? 0) >= 4 ? 'bg-warning/10 text-warning border-warning/30' :
                                'bg-error/10 text-error border-error/30'
                              } text-sm font-bold px-2 py-1 border`}
                            >
                              {resume.overallScore ?? 0}/10
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Fit: {resume.fitScore}/10
                            </span>
                          </div>
                        </div>

                        {/* Risk/Reward Section */}
                        <div className="flex items-center gap-2 mb-3">
                          <Badge 
                            variant="outline" 
                            className={`text-xs px-2 py-1 ${
                              (resume.riskScore?.toLowerCase() || '') === 'high' ? 'border-error/30 text-error bg-error/10' :
                              (resume.riskScore?.toLowerCase() || '') === 'medium' ? 'border-warning/30 text-warning bg-warning/10' :
                              (resume.riskScore?.toLowerCase() || '') === 'low' ? 'border-success/30 text-success bg-success/10' :
                              'border-border text-muted-foreground bg-muted/30'
                            }`}
                          >
                            Risk: {resume.riskScore || 'Unknown'}
                          </Badge>
                          <Badge 
                            variant="outline" 
                            className={`text-xs px-2 py-1 ${
                              (resume.rewardScore?.toLowerCase() || '') === 'high' ? 'border-success/30 text-success bg-success/10' :
                              (resume.rewardScore?.toLowerCase() || '') === 'medium' ? 'border-primary/30 text-primary bg-primary/10' :
                              (resume.rewardScore?.toLowerCase() || '') === 'low' ? 'border-border text-muted-foreground bg-muted/30' :
                              'border-border text-muted-foreground bg-muted/30'
                            }`}
                          >
                            Reward: {resume.rewardScore || 'Unknown'}
                          </Badge>
                        </div>

                        {/* Bottom Section - Date and Actions */}
                        <div className="flex items-center justify-between pt-3 border-t border-border">
                          <span className="text-sm text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {resume.date ? new Date(resume.date).toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric' 
                            }) : 'Unknown'}
                          </span>
                          <div className="flex items-center gap-2">
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              className="h-8 w-8 p-0"
                              title="Full Details"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCandidateFullView(resume);
                                setIsFullViewDialogOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(resume.resume, '_blank');
                                  }}
                                >
                                  <Download className="h-4 w-4 mr-2" />
                                  View Resume
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteCandidate(resume.id!);
                                  }}
                                  className="text-error"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 bg-muted/50 rounded-full">
                      <Users className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium text-lg">No candidates found</h3>
                      <p className="text-muted-foreground text-sm">
                        {searchTerm || filters.scoreRange !== 'all' || filters.dateRange !== 'all' 
                          ? 'Try adjusting your search or filter criteria' 
                          : 'Upload and analyze resumes to see candidate data here'
                        }
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Quick Preview Sheet - Opens on row click */}
      <Sheet open={isDetailsPanelOpen} onOpenChange={setIsDetailsPanelOpen}>
        <SheetContent side="right" className="w-full sm:w-[45vw] sm:max-w-[90vw] sm:min-w-[400px] p-0">
          <div className="h-full flex flex-col">
            <SheetHeader className="p-4 sm:p-6 border-b border-border bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle className="text-lg sm:text-2xl font-bold text-foreground">
                    Quick Preview
                  </SheetTitle>
                  <SheetDescription className="text-sm sm:text-lg text-muted-foreground mt-1">
                    {selectedCandidate?.candidateName || 'Unknown Candidate'}
                  </SheetDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 rounded-full"
                  onClick={() => setIsDetailsPanelOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </SheetHeader>
            
            <ScrollArea className="flex-1 p-4 sm:p-6">
              {selectedCandidate && (
                <div className="space-y-4 sm:space-y-6">
                  {/* Basic Info */}
                  <div className="border border-primary/20 rounded-xl p-4 bg-card/50 backdrop-blur-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Mail className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-foreground">{selectedCandidate.candidateName}</h4>
                        <p className="text-sm text-muted-foreground">{selectedCandidate.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Scores */}
                  <div className="space-y-3">
                    <h4 className="text-base font-bold text-foreground flex items-center gap-2">
                      <Target className="h-4 w-4 text-primary" />
                      Quick Scores
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="border border-primary/20 rounded-xl p-3 bg-card/50 backdrop-blur-sm">
                        <div className="text-center">
                          <span className="text-lg font-bold text-primary">{selectedCandidate.overallScore}/10</span>
                          <p className="text-xs text-muted-foreground">Overall</p>
                        </div>
                      </div>
                      <div className="border border-primary/20 rounded-xl p-3 bg-card/50 backdrop-blur-sm">
                        <div className="text-center">
                          <span className="text-lg font-bold text-primary">{selectedCandidate.fitScore}/10</span>
                          <p className="text-xs text-muted-foreground">Fit Score</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Risk/Reward */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-warning/30 rounded-xl p-3 text-center bg-warning/5 backdrop-blur-sm">
                      <AlertTriangle className="h-6 w-6 text-warning mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground mb-1">Risk</p>
                      <p className="text-sm font-bold text-warning">{selectedCandidate.riskScore || 'Unknown'}</p>
                    </div>
                    <div className="border border-success/30 rounded-xl p-3 text-center bg-success/5 backdrop-blur-sm">
                      <Trophy className="h-6 w-6 text-success mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground mb-1">Reward</p>
                      <p className="text-sm font-bold text-success">{selectedCandidate.rewardScore || 'Unknown'}</p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-3 pt-4 border-t border-border">
                    <Button
                      onClick={() => {
                        setIsDetailsPanelOpen(false);
                        setSelectedCandidateFullView(selectedCandidate);
                        setIsFullViewDialogOpen(true);
                      }}
                      variant="default"
                      className="w-full"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Full Analysis
                    </Button>
                    {selectedCandidate.resume && (
                      <Button
                        variant="outline"
                        onClick={() => window.open(selectedCandidate.resume, '_blank')}
                        className="w-full"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        View Resume
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      {/* Full View Dialog - Opens on View button click */}
      <CandidateAnalysisDialog 
        open={isFullViewDialogOpen} 
        onOpenChange={setIsFullViewDialogOpen}
        candidate={selectedCandidateFullView}
      />

      {/* Folder Naming Dialog - Opens when adding candidates to email sequence */}
      <Dialog open={isFolderDialogOpen} onOpenChange={setIsFolderDialogOpen}>
        <DialogContent className="sm:max-w-md backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-foreground">
              Name Your Candidate Group
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a folder name for the {selectedCandidates.size} selected candidate{selectedCandidates.size > 1 ? 's' : ''}. This will help you organize and track your email sequences.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name" className="text-foreground font-medium">
                Folder Name *
              </Label>
              <Input
                id="folder-name"
                placeholder="e.g., Senior AI Engineers Q1 2025"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleFolderNameSubmit();
                  }
                }}
                className="border-primary/20 focus:border-primary bg-card/50 backdrop-blur-sm"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                Choose a descriptive name to easily identify this group later
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setIsFolderDialogOpen(false);
                setNewFolderName("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleFolderNameSubmit}
              variant="default"
            >
              <Folder className="h-4 w-4 mr-2" />
              Continue to Email Setup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default ModernDashboard;
