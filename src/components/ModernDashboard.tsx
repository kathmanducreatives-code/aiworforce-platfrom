import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  ArrowUpRight
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

      // Helper functions to parse JSON data
      const parseFactorScore = (factor: any): string => {
        if (!factor) return 'Unknown';
        if (typeof factor === 'string') return factor;
        if (typeof factor === 'object' && factor.score) return factor.score;
        return 'Unknown';
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

      const convertScoreToNumber = (score: string): number => {
        const str = score.toLowerCase().trim();
        if (str.includes('high')) return 8;
        if (str.includes('medium')) return 5;
        if (str.includes('low')) return 2;
        return 5;
      };

      const rows = Array.isArray(data) ? data : [];
      
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
          riskFactor: convertScoreToNumber(riskScore),
          rewardFactor: convertScoreToNumber(rewardScore),
          fitScore: convertScoreToNumber(fitScore),
          overallFactor: convertScoreToNumber(overallScore),
          justification: row.justification ?? '',
          riskScore,
          rewardScore,
          fitScoreText: fitScore,
          overallScore,
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

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCandidates(new Set(filteredResumes.map(resume => resume.id!)));
    } else {
      setSelectedCandidates(new Set());
    }
  };

  const handleSelectCandidate = (candidateId: string, checked: boolean) => {
    const newSelected = new Set(selectedCandidates);
    if (checked) {
      newSelected.add(candidateId);
    } else {
      newSelected.delete(candidateId);
    }
    setSelectedCandidates(newSelected);
  };

  const handleBulkAction = async (action: 'accept' | 'reject' | 'archive') => {
    if (selectedCandidates.size === 0) return;
    
    toast({
      title: "Bulk Action",
      description: `${action === 'accept' ? 'Accepted' : action === 'reject' ? 'Rejected' : 'Archived'} ${selectedCandidates.size} candidate(s)`,
    });
    setSelectedCandidates(new Set());
  };

  const handleDelete = async (resumeId: string) => {
    const resumeToDelete = resumeData.find(r => r.id === resumeId);
    if (!resumeToDelete) return;
    
    setResumeData(prev => prev.filter(r => r.id !== resumeId));
    
    try {
      const { error } = await supabase
        .from('resume_analyses')
        .delete()
        .eq('id', resumeId);
      
      if (error) {
        throw new Error(error.message);
      }
      
      toast({
        title: "Success",
        description: "Resume analysis deleted successfully.",
      });
    } catch (error) {
      setResumeData(prev => [...prev, resumeToDelete].sort((a, b) => 
        new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      ));
      
      toast({
        title: "Error",
        description: "Failed to delete resume analysis. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getScoreBadgeStyle = (score: string) => {
    const lowerScore = score.toLowerCase();
    if (lowerScore.includes('high')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (lowerScore.includes('medium')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (lowerScore.includes('low')) return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-gray-100 text-gray-600 border-gray-200';
  };

  const getRiskBadgeStyle = (score: string) => {
    const lowerScore = score.toLowerCase();
    if (lowerScore.includes('high')) return 'bg-red-100 text-red-800 border-red-200';
    if (lowerScore.includes('medium')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (lowerScore.includes('low')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    return 'bg-gray-100 text-gray-600 border-gray-200';
  };

  const openDetailsPanel = (candidate: ResumeAnalysis) => {
    setSelectedCandidate(candidate);
    setIsDetailsPanelOpen(true);
  };

  const filteredResumes = resumeData.filter(resume => {
    const matchesSearch = 
      resume.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resume.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resume.resume.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  // Pagination
  const totalPages = Math.ceil(filteredResumes.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedResumes = filteredResumes.slice(startIndex, endIndex);

  const stats = {
    total: resumeData.length,
    analyzed: resumeData.length,
    highScore: resumeData.filter(r => r.fitScore >= 8).length,
    avgScore: resumeData.length > 0 ? 
      (resumeData.reduce((acc, r) => acc + r.fitScore, 0) / resumeData.length).toFixed(1) : '0'
  };

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
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Candidate Dashboard</h1>
              <p className="text-muted-foreground mt-2">
                Manage and analyze candidate applications with AI-powered insights
              </p>
            </div>
            <Button onClick={fetchResumeData} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="border-0 shadow-sm bg-white">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Resumes</p>
                    <p className="text-3xl font-bold text-foreground mt-2">{stats.total}</p>
                  </div>
                  <div className="h-12 w-12 bg-blue-50 rounded-xl flex items-center justify-center">
                    <FileText className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-white">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Analyzed</p>
                    <p className="text-3xl font-bold text-foreground mt-2">{stats.analyzed}</p>
                  </div>
                  <div className="h-12 w-12 bg-emerald-50 rounded-xl flex items-center justify-center">
                    <CheckCircle className="h-6 w-6 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-white">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">High Matches</p>
                    <p className="text-3xl font-bold text-foreground mt-2">{stats.highScore}</p>
                  </div>
                  <div className="h-12 w-12 bg-amber-50 rounded-xl flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-white">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Score</p>
                    <p className="text-3xl font-bold text-foreground mt-2">{stats.avgScore}</p>
                  </div>
                  <div className="h-12 w-12 bg-purple-50 rounded-xl flex items-center justify-center">
                    <Users className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search and Bulk Actions */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between mb-6">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search candidates..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-white border-border"
                />
              </div>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                Filter
              </Button>
            </div>

            {selectedCandidates.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedCandidates.size} selected
                </span>
                <Button 
                  size="sm" 
                  variant="default"
                  onClick={() => handleBulkAction('accept')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Accept
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleBulkAction('reject')}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  Reject
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleBulkAction('archive')}
                >
                  Archive
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Candidates Table */}
        <Card className="border-0 shadow-sm bg-white">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedCandidates.size === filteredResumes.length && filteredResumes.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="font-semibold text-foreground">Candidate</TableHead>
                <TableHead className="font-semibold text-foreground">Risk</TableHead>
                <TableHead className="font-semibold text-foreground">Reward</TableHead>
                <TableHead className="font-semibold text-foreground">Score</TableHead>
                <TableHead className="font-semibold text-foreground">Date</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedResumes.map((resume) => (
                <TableRow 
                  key={resume.id} 
                  className="border-b border-border hover:bg-gray-50/50 cursor-pointer"
                  onClick={() => openDetailsPanel(resume)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedCandidates.has(resume.id!)}
                      onCheckedChange={(checked) => handleSelectCandidate(resume.id!, checked as boolean)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center">
                        <span className="text-primary font-semibold text-sm">
                          {resume.candidateName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{resume.candidateName}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {resume.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={getRiskBadgeStyle(resume.riskScore || 'Unknown')}>
                      {resume.riskScore || 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={getScoreBadgeStyle(resume.rewardScore || 'Unknown')}>
                      {resume.rewardScore || 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{resume.overallFactor}/10</span>
                      <div className="w-16 bg-gray-100 rounded-full h-2">
                        <div 
                          className="bg-primary rounded-full h-2 transition-all"
                          style={{ width: `${(resume.overallFactor / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {resume.date}
                    </span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-white">
                        <DropdownMenuItem className="gap-2">
                          <Eye className="h-4 w-4" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2">
                          <Download className="h-4 w-4" />
                          Download Resume
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="gap-2 text-red-600"
                          onClick={() => handleDelete(resume.id!)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredResumes.length === 0 && (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No candidates found</h3>
              <p className="text-muted-foreground">
                {searchTerm ? 'Try adjusting your search terms.' : 'Upload resumes to get started.'}
              </p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1}-{Math.min(endIndex, filteredResumes.length)} of {filteredResumes.length} candidates
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Details Side Panel */}
      <Sheet open={isDetailsPanelOpen} onOpenChange={setIsDetailsPanelOpen}>
        <SheetContent className="w-[600px] sm:w-[700px] bg-white p-0">
          {selectedCandidate && (
            <>
              <SheetHeader className="p-6 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center">
                      <span className="text-primary font-bold text-lg">
                        {selectedCandidate.candidateName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <SheetTitle className="text-xl font-bold text-foreground">
                        {selectedCandidate.candidateName}
                      </SheetTitle>
                      <SheetDescription className="text-muted-foreground">
                        {selectedCandidate.email}
                      </SheetDescription>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsDetailsPanelOpen(false)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </SheetHeader>

              <ScrollArea className="flex-1 p-6">
                <div className="space-y-6">
                  {/* Score Overview */}
                  <div className="grid grid-cols-3 gap-4">
                    <Card className="p-4 border-0 bg-gray-50">
                      <div className="text-center">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Risk Factor</p>
                        <Badge className={getRiskBadgeStyle(selectedCandidate.riskScore || 'Unknown')}>
                          {selectedCandidate.riskScore || 'Unknown'}
                        </Badge>
                      </div>
                    </Card>
                    <Card className="p-4 border-0 bg-gray-50">
                      <div className="text-center">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Reward Factor</p>
                        <Badge className={getScoreBadgeStyle(selectedCandidate.rewardScore || 'Unknown')}>
                          {selectedCandidate.rewardScore || 'Unknown'}
                        </Badge>
                      </div>
                    </Card>
                    <Card className="p-4 border-0 bg-gray-50">
                      <div className="text-center">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Overall Score</p>
                        <p className="text-2xl font-bold text-foreground">{selectedCandidate.overallFactor}/10</p>
                      </div>
                    </Card>
                  </div>

                  {/* Strengths */}
                  <div>
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-emerald-600" />
                      Strengths
                    </h3>
                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                      {selectedCandidate.strengths && selectedCandidate.strengths.length > 0 ? (
                        <ul className="space-y-2">
                          {selectedCandidate.strengths.map((strength, index) => (
                            <li key={index} className="flex items-start gap-2 text-sm">
                              <span className="text-emerald-600 mt-0.5">•</span>
                              <span className="text-emerald-900">{strength}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-emerald-700 italic">No strengths identified</p>
                      )}
                    </div>
                  </div>

                  {/* Weaknesses */}
                  <div>
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                      Areas for Improvement
                    </h3>
                    <div className="bg-red-50 border border-red-100 rounded-lg p-4">
                      {selectedCandidate.weaknesses && selectedCandidate.weaknesses.length > 0 ? (
                        <ul className="space-y-2">
                          {selectedCandidate.weaknesses.map((weakness, index) => (
                            <li key={index} className="flex items-start gap-2 text-sm">
                              <span className="text-red-600 mt-0.5">•</span>
                              <span className="text-red-900">{weakness}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-red-700 italic">No weaknesses identified</p>
                      )}
                    </div>
                  </div>

                  {/* AI Justification */}
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">AI Analysis Summary</h3>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                      <p className="text-sm text-blue-900 leading-relaxed">
                        {selectedCandidate.justification || 'No detailed analysis available'}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4 border-t border-border">
                    <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Accept Candidate
                    </Button>
                    <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50 gap-2">
                      <X className="h-4 w-4" />
                      Reject
                    </Button>
                    <Button variant="outline" className="gap-2">
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ModernDashboard;