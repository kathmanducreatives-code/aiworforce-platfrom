import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Users, BarChart3, TrendingUp, Folder, ArrowRight, Brain } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

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

  const quickActions = [
    {
      title: "Resume Screener",
      description: "Upload and analyze new candidates with AI precision",
      icon: Upload,
      action: "Add Candidates",
      path: "/screening",
      color: "bg-primary/10 text-primary border-primary/30",
    },
    {
      title: "Candidate Intelligence",
      description: "Manage your candidate pipeline and insights",
      icon: Users,
      action: "View Candidates",
      path: "/candidates",
      color: "bg-accent/10 text-accent border-accent/30",
      badge: metrics.totalCandidates,
    },
    {
      title: "Analytics & Insights",
      description: "Deep dive into recruitment data and metrics",
      icon: BarChart3,
      action: "View Analytics",
      path: "/analytics",
      color: "bg-secondary/10 text-secondary border-secondary/30",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Welcome Header */}
        <div className="mb-12 animate-fade-in">
          <h1 className="text-4xl font-bold text-foreground mb-3">
            Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}! 👋
          </h1>
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

        {/* Quick Actions */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">Quick Actions</h2>
          <div className="grid gap-6 md:grid-cols-3 animate-fade-in-up animate-delay-200">
            {quickActions.map((action, index) => (
              <Card
                key={index}
                className="group cursor-pointer border-2 hover:border-primary/50 hover:shadow-xl transition-all duration-300 bg-card/50 backdrop-blur-sm"
                onClick={() => navigate(action.path)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`p-3 rounded-xl ${action.color} border transition-all duration-300 group-hover:scale-110`}>
                      <action.icon className="h-6 w-6" />
                    </div>
                    {action.badge !== undefined && (
                      <span className="px-3 py-1 bg-primary/10 text-primary text-sm font-semibold rounded-full">
                        {action.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                    {action.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {action.description}
                  </p>
                  <Button
                    variant="ghost"
                    className="w-full justify-between group-hover:bg-primary/10 group-hover:text-primary transition-all"
                  >
                    <span>{action.action}</span>
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Recent Activity Preview */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Activity</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/candidates")}
                className="gap-2"
              >
                View All
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center py-8">
              Your recent candidate uploads and activities will appear here
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
