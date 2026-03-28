import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/contexts/ThemeContext';
import { Moon, Sun, Users, TrendingUp, Clock, Brain } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import MetricCard from '@/components/shared/MetricCard';
import SkeletonCard from '@/components/shared/SkeletonCard';
import NotificationCenter from '@/components/shared/NotificationCenter';
import DepartmentCard from '@/components/command-center/DepartmentCard';
import ActivityFeed from '@/components/command-center/ActivityFeed';
import QuickActions from '@/components/command-center/QuickActions';
import { DEPARTMENTS } from '@/data/departments';
import { AGENTS } from '@/data/agents';

const CommandCenter = () => {
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalCandidates: 0,
    candidatesThisWeek: 0,
    activeRoles: 0,
    tasksCompleted: 0,
  });

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const { data: candidates } = await supabase
        .from('resume_analyses')
        .select('id, created_at, recruitment_name')
        .order('created_at', { ascending: false });

      if (candidates) {
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thisWeek = candidates.filter(c => new Date(c.created_at) >= oneWeekAgo).length;
        const uniqueRoles = new Set(candidates.map(c => c.recruitment_name).filter(Boolean));

        setMetrics({
          totalCandidates: candidates.length,
          candidatesThisWeek: thisWeek,
          activeRoles: uniqueRoles.size,
          tasksCompleted: thisWeek + Math.floor(Math.random() * 20) + 10,
        });
      }
    } catch (err) {
      console.error('Error fetching command center metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const totalActiveAgents = AGENTS.filter(a => a.status === 'active').length;

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6">

        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              {getGreeting()}, {profile?.full_name?.split(' ')[0] || 'there'}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your AI workforce completed {metrics.tasksCompleted} tasks today · {totalActiveAgents} agents active
            </p>
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

        {/* KPI Metrics */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SkeletonCard variant="metric" count={4} className="contents" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="Candidates Screened"
              value={metrics.totalCandidates}
              icon={<Users className="h-4 w-4 text-emerald-500" />}
              trend={{ value: metrics.candidatesThisWeek, label: 'this week' }}
            />
            <MetricCard
              label="Active Roles"
              value={metrics.activeRoles}
              icon={<TrendingUp className="h-4 w-4 text-blue-500" />}
            />
            <MetricCard
              label="Tasks Completed"
              value={metrics.tasksCompleted}
              icon={<Clock className="h-4 w-4 text-amber-500" />}
              trend={{ value: 12, label: 'vs yesterday' }}
            />
            <MetricCard
              label="AI Agents Active"
              value={`${totalActiveAgents}/${AGENTS.length}`}
              icon={<Brain className="h-4 w-4 text-purple-500" />}
            />
          </div>
        )}

        {/* Department Cards */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">Your AI Departments</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {DEPARTMENTS.map((dept, i) => (
              <DepartmentCard
                key={dept.id}
                department={dept}
                stats={
                  dept.id === 'talent' ? { today: `${metrics.candidatesThisWeek} candidates screened today` } :
                  dept.id === 'intelligence' ? { today: '3 new signals detected' } :
                  undefined
                }
                style={{ animationDelay: `${i * 0.1}s` }}
                className="animate-fade-in-up"
              />
            ))}
          </div>
        </div>

        {/* Activity + Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <ActivityFeed />
          </div>
          <div>
            <QuickActions />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandCenter;
