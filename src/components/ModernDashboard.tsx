import React, { useState, useEffect } from "react";
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

// Function to generate consistent colors for recruitment names
const getRecruitmentTagColor = (recruitmentName: string): string => {
  if (!recruitmentName) return "bg-gray-100 text-gray-800 hover:bg-gray-200";

  // Simple hash function to generate consistent color based on string
  let hash = 0;
  for (let i = 0; i < recruitmentName.length; i++) {
    hash = recruitmentName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ["bg-blue-100 text-blue-800 hover:bg-blue-200", "bg-green-100 text-green-800 hover:bg-green-200", "bg-purple-100 text-purple-800 hover:bg-purple-200", "bg-orange-100 text-orange-800 hover:bg-orange-200", "bg-pink-100 text-pink-800 hover:bg-pink-200", "bg-indigo-100 text-indigo-800 hover:bg-indigo-200", "bg-yellow-100 text-yellow-800 hover:bg-yellow-200", "bg-teal-100 text-teal-800 hover:bg-teal-200", "bg-red-100 text-red-800 hover:bg-red-200", "bg-cyan-100 text-cyan-800 hover:bg-cyan-200"];
  return colors[Math.abs(hash) % colors.length];
};
import { Search, FileText, TrendingUp, Users, CheckCircle, AlertTriangle, RefreshCw, Filter, MoreVertical, Eye, Download, Trash2, X, Mail, Calendar, ArrowUpRight, Folder, ChevronRight, ShieldAlert, ShieldCheck, Target, Trophy } from "lucide-react";
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
  const [filters, setFilters] = useState({
    scoreRange: 'all',
    rewardFactor: 'all',
    dateRange: 'all'
  });
  const {
    toast
  } = useToast();
  const itemsPerPage = 10;
  const handleDeleteCandidate = async (candidateId: string) => {
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
  };
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
  const recruitmentFolders = React.useMemo(() => {
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
  const filteredResumes = React.useMemo(() => {
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
    return <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
        <div className="flex items-center justify-center py-20">
          <div className="text-center animate-fade-in-up">
            <div className="relative">
              <RefreshCw className="h-12 w-12 animate-spin text-cyan-500 mx-auto mb-4" />
              <div className="absolute inset-0 h-12 w-12 bg-cyan-500/20 rounded-full animate-ping mx-auto" />
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-2 animate-fade-in-up animate-delay-200">
              Loading Candidates
            </h2>
            <p className="text-slate-600 font-medium animate-fade-in-up animate-delay-300">Analyzing resume data with AI precision...</p>
          </div>
        </div>
      </div>;
  }

  return <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-12">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-3">
                {viewMode === 'folders' && selectedFolder ? selectedFolder : 'Candidate Dashboard'}
              </h1>
              <p className="text-slate-600 text-lg font-medium">
                {viewMode === 'folders' && selectedFolder ? `${filteredResumes.length} candidates in ${selectedFolder}` : 'Manage and analyze candidate applications with AI precision'}
              </p>
            </div>
            <div className="flex gap-3">
              <Button 
                onClick={() => setViewMode(viewMode === 'all' ? 'folders' : 'all')} 
                variant={viewMode === 'folders' ? 'default' : 'outline'} 
                className={`gap-2 px-6 py-2 rounded-xl font-medium transition-all duration-200 ${
                  viewMode === 'folders' 
                    ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg shadow-cyan-500/25 hover:shadow-xl hover:shadow-cyan-500/30 hover:scale-105' 
                    : 'border-slate-200 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700'
                }`}
              >
                <Folder className="h-4 w-4" />
                {viewMode === 'folders' ? 'Show All' : 'Folders'}
              </Button>
              <Button 
                onClick={fetchResumeData} 
                variant="outline" 
                className="gap-2 px-6 py-2 rounded-xl font-medium border-slate-200 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 transition-all duration-200"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Folder View */}
          {viewMode === 'folders' && !selectedFolder && <div className="mb-12">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(recruitmentFolders).map(([folderName, candidates]) => <Card 
                  key={folderName} 
                  className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 hover:scale-[1.02] hover:border-cyan-200 rounded-2xl overflow-hidden"
                >
                    <CardContent className="p-6">
                      <div 
                        className="flex items-center gap-4 cursor-pointer"
                        onClick={() => navigate(`/folder/${encodeURIComponent(folderName)}`)}
                      >
                        <div className="p-3 bg-gradient-to-br from-cyan-50 to-teal-50 rounded-xl group-hover:from-cyan-100 group-hover:to-teal-100 transition-all duration-300">
                          <Folder className="h-5 w-5 text-cyan-600" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-800 group-hover:text-cyan-700 transition-colors">{folderName}</h3>
                          <p className="text-sm text-slate-500 mt-1">
                            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-cyan-500 group-hover:translate-x-1 transition-all duration-300" />
                      </div>
                      
                      {/* Email Sequence Button */}
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            toast({
                              title: "Email Sequence",
                              description: `Pushing ${candidates.length} candidates from ${folderName} to email sequence...`,
                            });
                          }}
                          className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 rounded-xl font-medium py-2.5 group/btn"
                        >
                          <div className="flex items-center justify-center gap-2">
                            <Mail className="h-4 w-4 group-hover/btn:scale-110 transition-transform duration-200" />
                            <span>Push to Email Sequence</span>
                            <div className="flex items-center gap-1 ml-2 bg-white/20 rounded-full px-2 py-0.5 text-xs font-semibold">
                              <Users className="h-3 w-3" />
                              {candidates.length}
                            </div>
                          </div>
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
              <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl">
                      <Users className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-slate-800">{filteredResumes.length}</p>
                      <p className="text-sm text-slate-500 font-medium">Total Candidates</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl">
                      <Trophy className="h-6 w-6 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-slate-800">
                        {filteredResumes.filter(r => (r.overallScore || 0) >= 8).length}
                      </p>
                      <p className="text-sm text-slate-500 font-medium">High Performers</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl">
                      <Calendar className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-slate-800">
                        {filteredResumes.filter(r => {
                          const today = new Date().toDateString();
                          const resumeDate = r.date ? new Date(r.date).toDateString() : '';
                          return resumeDate === today;
                        }).length}
                      </p>
                      <p className="text-sm text-slate-500 font-medium">Reviewed Today</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl">
                      <TrendingUp className="h-6 w-6 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-slate-800">
                        {filteredResumes.length > 0 
                          ? (filteredResumes.reduce((acc, r) => acc + (r.overallScore || 0), 0) / filteredResumes.length).toFixed(1)
                          : '0'
                        }
                      </p>
                      <p className="text-sm text-slate-500 font-medium">Average Score</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Candidate List */}
            {filteredResumes.length > 0 ? (
              <>
                {/* Desktop Table - Hidden on Mobile */}
                <Card className="hidden lg:block backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl overflow-hidden">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="py-4 px-6 font-semibold text-slate-700">
                            <Checkbox
                              checked={selectedCandidates.size === filteredResumes.length && filteredResumes.length > 0}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedCandidates(new Set(filteredResumes.map(r => r.id!)));
                                } else {
                                  setSelectedCandidates(new Set());
                                }
                              }}
                              className="border-slate-300 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                            />
                          </TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-slate-700">Candidate</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-slate-700 text-center">Score</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-slate-700 text-center">Risk & Reward</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-slate-700 text-center">Date</TableHead>
                          <TableHead className="py-4 px-6 font-semibold text-slate-700 text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResumes.map((resume, index) => {
                          const riskBadge = resume.riskScore?.toLowerCase() === 'high' 
                            ? { color: 'bg-red-100 text-red-700', icon: AlertTriangle }
                            : resume.riskScore?.toLowerCase() === 'medium'
                            ? { color: 'bg-amber-100 text-amber-700', icon: ShieldAlert }
                            : { color: 'bg-green-100 text-green-700', icon: ShieldCheck };
                          
                          const rewardBadge = resume.rewardScore?.toLowerCase() === 'high'
                            ? { color: 'bg-emerald-100 text-emerald-700', icon: Trophy }
                            : resume.rewardScore?.toLowerCase() === 'medium'
                            ? { color: 'bg-blue-100 text-blue-700', icon: Target }
                            : { color: 'bg-slate-100 text-slate-700', icon: Target };

                          return (
                            <TableRow 
                              key={resume.id}
                              className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors duration-200 group cursor-pointer"
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
                                  className="border-slate-300 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                                />
                              </TableCell>
                              <TableCell className="py-6 px-6">
                                <div className="flex items-center gap-4">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-slate-800 text-base mb-1">
                                      {resume.candidateName || 'Unknown Candidate'}
                                    </div>
                                    <div className="text-sm text-slate-600 truncate">
                                      {resume.email}
                                    </div>
                                    {resume.recruitmentName && (
                                      <Badge 
                                        className={`${getRecruitmentTagColor(resume.recruitmentName)} text-xs font-medium mt-2 cursor-pointer hover:scale-105 transition-transform duration-200`}
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
                                        className="h-3 bg-slate-100 rounded-full overflow-hidden"
                                      />
                                      <div 
                                        className="absolute top-0 left-0 h-3 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all duration-300 ease-out"
                                        style={{ width: `${Math.min(100, (resume.overallScore || 0) * 10)}%` }}
                                      />
                                    </div>
                                  </div>
                                  <span className="text-sm font-bold text-slate-800 min-w-[3rem] bg-slate-100 px-2 py-1 rounded-lg">
                                    {resume.overallScore || 0}/10
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6 text-center">
                                <div className="flex flex-col items-center gap-2">
                                  <Badge className={`text-xs px-3 py-1.5 font-semibold rounded-full border-0 flex items-center gap-2 shadow-md ${riskBadge.color}`}>
                                    <riskBadge.icon className="h-3.5 w-3.5" />
                                    Risk: {resume.riskScore || 'Unknown'}
                                  </Badge>
                                  <Badge className={`text-xs px-3 py-1.5 font-semibold rounded-full border-0 flex items-center gap-2 shadow-md ${rewardBadge.color}`}>
                                    <rewardBadge.icon className="h-3.5 w-3.5" />
                                    Reward: {resume.rewardScore || 'Unknown'}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6 text-center">
                                <div className="flex items-center justify-center text-sm text-slate-600 bg-slate-50 rounded-xl px-3 py-2 font-medium">
                                  <Calendar className="h-4 w-4 mr-2 text-slate-500" />
                                  <span>{resume.date ? new Date(resume.date).toLocaleDateString() : 'Unknown'}</span>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6 text-center">
                                <div className="flex items-center justify-center gap-3">
                                  <Button 
                                    size="sm" 
                                    className="h-9 w-9 p-0 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200" 
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
                                        className="h-9 w-9 p-0 rounded-xl border-slate-200 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-600 transition-all duration-200" 
                                        title="More Actions"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="rounded-2xl border-slate-200 bg-white/95 backdrop-blur-sm shadow-2xl">
                                      <DropdownMenuItem 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(resume.resume, '_blank');
                                        }}
                                        className="rounded-xl hover:bg-slate-50 cursor-pointer"
                                      >
                                        <Download className="h-4 w-4 mr-3 text-slate-500" />
                                        Download Resume
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteCandidate(resume.id);
                                        }}
                                        className="text-red-600 hover:bg-red-50 hover:text-red-700 rounded-xl cursor-pointer"
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
                      className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 rounded-xl cursor-pointer"
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
                            <h3 className="font-semibold text-slate-800 text-base mb-1 truncate">
                              {resume.candidateName || 'Unknown Candidate'}
                            </h3>
                            <p className="text-sm text-slate-600 truncate mb-2">
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
                                (resume.overallScore ?? 0) >= 8 ? 'bg-green-100 text-green-800' :
                                (resume.overallScore ?? 0) >= 6 ? 'bg-blue-100 text-blue-800' :
                                (resume.overallScore ?? 0) >= 4 ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              } text-sm font-bold px-2 py-1`}
                            >
                              {resume.overallScore ?? 0}/10
                            </Badge>
                            <span className="text-xs text-slate-500">
                              Fit: {resume.fitScore}/10
                            </span>
                          </div>
                        </div>

                        {/* Risk/Reward Section */}
                        <div className="flex items-center gap-2 mb-3">
                          <Badge 
                            variant="outline" 
                            className={`text-xs px-2 py-1 ${
                              (resume.riskScore?.toLowerCase() || '') === 'high' ? 'border-red-200 text-red-700 bg-red-50' :
                              (resume.riskScore?.toLowerCase() || '') === 'medium' ? 'border-amber-200 text-amber-700 bg-amber-50' :
                              (resume.riskScore?.toLowerCase() || '') === 'low' ? 'border-green-200 text-green-700 bg-green-50' :
                              'border-gray-200 text-gray-700 bg-gray-50'
                            }`}
                          >
                            Risk: {resume.riskScore || 'Unknown'}
                          </Badge>
                          <Badge 
                            variant="outline" 
                            className={`text-xs px-2 py-1 ${
                              (resume.rewardScore?.toLowerCase() || '') === 'high' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' :
                              (resume.rewardScore?.toLowerCase() || '') === 'medium' ? 'border-blue-200 text-blue-700 bg-blue-50' :
                              (resume.rewardScore?.toLowerCase() || '') === 'low' ? 'border-slate-200 text-slate-700 bg-slate-50' :
                              'border-gray-200 text-gray-700 bg-gray-50'
                            }`}
                          >
                            Reward: {resume.rewardScore || 'Unknown'}
                          </Badge>
                        </div>

                        {/* Bottom Section - Date and Actions */}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                          <span className="text-sm text-slate-500 flex items-center gap-1">
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
                              className="h-8 w-8 p-0 hover:bg-blue-100 hover:text-blue-600"
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
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
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
            <SheetHeader className="p-4 sm:p-6 border-b bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
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
                  <div className="border rounded-xl p-4 bg-gradient-to-br from-white to-slate-50/50 shadow-md">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-cyan-50 to-teal-50 rounded-lg">
                        <Mail className="h-5 w-5 text-cyan-600" />
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
                      <Target className="h-4 w-4 text-cyan-600" />
                      Quick Scores
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="border rounded-xl p-3 bg-gradient-to-br from-cyan-50/50 to-white shadow-sm">
                        <div className="text-center">
                          <span className="text-lg font-bold text-cyan-600">{selectedCandidate.overallScore}/10</span>
                          <p className="text-xs text-slate-600">Overall</p>
                        </div>
                      </div>
                      <div className="border rounded-xl p-3 bg-gradient-to-br from-teal-50/50 to-white shadow-sm">
                        <div className="text-center">
                          <span className="text-lg font-bold text-teal-600">{selectedCandidate.fitScore}/10</span>
                          <p className="text-xs text-slate-600">Fit Score</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Risk/Reward */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border rounded-xl p-3 text-center bg-gradient-to-br from-amber-50/50 to-white shadow-sm">
                      <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground mb-1">Risk</p>
                      <p className="text-sm font-bold text-amber-700">{selectedCandidate.riskScore || 'Unknown'}</p>
                    </div>
                    <div className="border rounded-xl p-3 text-center bg-gradient-to-br from-green-50/50 to-white shadow-sm">
                      <Trophy className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground mb-1">Reward</p>
                      <p className="text-sm font-bold text-green-700">{selectedCandidate.rewardScore || 'Unknown'}</p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-3 pt-4 border-t">
                    <Button
                      onClick={() => {
                        setIsDetailsPanelOpen(false);
                        setSelectedCandidateFullView(selectedCandidate);
                        setIsFullViewDialogOpen(true);
                      }}
                      className="w-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white"
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
      <Dialog open={isFullViewDialogOpen} onOpenChange={setIsFullViewDialogOpen}>
        <DialogContent className="max-w-7xl w-[95vw] max-h-[95vh] p-0 overflow-hidden animate-fade-in">
          <div className="h-full flex flex-col max-h-[95vh]">
            {/* Elegant Header with Gradient */}
            <div className="relative overflow-hidden border-b bg-gradient-to-br from-background via-background/95 to-primary/5">
              <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
              <DialogHeader className="relative p-8 pb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1 space-y-3 animate-fade-in-up">
                    <DialogTitle className="text-4xl font-bold bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text text-transparent">
                      Complete Candidate Analysis
                    </DialogTitle>
                    <DialogDescription className="text-lg text-muted-foreground">
                      Comprehensive AI-powered resume assessment and evaluation
                    </DialogDescription>
                  </div>
                  {selectedCandidateFullView?.overallScore !== undefined && (
                    <div className="flex items-center gap-3 px-6 py-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent rounded-2xl border border-primary/20 shadow-lg animate-fade-in-up animate-delay-200">
                      <div className="text-right">
                        <div className="text-sm font-medium text-muted-foreground">Overall Score</div>
                        <div className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                          {selectedCandidateFullView.overallScore}<span className="text-xl">/10</span>
                        </div>
                      </div>
                      <div className="w-16 h-16 relative">
                        <svg className="w-16 h-16 transform -rotate-90">
                          <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-muted/20" />
                          <circle 
                            cx="32" cy="32" r="28" 
                            stroke="currentColor" 
                            strokeWidth="4" 
                            fill="none" 
                            strokeDasharray={`${(selectedCandidateFullView.overallScore / 10) * 175.93} 175.93`}
                            className="text-primary transition-all duration-1000 ease-out"
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Candidate Quick Info */}
                {selectedCandidateFullView && (
                  <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-border/50 animate-fade-in-up animate-delay-300">
                    <div className="flex items-center gap-3 px-4 py-2 bg-background/60 backdrop-blur-sm rounded-xl border border-border/50">
                      <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/10 rounded-full flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">
                          {selectedCandidateFullView.candidateName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{selectedCandidateFullView.candidateName}</div>
                        <div className="text-sm text-muted-foreground">{selectedCandidateFullView.email}</div>
                      </div>
                    </div>
                    {selectedCandidateFullView.date && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-background/60 backdrop-blur-sm rounded-xl border border-border/50">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">
                          {new Date(selectedCandidateFullView.date).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                          })}
                        </span>
                      </div>
                    )}
                    {selectedCandidateFullView.recruitmentName && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-background/60 backdrop-blur-sm rounded-xl border border-border/50">
                        <Folder className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{selectedCandidateFullView.recruitmentName}</span>
                      </div>
                    )}
                  </div>
                )}
              </DialogHeader>
            </div>
            
            {/* Main Content with Tabs */}
            <ScrollArea className="flex-1 pointer-events-auto">
              {selectedCandidateFullView && (
                <div className="p-8">
                  <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="grid w-full grid-cols-4 mb-8 h-auto p-1 bg-muted/50">
                      <TabsTrigger value="overview" className="gap-2 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md">
                        <Target className="h-4 w-4" />
                        <span className="hidden sm:inline">Overview</span>
                      </TabsTrigger>
                      <TabsTrigger value="assessment" className="gap-2 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md">
                        <TrendingUp className="h-4 w-4" />
                        <span className="hidden sm:inline">Assessment</span>
                      </TabsTrigger>
                      <TabsTrigger value="details" className="gap-2 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md">
                        <FileText className="h-4 w-4" />
                        <span className="hidden sm:inline">Details</span>
                      </TabsTrigger>
                      <TabsTrigger value="ai-insights" className="gap-2 py-3 data-[state=active]:bg-background data-[state=active]:shadow-md">
                        <ArrowUpRight className="h-4 w-4" />
                        <span className="hidden sm:inline">AI Insights</span>
                      </TabsTrigger>
                    </TabsList>

                    {/* Overview Tab */}
                    <TabsContent value="overview" className="space-y-6 animate-fade-in">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Fit Score Card */}
                        <Card className="group hover:shadow-xl transition-all duration-300 border-border/50 hover:border-primary/30 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                          <CardHeader className="relative pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-lg font-semibold">Fit Score</CardTitle>
                              <div className="p-2 bg-primary/10 rounded-lg">
                                <Target className="h-5 w-5 text-primary" />
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="relative space-y-3">
                            <div className="text-4xl font-bold text-primary">
                              {selectedCandidateFullView.fitScore}<span className="text-2xl text-muted-foreground">/10</span>
                            </div>
                            <Progress 
                              value={(selectedCandidateFullView.fitScore || 0) * 10} 
                              className="h-2.5 transition-all duration-500"
                            />
                            <p className="text-sm text-muted-foreground">
                              {selectedCandidateFullView.fitScore >= 8 ? 'Excellent match for the role' : 
                               selectedCandidateFullView.fitScore >= 6 ? 'Good potential fit' : 
                               selectedCandidateFullView.fitScore >= 4 ? 'Moderate alignment' : 'Needs consideration'}
                            </p>
                          </CardContent>
                        </Card>

                        {/* Risk Assessment Card */}
                        <Card className="group hover:shadow-xl transition-all duration-300 border-border/50 hover:border-amber-500/30 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                          <CardHeader className="relative pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-lg font-semibold">Risk Level</CardTitle>
                              <div className="p-2 bg-amber-500/10 rounded-lg">
                                <ShieldAlert className="h-5 w-5 text-amber-600" />
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="relative space-y-3">
                            <div className="text-4xl font-bold text-amber-600">
                              {selectedCandidateFullView.riskScore || 'N/A'}
                            </div>
                            {typeof selectedCandidateFullView.riskFactor === 'number' && (
                              <Progress 
                                value={(selectedCandidateFullView.riskFactor || 0) * 10} 
                                className="h-2.5 [&>div]:bg-amber-500 transition-all duration-500"
                              />
                            )}
                            <p className="text-sm text-muted-foreground">Assessment of potential concerns</p>
                          </CardContent>
                        </Card>

                        {/* Reward Potential Card */}
                        <Card className="group hover:shadow-xl transition-all duration-300 border-border/50 hover:border-green-500/30 overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                          <CardHeader className="relative pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-lg font-semibold">Reward Factor</CardTitle>
                              <div className="p-2 bg-green-500/10 rounded-lg">
                                <Trophy className="h-5 w-5 text-green-600" />
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="relative space-y-3">
                            <div className="text-4xl font-bold text-green-600">
                              {selectedCandidateFullView.rewardScore || 'N/A'}
                            </div>
                            {typeof selectedCandidateFullView.rewardFactor === 'number' && (
                              <Progress 
                                value={(selectedCandidateFullView.rewardFactor || 0) * 10} 
                                className="h-2.5 [&>div]:bg-green-500 transition-all duration-500"
                              />
                            )}
                            <p className="text-sm text-muted-foreground">Potential value and impact</p>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Quick Stats */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="hover:shadow-lg transition-all duration-300">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <CheckCircle className="h-5 w-5 text-green-600" />
                              Quick Stats
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                              <span className="text-sm font-medium text-muted-foreground">Strengths Identified</span>
                              <Badge variant="secondary" className="font-semibold">
                                {selectedCandidateFullView.strengths?.length || 0}
                              </Badge>
                            </div>
                            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                              <span className="text-sm font-medium text-muted-foreground">Development Areas</span>
                              <Badge variant="secondary" className="font-semibold">
                                {selectedCandidateFullView.weaknesses?.length || 0}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Resume Access */}
                        {selectedCandidateFullView.resume && (
                          <Card className="hover:shadow-lg transition-all duration-300 border-primary/20">
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" />
                                Resume Document
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground mb-4">
                                Access the original resume submission for detailed review
                              </p>
                              <Button
                                onClick={() => window.open(selectedCandidateFullView.resume, '_blank')}
                                className="w-full group/btn"
                              >
                                <FileText className="h-4 w-4 mr-2 group-hover/btn:scale-110 transition-transform" />
                                Open Resume
                              </Button>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </TabsContent>

                    {/* Assessment Tab */}
                    <TabsContent value="assessment" className="space-y-6 animate-fade-in">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Strengths */}
                        {selectedCandidateFullView.strengths?.length > 0 && (
                          <Card className="hover:shadow-lg transition-all duration-300 overflow-hidden">
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 to-emerald-500"></div>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2 text-green-700">
                                <div className="p-2 bg-green-100 rounded-lg">
                                  <CheckCircle className="h-5 w-5" />
                                </div>
                                Key Strengths
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {selectedCandidateFullView.strengths.map((strength, idx) => (
                                  <div 
                                    key={idx} 
                                    className="flex items-start gap-3 p-3 bg-green-50/50 rounded-lg hover:bg-green-50 transition-colors duration-200 group animate-fade-in-up"
                                    style={{ animationDelay: `${idx * 50}ms` }}
                                  >
                                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform">
                                      <CheckCircle className="h-4 w-4 text-white" />
                                    </div>
                                    <span className="text-sm text-slate-700 leading-relaxed">{strength}</span>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Weaknesses */}
                        {selectedCandidateFullView.weaknesses?.length > 0 && (
                          <Card className="hover:shadow-lg transition-all duration-300 overflow-hidden">
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500"></div>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2 text-amber-700">
                                <div className="p-2 bg-amber-100 rounded-lg">
                                  <AlertTriangle className="h-5 w-5" />
                                </div>
                                Areas for Development
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {selectedCandidateFullView.weaknesses.map((weakness, idx) => (
                                  <div 
                                    key={idx} 
                                    className="flex items-start gap-3 p-3 bg-amber-50/50 rounded-lg hover:bg-amber-50 transition-colors duration-200 group animate-fade-in-up"
                                    style={{ animationDelay: `${idx * 50}ms` }}
                                  >
                                    <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform">
                                      <AlertTriangle className="h-4 w-4 text-white" />
                                    </div>
                                    <span className="text-sm text-slate-700 leading-relaxed">{weakness}</span>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>

                      {/* Score Breakdown */}
                      <Card className="hover:shadow-lg transition-all duration-300">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-primary" />
                            Score Breakdown & Analysis
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-foreground">Overall Score</span>
                                <span className="text-lg font-bold text-primary">{selectedCandidateFullView.overallScore}/10</span>
                              </div>
                              <Progress value={(selectedCandidateFullView.overallScore || 0) * 10} className="h-3" />
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-foreground">Fit Score</span>
                                <span className="text-lg font-bold text-primary">{selectedCandidateFullView.fitScore}/10</span>
                              </div>
                              <Progress value={(selectedCandidateFullView.fitScore || 0) * 10} className="h-3" />
                            </div>
                            {typeof selectedCandidateFullView.riskFactor === 'number' && (
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-sm font-medium text-foreground">Risk Factor</span>
                                  <span className="text-lg font-bold text-amber-600">{selectedCandidateFullView.riskFactor}/10</span>
                                </div>
                                <Progress value={(selectedCandidateFullView.riskFactor || 0) * 10} className="h-3 [&>div]:bg-amber-500" />
                              </div>
                            )}
                            {typeof selectedCandidateFullView.rewardFactor === 'number' && (
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-sm font-medium text-foreground">Reward Factor</span>
                                  <span className="text-lg font-bold text-green-600">{selectedCandidateFullView.rewardFactor}/10</span>
                                </div>
                                <Progress value={(selectedCandidateFullView.rewardFactor || 0) * 10} className="h-3 [&>div]:bg-green-500" />
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>

                    {/* Details Tab */}
                    <TabsContent value="details" className="space-y-6 animate-fade-in">
                      <Card className="hover:shadow-lg transition-all duration-300">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-primary" />
                            Candidate Information
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                              <div className="text-sm font-medium text-muted-foreground">Full Name</div>
                              <div className="text-base font-semibold text-foreground">{selectedCandidateFullView.candidateName}</div>
                            </div>
                            <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                              <div className="text-sm font-medium text-muted-foreground">Email Address</div>
                              <div className="text-base font-semibold text-foreground">{selectedCandidateFullView.email}</div>
                            </div>
                            {selectedCandidateFullView.date && (
                              <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                                <div className="text-sm font-medium text-muted-foreground">Analysis Date</div>
                                <div className="text-base font-semibold text-foreground">
                                  {new Date(selectedCandidateFullView.date).toLocaleDateString('en-US', { 
                                    year: 'numeric', 
                                    month: 'long', 
                                    day: 'numeric' 
                                  })}
                                </div>
                              </div>
                            )}
                            {selectedCandidateFullView.recruitmentName && (
                              <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                                <div className="text-sm font-medium text-muted-foreground">Recruitment Campaign</div>
                                <div className="text-base font-semibold text-foreground">{selectedCandidateFullView.recruitmentName}</div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Full Assessment Overview */}
                      <Card className="hover:shadow-lg transition-all duration-300">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Target className="h-5 w-5 text-primary" />
                            Complete Assessment Metrics
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="text-center p-6 bg-gradient-to-br from-primary/10 to-transparent rounded-xl border border-primary/20">
                              <div className="text-3xl font-bold text-primary mb-2">{selectedCandidateFullView.overallScore}</div>
                              <div className="text-sm text-muted-foreground">Overall</div>
                            </div>
                            <div className="text-center p-6 bg-gradient-to-br from-primary/10 to-transparent rounded-xl border border-primary/20">
                              <div className="text-3xl font-bold text-primary mb-2">{selectedCandidateFullView.fitScore}</div>
                              <div className="text-sm text-muted-foreground">Fit Score</div>
                            </div>
                            <div className="text-center p-6 bg-gradient-to-br from-amber-500/10 to-transparent rounded-xl border border-amber-500/20">
                              <div className="text-3xl font-bold text-amber-600 mb-2">{selectedCandidateFullView.riskScore || 'N/A'}</div>
                              <div className="text-sm text-muted-foreground">Risk</div>
                            </div>
                            <div className="text-center p-6 bg-gradient-to-br from-green-500/10 to-transparent rounded-xl border border-green-500/20">
                              <div className="text-3xl font-bold text-green-600 mb-2">{selectedCandidateFullView.rewardScore || 'N/A'}</div>
                              <div className="text-sm text-muted-foreground">Reward</div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>

                    {/* AI Insights Tab */}
                    <TabsContent value="ai-insights" className="space-y-6 animate-fade-in">
                      {selectedCandidateFullView.justification && (
                        <Card className="hover:shadow-lg transition-all duration-300 overflow-hidden">
                          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-primary"></div>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-3">
                              <div className="p-3 bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl">
                                <ArrowUpRight className="h-6 w-6 text-purple-600" />
                              </div>
                              <div>
                                <div className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-primary bg-clip-text text-transparent">
                                  AI-Powered Analysis
                                </div>
                                <div className="text-sm font-normal text-muted-foreground mt-1">
                                  Comprehensive evaluation and recommendations
                                </div>
                              </div>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="prose prose-slate max-w-none">
                              <div className="p-6 bg-gradient-to-br from-muted/30 to-transparent rounded-xl border border-border/50">
                                <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap">
                                  {selectedCandidateFullView.justification}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* AI Insights Summary */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Card className="hover:shadow-lg transition-all duration-300 border-green-500/20">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <ShieldCheck className="h-5 w-5 text-green-600" />
                              <span className="text-green-700">Strengths</span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-green-600 mb-2">
                              {selectedCandidateFullView.strengths?.length || 0}
                            </div>
                            <p className="text-sm text-muted-foreground">Key strengths identified by AI</p>
                          </CardContent>
                        </Card>

                        <Card className="hover:shadow-lg transition-all duration-300 border-amber-500/20">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-amber-600" />
                              <span className="text-amber-700">Growth Areas</span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-amber-600 mb-2">
                              {selectedCandidateFullView.weaknesses?.length || 0}
                            </div>
                            <p className="text-sm text-muted-foreground">Areas for development</p>
                          </CardContent>
                        </Card>

                        <Card className="hover:shadow-lg transition-all duration-300 border-primary/20">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Trophy className="h-5 w-5 text-primary" />
                              <span className="text-primary">Match Score</span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-bold text-primary mb-2">
                              {((selectedCandidateFullView.overallScore || 0) * 10).toFixed(0)}%
                            </div>
                            <p className="text-sm text-muted-foreground">Overall compatibility</p>
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>;
};
export default ModernDashboard;
