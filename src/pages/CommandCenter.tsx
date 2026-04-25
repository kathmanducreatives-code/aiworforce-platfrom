import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Users, TrendingUp, Palette, Brain, Target, Settings,
  Clock, Plus, Search, Sparkles, Moon, Sun, ArrowRight,
  Minus, Play
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import NotificationCenter from "@/components/shared/NotificationCenter";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import CountUp from 'react-countup';
import HandoffFeedItem, { HandoffEvent } from "@/components/command-center/HandoffFeedItem";

// Mock Data as structured in the plan
const mockDepartments = [
  {
    id: 'talent',
    name: 'Talent',
    color: 'talent',
    status: 'active',
    icon: Target,
    agents: ['Scout', 'Aria', 'Expert'],
    stats: {
      active: '3 agents',
      today: '12 candidates screened',
      thisWeek: '47 interviews completed'
    },
    href: '/departments/talent'
  },
  {
    id: 'growth',
    name: 'Growth',
    color: 'growth',
    status: 'coming-soon',
    icon: TrendingUp,
    agents: ['Radar', 'Penn', 'Relay'],
    description: 'Find leads, write outreach, track responses',
    href: null
  },
  {
    id: 'content',
    name: 'Content',
    color: 'content',
    status: 'coming-soon',
    icon: Palette,
    agents: ['Ink', 'Palette', 'Chronos'],
    description: 'Write posts, create visuals, schedule content',
    href: null
  },
  {
    id: 'intelligence',
    name: 'Intelligence',
    color: 'intelligence',
    status: 'partial',
    icon: Brain,
    agents: ['Brief', 'Watch', 'Pulse'],
    stats: {
      active: '1 agent',
      today: 'Morning brief delivered',
      thisWeek: '14 competitor signals'
    },
    href: '/departments/intelligence'
  }
];

type FeedItem =
  | {
      kind?: 'activity';
      time: string;
      agent: string;
      department: string;
      action: string;
      details: string;
      cta?: string;
      href?: string;
      badge: string | null;
      disabled?: boolean;
    }
  | (HandoffEvent & { kind: 'handoff' });

const mockActivityFeed: FeedItem[] = [
  {
    time: '9:31 AM',
    agent: 'Aria',
    department: 'talent',
    action: 'Completed AI screening for 12 candidates',
    details: 'Average fit score: 76% • 3 high-priority matches',
    cta: 'Review Candidates',
    href: '/candidates',
    badge: null
  },
  {
    kind: 'handoff',
    time: '9:15 AM',
    from: { agent: 'Scout', dept: 'talent', action: 'Sourced 18 leads matching ICP' },
    to: { agent: 'Aria', dept: 'talent', action: 'Now screening them in batch' },
  },
  {
    time: '7:45 AM',
    agent: 'Penn',
    department: 'growth',
    action: 'Drafted 3 personalized outreach emails',
    details: 'Targeting Series A companies • Ready for review',
    badge: 'needs-approval',
    disabled: true
  },
  {
    kind: 'handoff',
    time: '7:20 AM',
    from: { agent: 'Brief', dept: 'intelligence', action: 'Flagged 2 hot signals overnight' },
    to: { agent: 'Penn', dept: 'growth', action: 'Drafting outreach for matching leads' },
  },
  {
    time: '7:00 AM',
    agent: 'Brief',
    department: 'intelligence',
    action: 'Morning intelligence brief delivered',
    details: '3 competitor updates • 2 market signals • 1 urgent alert',
    cta: 'Read Brief',
    href: '/growth-signals',
    badge: null
  },
  {
    time: 'Yesterday 11:45 PM',
    agent: 'Scout',
    department: 'talent',
    action: 'Sourced 47 new candidates matching Senior Engineer ICP',
    details: 'Lookalike search completed • Sent to Aria for screening',
    cta: 'View Candidates',
    href: '/candidates',
    badge: null
  }
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function CommandCenter() {
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-500">
        
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            {profile?.logo_url && (
              <img src={profile.logo_url} alt="Logo" className="h-10 w-auto rounded-md shadow-sm" />
            )}
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {getGreeting()}, {profile?.full_name?.split(' ')[0] || 'there'}
              </h1>
              <p className="text-[15px] text-zinc-400 mt-1 flex items-center gap-2">
                Your AI workforce completed <strong className="text-white">47 tasks</strong> today
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-[#1a2332]/50 text-xs shadow-sm">
              <Moon className="h-3.5 w-3.5 text-zinc-400" />
              <Switch checked={theme === 'light'} onCheckedChange={toggleTheme} className="data-[state=checked]:bg-emerald-500 scale-90" />
              <Sun className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <NotificationCenter />
            <button className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-zinc-200 transition-colors hover-lift">
              <Plus className="h-4 w-4" />
              Deploy New Agent
            </button>
          </div>
        </div>

        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <MetricCard 
            icon={<Users className="h-4 w-4 text-emerald-500" />} 
            label="Candidates Screened"
            value={12}
            change="+8 vs yesterday"
            trend="up"
          />
          <MetricCard 
            icon={<TrendingUp className="h-4 w-4 text-blue-500" />} 
            label="Leads Found"
            value={4}
            change="0% vs last week"
            trend="neutral"
          />
          <MetricCard 
            icon={<Palette className="h-4 w-4 text-purple-500" />} 
            label="Content Scheduled"
            value={3}
            change="+2 this week"
            trend="up"
          />
          <MetricCard 
            icon={<Clock className="h-4 w-4 text-amber-500" />} 
            label="Time Saved Today"
            value={6.2}
            suffix="h"
            subtitle="vs manual work"
            trend="up"
          />
        </div>

        {/* Department Cards Section */}
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Your AI Departments</h2>
            <p className="text-sm text-zinc-400 mt-1">5 departments • 3 active • 12 agents deployed</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {mockDepartments.map(dept => (
            <DepartmentCard key={dept.id} {...dept} />
          ))}
          
          {/* Command Center Settings Card */}
          <div className="glass-card rounded-2xl p-6 relative overflow-hidden group hover-lift border-white/5 bg-[#1a2332]/80 hover:border-pink-500/30">
            <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle,rgba(236,72,153,0.1)_0%,transparent_60%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            
            <div className="flex items-start justify-between mb-6 relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
                  <Settings className="h-5 w-5 text-pink-500" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Company Brain</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-500 pulse-badge" />
                    <span className="text-[11px] font-semibold text-pink-400 tracking-wider uppercase">Setup Needed</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-sm text-zinc-400 mb-6 relative z-10">
              Your shared context across all departments. Agents use this to understand your brand and goals.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
              <div>
                <p className="text-xs text-zinc-500 mb-1">Setup</p>
                <p className="text-sm font-semibold text-white">8/12 complete</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1">Updated</p>
                <p className="text-sm font-semibold text-white">2 days ago</p>
              </div>
            </div>

            <button 
              onClick={() => navigate('/dashboard')}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-pink-500 text-white text-sm font-semibold transition-colors hover:bg-pink-600 relative z-10 shadow-[0_0_15px_rgba(236,72,153,0.2)]"
            >
              Complete Setup
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Two-Column Activity & Action Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column - Activity Timeline */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white tracking-tight">Today's Activity</h2>
              <div className="flex items-center gap-2 bg-[#1a2332] p-1 rounded-lg border border-white/5">
                <button className="px-3 py-1.5 text-xs font-semibold rounded bg-white/10 text-white">All</button>
                <button className="px-3 py-1.5 text-xs font-semibold rounded text-zinc-400 hover:text-white transition-colors">Talent</button>
                <button className="px-3 py-1.5 text-xs font-semibold rounded text-zinc-400 hover:text-white transition-colors">Intelligence</button>
              </div>
            </div>

            <div className="glass-card rounded-2xl p-6 border-white/5 bg-[#1a2332]/60">
              <div className="relative border-l border-white/10 ml-4 space-y-8 py-2">
                {mockActivityFeed.map((item, idx) => {
                  if (item.kind === 'handoff') {
                    return <HandoffFeedItem key={idx} event={item} />;
                  }
                  return (
                  <div key={idx} className="relative pl-6">
                    {/* Timeline Dot */}
                    <div className={cn(
                      "absolute -left-[5px] top-1.5 w-[9px] h-[9px] rounded-full border-2 border-[#1a2332]",
                      item.department === 'talent' ? 'bg-emerald-500' :
                      item.department === 'growth' ? 'bg-blue-500' :
                      item.department === 'intelligence' ? 'bg-amber-500' : 'bg-zinc-500'
                    )} />
                    
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-[#0a0f1a] border border-white/10 rounded-full px-2 py-1">
                          <div className={cn(
                            "w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white",
                            item.department === 'talent' ? 'bg-emerald-500' :
                            item.department === 'growth' ? 'bg-blue-500' :
                            item.department === 'intelligence' ? 'bg-amber-500' : 'bg-zinc-500'
                          )}>
                            {item.agent[0]}
                          </div>
                          <span className="text-xs font-semibold text-zinc-300">{item.agent}</span>
                        </div>
                        <span className="text-xs text-zinc-500 font-medium">{item.time}</span>
                      </div>
                      
                      {item.badge && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          {item.badge.replace('-', ' ')}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-sm font-medium text-white mb-1">{item.action}</p>
                    <p className="text-sm text-zinc-400 mb-3">{item.details}</p>
                    
                    {item.cta && (
                      <button 
                        disabled={item.disabled}
                        onClick={() => item.href && navigate(item.href)}
                        className={cn(
                          "text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5",
                          item.disabled 
                            ? "bg-transparent border-white/5 text-zinc-500 cursor-not-allowed" 
                            : "bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {item.cta}
                        {!item.disabled && <ArrowRight className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column - Quick Actions */}
          <div className="space-y-6">
            
            {/* Quick Actions */}
            <div className="glass-card rounded-2xl p-5 border-white/5 bg-[#1a2332]/60">
              <h3 className="text-sm font-bold text-white mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <ActionItem icon={<Plus className="h-4 w-4 text-emerald-500" />} label="Create Screening Job" href="/screening-jobs" />
                <ActionItem icon={<Search className="h-4 w-4 text-emerald-500" />} label="Source New Candidates" href="/lead-scraper" />
                <ActionItem icon={<Brain className="h-4 w-4 text-pink-500" />} label="Update Company Brain" href="/dashboard" badge="4 incomplete" badgeColor="pink" />
                <ActionItem icon={<Sparkles className="h-4 w-4 text-blue-500" />} label="Deploy Custom Agent" href="/dashboard" badge="new" badgeColor="blue" />
              </div>
            </div>

            {/* Needs Attention */}
            <div className="glass-card rounded-2xl p-5 border-white/5 bg-[#1a2332]/60">
              <h3 className="text-sm font-bold text-white mb-4">Needs Your Attention</h3>
              <div className="space-y-3">
                <AttentionItem 
                  priority="high"
                  title="3 high-fit candidates ready"
                  action="Schedule Interviews"
                  href="/candidates"
                />
                <AttentionItem 
                  priority="medium"
                  title="Complete Company Brain setup"
                  action="Complete Setup"
                  href="/dashboard"
                />
                <AttentionItem 
                  priority="low"
                  title="1 active screening job needs review"
                  action="Review Job"
                  href="/screening-jobs"
                />
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------

function MetricCard({ icon, label, value, suffix = '', change, subtitle, trend }: any) {
  return (
    <div className="glass-card rounded-2xl p-5 border-white/5 bg-[#1a2332]/80 hover-lift relative overflow-hidden group">
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="w-8 h-8 rounded-lg bg-[#0a0f1a] border border-white/5 flex items-center justify-center">
          {icon}
        </div>
        {change && (
          <div className={cn(
            "flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border",
            trend === 'up' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 
            trend === 'down' ? 'text-rose-400 bg-rose-400/10 border-rose-400/20' :
            'text-zinc-400 bg-zinc-400/10 border-white/10'
          )}>
            {trend === 'up' && <TrendingUp className="h-3 w-3" />}
            {trend === 'down' && <TrendingUp className="h-3 w-3 rotate-180" />}
            {trend === 'neutral' && <Minus className="h-3 w-3" />}
            {change}
          </div>
        )}
      </div>
      
      <div className="relative z-10">
        <p className="text-3xl font-bold text-white tabular-nums tracking-tight mb-1">
          <CountUp end={value} decimals={suffix === 'h' ? 1 : 0} duration={2} />
          {suffix}
        </p>
        <p className="text-sm font-medium text-zinc-400">{label}</p>
        {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

function DepartmentCard({ color, status, name, icon: Icon, agents, stats, description, cta, href }: any) {
  const isComingSoon = status === 'coming-soon';
  const getGlowColor = () => {
    if (color === 'talent') return 'rgba(16,185,129,0.15)';
    if (color === 'growth') return 'rgba(59,130,246,0.15)';
    if (color === 'content') return 'rgba(139,92,246,0.15)';
    if (color === 'intelligence') return 'rgba(245,158,11,0.15)';
    return 'rgba(255,255,255,0.05)';
  };
  
  const getBorderColor = () => {
    if (color === 'talent') return 'border-emerald-500/30';
    if (color === 'growth') return 'border-blue-500/30';
    if (color === 'content') return 'border-purple-500/30';
    if (color === 'intelligence') return 'border-amber-500/30';
    return 'border-white/10';
  };

  const getTextColor = () => {
    if (color === 'talent') return 'text-emerald-500';
    if (color === 'growth') return 'text-blue-500';
    if (color === 'content') return 'text-purple-500';
    if (color === 'intelligence') return 'text-amber-500';
    return 'text-white';
  };

  const getBgColor = () => {
    if (color === 'talent') return 'bg-emerald-500';
    if (color === 'growth') return 'bg-blue-500';
    if (color === 'content') return 'bg-purple-500';
    if (color === 'intelligence') return 'bg-amber-500';
    return 'bg-white';
  };

  return (
    <div className={cn(
      "glass-card rounded-2xl p-6 relative overflow-hidden transition-all duration-300 border-white/5 bg-[#1a2332]/80",
      isComingSoon ? "opacity-60 grayscale hover:grayscale-0 cursor-not-allowed" : `hover-lift hover:${getBorderColor()} group`
    )}>
      {!isComingSoon && (
        <div 
          className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-0"
          style={{ background: `radial-gradient(circle, ${getGlowColor()} 0%, transparent 60%)` }}
        />
      )}

      <div className="flex items-start justify-between mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl bg-opacity-10 border flex items-center justify-center", getBgColor().replace('bg-', 'bg-opacity-10 border-').replace('500', '500/20'))}>
            <Icon className={cn("h-5 w-5", getTextColor())} />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">{name} Department</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              {status === 'active' || status === 'partial' ? (
                <>
                  <span className={cn("w-1.5 h-1.5 rounded-full pulse-badge", getBgColor())} />
                  <span className={cn("text-[11px] font-semibold tracking-wider uppercase", getTextColor())}>
                    {status === 'active' ? 'Active' : 'Partial'}
                  </span>
                </>
              ) : (
                <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-500">Coming Soon</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {agents && (
        <div className="flex items-center gap-2 mb-5 relative z-10 border-b border-white/5 pb-5">
          <div className="flex -space-x-3">
            {agents.map((agent: string) => (
              <div key={agent} className={cn(
                "w-8 h-8 rounded-full border-2 border-[#1a2332] flex items-center justify-center text-xs font-bold text-white shadow-sm transition-transform hover:scale-110",
                color === 'talent' ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' :
                color === 'growth' ? 'bg-gradient-to-br from-blue-400 to-blue-600' :
                color === 'content' ? 'bg-gradient-to-br from-purple-400 to-purple-600' :
                'bg-gradient-to-br from-amber-400 to-amber-600'
              )}>
                {agent[0]}
              </div>
            ))}
          </div>
          <span className="text-xs font-medium text-zinc-400 ml-1">{agents.length} agents</span>
        </div>
      )}

      {stats ? (
        <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Active</p>
            <p className="text-sm font-semibold text-white">{stats.active}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Today</p>
            <p className="text-sm font-semibold text-white truncate">{stats.today}</p>
          </div>
          {stats.thisWeek && (
            <div className="col-span-2">
              <p className="text-xs text-zinc-500 mb-1">This Week</p>
              <p className="text-sm font-semibold text-white">{stats.thisWeek}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-400 mb-6 relative z-10 h-16">{description}</p>
      )}

      {href ? (
        <Link 
          to={href}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors relative z-10 border shadow-sm",
            color === 'talent' ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-500' :
            color === 'intelligence' ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500' :
            'bg-white text-black hover:bg-zinc-200 border-white'
          )}
        >
          {cta || 'View Department'}
          <ArrowRight className="h-4 w-4" />
        </Link>
      ) : (
        <button 
          disabled
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-white/5 text-zinc-500 border border-white/5 cursor-not-allowed relative z-10"
        >
          Coming Soon
        </button>
      )}
    </div>
  );
}

function ActionItem({ icon, label, href, badge, badgeColor = 'emerald' }: any) {
  return (
    <Link to={href} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors group">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#0a0f1a] border border-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
          {icon}
        </div>
        <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">{label}</span>
      </div>
      {badge && (
        <span className={cn(
          "text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded",
          badgeColor === 'pink' ? 'bg-pink-500/10 text-pink-500' :
          badgeColor === 'blue' ? 'bg-blue-500/10 text-blue-500' :
          'bg-emerald-500/10 text-emerald-500'
        )}>
          {badge}
        </span>
      )}
    </Link>
  );
}

function AttentionItem({ priority, title, action, href }: any) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-white/5 bg-[#0a0f1a]/50 gap-3">
      <div className="flex items-start gap-3">
        <div className={cn(
          "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
          priority === 'high' ? 'bg-rose-500' :
          priority === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'
        )} />
        <p className="text-sm font-medium text-white leading-snug">{title}</p>
      </div>
      <Link to={href} className="text-xs font-semibold whitespace-nowrap px-3 py-1.5 rounded-md bg-white/10 text-white hover:bg-white/20 transition-colors self-start sm:self-auto">
        {action}
      </Link>
    </div>
  );
}
