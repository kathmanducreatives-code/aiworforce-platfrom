import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Users, TrendingUp, Folder, Brain, Moon, Sun,
  UserPlus, Mail, Search, Calendar, AlertCircle, ChevronRight,
  ArrowUpRight, ArrowDownRight, Clock
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import MetricCard from "@/components/shared/MetricCard";
import SkeletonCard from "@/components/shared/SkeletonCard";
import ScorePill from "@/components/shared/ScorePill";
import NotificationCenter from "@/components/shared/NotificationCenter";
import { cn } from "@/lib/utils";

const Dashboard = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [metrics, setMetrics] = useState({
    totalCandidates: 0,
    avgFitScore: 0,
    activeRecruitments: 0,
    candidatesThisWeek: 0,
    candidatesLastWeek: 0,
    pipelineNew: 0,
    pipelineScreened: 0,
    pipelineInterviewed: 0,
    pipelineHired: 0,
  });
  const [recentCandidates, setRecentCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const { data: candidates } = await supabase
        .from('resume_analyses')
        .select('*')
        .order('created_at', { ascending: false });

      if (candidates) {
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

        const thisWeek = candidates.filter(c => new Date(c.created_at) >= oneWeekAgo).length;
        const lastWeek = candidates.filter(c => new Date(c.created_at) >= twoWeeksAgo && new Date(c.created_at) < oneWeekAgo).length;

        const fitScores = candidates.map(c => {
          const fs = c.fit_score as any;
          return typeof fs === 'object' && fs !== null ? (fs.score || 0) : 0;
        }).filter(s => s > 0);

        const avgFitScore = fitScores.length > 0
          ? Math.round(fitScores.reduce((a, b) => a + b, 0) / fitScores.length)
          : 0;

        const uniqueRoles = new Set(candidates.map(c => c.recruitment_name).filter(Boolean));

        // Pipeline stage counts from real current_stage data
        let pipelineNew = 0, pipelineScreened = 0, pipelineInterviewed = 0, pipelineHired = 0;
        candidates.forEach(c => {
          const stage = (c.current_stage || 'new').toLowerCase();
          if (stage === 'hired' || stage === 'placed') pipelineHired++;
          else if (stage === 'interviewed' || stage === 'interview') pipelineInterviewed++;
          else if (stage === 'screened' || stage === 'screening' || stage === 'reviewed') pipelineScreened++;
          else pipelineNew++;
        });

        setMetrics({
          totalCandidates: candidates.length,
          avgFitScore,
          activeRecruitments: uniqueRoles.size,
          candidatesThisWeek: thisWeek,
          candidatesLastWeek: lastWeek,
          pipelineNew,
          pipelineScreened,
          pipelineInterviewed,
          pipelineHired,
        });

        // Recent candidates for the table
        setRecentCandidates(candidates.slice(0, 8).map(c => {
          const fs = c.fit_score as any;
          const score = typeof fs === 'object' && fs !== null ? (fs.score || 0) : 0;
          return {
            id: c.id,
            name: c.candidate_name || 'Unknown',
            role: c.recruitment_name || '—',
            score,
            stage: c.current_stage || 'new',
            date: new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          };
        }));
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const weekTrend = metrics.candidatesLastWeek > 0
    ? Math.round(((metrics.candidatesThisWeek - metrics.candidatesLastWeek) / metrics.candidatesLastWeek) * 100)
    : metrics.candidatesThisWeek > 0 ? 100 : 0;

  // Contextual actions — smart to-do items
  const contextualActions = useMemo(() => {
    const actions = [];
    if (metrics.candidatesThisWeek > 0) {
      actions.push({
        icon: <Users className="h-4 w-4 text-emerald-500" />,
        title: `${metrics.candidatesThisWeek} candidates this week`,
        subtitle: 'Review new screenings',
        path: '/candidates',
      });
    }
    if (metrics.activeRecruitments > 0) {
      actions.push({
        icon: <Folder className="h-4 w-4 text-blue-500" />,
        title: `${metrics.activeRecruitments} active roles`,
        subtitle: 'Manage job screenings',
        path: '/screening-jobs',
      });
    }
    actions.push({
      icon: <Search className="h-4 w-4 text-purple-500" />,
      title: 'Source new talent',
      subtitle: 'Start a lead scrape or deep search',
      path: '/lead-scraper',
    });
    actions.push({
      icon: <Mail className="h-4 w-4 text-teal-500" />,
      title: 'Email outreach',
      subtitle: 'Create or manage sequences',
      path: '/email-sequences',
    });
    return actions;
  }, [metrics]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6">

        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            {profile?.logo_url && (
              <img src={profile.logo_url} alt="Logo" className="h-10 w-auto" />
            )}
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                {getGreeting()}, {profile?.full_name?.split(' ')[0] || 'there'}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                {metrics.candidatesThisWeek > 0 && ` · ${metrics.candidatesThisWeek} new candidates this week`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card/50 text-xs">
              <Moon className="h-3.5 w-3.5 text-muted-foreground" />
              <Switch checked={theme === 'light'} onCheckedChange={toggleTheme} className="data-[state=checked]:bg-primary scale-90" />
              <Sun className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <NotificationCenter />
          </div>
        </div>

        {/* KPI Metrics Row */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SkeletonCard variant="metric" count={4} className="contents" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="Total Candidates"
              value={metrics.totalCandidates}
              icon={<Users className="h-4 w-4 text-emerald-500" />}
              trend={{ value: weekTrend, label: 'vs last week' }}
            />
            <MetricCard
              label="Avg Fit Score"
              value={`${metrics.avgFitScore}%`}
              icon={<TrendingUp className="h-4 w-4 text-teal-500" />}
            />
            <MetricCard
              label="Active Roles"
              value={metrics.activeRecruitments}
              icon={<Folder className="h-4 w-4 text-blue-500" />}
            />
            <MetricCard
              label="AI Screening"
              value="100%"
              icon={<Brain className="h-4 w-4 text-purple-500" />}
              trend={{ value: 0, label: 'powered' }}
            />
          </div>
        )}

        {/* Two-column: Contextual Actions + Pipeline */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-8">

          {/* Contextual Actions (60%) */}
          <div className="lg:col-span-3 rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">What needs attention</h3>
            <div className="space-y-2">
              {contextualActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => navigate(action.path)}
                  className="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-muted/50 transition-all group text-left"
                >
                  <div className="p-2 rounded-xl bg-muted/80 group-hover:bg-primary/10 transition-colors">
                    {action.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{action.title}</p>
                    <p className="text-xs text-muted-foreground">{action.subtitle}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </button>
              ))}
            </div>
          </div>

          {/* Pipeline Funnel (40%) */}
          <div className="lg:col-span-2 rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Hiring Pipeline</h3>
            {loading ? (
              <SkeletonCard variant="list-item" count={4} />
            ) : (
              <div className="space-y-3">
                {[
                  { stage: 'New / Sourced', count: metrics.pipelineNew, color: 'bg-blue-500', pct: metrics.totalCandidates > 0 ? Math.round((metrics.pipelineNew / metrics.totalCandidates) * 100) : 0 },
                  { stage: 'Screened', count: metrics.pipelineScreened, color: 'bg-emerald-500', pct: metrics.totalCandidates > 0 ? Math.round((metrics.pipelineScreened / metrics.totalCandidates) * 100) : 0 },
                  { stage: 'Interviewed', count: metrics.pipelineInterviewed, color: 'bg-amber-500', pct: metrics.totalCandidates > 0 ? Math.round((metrics.pipelineInterviewed / metrics.totalCandidates) * 100) : 0 },
                  { stage: 'Hired', count: metrics.pipelineHired, color: 'bg-purple-500', pct: metrics.totalCandidates > 0 ? Math.round((metrics.pipelineHired / metrics.totalCandidates) * 100) : 0 },
                ].map((s) => (
                  <div key={s.stage} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{s.stage}</span>
                      <span className="text-muted-foreground tabular-nums">{s.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all duration-700', s.color)} style={{ width: `${s.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Candidates Table */}
        <div className="rounded-2xl border border-border bg-card/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Recent Candidates</h3>
            <button onClick={() => navigate('/candidates')} className="text-xs text-primary hover:text-primary/80 font-medium transition-colors">
              View all →
            </button>
          </div>
          {loading ? (
            <SkeletonCard variant="table-row" count={5} />
          ) : recentCandidates.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-muted-foreground mb-3">No candidates yet</p>
              <button onClick={() => navigate('/screening')} className="text-sm text-primary hover:text-primary/80 font-medium">
                Upload your first resume →
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-xs text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Name</th>
                    <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Role</th>
                    <th className="text-left py-2 px-3 font-medium">Score</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Stage</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Date</th>
                    <th className="text-right py-2 px-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {recentCandidates.map((c) => (
                    <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate('/candidates')}>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
                            {c.name[0]}
                          </div>
                          <span className="font-medium text-foreground truncate max-w-[150px]">{c.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[120px] hidden sm:table-cell">{c.role}</td>
                      <td className="py-2.5 px-3"><ScorePill score={c.score} size="sm" /></td>
                      <td className="py-2.5 px-3 hidden md:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{c.stage}</span>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs hidden md:table-cell">{c.date}</td>
                      <td className="py-2.5 px-3 text-right">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
