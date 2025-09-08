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

          {/* Main Content */}
          <div className={`${viewMode === 'folders' && !selectedFolder ? 'hidden' : ''}`}>
            <p className="text-center py-8 text-muted-foreground">Dashboard content will be displayed here</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModernDashboard;
