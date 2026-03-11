import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Clock,
  Eye,
  Download,
  Filter,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Trash2
} from "lucide-react";

const Dashboard = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [resumeData, setResumeData] = useState<ResumeAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJustifications, setExpandedJustifications] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const fetchResumeData = async () => {
    try {
      console.log('Fetching resume analysis data...');
      setLoading(true);
      
      const { data, error } = await supabase
        .from('resume_analyses')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Supabase function error:', error);
        throw new Error(`Failed to fetch resume data: ${error.message}`);
      }

      console.log('Fetched resume data raw payload:', data);

      // Helper functions to parse JSON data
      const parseFactorScore = (factor: any): number => {
        if (!factor) return 0;
        
        // Handle simple numeric values
        if (typeof factor === 'number') return Math.max(0, Math.min(10, Math.round(factor)));
        if (typeof factor === 'string') {
          const num = parseFloat(factor);
          return isNaN(num) ? 0 : Math.max(0, Math.min(10, Math.round(num)));
        }
        
        return 0;
      };

      const parseFactorScoreText = (factor: any): string => {
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

      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        console.warn('No rows in resume_analyses table yet.');
        setResumeData([]);
        return;
      }

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
          // Store original score strings for display
          riskScore: parseFactorScoreText(row.risk_factor),
          rewardScore: parseFactorScoreText(row.reward_factor),
          fitScoreText: parseFactorScoreText(row.fit_score),
          overallScore: overallScore,
        };
      });

      console.log(`Loaded ${normalized.length} rows from resume_analyses`);
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

  const toggleJustification = (id: string) => {
    setExpandedJustifications(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleDelete = async (resumeId: string) => {
    // Optimistically remove from UI
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
      // Restore the item on error
      setResumeData(prev => [...prev, resumeToDelete].sort((a, b) => 
        new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      ));
      
      console.error('Error deleting resume:', error);
      toast({
        title: "Error",
        description: "Failed to delete resume analysis. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getFactorColor = (factor: number) => {
    if (factor >= 8) return 'text-primary';
    if (factor >= 6) return 'text-foreground';
    if (factor >= 4) return 'text-muted-foreground';
    return 'text-destructive';
  };

  const getFactorBadgeColor = (factor: number) => {
    if (factor >= 8) return 'bg-primary/15 text-primary';
    if (factor >= 6) return 'bg-primary/10 text-primary';
    if (factor >= 4) return 'bg-muted text-muted-foreground';
    return 'bg-destructive/10 text-destructive';
  };

  const getScoreColor = (score: string) => {
    const lowerScore = score.toLowerCase();
    if (lowerScore.includes('high')) return 'border-primary/40 text-primary bg-primary/10';
    if (lowerScore.includes('medium')) return 'border-primary/30 text-primary bg-primary/5';
    if (lowerScore.includes('low')) return 'border-amber-500/30 text-amber-600 bg-amber-500/10';
    return 'border-border text-muted-foreground bg-muted/40';
  };

  const filteredResumes = resumeData.filter(resume => {
    const matchesSearch = 
      resume.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resume.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resume.resume.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  if (loading) {
    return (
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-background">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-primary mr-2" />
            <span className="text-lg text-muted-foreground">Loading resume analysis data...</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 px-4 sm:px-6 lg:px-8 bg-background">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-foreground mb-2">Resume Analysis Dashboard</h2>
            <p className="text-muted-foreground">
              Track and manage candidate applications with AI-powered insights
            </p>
          </div>
          <Button onClick={fetchResumeData} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg mr-4">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Resumes</p>
                <p className="text-2xl font-bold text-foreground">{resumeData.length}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg mr-4">
                <CheckCircle className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Scores (8+)</p>
                <p className="text-2xl font-bold text-foreground">
                  {resumeData.filter(r => r.fitScore >= 8).length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-muted rounded-lg mr-4">
                <AlertTriangle className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Risk</p>
                <p className="text-2xl font-bold text-foreground">
                  {resumeData.filter(r => r.riskFactor >= 7).length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg mr-4">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Overall Score</p>
                <p className="text-2xl font-bold text-foreground">
                  {resumeData.length > 0 ? 
                    (resumeData.reduce((acc, r) => acc + r.fitScore, 0) / resumeData.length).toFixed(1)
                    : '0'
                  }
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search Section */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search by name, email, or resume title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Resume Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredResumes.map((resume) => (
            <Card key={resume.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold text-foreground">
                      {resume.candidateName}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{resume.resume}</p>
                  </div>
                  <Badge className={getFactorBadgeColor(resume.fitScore)}>
                    Score: {resume.fitScore}/10
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{resume.email}</span>
                  <span>•</span>
                  <span>{resume.date}</span>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Factor Scores */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Risk Factor</p>
                    <Badge variant="outline" className={`${getScoreColor(resume.riskScore || 'Unknown')}`}>
                      {resume.riskScore || 'Unknown'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Reward Factor</p>
                    <Badge variant="outline" className={`${getScoreColor(resume.rewardScore || 'Unknown')}`}>
                      {resume.rewardScore || 'Unknown'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Overall Score</p>
                    <div className="flex items-center gap-2">
                      <Progress value={resume.overallFactor * 10} className="h-2" />
                      <span className={`text-sm font-bold ${getFactorColor(resume.overallFactor)}`}>
                        {resume.overallFactor}/10
                      </span>
                    </div>
                  </div>
                </div>

                {/* Strengths & Weaknesses */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-green-700 mb-3">Strengths</p>
                    <div className="bg-green-50 p-3 rounded-lg">
                      {resume.strengths && resume.strengths.length > 0 ? (
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {resume.strengths.map((strength, index) => (
                            <li key={index} className="flex items-start">
                              <span className="text-green-600 mr-2">•</span>
                              <span>{strength}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No strengths listed</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-red-700 mb-3">Weaknesses</p>
                    <div className="bg-red-50 p-3 rounded-lg">
                      {resume.weaknesses && resume.weaknesses.length > 0 ? (
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {resume.weaknesses.map((weakness, index) => (
                            <li key={index} className="flex items-start">
                              <span className="text-red-600 mr-2">•</span>
                              <span>{weakness}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No weaknesses listed</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Justification */}
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleJustification(resume.id!)}
                    className="p-0 h-auto font-medium text-foreground mb-2"
                  >
                    Justification
                    {expandedJustifications.has(resume.id!) ? 
                      <ChevronUp className="h-4 w-4 ml-1" /> : 
                      <ChevronDown className="h-4 w-4 ml-1" />
                    }
                  </Button>
                  {expandedJustifications.has(resume.id!) && (
                    <p className="text-sm text-muted-foreground bg-muted p-3 rounded">
                      {resume.justification || 'No justification provided'}
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4">
                  <Button size="sm" variant="outline" className="flex-1">
                    <Eye className="h-4 w-4 mr-2" />
                    View Details
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1">
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => handleDelete(resume.id!)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredResumes.length === 0 && (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No resumes found</h3>
            <p className="text-muted-foreground">
              {searchTerm ? "Try adjusting your search terms" : "Upload and analyze some resumes to get started"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
};

export default Dashboard;