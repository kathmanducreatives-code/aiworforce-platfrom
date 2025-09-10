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
  
  const colors = [
    "bg-blue-100 text-blue-800 hover:bg-blue-200",
    "bg-green-100 text-green-800 hover:bg-green-200", 
    "bg-purple-100 text-purple-800 hover:bg-purple-200",
    "bg-orange-100 text-orange-800 hover:bg-orange-200",
    "bg-pink-100 text-pink-800 hover:bg-pink-200",
    "bg-indigo-100 text-indigo-800 hover:bg-indigo-200",
    "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
    "bg-teal-100 text-teal-800 hover:bg-teal-200",
    "bg-red-100 text-red-800 hover:bg-red-200",
    "bg-cyan-100 text-cyan-800 hover:bg-cyan-200"
  ];
  
  return colors[Math.abs(hash) % colors.length];
};
import { 
  Search, 
  FileText, 
  TrendingUp, 
  Users, 
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Filter,
  MoreVertical,
  Eye,
  Download,
  Trash2,
  X,
  Mail,
  Calendar,
  ArrowUpRight,
  Folder,
  ChevronRight
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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
  const { toast } = useToast();

  const itemsPerPage = 10;

  const handleDeleteCandidate = async (candidateId: string) => {
    try {
      const { error } = await supabase
        .from('resume_analyses')
        .delete()
        .eq('id', candidateId);

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
        description: 'Candidate has been successfully removed.',
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
      
      const { data, error } = await supabase
        .from('resume_analyses')
        .select('*')
        .order('created_at', { ascending: false });
      
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
        };
      });

      setResumeData(normalized);
    } catch (error) {
      console.error('Error fetching resume data:', error);
      toast({
        title: "Error",
        description: "Failed to load resume analysis data. Please try again.",
        variant: "destructive",
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
    let filtered = viewMode === 'folders' && selectedFolder 
      ? recruitmentFolders[selectedFolder] || []
      : resumeData;

    return filtered.filter(resume => {
      const matchesSearch = 
        resume.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        resume.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        resume.resume.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesScore = filters.scoreRange === 'all' || (() => {
        const score = resume.overallScore || 0;
        switch (filters.scoreRange) {
          case 'high': return score >= 8;
          case 'medium': return score >= 4 && score < 8;
          case 'low': return score < 4;
          default: return true;
        }
      })();

      const matchesReward = filters.rewardFactor === 'all' || 
        resume.rewardScore?.toLowerCase() === filters.rewardFactor.toLowerCase();

      const matchesDate = filters.dateRange === 'all' || (() => {
        const resumeDate = new Date(resume.date || '');
        const today = new Date();
        const daysDiff = Math.floor((today.getTime() - resumeDate.getTime()) / (1000 * 60 * 60 * 24));
        
        switch (filters.dateRange) {
          case 'today': return daysDiff === 0;
          case 'week': return daysDiff <= 7;
          case 'month': return daysDiff <= 30;
          default: return true;
        }
      })();
      
      return matchesSearch && matchesScore && matchesReward && matchesDate;
    });
  }, [viewMode, selectedFolder, recruitmentFolders, resumeData, searchTerm, filters]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mr-3" />
          <span className="text-lg text-muted-foreground">Loading candidates...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">
                {viewMode === 'folders' && selectedFolder ? selectedFolder : 'Candidate Dashboard'}
              </h1>
              <p className="text-muted-foreground mt-2">
                {viewMode === 'folders' && selectedFolder 
                  ? `Candidates in ${selectedFolder}` 
                  : 'Manage and analyze candidate applications with AI-powered insights'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setViewMode(viewMode === 'all' ? 'folders' : 'all')}
                variant={viewMode === 'folders' ? 'default' : 'outline'}
                size="sm"
                className="gap-2"
              >
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
          {viewMode === 'folders' && !selectedFolder && (
            <div className="mb-8">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(recruitmentFolders).map(([folderName, candidates]) => (
                  <Card 
                    key={folderName} 
                    className="cursor-pointer hover:bg-accent/50 transition-colors border-0 shadow-sm"
                    onClick={() => setSelectedFolder(folderName)}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <Folder className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg">{folderName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb for folder navigation */}
          {viewMode === 'folders' && selectedFolder && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedFolder(null)}
                className="p-0 h-auto text-sm hover:text-foreground"
              >
                Folders
              </Button>
              <ChevronRight className="h-3 w-3" />
              <span className="font-medium text-foreground">{selectedFolder}</span>
            </div>
          )}

          {/* Search and Filter Bar */}
          <div className={`${viewMode === 'folders' && !selectedFolder ? 'hidden' : ''} space-y-6`}>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search candidates, emails, or resume titles..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 border-0 bg-muted/30 focus:bg-background"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 border-0 bg-muted/30">
                    <Filter className="h-4 w-4" />
                    Filters
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">Score Range</Label>
                      <Select value={filters.scoreRange} onValueChange={(value) => setFilters({...filters, scoreRange: value})}>
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
                      <Select value={filters.dateRange} onValueChange={(value) => setFilters({...filters, dateRange: value})}>
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-700">Total Candidates</p>
                      <p className="text-2xl font-bold text-blue-900">{filteredResumes.length}</p>
                    </div>
                    <Users className="h-8 w-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-green-50 to-green-100/50 border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-green-700">High Scores</p>
                      <p className="text-2xl font-bold text-green-900">
                        {filteredResumes.filter(r => (r.overallScore || 0) >= 8).length}
                      </p>
                    </div>
                    <TrendingUp className="h-8 w-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100/50 border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-yellow-700">High Risk</p>
                      <p className="text-2xl font-bold text-yellow-900">
                        {filteredResumes.filter(r => (r.riskFactor || 0) >= 7).length}
                      </p>
                    </div>
                    <AlertTriangle className="h-8 w-8 text-yellow-600" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 border-0">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-purple-700">Avg Score</p>
                      <p className="text-2xl font-bold text-purple-900">
                        {filteredResumes.length > 0 
                          ? (filteredResumes.reduce((sum, r) => sum + (r.overallScore || 0), 0) / filteredResumes.length).toFixed(1)
                          : '0.0'
                        }
                      </p>
                    </div>
                    <CheckCircle className="h-8 w-8 text-purple-600" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Candidates Table */}
            {filteredResumes.length > 0 ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <div className="rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="font-semibold">Candidate</TableHead>
                          <TableHead className="font-semibold">Overall Score</TableHead>
                          <TableHead className="font-semibold">Risk/Reward</TableHead>
                          <TableHead className="font-semibold">Date</TableHead>
                          <TableHead className="font-semibold">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResumes.map((resume, index) => (
                          <TableRow key={resume.id} className="hover:bg-muted/20 transition-colors">
                            <TableCell>
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="font-medium text-foreground">
                                    {resume.candidateName || 'Unknown Candidate'}
                                  </div>
                                  {resume.recruitmentName && (
                                    <Badge 
                                      className={`text-xs px-2 py-0.5 font-medium transition-colors ${getRecruitmentTagColor(resume.recruitmentName)}`}
                                    >
                                      {resume.recruitmentName}
                                    </Badge>
                                  )}
                                </div>
                                {resume.email && (
                                  <div className="flex items-center text-sm text-muted-foreground mt-1">
                                    <Mail className="h-3 w-3 mr-1" />
                                    {resume.email}
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground mt-1 flex items-center">
                                  <FileText className="h-3 w-3 mr-1" />
                                  {resume.resume || 'Resume file'}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="flex-1">
                                  <Progress 
                                    value={(resume.overallScore || 0) * 10} 
                                    className="h-2"
                                  />
                                </div>
                                <span className="text-sm font-medium min-w-[2rem]">
                                  {resume.overallScore || 0}/10
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Badge 
                                  variant={resume.riskScore === "High" ? "destructive" : resume.riskScore === "Medium" ? "secondary" : "outline"}
                                  className="text-xs"
                                >
                                  Risk: {resume.riskScore || 'Unknown'}
                                </Badge>
                                <Badge 
                                  variant={resume.rewardScore === "High" ? "default" : "outline"}
                                  className="text-xs"
                                >
                                  Reward: {resume.rewardScore || 'Unknown'}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center text-sm text-muted-foreground">
                                <Calendar className="h-3 w-3 mr-1" />
                                {resume.date ? new Date(resume.date).toLocaleDateString() : 'Unknown'}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                 <Sheet>
                                   <SheetTrigger asChild>
                                     <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary transition-colors">
                                       <Eye className="h-4 w-4" />
                                     </Button>
                                   </SheetTrigger>
                                    <SheetContent side="right" className="w-[35vw] min-w-[500px] max-w-[900px] bg-gradient-to-br from-background via-background/95 to-accent/5 border-l border-border/30 backdrop-blur-sm shadow-2xl">
                                      <SheetHeader className="pb-8 border-b border-border/20 bg-gradient-to-r from-primary/5 to-accent/5 -mx-6 -mt-6 px-6 pt-6 mb-6 rounded-t-lg">
                                        <div className="flex items-center gap-4">
                                          <div className="p-3 bg-gradient-to-br from-primary/20 to-primary/10 rounded-xl shadow-sm border border-primary/20">
                                            <Users className="h-6 w-6 text-primary" />
                                          </div>
                                          <div className="flex-1">
                                            <SheetTitle className="text-2xl font-bold bg-gradient-to-r from-foreground via-primary to-foreground/80 bg-clip-text text-transparent mb-1">
                                              Candidate Profile
                                            </SheetTitle>
                                            <SheetDescription className="text-muted-foreground/80 text-lg font-medium">
                                              {resume.candidateName || 'Unknown Candidate'}
                                            </SheetDescription>
                                          </div>
                                        </div>
                                      </SheetHeader>
                                      <ScrollArea className="h-[calc(100vh-12rem)] mt-2">
                                        <div className="space-y-10 pr-6 pb-8">
                                          {/* Candidate Info Card */}
                                          <div className="bg-gradient-to-br from-primary/8 via-primary/5 to-accent/8 border border-primary/15 rounded-2xl p-6 animate-fade-in shadow-sm hover:shadow-md transition-all duration-300">
                                            <div className="flex items-center gap-4 mb-4">
                                              <div className="p-3 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 rounded-xl shadow-sm">
                                                <Mail className="h-5 w-5 text-primary" />
                                              </div>
                                              <div className="flex-1">
                                                <h4 className="font-bold text-lg text-foreground mb-1">{resume.candidateName}</h4>
                                                {resume.email && (
                                                  <p className="text-sm text-muted-foreground/80 font-medium">{resume.email}</p>
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-3 text-sm text-muted-foreground bg-background/50 rounded-lg p-3 border border-border/30">
                                              <Calendar className="h-4 w-4 text-primary" />
                                              <span className="font-medium">Analyzed on {resume.date ? new Date(resume.date).toLocaleDateString() : 'Unknown date'}</span>
                                            </div>
                                          </div>

                                          {/* Overall Assessment */}
                                          <div className="animate-fade-in" style={{animationDelay: '0.1s'}}>
                                            <h4 className="font-bold text-xl mb-6 flex items-center gap-3 text-primary">
                                              <div className="p-2 bg-gradient-to-br from-primary/20 to-primary/10 rounded-xl">
                                                <TrendingUp className="h-6 w-6 text-primary" />
                                              </div>
                                              Overall Assessment
                                            </h4>
                                            <div className="grid grid-cols-2 gap-6">
                                              <div className="bg-gradient-to-br from-blue-50 via-indigo-50/80 to-blue-100/50 border border-blue-200/40 rounded-2xl p-6 hover:shadow-lg hover:scale-105 transition-all duration-300 group">
                                                <div className="flex justify-between items-center mb-4">
                                                  <span className="text-sm font-bold text-blue-700 uppercase tracking-wide">Overall Score</span>
                                                  <div className="bg-blue-100 rounded-full px-3 py-1">
                                                    <span className="text-xl font-black text-blue-900">{resume.overallScore}/10</span>
                                                  </div>
                                                </div>
                                                <div className="relative">
                                                  <Progress 
                                                    value={(resume.overallScore || 0) * 10} 
                                                    className="h-4 bg-blue-100 [&>div]:bg-gradient-to-r [&>div]:from-blue-500 [&>div]:to-indigo-600 [&>div]:shadow-sm [&>div]:transition-all [&>div]:duration-500 group-hover:[&>div]:shadow-md" 
                                                  />
                                                  <div className="absolute -top-2 left-0 w-full flex justify-between text-xs text-blue-600/70 font-medium">
                                                    <span>0</span>
                                                    <span>5</span>
                                                    <span>10</span>
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="bg-gradient-to-br from-emerald-50 via-green-50/80 to-emerald-100/50 border border-emerald-200/40 rounded-2xl p-6 hover:shadow-lg hover:scale-105 transition-all duration-300 group">
                                                <div className="flex justify-between items-center mb-4">
                                                  <span className="text-sm font-bold text-emerald-700 uppercase tracking-wide">Fit Score</span>
                                                  <div className="bg-emerald-100 rounded-full px-3 py-1">
                                                    <span className="text-xl font-black text-emerald-900">{resume.fitScore}/10</span>
                                                  </div>
                                                </div>
                                                <div className="relative">
                                                  <Progress 
                                                    value={(resume.fitScore || 0) * 10} 
                                                    className="h-4 bg-emerald-100 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-green-600 [&>div]:shadow-sm [&>div]:transition-all [&>div]:duration-500 group-hover:[&>div]:shadow-md" 
                                                  />
                                                  <div className="absolute -top-2 left-0 w-full flex justify-between text-xs text-emerald-600/70 font-medium">
                                                    <span>0</span>
                                                    <span>5</span>
                                                    <span>10</span>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Risk & Reward Analysis */}
                                          <div className="animate-fade-in" style={{animationDelay: '0.2s'}}>
                                            <h4 className="font-bold text-xl mb-6 flex items-center gap-3 text-orange-600">
                                              <div className="p-2 bg-gradient-to-br from-orange-100 to-orange-50 rounded-xl">
                                                <AlertTriangle className="h-6 w-6 text-orange-600" />
                                              </div>
                                              Risk & Reward Analysis
                                            </h4>
                                            <div className="grid grid-cols-2 gap-6">
                                              <div className="group bg-gradient-to-br from-red-50 via-red-50/80 to-red-100/60 border border-red-200/40 rounded-2xl p-8 text-center hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                                                <div className="p-4 bg-gradient-to-br from-red-100 to-red-50 rounded-2xl w-fit mx-auto mb-6 group-hover:bg-red-200 transition-all duration-300 shadow-sm">
                                                  <AlertTriangle className="h-8 w-8 text-red-600" />
                                                </div>
                                                 <p className="text-sm text-red-600 font-bold mb-3 uppercase tracking-wide">Risk Factor</p>
                                                 <p className="text-3xl font-black text-red-700 group-hover:scale-110 transition-transform bg-red-100 rounded-xl py-2 px-4 inline-block">{resume.riskScore || 'Unknown'}</p>
                                              </div>
                                              <div className="group bg-gradient-to-br from-green-50 via-green-50/80 to-green-100/60 border border-green-200/40 rounded-2xl p-8 text-center hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer">
                                                <div className="p-4 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl w-fit mx-auto mb-6 group-hover:bg-green-200 transition-all duration-300 shadow-sm">
                                                  <CheckCircle className="h-8 w-8 text-green-600" />
                                                </div>
                                                 <p className="text-sm text-green-600 font-bold mb-3 uppercase tracking-wide">Reward Factor</p>
                                                 <p className="text-3xl font-black text-green-700 group-hover:scale-110 transition-transform bg-green-100 rounded-xl py-2 px-4 inline-block">{resume.rewardScore || 'Unknown'}</p>
                                              </div>
                                            </div>
                                          </div>

                                         {/* Strengths */}
                                         {resume.strengths && resume.strengths.length > 0 && (
                                           <div className="animate-fade-in" style={{animationDelay: '0.3s'}}>
                                             <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-green-700">
                                               <CheckCircle className="h-5 w-5" />
                                               Key Strengths
                                             </h4>
                                             <div className="bg-gradient-to-br from-green-50/50 to-emerald-50/50 border border-green-200/30 rounded-xl p-5">
                                               <div className="space-y-3">
                                                 {resume.strengths.map((strength, idx) => (
                                                   <div 
                                                     key={idx} 
                                                     className="flex items-start gap-3 p-3 bg-white/60 rounded-lg hover:bg-white/80 transition-all duration-200 hover:shadow-sm animate-fade-in group"
                                                     style={{animationDelay: `${0.4 + idx * 0.1}s`}}
                                                   >
                                                     <div className="p-1 bg-green-100 rounded-full group-hover:bg-green-200 transition-colors">
                                                       <CheckCircle className="h-4 w-4 text-green-600" />
                                                     </div>
                                                     <span className="text-sm text-foreground font-medium flex-1">{strength}</span>
                                                   </div>
                                                 ))}
                                               </div>
                                             </div>
                                           </div>
                                         )}

                                         {/* Areas for Improvement */}
                                         {resume.weaknesses && resume.weaknesses.length > 0 && (
                                           <div className="animate-fade-in" style={{animationDelay: '0.4s'}}>
                                             <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-orange-700">
                                               <AlertTriangle className="h-5 w-5" />
                                               Areas for Improvement
                                             </h4>
                                             <div className="bg-gradient-to-br from-orange-50/50 to-red-50/50 border border-orange-200/30 rounded-xl p-5">
                                               <div className="space-y-3">
                                                 {resume.weaknesses.map((weakness, idx) => (
                                                   <div 
                                                     key={idx} 
                                                     className="flex items-start gap-3 p-3 bg-white/60 rounded-lg hover:bg-white/80 transition-all duration-200 hover:shadow-sm animate-fade-in group"
                                                     style={{animationDelay: `${0.5 + idx * 0.1}s`}}
                                                   >
                                                     <div className="p-1 bg-orange-100 rounded-full group-hover:bg-orange-200 transition-colors">
                                                       <AlertTriangle className="h-4 w-4 text-orange-600" />
                                                     </div>
                                                     <span className="text-sm text-foreground font-medium flex-1">{weakness}</span>
                                                   </div>
                                                 ))}
                                               </div>
                                             </div>
                                           </div>
                                         )}

                                         {/* AI Analysis */}
                                         {resume.justification && (
                                           <div className="animate-fade-in" style={{animationDelay: '0.5s'}}>
                                             <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-purple-700">
                                               <div className="p-1 bg-purple-100 rounded-full">
                                                 <span className="text-xs font-bold text-purple-600">AI</span>
                                               </div>
                                               AI Analysis
                                             </h4>
                                             <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200/50 rounded-xl p-5 hover:shadow-md transition-all duration-300">
                                               <p className="text-sm leading-relaxed text-foreground/90">{resume.justification}</p>
                                             </div>
                                           </div>
                                         )}

                                         {/* Resume Actions */}
                                         <div className="animate-fade-in" style={{animationDelay: '0.6s'}}>
                                           <h4 className="font-bold text-lg mb-4 flex items-center gap-2">
                                             <FileText className="h-5 w-5 text-blue-600" />
                                             Resume Document
                                           </h4>
                                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-5">
                                              <div className="mb-3">
                                                <Button 
                                                  onClick={() => {
                                                    const driveLink = `https://drive.google.com/file/d/${resume.resume}/view`;
                                                    window.open(driveLink, '_blank');
                                                  }}
                                                  className="w-full gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 shadow-md hover:shadow-lg transition-all duration-300 hover:scale-105"
                                                >
                                                  <FileText className="h-4 w-4" />
                                                  View Resume
                                                  <ArrowUpRight className="h-3 w-3" />
                                                </Button>
                                              </div>
                                             {resume.resume && (
                                               <div className="flex items-center gap-2 text-xs text-muted-foreground bg-white/50 rounded-lg p-2">
                                                 <FileText className="h-3 w-3" />
                                                 <span>{resume.resume.split('/').pop() || resume.resume}</span>
                                               </div>
                                             )}
                                           </div>
                                         </div>
                                       </div>
                                     </ScrollArea>
                                   </SheetContent>
                                 </Sheet>
                                
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                  <Download className="h-4 w-4" />
                                </Button>
                                
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                   <DropdownMenuContent align="end">
                                     <DropdownMenuItem 
                                       className="text-red-600 cursor-pointer"
                                       onClick={() => handleDeleteCandidate(resume.id!)}
                                     >
                                       <Trash2 className="h-4 w-4 mr-2" />
                                       Delete
                                     </DropdownMenuItem>
                                   </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-12 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 bg-muted/50 rounded-full">
                      <Users className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">No candidates found</h3>
                      <p className="text-muted-foreground">
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
    </div>
  );
};

export default ModernDashboard;
