import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Folder, Brain, Users, Moon, Sun } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ModernDashboard from "@/components/ModernDashboard";
import WeeklyActivityChart from "@/components/dashboard/WeeklyActivityChart";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";

const Dashboard = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
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

        const fitScores = candidates.map(c => {
          const fitScore = c.fit_score as any;
          return typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
        }).filter(score => score > 0);

        const avgFitScore = fitScores.length > 0
          ? Math.round(fitScores.reduce((a, b) => a + b, 0) / fitScores.length)
          : 0;

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

  const kpis = [
    { label: 'Total Candidates', value: loading ? null : metrics.totalCandidates, sub: `+${metrics.candidatesThisWeek} this week`, icon: Users, color: 'text-emerald-400' },
    { label: 'Avg Fit Score', value: loading ? null : `${metrics.avgFitScore}%`, sub: 'quality rate', icon: TrendingUp, color: 'text-teal-400' },
    { label: 'Active Roles', value: loading ? null : metrics.activeRecruitments, sub: 'open positions', icon: Folder, color: 'text-blue-400' },
    { label: 'AI Screening', value: '100%', sub: 'powered', icon: Brain, color: 'text-purple-400' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Header */}
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            {profile?.logo_url && (
              <img
                src={profile.logo_url}
                alt="Client Logo"
                className="h-16 sm:h-24 w-auto hover:scale-105 transition-transform duration-300"
              />
            )}
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight font-display">
                Dashboard
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full dash-glass">
              <Moon className="h-3.5 w-3.5 text-muted-foreground" />
              <Switch
                checked={theme === 'light'}
                onCheckedChange={toggleTheme}
                className="data-[state=checked]:bg-primary"
              />
              <Sun className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <Button
              onClick={() => navigate('/screening')}
              size="sm"
              className="ripple-btn bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_25px_rgba(5,150,105,0.2)] hover:shadow-[0_0_35px_rgba(5,150,105,0.35)] transition-all duration-300 w-full sm:w-auto rounded-lg"
            >
              + New Candidate
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {kpis.map((kpi, i) => (
            <div key={kpi.label} className="dash-glass rounded-2xl p-5 sm:p-6" style={{ animationDelay: `${0.1 + i * 0.1}s` }}>
              <div className="flex items-center gap-3 mb-3 sm:mb-4">
                <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/15">
                  <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color}`} />
                </div>
                <span className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
              </div>
              {kpi.value === null ? (
                <div className="h-10 skeleton-glass mb-1" />
              ) : (
                <div className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">{kpi.value}</div>
              )}
              <div className="text-xs text-primary/80 mt-1.5 font-medium">{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <Button onClick={() => navigate('/screening')} variant="outline" className="w-full sm:w-auto ripple-btn rounded-xl border-border hover:border-primary/40 hover:bg-primary/10 transition-all duration-300" size="sm">
            Upload Resume
          </Button>
          <Button onClick={() => navigate('/lead-scraper')} variant="outline" className="w-full sm:w-auto ripple-btn rounded-xl border-border hover:border-primary/40 hover:bg-primary/10 transition-all duration-300" size="sm">
            Start Scraping
          </Button>
          <Button onClick={() => navigate('/deep-search')} variant="outline" className="w-full sm:w-auto ripple-btn rounded-xl border-border hover:border-primary/40 hover:bg-primary/10 transition-all duration-300" size="sm">
            Deep Search
          </Button>
          <Button onClick={() => navigate('/analytics')} variant="ghost" className="w-full sm:w-auto sm:ml-auto text-primary hover:bg-primary/10 transition-all duration-300" size="sm">
            View Analytics →
          </Button>
        </div>

        {/* Weekly Activity Chart & Recent Activity */}
        <WeeklyActivityChart />
      </div>

      {/* Candidate Intelligence Hub */}
      <div className="border-t border-border/50 pt-8 mt-8">
        <ModernDashboard />
      </div>
    </div>
  );
};

export default Dashboard;
