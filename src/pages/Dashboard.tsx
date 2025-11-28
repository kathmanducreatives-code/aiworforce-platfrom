import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Folder, Brain, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
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
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
        {/* Header Section */}
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-4 sm:px-0">
          <div className="flex items-center gap-3 sm:gap-4">
            {profile?.logo_url && (
              <img 
                src={profile.logo_url} 
                alt="Client Logo" 
                className="h-12 sm:h-16 w-auto" 
              />
            )}
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Dashboard</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <Button
            onClick={() => navigate('/screening')}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-glow w-full sm:w-auto"
          >
            + New Candidate
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 px-4 sm:px-0">
          <Card className="p-4 sm:p-6 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                <Users className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wide">Total Candidates</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-foreground">{loading ? "..." : metrics.totalCandidates}</div>
            <div className="text-xs text-primary mt-1">+{metrics.candidatesThisWeek} this week</div>
          </Card>

          <Card className="p-4 sm:p-6 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wide">Avg Fit Score</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-foreground">{loading ? "..." : `${metrics.avgFitScore}%`}</div>
            <div className="text-xs text-muted-foreground mt-1">quality rate</div>
          </Card>

          <Card className="p-4 sm:p-6 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                <Folder className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wide">Active Roles</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-foreground">{loading ? "..." : metrics.activeRecruitments}</div>
            <div className="text-xs text-muted-foreground mt-1">open positions</div>
          </Card>

          <Card className="p-4 sm:p-6 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                <Brain className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wide">AI Screening</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-foreground">100%</div>
            <div className="text-xs text-muted-foreground mt-1">powered</div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6 px-4 sm:px-0">
          <Button onClick={() => navigate('/screening')} variant="outline" className="w-full sm:w-auto border-primary/30 hover:bg-primary/10 hover:border-primary" size="sm">
            Upload Resume
          </Button>
          <Button onClick={() => navigate('/lead-scraper')} variant="outline" className="w-full sm:w-auto border-primary/30 hover:bg-primary/10 hover:border-primary" size="sm">
            Start Scraping
          </Button>
          <Button onClick={() => navigate('/deep-search')} variant="outline" className="w-full sm:w-auto border-primary/30 hover:bg-primary/10 hover:border-primary" size="sm">
            Deep Search
          </Button>
          <Button onClick={() => navigate('/analytics')} variant="ghost" className="w-full sm:w-auto sm:ml-auto text-primary hover:bg-primary/10" size="sm">
            View Analytics →
          </Button>
        </div>
      </div>

      {/* Candidate Intelligence Hub - Seamlessly Integrated */}
      <div className="border-t border-border/50 pt-8 mt-8">
        <ModernDashboard />
      </div>
    </div>
  );
};

export default Dashboard;
