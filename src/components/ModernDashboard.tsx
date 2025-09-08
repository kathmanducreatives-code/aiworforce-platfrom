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
          recruitmentName: row.recruitment_name ?? 'Uncategorized',
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
                                <div className="font-medium text-foreground">
                                  {resume.candidateName || 'Unknown Candidate'}
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
                                  variant={resume.riskFactor >= 7 ? "destructive" : resume.riskFactor >= 4 ? "secondary" : "outline"}
                                  className="text-xs"
                                >
                                  Risk: {resume.riskFactor}/10
                                </Badge>
                                <Badge 
                                  variant={resume.rewardFactor >= 7 ? "default" : "outline"}
                                  className="text-xs"
                                >
                                  Reward: {resume.rewardFactor}/10
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
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                  </SheetTrigger>
                                  <SheetContent side="right" className="w-[400px] sm:w-[540px]">
                                    <SheetHeader>
                                      <SheetTitle>Candidate Details</SheetTitle>
                                      <SheetDescription>
                                        Detailed analysis for {resume.candidateName}
                                      </SheetDescription>
                                    </SheetHeader>
                                    <ScrollArea className="h-[calc(100vh-8rem)] mt-6">
                                      <div className="space-y-6">
                                        {/* Overall Score */}
                                        <div>
                                          <h4 className="font-semibold mb-3">Overall Assessment</h4>
                                          <div className="space-y-3">
                                            <div>
                                              <div className="flex justify-between text-sm mb-1">
                                                <span>Overall Score</span>
                                                <span className="font-medium">{resume.overallScore}/10</span>
                                              </div>
                                              <Progress value={(resume.overallScore || 0) * 10} className="h-2" />
                                            </div>
                                            <div>
                                              <div className="flex justify-between text-sm mb-1">
                                                <span>Fit Score</span>
                                                <span className="font-medium">{resume.fitScore}/10</span>
                                              </div>
                                              <Progress value={(resume.fitScore || 0) * 10} className="h-2" />
                                            </div>
                                          </div>
                                        </div>

                                        {/* Risk & Reward */}
                                        <div>
                                          <h4 className="font-semibold mb-3">Risk & Reward Analysis</h4>
                                          <div className="grid grid-cols-2 gap-4">
                                            <div className="text-center p-4 bg-red-50 rounded-lg">
                                              <p className="text-sm text-red-600 font-medium">Risk Factor</p>
                                              <p className="text-2xl font-bold text-red-700">{resume.riskFactor}/10</p>
                                            </div>
                                            <div className="text-center p-4 bg-green-50 rounded-lg">
                                              <p className="text-sm text-green-600 font-medium">Reward Factor</p>
                                              <p className="text-2xl font-bold text-green-700">{resume.rewardFactor}/10</p>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Strengths */}
                                        {resume.strengths && resume.strengths.length > 0 && (
                                          <div>
                                            <h4 className="font-semibold mb-3 text-green-700">Strengths</h4>
                                            <div className="space-y-2">
                                              {resume.strengths.map((strength, idx) => (
                                                <div key={idx} className="flex items-start gap-2">
                                                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                                  <span className="text-sm">{strength}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Weaknesses */}
                                        {resume.weaknesses && resume.weaknesses.length > 0 && (
                                          <div>
                                            <h4 className="font-semibold mb-3 text-red-700">Areas for Improvement</h4>
                                            <div className="space-y-2">
                                              {resume.weaknesses.map((weakness, idx) => (
                                                <div key={idx} className="flex items-start gap-2">
                                                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                                                  <span className="text-sm">{weakness}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Justification */}
                                        {resume.justification && (
                                          <div>
                                            <h4 className="font-semibold mb-3">AI Analysis</h4>
                                            <div className="bg-muted/50 rounded-lg p-4">
                                              <p className="text-sm leading-relaxed">{resume.justification}</p>
                                            </div>
                                          </div>
                                        )}
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
                                    <DropdownMenuItem className="text-red-600">
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
