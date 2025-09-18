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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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

            {/* Statistics Cards */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-12">
              <Card className="backdrop-blur-sm bg-white/70 border-0 shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden group hover:shadow-2xl hover:shadow-cyan-500/10 transition-all duration-300">
                <CardContent className="p-6 relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500 mb-2">Total Candidates</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                        {filteredResumes.length}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl group-hover:scale-110 transition-transform duration-300">
                      <Users className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="backdrop-blur-sm bg-white/70 border-0 shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden group hover:shadow-2xl hover:shadow-emerald-500/10 transition-all duration-300">
                <CardContent className="p-6 relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500 mb-2">High Performers</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                        {filteredResumes.filter(r => (r.overallScore || 0) >= 8).length}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl group-hover:scale-110 transition-transform duration-300">
                      <Trophy className="h-6 w-6 text-emerald-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="backdrop-blur-sm bg-white/70 border-0 shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden group hover:shadow-2xl hover:shadow-purple-500/10 transition-all duration-300">
                <CardContent className="p-6 relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500 mb-2">Reviewed Today</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                        {filteredResumes.filter(r => {
                          const today = new Date().toISOString().split('T')[0];
                          return r.date === today;
                        }).length}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl group-hover:scale-110 transition-transform duration-300">
                      <Calendar className="h-6 w-6 text-purple-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="backdrop-blur-sm bg-white/70 border-0 shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden group hover:shadow-2xl hover:shadow-amber-500/10 transition-all duration-300">
                <CardContent className="p-6 relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500 mb-2">Average Score</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">
                        {filteredResumes.length > 0 ? (filteredResumes.reduce((sum, r) => sum + (r.overallScore || 0), 0) / filteredResumes.length).toFixed(1) : '0.0'}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl group-hover:scale-110 transition-transform duration-300">
                      <Target className="h-6 w-6 text-amber-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Search and Filter Bar */}
            <div className="flex flex-col sm:flex-row gap-6 mb-8">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                <Input 
                  placeholder="Search candidates, emails, or resume titles..." 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)} 
                  className="pl-12 h-12 rounded-2xl border-slate-200 bg-white/80 backdrop-blur-sm shadow-lg focus:border-cyan-300 focus:ring-cyan-100 text-slate-700 placeholder:text-slate-400"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="outline" 
                    className="gap-2 h-12 px-6 rounded-2xl border-slate-200 bg-white/80 backdrop-blur-sm shadow-lg hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 transition-all duration-200"
                  >
                    <Filter className="h-5 w-5" />
                    Filters
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 rounded-2xl border-slate-200 bg-white/95 backdrop-blur-sm shadow-2xl" align="end">
                  <div className="space-y-6 p-2">
                    <div>
                      <Label className="text-sm font-semibold text-slate-700">Score Range</Label>
                      <Select value={filters.scoreRange} onValueChange={value => setFilters({
                      ...filters,
                      scoreRange: value
                    })}>
                        <SelectTrigger className="mt-2 rounded-xl border-slate-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200">
                          <SelectItem value="all">All Scores</SelectItem>
                          <SelectItem value="high">High (8-10)</SelectItem>
                          <SelectItem value="medium">Medium (4-7)</SelectItem>
                          <SelectItem value="low">Low (0-3)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-semibold text-slate-700">Date Range</Label>
                      <Select value={filters.dateRange} onValueChange={value => setFilters({
                      ...filters,
                      dateRange: value
                    })}>
                        <SelectTrigger className="mt-2 rounded-xl border-slate-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200">
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

            {/* Mobile-Responsive Candidate Display */}
            {filteredResumes.length > 0 ? (
              <>
                {/* Desktop Table - Hidden on Mobile */}
                <Card className="backdrop-blur-sm bg-white/80 border-0 shadow-2xl shadow-slate-200/50 rounded-3xl overflow-hidden hidden lg:block">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                          <TableHead className="font-semibold text-slate-700 py-6 px-6 text-left">Candidate</TableHead>
                          <TableHead className="font-semibold text-slate-700 py-6 px-6 text-center">Overall Score</TableHead>
                          <TableHead className="font-semibold text-slate-700 py-6 px-6 text-center">Risk/Reward</TableHead>
                          <TableHead className="font-semibold text-slate-700 py-6 px-6 text-center">Date</TableHead>
                          <TableHead className="font-semibold text-slate-700 py-6 px-6 text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResumes.map((resume, index) => {
                          const getRiskBadge = (riskScore: string) => {
                            const risk = riskScore?.toLowerCase() || 'unknown';
                            if (risk === 'high') return { color: 'bg-red-50 text-red-700 border-red-200', icon: ShieldAlert };
                            if (risk === 'medium') return { color: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle };
                            if (risk === 'low') return { color: 'bg-green-50 text-green-700 border-green-200', icon: ShieldCheck };
                            return { color: 'bg-gray-50 text-gray-700 border-gray-200', icon: ShieldAlert };
                          };
                          
                          const getRewardBadge = (rewardScore: string) => {
                            const reward = rewardScore?.toLowerCase() || 'unknown';
                            if (reward === 'high') return { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Trophy };
                            if (reward === 'medium') return { color: 'bg-blue-50 text-blue-700 border-blue-200', icon: Target };
                            if (reward === 'low') return { color: 'bg-slate-50 text-slate-700 border-slate-200', icon: Target };
                            return { color: 'bg-gray-50 text-gray-700 border-gray-200', icon: Target };
                          };
                          
                          const riskBadge = getRiskBadge(resume.riskScore || 'unknown');
                          const rewardBadge = getRewardBadge(resume.rewardScore || 'unknown');
                          
                          return (
                            <TableRow 
                              key={resume.id} 
                              className={`group hover:bg-gradient-to-r hover:from-cyan-50/30 hover:to-teal-50/30 transition-all duration-300 border-b border-slate-50 ${
                                index % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                              }`}
                            >
                              <TableCell className="py-6 px-6">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-3 mb-2">
                                    <div className="font-semibold text-slate-800 group-hover:text-cyan-700 transition-colors">
                                      {resume.candidateName || 'Unknown Candidate'}
                                    </div>
                                    {resume.recruitmentName && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Badge 
                                              className={`px-3 py-1 rounded-full text-xs font-medium border cursor-help ${getRecruitmentTagColor(resume.recruitmentName)}`}
                                            >
                                              {resume.recruitmentName}
                                            </Badge>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <div className="text-xs">
                                              <p><strong>Debug Info:</strong></p>
                                              <p>Raw DB value: "{(resume as any).recruitment_name_raw || 'N/A'}"</p>
                                              <p>Displayed: "{resume.recruitmentName}"</p>
                                            </div>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                  </div>
                                  {resume.email && (
                                    <div className="flex items-center text-sm text-slate-500">
                                      <Mail className="h-4 w-4 mr-2 text-slate-400" />
                                      <span>{resume.email}</span>
                                    </div>
                                  )}
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
                                  <Sheet open={isDetailsPanelOpen && selectedCandidate?.id === resume.id} onOpenChange={(open) => {
                                    if (!open) {
                                      setIsDetailsPanelOpen(false);
                                      setSelectedCandidate(null);
                                    }
                                  }}>
                                    <SheetTrigger asChild>
                                      <Button 
                                        size="sm" 
                                        className="h-9 w-9 p-0 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200" 
                                        title="View Details"
                                        onClick={() => {
                                          setSelectedCandidate(resume);
                                          setIsDetailsPanelOpen(true);
                                        }}
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </SheetTrigger>
                                    <SheetContent side="right" className="w-[45vw] max-w-[90vw] min-w-[600px]">
                                      <SheetHeader className="animate-fade-in">
                                        <SheetTitle className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                                          Candidate Profile
                                        </SheetTitle>
                                        <SheetDescription className="text-lg text-muted-foreground">
                                          {resume.candidateName || 'Unknown Candidate'}
                                        </SheetDescription>
                                      </SheetHeader>
                                      <ScrollArea className="h-[calc(100vh-8rem)] mt-8">
                                        <div className="space-y-8 animate-fade-in">
                                          {/* Candidate Info */}
                                          <div className="border rounded-2xl p-6 bg-gradient-to-br from-white to-slate-50/50 shadow-lg hover:shadow-xl transition-all duration-300 animate-scale-in">
                                            <div className="flex items-center gap-4 mb-6">
                                              <div className="p-3 bg-gradient-to-br from-cyan-50 to-teal-50 rounded-xl">
                                                <Mail className="h-6 w-6 text-cyan-600" />
                                              </div>
                                              <div>
                                                <h4 className="text-xl font-bold text-foreground">{resume.candidateName}</h4>
                                                {resume.email && <p className="text-sm text-muted-foreground mt-1">{resume.email}</p>}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                              <Calendar className="h-4 w-4" />
                                              <span>Analyzed on {resume.date ? new Date(resume.date).toLocaleDateString() : 'Unknown date'}</span>
                                            </div>
                                          </div>

                                          {/* Scores */}
                                          <div className="space-y-6 animate-fade-in [animation-delay:200ms]">
                                            <h4 className="text-lg font-bold text-foreground flex items-center gap-2">
                                              <Target className="h-5 w-5 text-cyan-600" />
                                              Assessment Scores
                                            </h4>
                                            <div className="grid grid-cols-1 gap-6">
                                              <div className="border rounded-2xl p-6 bg-gradient-to-br from-cyan-50/50 to-white shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                                                <div className="flex justify-between items-center mb-4">
                                                  <span className="text-lg font-semibold text-slate-700">Overall Score</span>
                                                  <span className="text-2xl font-bold text-cyan-600">{resume.overallScore}/10</span>
                                                </div>
                                                <Progress value={(resume.overallScore || 0) * 10} className="h-3 rounded-full" />
                                              </div>
                                              <div className="border rounded-2xl p-6 bg-gradient-to-br from-teal-50/50 to-white shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                                                <div className="flex justify-between items-center mb-4">
                                                  <span className="text-lg font-semibold text-slate-700">Fit Score</span>
                                                  <span className="text-2xl font-bold text-teal-600">{resume.fitScore}/10</span>
                                                </div>
                                                <Progress value={(resume.fitScore || 0) * 10} className="h-3 rounded-full" />
                                              </div>
                                            </div>
                                          </div>

                                          {/* Risk & Reward */}
                                          <div className="space-y-6 animate-fade-in [animation-delay:400ms]">
                                            <h4 className="text-lg font-bold text-foreground flex items-center gap-2">
                                              <ShieldAlert className="h-5 w-5 text-amber-500" />
                                              Risk & Reward Analysis
                                            </h4>
                                            <div className="grid grid-cols-2 gap-6">
                                              <div className="border rounded-2xl p-6 text-center bg-gradient-to-br from-amber-50/50 to-white shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                                                <div className="p-3 bg-gradient-to-br from-amber-100 to-orange-100 rounded-xl mx-auto mb-4 w-fit">
                                                  <AlertTriangle className="h-8 w-8 text-amber-600" />
                                                </div>
                                                <p className="text-sm text-muted-foreground mb-2 font-medium">Risk Factor</p>
                                                <p className="text-xl font-bold text-amber-700">{resume.riskScore || 'Unknown'}</p>
                                              </div>
                                              <div className="border rounded-2xl p-6 text-center bg-gradient-to-br from-green-50/50 to-white shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                                                <div className="p-3 bg-gradient-to-br from-green-100 to-emerald-100 rounded-xl mx-auto mb-4 w-fit">
                                                  <Trophy className="h-8 w-8 text-green-600" />
                                                </div>
                                                <p className="text-sm text-muted-foreground mb-2 font-medium">Reward Factor</p>
                                                <p className="text-xl font-bold text-green-700">{resume.rewardScore || 'Unknown'}</p>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Strengths & Weaknesses */}
                                          {(resume.strengths?.length > 0 || resume.weaknesses?.length > 0) && (
                                            <div className="space-y-6 animate-fade-in [animation-delay:600ms]">
                                              <h4 className="text-lg font-bold text-foreground flex items-center gap-2">
                                                <ShieldCheck className="h-5 w-5 text-green-600" />
                                                Detailed Analysis
                                              </h4>
                                              <div className="grid grid-cols-1 gap-6">
                                                {resume.strengths?.length > 0 && (
                                                  <div className="border rounded-2xl p-6 bg-gradient-to-br from-green-50/50 to-white shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                                                    <h5 className="text-lg font-bold text-green-700 mb-4 flex items-center gap-2">
                                                      <CheckCircle className="h-5 w-5" />
                                                      Strengths
                                                    </h5>
                                                    <ul className="text-sm text-slate-600 space-y-2 leading-relaxed">
                                                      {resume.strengths.map((strength, idx) => (
                                                        <li key={idx} className="flex items-start gap-2">
                                                          <span className="text-green-500 mt-1">•</span>
                                                          <span>{strength}</span>
                                                        </li>
                                                      ))}
                                                    </ul>
                                                  </div>
                                                )}
                                                {resume.weaknesses?.length > 0 && (
                                                  <div className="border rounded-2xl p-6 bg-gradient-to-br from-red-50/50 to-white shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                                                    <h5 className="text-lg font-bold text-red-700 mb-4 flex items-center gap-2">
                                                      <AlertTriangle className="h-5 w-5" />
                                                      Areas for Improvement
                                                    </h5>
                                                    <ul className="text-sm text-slate-600 space-y-2 leading-relaxed">
                                                      {resume.weaknesses.map((weakness, idx) => (
                                                        <li key={idx} className="flex items-start gap-2">
                                                          <span className="text-red-500 mt-1">•</span>
                                                          <span>{weakness}</span>
                                                        </li>
                                                      ))}
                                                    </ul>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          )}

                                          {/* AI Analysis */}
                                          {resume.justification && (
                                            <div className="space-y-6 animate-fade-in [animation-delay:800ms]">
                                              <h4 className="text-lg font-bold text-foreground flex items-center gap-3">
                                                <div className="p-2 bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl">
                                                  <ArrowUpRight className="h-5 w-5 text-purple-600" />
                                                </div>
                                                AI Analysis
                                              </h4>
                                              
                                              {/* Container with traveling border glow */}
                                              <div className="relative">
                                                <div className="relative bg-white rounded-2xl border-2 border-transparent overflow-hidden shadow-lg">
                                                  {/* Traveling glow border effect */}
                                                  <div className="absolute inset-0 rounded-2xl">
                                                    <div className="absolute inset-0 rounded-2xl border-2 border-transparent bg-gradient-to-r from-purple-500 via-cyan-500 via-pink-500 to-purple-500 animate-gradient bg-300% opacity-80 [mask:linear-gradient(#fff_0_0)_padding-box,_linear-gradient(#fff_0_0)] [mask-composite:xor] [mask-composite:exclude]"></div>
                                                  </div>
                                                  
                                                  {/* Content area */}
                                                  <div className="relative z-10 p-8 bg-white rounded-2xl m-[2px]">
                                                    {/* AI Analysis Header */}
                                                    <div className="flex items-center gap-3 mb-6">
                                                      <div className="flex items-center gap-2">
                                                        <div className="w-3 h-3 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full animate-pulse"></div>
                                                        <h5 className="text-lg font-bold bg-gradient-to-r from-purple-600 to-cyan-600 bg-clip-text text-transparent">
                                                          AI Analysis
                                                        </h5>
                                                      </div>
                                                    </div>
                                                    
                                                    {/* Analysis content */}
                                                    <div className="relative">
                                                      <p className="text-base text-slate-700 leading-relaxed font-medium">
                                                        {resume.justification}
                                                      </p>
                                                    </div>
                                                    
                                                    {/* Subtle bottom accent */}
                                                    <div className="mt-6 h-px bg-gradient-to-r from-transparent via-purple-200 to-transparent"></div>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          )}

                                          {/* Resume View Button */}
                                          {resume.resume && (
                                            <div className="space-y-4 animate-fade-in [animation-delay:1000ms]">
                                              <h4 className="text-lg font-bold text-foreground flex items-center gap-2">
                                                <FileText className="h-5 w-5 text-blue-600" />
                                                Resume Document
                                              </h4>
                                              <div className="border rounded-2xl p-6 bg-gradient-to-br from-blue-50/50 to-white shadow-md hover:shadow-lg transition-all duration-300">
                                                <div className="flex items-center justify-between">
                                                  <div>
                                                    <p className="text-sm text-slate-600 mb-2">View the original resume document</p>
                                                    <p className="text-xs text-muted-foreground">Click to open in a new tab</p>
                                                  </div>
                                                  <Button
                                                    onClick={() => window.open(resume.resume, '_blank')}
                                                    className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 gap-2"
                                                  >
                                                    <FileText className="h-4 w-4" />
                                                    View Resume
                                                  </Button>
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                       </div>
                                     </ScrollArea>
                                    </SheetContent>
                                  </Sheet>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="h-9 w-9 p-0 rounded-xl border-slate-200 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-600 transition-all duration-200" 
                                        title="More Actions"
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="rounded-2xl border-slate-200 bg-white/95 backdrop-blur-sm shadow-2xl">
                                      <DropdownMenuItem 
                                        onClick={() => window.open(resume.resume, '_blank')}
                                        className="rounded-xl hover:bg-slate-50 cursor-pointer"
                                      >
                                        <Download className="h-4 w-4 mr-3 text-slate-500" />
                                        Download Resume
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => handleDeleteCandidate(resume.id)}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCandidate(resume);
                                setIsDetailsPanelOpen(true);
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
    </div>;
};
export default ModernDashboard;