import React, { useState, useEffect } from "react";
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
const ModernDashboard = () => {
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
          overallScore: overallScore
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
    return <div className="min-h-screen bg-white">
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mr-3" />
          <span className="text-lg text-muted-foreground">Loading candidates...</span>
        </div>
      </div>;
  }
  return <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {viewMode === 'folders' && selectedFolder ? selectedFolder : 'Candidate Dashboard'}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {viewMode === 'folders' && selectedFolder ? `${filteredResumes.length} candidates in ${selectedFolder}` : 'Manage and analyze candidate applications'}
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => setViewMode(viewMode === 'all' ? 'folders' : 'all')} variant={viewMode === 'folders' ? 'secondary' : 'outline'} size="sm" className="gap-2">
                <Folder className="h-4 w-4" />
                {viewMode === 'folders' ? 'Show All' : 'Folders'}
              </Button>
              <Button onClick={fetchResumeData} variant="outline" size="sm" className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Folder View */}
          {viewMode === 'folders' && !selectedFolder && <div className="mb-8">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(recruitmentFolders).map(([folderName, candidates]) => <Card key={folderName} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedFolder(folderName)}>
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-muted rounded-md">
                          <Folder className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium">{folderName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
          <div className={`${viewMode === 'folders' && !selectedFolder ? 'hidden' : ''} space-y-6`}>
            <div className="flex flex-col sm:flex-row gap-4">
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

            {/* Enhanced Statistics Cards */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <Card className="bg-gradient-to-br from-blue-500/10 via-blue-400/5 to-blue-300/10 border border-blue-200/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-blue-700 uppercase tracking-wide mb-2">Total Candidates</p>
                      <p className="text-3xl font-black text-blue-900 group-hover:scale-110 transition-transform">
                        {filteredResumes.length}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-blue-500/20 to-blue-400/10 rounded-xl shadow-sm group-hover:shadow-md group-hover:scale-110 transition-all">
                      <Users className="h-8 w-8 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-emerald-500/10 via-emerald-400/5 to-emerald-300/10 border border-emerald-200/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-emerald-700 uppercase tracking-wide mb-2">High Performers</p>
                      <p className="text-3xl font-black text-emerald-900 group-hover:scale-110 transition-transform">
                        {filteredResumes.filter(r => (r.overallScore || 0) >= 8).length}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-emerald-500/20 to-emerald-400/10 rounded-xl shadow-sm group-hover:shadow-md group-hover:scale-110 transition-all">
                      <Trophy className="h-8 w-8 text-emerald-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-amber-500/10 via-amber-400/5 to-amber-300/10 border border-amber-200/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-amber-700 uppercase tracking-wide mb-2">High Risk</p>
                      <p className="text-3xl font-black text-amber-900 group-hover:scale-110 transition-transform">
                        {filteredResumes.filter(r => (r.riskFactor || 0) >= 7).length}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-amber-500/20 to-amber-400/10 rounded-xl shadow-sm group-hover:shadow-md group-hover:scale-110 transition-all">
                      <ShieldAlert className="h-8 w-8 text-amber-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-purple-500/10 via-purple-400/5 to-purple-300/10 border border-purple-200/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-purple-700 uppercase tracking-wide mb-2">Average Score</p>
                      <p className="text-3xl font-black text-purple-900 group-hover:scale-110 transition-transform">
                        {filteredResumes.length > 0 ? (filteredResumes.reduce((sum, r) => sum + (r.overallScore || 0), 0) / filteredResumes.length).toFixed(1) : '0.0'}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-br from-purple-500/20 to-purple-400/10 rounded-xl shadow-sm group-hover:shadow-md group-hover:scale-110 transition-all">
                      <Target className="h-8 w-8 text-purple-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Candidates Table */}
            {filteredResumes.length > 0 ? <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b">
                        <TableHead className="font-medium text-foreground py-3 px-4">Candidate</TableHead>
                        <TableHead className="font-medium text-foreground py-3 px-4">Overall Score</TableHead>
                        <TableHead className="font-medium text-foreground py-3 px-4">Risk/Reward</TableHead>
                        <TableHead className="font-medium text-foreground py-3 px-4">Date</TableHead>
                        <TableHead className="font-medium text-foreground py-3 px-4">Actions</TableHead>
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
                            className={`hover:bg-muted/50 transition-colors ${
                              index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                            }`}
                          >
                            <TableCell className="py-4 px-4">
                              <div className="flex flex-col">
                                <div className="flex items-center gap-3 mb-1">
                                  <div className="font-medium text-foreground">
                                    {resume.candidateName || 'Unknown Candidate'}
                                  </div>
                                  {resume.recruitmentName && <Badge variant="secondary" className="text-xs">
                                      {resume.recruitmentName}
                                    </Badge>}
                                </div>
                                {resume.email && <div className="flex items-center text-sm text-muted-foreground">
                                    <Mail className="h-3 w-3 mr-1" />
                                    <span>{resume.email}</span>
                                  </div>}
                              </div>
                            </TableCell>
                            <TableCell className="py-4 px-4">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-[100px]">
                                  <Progress 
                                    value={(resume.overallScore || 0) * 10} 
                                    className="h-2" 
                                  />
                                </div>
                                <span className="text-sm font-medium text-foreground min-w-[2.5rem]">
                                  {resume.overallScore || 0}/10
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="py-4 px-4">
                              <div className="flex flex-col gap-1">
                                <Badge className={`text-xs px-2 py-1 font-medium rounded-md border flex items-center gap-1 w-fit ${riskBadge.color}`}>
                                  <riskBadge.icon className="h-3 w-3" />
                                  Risk: {resume.riskScore || 'Unknown'}
                                </Badge>
                                <Badge className={`text-xs px-2 py-1 font-medium rounded-md border flex items-center gap-1 w-fit ${rewardBadge.color}`}>
                                  <rewardBadge.icon className="h-3 w-3" />
                                  Reward: {resume.rewardScore || 'Unknown'}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="py-4 px-4">
                              <div className="flex items-center text-sm text-muted-foreground">
                                <Calendar className="h-4 w-4 mr-2" />
                                <span>{resume.date ? new Date(resume.date).toLocaleDateString() : 'Unknown'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-4 px-4">
                              <div className="flex items-center gap-2">
                                <Sheet>
                                  <SheetTrigger asChild>
                                    <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="View Details">
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                  </SheetTrigger>
                                  <SheetContent side="right" className="w-[600px] max-w-[90vw]">
                                    <SheetHeader>
                                      <SheetTitle>Candidate Profile</SheetTitle>
                                      <SheetDescription>
                                        {resume.candidateName || 'Unknown Candidate'}
                                      </SheetDescription>
                                    </SheetHeader>
                                    <ScrollArea className="h-[calc(100vh-8rem)] mt-6">
                                      <div className="space-y-6">
                                        {/* Candidate Info */}
                                        <div className="border rounded-lg p-4">
                                          <div className="flex items-center gap-3 mb-4">
                                            <Mail className="h-5 w-5 text-muted-foreground" />
                                            <div>
                                              <h4 className="font-medium text-foreground">{resume.candidateName}</h4>
                                              {resume.email && <p className="text-sm text-muted-foreground">{resume.email}</p>}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Calendar className="h-4 w-4" />
                                            <span>Analyzed on {resume.date ? new Date(resume.date).toLocaleDateString() : 'Unknown date'}</span>
                                          </div>
                                        </div>

                                        {/* Scores */}
                                        <div className="space-y-4">
                                          <h4 className="font-medium text-foreground">Assessment Scores</h4>
                                          <div className="grid grid-cols-1 gap-4">
                                            <div className="border rounded-lg p-4">
                                              <div className="flex justify-between items-center mb-2">
                                                <span className="text-sm font-medium">Overall Score</span>
                                                <span className="text-sm font-medium">{resume.overallScore}/10</span>
                                              </div>
                                              <Progress value={(resume.overallScore || 0) * 10} className="h-2" />
                                            </div>
                                            <div className="border rounded-lg p-4">
                                              <div className="flex justify-between items-center mb-2">
                                                <span className="text-sm font-medium">Fit Score</span>
                                                <span className="text-sm font-medium">{resume.fitScore}/10</span>
                                              </div>
                                              <Progress value={(resume.fitScore || 0) * 10} className="h-2" />
                                            </div>
                                          </div>
                                        </div>

                                        {/* Risk & Reward */}
                                        <div className="space-y-4">
                                          <h4 className="font-medium text-foreground">Risk & Reward Analysis</h4>
                                          <div className="grid grid-cols-2 gap-4">
                                            <div className="border rounded-lg p-4 text-center">
                                              <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-amber-500" />
                                              <p className="text-sm text-muted-foreground mb-1">Risk Factor</p>
                                              <p className="font-medium">{resume.riskScore || 'Unknown'}</p>
                                            </div>
                                            <div className="border rounded-lg p-4 text-center">
                                              <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
                                              <p className="text-sm text-muted-foreground mb-1">Reward Factor</p>
                                              <p className="font-medium">{resume.rewardScore || 'Unknown'}</p>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Strengths & Weaknesses */}
                                        {(resume.strengths?.length > 0 || resume.weaknesses?.length > 0) && (
                                          <div className="space-y-4">
                                            <h4 className="font-medium text-foreground">Analysis</h4>
                                            <div className="grid grid-cols-1 gap-4">
                                              {resume.strengths?.length > 0 && (
                                                <div className="border rounded-lg p-4">
                                                  <h5 className="font-medium text-green-700 mb-2">Strengths</h5>
                                                  <ul className="text-sm text-muted-foreground space-y-1">
                                                    {resume.strengths.map((strength, idx) => (
                                                      <li key={idx}>• {strength}</li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              )}
                                              {resume.weaknesses?.length > 0 && (
                                                <div className="border rounded-lg p-4">
                                                  <h5 className="font-medium text-red-700 mb-2">Areas for Improvement</h5>
                                                  <ul className="text-sm text-muted-foreground space-y-1">
                                                    {resume.weaknesses.map((weakness, idx) => (
                                                      <li key={idx}>• {weakness}</li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )}

                                        {/* Justification */}
                                        {resume.justification && (
                                          <div className="space-y-2">
                                            <h4 className="font-medium text-foreground">Justification</h4>
                                            <div className="border rounded-lg p-4">
                                              <p className="text-sm text-muted-foreground">{resume.justification}</p>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </ScrollArea>
                                  </SheetContent>
                                </Sheet>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => window.open(resume.resume, '_blank')}>
                                      <Download className="h-4 w-4 mr-2" />
                                      Download Resume
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => handleDeleteCandidate(resume.id)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
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
              </Card> : <Card>
                <CardContent className="p-12 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 bg-muted/50 rounded-full">
                      <Users className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium text-lg">No candidates found</h3>
                      <p className="text-muted-foreground text-sm">
                        {searchTerm || filters.scoreRange !== 'all' || filters.dateRange !== 'all' ? 'Try adjusting your search or filter criteria' : 'Upload and analyze resumes to see candidate data here'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>}
          </div>
        </div>
      </div>
    </div>;
};
export default ModernDashboard;