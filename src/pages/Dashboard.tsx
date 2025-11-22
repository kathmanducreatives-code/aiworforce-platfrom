import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Folder, Brain, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ResumeUpload from "@/components/ResumeUpload";
import ModernDashboard from "@/components/ModernDashboard";

const Dashboard = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [metrics, setMetrics] = useState({
    totalCandidates: 0,
    avgFitScore: 0,
    activeRecruitments: 0,
    candidatesThisWeek: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const { data: candidates } = await supabase
        .from('resume_analyses')
        .select('*')
        .order('created_at', { ascending: false });

      if (candidates) {
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        const candidatesThisWeek = candidates.filter(
          c => new Date(c.created_at) >= oneWeekAgo
        ).length;

        // Calculate average fit score
        const fitScores = candidates.map(c => {
          const fitScore = c.fit_score as any;
          return typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
        }).filter(score => score > 0);
        
        const avgFitScore = fitScores.length > 0 
          ? Math.round(fitScores.reduce((a, b) => a + b, 0) / fitScores.length)
          : 0;

        // Count unique recruitment names
        const uniqueRecruitments = new Set(
          candidates.map(c => c.recruitment_name).filter(Boolean)
        );

        setMetrics({
          totalCandidates: candidates.length,
          avgFitScore,
          activeRecruitments: uniqueRecruitments.size,
          candidatesThisWeek,
        });
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Welcome Header */}
        <div className="mb-12 animate-fade-in">
          {profile?.logo_url ? (
            <img 
              src={profile.logo_url} 
              alt="Client logo" 
              className="h-16 w-auto mb-3" 
            />
          ) : (
            <h1 className="text-4xl font-bold text-foreground mb-3">
              ScreeningPilot
            </h1>
          )}
          <p className="text-xl text-muted-foreground">
            Your AI-powered recruitment command center
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-12 animate-fade-in-up">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Total Candidates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground mb-1">
                {loading ? "..." : metrics.totalCandidates}
              </div>
              <p className="text-xs text-muted-foreground">
                +{metrics.candidatesThisWeek} this week
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-success" />
                Avg Fit Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground mb-1">
                {loading ? "..." : `${metrics.avgFitScore}%`}
              </div>
              <p className="text-xs text-success">Quality candidates</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Folder className="h-4 w-4 text-accent" />
                Active Recruitments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground mb-1">
                {loading ? "..." : metrics.activeRecruitments}
              </div>
              <p className="text-xs text-muted-foreground">Open positions</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Brain className="h-4 w-4 text-secondary" />
                AI Powered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground mb-1">100%</div>
              <p className="text-xs text-muted-foreground">Automation rate</p>
            </CardContent>
          </Card>
        </div>

        {/* Resume Screener Section */}
        <div className="mb-12">
          <ResumeUpload />
        </div>

        {/* Candidate Intelligence Section */}
        <div>
          <ModernDashboard />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
