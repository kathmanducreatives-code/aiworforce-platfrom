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
  RefreshCw
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

      // Normalize API response shape and values
      const convertFactorToNumber = (factor: any): number => {
        if (factor === null || factor === undefined) return 0;
        const str = String(factor).toLowerCase().trim();
        if (str.includes('high')) return 8;
        if (str.includes('medium')) return 5;
        if (str.includes('low')) return 2;
        const n = Number(str);
        return Number.isFinite(n) ? n : 0;
      };

      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        console.warn('No rows in resume_analyses table yet.');
        setResumeData([]);
        return;
      }

      const normalized: ResumeAnalysis[] = rows.map((row: any, index: number) => {
        const candidateName: string = row.candidate_name || '';
        const [firstName, ...rest] = candidateName.split(' ').filter(Boolean);
        const lastName = rest.join(' ');
        const rf = row.risk_factor;
        const rwf = row.reward_factor;
        const fit = row.fit_score;
        const overall = row.overall_factor ?? fit;

        return {
          id: row.id ?? `analysis-${index}`,
          date: row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : '',
          resume: row.resume ?? '',
          firstName: firstName || '',
          lastName: lastName || '',
          email: row.email ?? '',
          strengths: row.strengths ?? '',
          weaknesses: row.weaknesses ?? '',
          riskFactor: typeof rf === 'number' ? rf : convertFactorToNumber(rf),
          rewardFactor: typeof rwf === 'number' ? rwf : convertFactorToNumber(rwf),
          overallFactor: typeof overall === 'number' ? overall : convertFactorToNumber(overall),
          justification: row.justification ?? '',
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

  const getFactorColor = (factor: number) => {
    if (factor >= 8) return 'text-green-600';
    if (factor >= 6) return 'text-blue-600';
    if (factor >= 4) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getFactorBadgeColor = (factor: number) => {
    if (factor >= 8) return 'bg-green-100 text-green-800';
    if (factor >= 6) return 'bg-blue-100 text-blue-800';
    if (factor >= 4) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const filteredResumes = resumeData.filter(resume => {
    const matchesSearch = 
      resume.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resume.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
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
              <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg mr-4">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Resumes</p>
                <p className="text-2xl font-bold text-foreground">{resumeData.length}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg mr-4">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Scores (8+)</p>
                <p className="text-2xl font-bold text-foreground">
                  {resumeData.filter(r => r.overallFactor >= 8).length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-yellow-100 rounded-lg mr-4">
                <AlertTriangle className="h-6 w-6 text-yellow-600" />
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
              <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg mr-4">
                <TrendingUp className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Overall Score</p>
                <p className="text-2xl font-bold text-foreground">
                  {resumeData.length > 0 ? 
                    (resumeData.reduce((acc, r) => acc + r.overallFactor, 0) / resumeData.length).toFixed(1)
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
                      {resume.firstName} {resume.lastName}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{resume.resume}</p>
                  </div>
                  <Badge className={getFactorBadgeColor(resume.overallFactor)}>
                    Score: {resume.overallFactor}/10
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
                    <p className="text-xs text-muted-foreground mb-1">Risk Factor</p>
                    <div className="flex items-center gap-2">
                      <Progress value={resume.riskFactor * 10} className="h-2" />
                      <span className={`text-sm font-bold ${getFactorColor(resume.riskFactor)}`}>
                        {resume.riskFactor}/10
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Reward Factor</p>
                    <div className="flex items-center gap-2">
                      <Progress value={resume.rewardFactor * 10} className="h-2" />
                      <span className={`text-sm font-bold ${getFactorColor(resume.rewardFactor)}`}>
                        {resume.rewardFactor}/10
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Overall Factor</p>
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
                    <p className="text-sm font-medium text-foreground mb-2 text-green-700">Strengths</p>
                    <p className="text-sm text-muted-foreground bg-green-50 p-2 rounded">
                      {resume.strengths || 'No strengths listed'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2 text-red-700">Weaknesses</p>
                    <p className="text-sm text-muted-foreground bg-red-50 p-2 rounded">
                      {resume.weaknesses || 'No weaknesses listed'}
                    </p>
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