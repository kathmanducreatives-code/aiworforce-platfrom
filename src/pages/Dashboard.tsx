import { useState, useEffect, useMemo, useRef } from "react";
import OnboardingWizard from "@/components/OnboardingWizard";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Activity, Gauge, Layers, Cpu, Moon, Sun,
  ChevronRight, Crosshair, Zap, MessageSquare,
  Rocket, ScanLine, Bot, Terminal, Radio, Wifi
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import SkeletonCard from "@/components/shared/SkeletonCard";
import ScorePill from "@/components/shared/ScorePill";
import NotificationCenter from "@/components/shared/NotificationCenter";
import { cn } from "@/lib/utils";
import { fetchOutboundMetrics } from "@/services/interceptorService";

/* ─── Inline CSS for animations ─── */
const commandCenterStyles = `
  @keyframes ring-pulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.05); }
  }
  @keyframes shimmer-bar {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes orbit-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes border-shimmer {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  @keyframes typewriter {
    from { width: 0; }
    to { width: 100%; }
  }
  @keyframes blink-cursor {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .cmd-fade-up {
    animation: fade-up 0.5s ease-out forwards;
    opacity: 0;
  }
  .shimmer-border {
    background: linear-gradient(90deg, transparent, rgba(0,255,148,0.15), transparent);
    background-size: 200% 100%;
    animation: border-shimmer 3s linear infinite;
  }
`;

/* ─── SVG Progress Ring Component ─── */
const ProgressRing = ({ value, max, label, icon, delay = 0 }: {
  value: number | string; max: number; label: string; icon: React.ReactNode; delay?: number;
}) => {
  const numVal = typeof value === 'string' ? parseFloat(value) || 0 : value;
  const pct = max > 0 ? Math.min((numVal / max) * 100, 100) : 0;
  const r = 36;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  const isHigh = pct > 70;

  return (
    <div
      className="cmd-fade-up flex flex-col items-center gap-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="relative">
        <svg width="88" height="88" viewBox="0 0 88 88" className="transform -rotate-90">
          {/* Track */}
          <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
          {/* Value arc */}
          <circle
            cx="44" cy="44" r={r} fill="none"
            stroke={isHigh ? "#00FF94" : "rgba(0,255,148,0.5)"}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-out"
            style={{
              filter: isHigh ? 'drop-shadow(0 0 8px rgba(0,255,148,0.6))' : 'none',
            }}
          />
        </svg>
        {/* Center value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-white tabular-nums font-mono tracking-tight">
            {value}
          </span>
        </div>
        {/* Icon badge */}
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#030507] border border-white/10 flex items-center justify-center">
          {icon}
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-mono text-center leading-tight">
        {label}
      </span>
    </div>
  );
};

/* ─── Orbital Rings SVG ─── */
const OrbitalRings = () => (
  <div className="relative w-full h-20 flex items-center justify-center mb-4 overflow-hidden">
    <svg viewBox="0 0 300 80" className="w-full h-full opacity-30">
      {/* Three concentric orbital ellipses */}
      <ellipse cx="150" cy="40" rx="140" ry="25" fill="none" stroke="rgba(0,255,148,0.15)" strokeWidth="0.5" strokeDasharray="4 6" />
      <ellipse cx="150" cy="40" rx="100" ry="18" fill="none" stroke="rgba(0,255,148,0.2)" strokeWidth="0.5" strokeDasharray="3 5" />
      <ellipse cx="150" cy="40" rx="60" ry="12" fill="none" stroke="rgba(0,255,148,0.25)" strokeWidth="0.5" />
      {/* Orbiting dots */}
      <circle r="2.5" fill="#00FF94" opacity="0.8">
        <animateMotion dur="8s" repeatCount="indefinite" path="M 10,40 A 140,25 0 1 1 290,40 A 140,25 0 1 1 10,40" />
      </circle>
      <circle r="2" fill="#00FF94" opacity="0.6">
        <animateMotion dur="6s" repeatCount="indefinite" path="M 50,40 A 100,18 0 1 1 250,40 A 100,18 0 1 1 50,40" />
      </circle>
      <circle r="1.5" fill="#00FF94" opacity="0.9">
        <animateMotion dur="4s" repeatCount="indefinite" path="M 90,40 A 60,12 0 1 1 210,40 A 60,12 0 1 1 90,40" />
      </circle>
    </svg>
    {/* Center node */}
    <div className="absolute w-3 h-3 rounded-full bg-[#00FF94] shadow-[0_0_12px_rgba(0,255,148,0.5)]" />
  </div>
);


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
  const [outbound, setOutbound] = useState<{ total: number; hotPending: number; dmsSent: number; last7: { date: string; count: number }[] } | null>(null);
  const [recentCandidates, setRecentCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredAction, setHoveredAction] = useState<number | null>(null);

  useEffect(() => {
    fetchDashboardData();
    fetchOutboundMetrics().then(setOutbound).catch(() => null);
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

  // The AI Workforce Roster
  const AI_AGENTS = useMemo(() => [
    { name: 'Scout', role: 'Talent Scout', status: 'Scanning 1,247 profiles…', image: '/assets/agents/scout.png', active: true },
    { name: 'Aria', role: 'AI Screener', status: 'Evaluating candidate #38…', image: '/assets/agents/aria.png', active: true },
    { name: 'Radar', role: 'Intelligence', status: '3 new signals detected', image: '/assets/agents/radar.png', active: true },
    { name: 'Penn', role: 'Outreach Writer', status: 'Drafting sequence v3…', image: '/assets/agents/penn.png', active: true },
    { name: 'Constructor', role: 'Architect', status: 'Standing by', image: '/assets/agents/constructor.png', active: false }
  ], []);

  // Direct Deployment actions
  const DEPLOYMENTS = useMemo(() => [
    { label: 'Deploy Scout', subtitle: 'Source talent from the web', icon: Rocket, path: '/lead-scraper' },
    { label: 'Launch Screening', subtitle: 'Begin AI resume analysis', icon: ScanLine, path: '/screening' },
    { label: 'Open Interceptor', subtitle: 'Capture inbound signals', icon: Crosshair, path: '/post-interceptor' },
    { label: 'Agent Studio', subtitle: 'Configure your workforce', icon: Bot, path: '/agent-studio' },
  ], []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <>
      <style>{commandCenterStyles}</style>
      <div className="min-h-screen bg-transparent text-white font-display overflow-x-hidden selection:bg-[#00FF94]/30 selection:text-white">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 relative z-10">

          {/* Onboarding Wizard */}
          <OnboardingWizard totalCandidates={metrics.totalCandidates} />

          {/* ═══════════════════════════════════════════════════
              HEADER — Welcome + Controls
          ═══════════════════════════════════════════════════ */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-4">
              {profile?.logo_url && (
                <img src={profile.logo_url} alt="Logo" className="h-10 w-auto" />
              )}
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white mb-0.5">
                  {getGreeting()}, <span className="bg-gradient-to-r from-white to-[#00FF94] bg-clip-text text-transparent">{profile?.full_name?.split(' ')[0] || 'Operator'}</span>
                </h1>
                <p className="text-xs text-white/40 font-mono tracking-wide">
                  <span className="text-[#00FF94]/50">SYS_TIME:</span>{' '}
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  {metrics.candidatesThisWeek > 0 && <span className="text-white/30"> · {metrics.candidatesThisWeek} new intercepts this cycle</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl text-xs">
                <Moon className="h-3.5 w-3.5 text-white/30" />
                <Switch checked={theme === 'light'} onCheckedChange={toggleTheme} className="scale-90 data-[state=checked]:bg-[#00FF94]" />
                <Sun className="h-3.5 w-3.5 text-[#00FF94]/60" />
              </div>
              <NotificationCenter />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════
              COMMAND SUMMARY — Circular Progress Rings
          ═══════════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl p-6 sm:p-8 mb-8 shadow-[0_0_60px_rgba(0,255,148,0.02)]">
            <div className="flex items-center gap-2 mb-6">
              <Terminal className="h-3.5 w-3.5 text-[#00FF94]/60" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-mono">Command Summary</span>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 place-items-center">
                {[1,2,3,4].map(i => <div key={i} className="w-[88px] h-[110px] bg-white/5 rounded-xl animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 place-items-center">
                <ProgressRing
                  value={metrics.totalCandidates}
                  max={Math.max(metrics.totalCandidates, 100)}
                  label="Candidates Screened"
                  icon={<Activity className="h-3 w-3 text-[#00FF94]" />}
                  delay={0}
                />
                <ProgressRing
                  value={`${metrics.avgFitScore}%`}
                  max={100}
                  label="Avg Fit Score"
                  icon={<Gauge className="h-3 w-3 text-[#00FF94]" />}
                  delay={100}
                />
                <ProgressRing
                  value={metrics.activeRecruitments}
                  max={Math.max(metrics.activeRecruitments, 10)}
                  label="Active Roles"
                  icon={<Layers className="h-3 w-3 text-[#00FF94]" />}
                  delay={200}
                />
                <ProgressRing
                  value="100%"
                  max={100}
                  label="AI Powered"
                  icon={<Cpu className="h-3 w-3 text-[#00FF94]" />}
                  delay={300}
                />
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════
              TWO-COLUMN: AI Workforce Nexus + Pipeline
          ═══════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-8">

            {/* Digital Workforce Nexus (60%) */}
            <div className="lg:col-span-3 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl p-5 shadow-[0_0_60px_rgba(0,255,148,0.02)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#00FF94] shadow-[0_0_10px_#00FF94]" style={{ animation: 'ring-pulse 2s ease-in-out infinite' }} />
                  Digital Workforce Nexus
                </h3>
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#00FF94]/50 font-mono tabular-nums">
                  {AI_AGENTS.filter(a => a.active).length} Active · {AI_AGENTS.filter(a => !a.active).length} Standby
                </span>
              </div>

              {/* Orbital visualization */}
              <OrbitalRings />

              <div className="space-y-2">
                {AI_AGENTS.map((agent, i) => (
                  <button
                    key={i}
                    onClick={() => navigate('/agent-studio')}
                    className="flex items-center gap-4 w-full px-4 py-3 rounded-xl hover:bg-white/[0.04] transition-all duration-300 group text-left border border-transparent hover:border-[rgba(255,255,255,0.08)] relative overflow-hidden"
                  >
                    {/* Active edge indicator */}
                    <div className={cn(
                      "absolute left-0 top-0 bottom-0 w-[3px] rounded-r transition-all duration-300",
                      agent.active
                        ? "bg-[#00FF94] opacity-0 group-hover:opacity-100 shadow-[0_0_8px_#00FF94]"
                        : "bg-white/20 opacity-0 group-hover:opacity-50"
                    )} />

                    {/* Agent avatar — double ring */}
                    <div className={cn(
                      "relative w-14 h-14 rounded-full overflow-hidden flex-shrink-0 transition-all duration-300",
                      agent.active
                        ? "border-2 border-[#00FF94]/40 shadow-[0_0_20px_rgba(0,255,148,0.15)] group-hover:border-[#00FF94]/80 group-hover:shadow-[0_0_30px_rgba(0,255,148,0.25)]"
                        : "border border-white/10 opacity-60 group-hover:opacity-80"
                    )}>
                      <div className="absolute inset-0 bg-[#030507]" />
                      <img
                        src={agent.image}
                        alt={agent.name}
                        className="w-full h-full object-cover relative z-10"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          if (e.currentTarget.nextElementSibling) {
                            (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex';
                          }
                        }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center font-bold text-[#00FF94] text-base z-20" style={{ display: 'none' }}>
                        {agent.name.charAt(0)}
                      </span>
                      {/* Pulse ring for active */}
                      {agent.active && (
                        <div className="absolute inset-0 rounded-full border border-[#00FF94]/30 z-20" style={{ animation: 'ring-pulse 3s ease-in-out infinite' }} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white">{agent.name}</p>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-md font-mono tracking-wider uppercase border"
                          style={{
                            background: agent.active ? 'linear-gradient(135deg, rgba(0,255,148,0.1), rgba(0,204,118,0.05))' : 'rgba(255,255,255,0.03)',
                            borderColor: agent.active ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.08)',
                            color: agent.active ? '#00FF94' : 'rgba(255,255,255,0.3)',
                          }}
                        >
                          {agent.role}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/40 truncate font-mono mt-1">
                        <span className="text-[#00FF94]/50">&gt; SYS_LOG:</span> {agent.status}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-white/15 group-hover:text-[#00FF94] transition-colors" />
                  </button>
                ))}
              </div>
            </div>

            {/* Pipeline Funnel (40%) */}
            <div className="lg:col-span-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl p-5 shadow-[0_0_40px_rgba(0,255,148,0.015)]">
              <div className="flex items-center gap-2 mb-5">
                <Radio className="h-3.5 w-3.5 text-[#00FF94]/50" />
                <h3 className="text-sm font-semibold text-white">Hiring Pipeline</h3>
              </div>
              {loading ? (
                <SkeletonCard variant="list-item" count={4} />
              ) : (
                <div className="space-y-4 flex flex-col justify-center">
                  {[
                    { stage: '▸ New / Sourced', count: metrics.pipelineNew, intensity: 0.3 },
                    { stage: '▸ Screened', count: metrics.pipelineScreened, intensity: 0.5 },
                    { stage: '▸ Interviewed', count: metrics.pipelineInterviewed, intensity: 0.75 },
                    { stage: '▸ Hired', count: metrics.pipelineHired, intensity: 1 },
                  ].map((s) => {
                    const pct = metrics.totalCandidates > 0 ? Math.round((s.count / metrics.totalCandidates) * 100) : 0;
                    return (
                      <div key={s.stage} className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-white/70 font-mono text-[11px]">{s.stage}</span>
                          <span className="text-white/40 font-mono tracking-widest tabular-nums">{s.count}</span>
                        </div>
                        <div className="h-[6px] rounded-full bg-white/[0.04] overflow-hidden border border-white/[0.04] relative">
                          <div
                            className="h-full rounded-full transition-all duration-1000 ease-out relative"
                            style={{
                              width: `${pct}%`,
                              background: `rgba(0, 255, 148, ${s.intensity})`,
                              boxShadow: pct > 0 ? `0 0 10px rgba(0, 255, 148, ${s.intensity * 0.5})` : 'none',
                            }}
                          >
                            {/* Shimmer overlay */}
                            {pct > 0 && (
                              <div
                                className="absolute inset-0 rounded-full"
                                style={{
                                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                                  animation: 'shimmer-bar 2.5s ease-in-out infinite',
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {/* Pipeline total */}
                  <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/25 font-mono">Total Pipeline</span>
                    <span className="text-sm font-bold text-[#00FF94] font-mono tabular-nums">
                      {metrics.totalCandidates}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════
              RECENT CANDIDATE INTERCEPTS — Terminal Log
          ═══════════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl p-5 mb-4 shadow-[0_0_40px_rgba(0,255,148,0.015)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wifi className="h-3.5 w-3.5 text-[#00FF94]/50" />
                <h3 className="text-sm font-semibold text-white">Recent Candidate Intercepts</h3>
              </div>
              <button onClick={() => navigate('/candidates')} className="text-[10px] text-[#00FF94]/70 hover:text-[#00FF94] font-mono tracking-[0.15em] uppercase transition-colors">
                View all →
              </button>
            </div>
            {loading ? (
              <SkeletonCard variant="table-row" count={5} />
            ) : recentCandidates.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-white/40 mb-3 font-mono">
                  <span className="text-[#00FF94]/50">&gt;</span> No intercepts logged
                  <span className="inline-block w-2 h-4 bg-[#00FF94]/60 ml-1" style={{ animation: 'blink-cursor 1s step-end infinite' }} />
                </p>
                <button onClick={() => navigate('/screening')} className="text-sm text-[#00FF94] hover:text-[#00FF94]/80 font-medium font-mono">
                  Upload first resume →
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.15em] text-white/30 font-mono">
                      <th className="text-left py-3 px-3 font-medium">ID_NAME</th>
                      <th className="text-left py-3 px-3 font-medium hidden sm:table-cell">ROLE_TAG</th>
                      <th className="text-left py-3 px-3 font-medium">FIT_SCORE</th>
                      <th className="text-left py-3 px-3 font-medium hidden md:table-cell">STAGE</th>
                      <th className="text-left py-3 px-3 font-medium hidden md:table-cell">TIMESTAMP</th>
                      <th className="text-right py-3 px-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCandidates.map((c) => (
                      <tr key={c.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-all duration-200 cursor-pointer group" onClick={() => navigate('/candidates')}>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-3">
                            <div className="relative w-8 h-8 rounded-full bg-[#00FF94]/[0.06] border border-[#00FF94]/15 group-hover:border-[#00FF94]/40 flex items-center justify-center text-xs font-bold text-[#00FF94] flex-shrink-0 transition-all duration-300 group-hover:shadow-[0_0_12px_rgba(0,255,148,0.15)]">
                              {c.name[0]}
                            </div>
                            <span className="font-medium text-white/80 truncate max-w-[150px] group-hover:text-white transition-colors">{c.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-white/40 truncate max-w-[120px] hidden sm:table-cell font-mono text-[11px]">{c.role}</td>
                        <td className="py-3 px-3"><ScorePill score={c.score} size="sm" /></td>
                        <td className="py-3 px-3 hidden md:table-cell">
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/[0.06] bg-white/[0.03] text-white/50 capitalize font-mono tracking-wider">{c.stage}</span>
                        </td>
                        <td className="py-3 px-3 text-white/30 text-[11px] hidden md:table-cell font-mono tracking-widest">{c.date}</td>
                        <td className="py-3 px-3 text-right">
                          <span className="text-[#00FF94]/0 group-hover:text-[#00FF94]/60 transition-colors font-mono text-[10px] mr-1">▶</span>
                          <ChevronRight className="h-4 w-4 text-white/15 group-hover:text-[#00FF94] transition-colors inline" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════
              SIGNAL INTERCEPT CONSOLE — Outbound Metrics
          ═══════════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl p-5 mb-4 shadow-[0_0_40px_rgba(0,255,148,0.015)]">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-[#00FF94]/60" />
                <h3 className="text-sm font-semibold text-white">Signal Intercept Console</h3>
              </div>
              <button onClick={() => navigate('/post-interceptor')} className="text-[10px] text-[#00FF94]/70 hover:text-[#00FF94] font-mono tracking-[0.15em] uppercase transition-colors">
                Open Interceptor →
              </button>
            </div>
            {!outbound ? (
              <div className="grid grid-cols-3 gap-4 mb-5">
                {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white/[0.03] rounded-xl animate-pulse border border-white/[0.04]" />)}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  {[
                    { label: 'Signals Intercepted', value: outbound.total, icon: <Crosshair className="h-4 w-4 text-[#00FF94]" /> },
                    { label: 'Hot Leads Pending', value: outbound.hotPending, icon: <Zap className="h-4 w-4 text-[#00FF94]" /> },
                    { label: 'DMs Deployed', value: outbound.dmsSent, icon: <MessageSquare className="h-4 w-4 text-[#00FF94]" /> },
                  ].map(m => (
                    <div key={m.label} className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-5 py-4 flex items-center gap-4 transition-all duration-300 hover:bg-white/[0.04] hover:border-[#00FF94]/15 group relative overflow-hidden">
                      {/* Animated border glow */}
                      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 shimmer-border" />
                      <div className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] relative z-10">{m.icon}</div>
                      <div className="relative z-10">
                        <p className="text-2xl font-bold text-white tabular-nums tracking-tight font-mono">{m.value}</p>
                        <p className="text-[10px] text-white/40 uppercase tracking-[0.12em] font-mono mt-0.5">{m.label}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {/* 7-cycle bar chart */}
                <div>
                  <p className="text-[9px] text-white/30 uppercase tracking-[0.2em] font-mono mb-3">
                    <span className="text-[#00FF94]/40">SIG_INTEL:</span> Leads last 7 cycles
                  </p>
                  <div className="flex items-end gap-2 h-20">
                    {outbound.last7.map(({ date, count }) => {
                      const max = Math.max(...outbound.last7.map(d => d.count), 1);
                      const pct = (count / max) * 100;
                      return (
                        <div key={date} className="flex-1 flex flex-col items-center gap-2 group" title={`${date}: ${count} leads`}>
                          <div
                            className="w-full rounded-sm bg-white/[0.06] group-hover:bg-[#00FF94] transition-all duration-300 relative overflow-hidden"
                            style={{
                              height: `${Math.max(pct, count > 0 ? 8 : 2)}%`,
                              boxShadow: 'none',
                            }}
                            onMouseEnter={(e) => {
                              if (count > 0) e.currentTarget.style.boxShadow = '0 0 15px rgba(0,255,148,0.4)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                          >
                            {/* Top cap glow */}
                            {count > 0 && <div className="absolute top-0 w-full h-[2px] bg-white/30 group-hover:bg-white/50" />}
                          </div>
                          <p className="text-[9px] text-white/25 group-hover:text-[#00FF94] tabular-nums font-mono transition-colors">
                            {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════
              DIRECT DEPLOYMENTS — Premium Action Buttons
          ═══════════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl p-5 shadow-[0_0_40px_rgba(0,255,148,0.015)]">
            <div className="flex items-center gap-2 mb-5">
              <Rocket className="h-3.5 w-3.5 text-[#00FF94]/50" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-mono">Direct Deployments</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {DEPLOYMENTS.map((d, i) => (
                <button
                  key={i}
                  onClick={() => navigate(d.path)}
                  onMouseEnter={() => setHoveredAction(i)}
                  onMouseLeave={() => setHoveredAction(null)}
                  className={cn(
                    "relative group rounded-xl border px-5 py-5 text-left transition-all duration-500 overflow-hidden",
                    hoveredAction === null || hoveredAction === i
                      ? "border-[rgba(255,255,255,0.08)] opacity-100"
                      : "border-[rgba(255,255,255,0.04)] opacity-40",
                  )}
                  style={{
                    background: hoveredAction === i
                      ? 'rgba(0, 255, 148, 0.03)'
                      : 'rgba(255, 255, 255, 0.02)',
                    boxShadow: hoveredAction === i
                      ? '0 0 60px rgba(0,255,148,0.08), inset 0 1px 0 rgba(0,255,148,0.1)'
                      : 'none',
                  }}
                >
                  {/* Shimmer border on hover */}
                  {hoveredAction === i && (
                    <div className="absolute inset-0 rounded-xl border border-[#00FF94]/20 shimmer-border pointer-events-none" />
                  )}
                  {/* Radial halo */}
                  {hoveredAction === i && (
                    <div
                      className="absolute inset-0 rounded-xl pointer-events-none"
                      style={{
                        background: 'radial-gradient(circle at 50% 50%, rgba(0,255,148,0.06) 0%, transparent 70%)',
                      }}
                    />
                  )}
                  <div className="relative z-10">
                    <d.icon className={cn(
                      "h-5 w-5 mb-3 transition-colors duration-300",
                      hoveredAction === i ? "text-[#00FF94]" : "text-white/30"
                    )} />
                    <p className="text-sm font-semibold text-white mb-1">{d.label}</p>
                    <p className="text-[11px] text-white/35 font-mono tracking-wide overflow-hidden">
                      <span className={cn(
                        "inline-block",
                        hoveredAction === i && "animate-[typewriter_0.8s_steps(30)_forwards]"
                      )}>
                        {d.subtitle}
                      </span>
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default Dashboard;
