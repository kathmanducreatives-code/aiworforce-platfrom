import { useState, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Bot, Wrench, Target, TrendingUp, Palette, Eye,
  Search, Brain, Calendar, Users, Briefcase, Mail, Share2, Crosshair, Zap,
  Radar, BarChart3, LogOut, HelpCircle, Terminal, ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Navigation Definition ─── */

interface RailItem {
  path: string;
  icon: any;
  label: string;
}

interface RailGroup {
  id: string;
  label: string;
  icon?: any;
  items: RailItem[];
}

const RAIL_GROUPS: RailGroup[] = [
  {
    id: 'core',
    label: 'WORKSPACE',
    items: [
      { path: '/dashboard', icon: LayoutDashboard, label: 'Command Center' },
      { path: '/agent-studio', icon: Bot, label: 'Agent Studio' },
    ],
  },
  {
    id: 'talent',
    label: 'DEPARTMENTS',
    icon: Target,
    items: [
      { path: '/departments/talent', icon: Target, label: 'Talent Dept' },
      { path: '/screening-jobs', icon: Briefcase, label: 'Job Screening' },
      { path: '/candidates', icon: Users, label: 'Candidates' },
      { path: '/lead-scraper', icon: Search, label: 'Scout (Source)' },
      { path: '/icp-intelligence', icon: Target, label: 'ICP Intelligence' },
      { path: '/deep-search', icon: Brain, label: 'Deep Search' },
      { path: '/expert-marketplace', icon: Users, label: 'Expert Interviews' },
      { path: '/interview-scheduler', icon: Calendar, label: 'Interviews' },
    ],
  },
  {
    id: 'growth',
    label: 'GROWTH',
    icon: TrendingUp,
    items: [
      { path: '/email-sequences', icon: Mail, label: 'Email Sequences' },
      { path: '/distribution', icon: Share2, label: 'Job Distribution' },
      { path: '/post-interceptor', icon: Crosshair, label: 'Post Interceptor' },
      { path: '/lead-crm', icon: Zap, label: 'Lead CRM' },
      { path: '/outreach-engine', icon: Mail, label: 'Outreach Engine' },
    ],
  },
  {
    id: 'intelligence',
    label: 'INTELLIGENCE',
    icon: Eye,
    items: [
      { path: '/competitor-intel', icon: Eye, label: 'Competitor Intel' },
      { path: '/competitors', icon: Radar, label: 'Job Tracker' },
      { path: '/growth-signals', icon: TrendingUp, label: 'Growth Signals' },
      { path: '/talent-intel', icon: Users, label: 'Talent Intel' },
    ],
  },
  {
    id: 'insights',
    label: 'TOOLS',
    icon: BarChart3,
    items: [
      { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    ],
  },
];

/* ─── Component ─── */

interface NavigationRailProps {
  onOpenCommandPalette: () => void;
}

const NavigationRail = ({ onOpenCommandPalette }: NavigationRailProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['core', 'talent', 'growth', 'intelligence', 'insights']));
  const { signOut, profile } = useAuth();
  const location = useLocation();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(true), 120);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(false), 200);
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col',
        'bg-[rgba(3,10,12,0.95)] backdrop-blur-[20px] border-r border-[rgba(52,211,153,0.08)]',
        'transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
        isExpanded ? 'w-[240px]' : 'w-[64px]'
      )}
      style={{ willChange: 'width' }}
    >
      {/* ─── User Identity ─── */}
      <div className={cn(
        'flex items-center gap-3 px-4 py-4 border-b border-[rgba(255,255,255,0.06)]',
        !isExpanded && 'justify-center px-0'
      )}>
        <div className="w-8 h-8 rounded-lg bg-[#34d399]/10 border border-[#34d399]/20 flex items-center justify-center text-sm font-bold text-[#34d399] flex-shrink-0 shadow-[0_0_12px_rgba(52,211,153,0.1)]">
          {profile?.full_name?.[0] || 'S'}
        </div>
        {isExpanded && (
          <div className="flex-1 min-w-0 animate-in fade-in duration-200">
            <p className="text-sm font-semibold text-white truncate">{profile?.full_name || 'ScreeningPilot'}</p>
            <p className="text-[10px] text-white/30 truncate font-mono tracking-wider">OPERATOR</p>
          </div>
        )}
        {isExpanded && (
          <span className="text-[9px] font-bold text-[#34d399] bg-[#34d399]/10 border border-[#34d399]/20 px-1.5 py-0.5 rounded font-mono tracking-wider flex-shrink-0 animate-in fade-in duration-200">PRO</span>
        )}
      </div>

      {/* ─── SYS_COMMAND Trigger ─── */}
      <div className="px-2 pt-3">
        <button
          onClick={onOpenCommandPalette}
          className={cn(
            'flex items-center rounded-lg transition-all duration-200 w-full group',
            isExpanded
              ? 'gap-2 px-3 py-2.5 border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:border-[#00FF94]/30 hover:shadow-[0_0_16px_rgba(0,255,148,0.06)]'
              : 'justify-center py-2.5 hover:bg-white/[0.04]'
          )}
        >
          <Terminal className="h-3.5 w-3.5 text-white/25 group-hover:text-[#34d399] transition-colors flex-shrink-0" />
          {isExpanded && (
            <>
              <span className="flex-1 text-left text-[10px] text-white/30 font-mono tracking-wider truncate">SYS_COMMAND</span>
              <kbd className="text-[9px] bg-white/5 border border-white/8 rounded px-1.5 py-0.5 font-mono text-[#34d399]/50">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* ─── Navigation Groups ─── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-1 scrollbar-thin scrollbar-thumb-white/5">
        {RAIL_GROUPS.map((group) => {
          const isGroupExpanded = expandedGroups.has(group.id);
          const hasActiveChild = group.items.some(item =>
            location.pathname === item.path || location.pathname.startsWith(item.path + '/')
          );

          return (
            <div key={group.id}>
              {/* Group header */}
              {group.label && isExpanded && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 mt-2 mb-1 group/header"
                >
                  <span className={cn(
                    'text-[9px] font-medium uppercase tracking-[0.2em] font-mono transition-colors',
                    hasActiveChild ? 'text-[#34d399]/50' : 'text-white/20'
                  )}>
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                  <ChevronDown className={cn(
                    'h-3 w-3 text-white/15 transition-transform duration-200',
                    !isGroupExpanded && '-rotate-90'
                  )} />
                </button>
              )}
              {group.label && !isExpanded && (
                <div className="w-5 h-px bg-white/[0.06] mx-auto my-2" />
              )}

              {/* Group items */}
              {(isGroupExpanded || !group.label) && (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 relative group/item',
                          isActive
                            ? 'bg-[#34d399]/[0.08] text-[#34d399]'
                            : 'text-white/40 hover:text-white/75 hover:bg-white/[0.03]',
                          !isExpanded && 'justify-center px-0'
                        )}
                      >
                        {/* Active indicator bar */}
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#34d399] rounded-r-full shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                        )}
                        <item.icon className={cn(
                          'h-4 w-4 flex-shrink-0 transition-colors',
                          isActive ? 'text-[#34d399]' : 'text-white/35 group-hover/item:text-white/60'
                        )} />
                        {isExpanded && (
                          <span className="truncate animate-in fade-in duration-150">{item.label}</span>
                        )}
                        {/* Tooltip on collapsed */}
                        {!isExpanded && (
                          <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-[#0a0e0c] border border-white/8 text-[11px] text-white/80 font-mono opacity-0 group-hover/item:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[60] shadow-2xl">
                            {item.label}
                          </div>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ─── Bottom Controls ─── */}
      <div className="border-t border-[rgba(255,255,255,0.06)] px-2 py-2 space-y-0.5">
        <button
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-white/35 hover:text-white/65 hover:bg-white/[0.03] transition-all w-full',
            !isExpanded && 'justify-center px-0'
          )}
        >
          <HelpCircle className="h-4 w-4 flex-shrink-0" />
          {isExpanded && <span className="truncate">Help & Support</span>}
        </button>
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-white/35 hover:text-red-400 hover:bg-red-500/[0.05] transition-all w-full',
            !isExpanded && 'justify-center px-0'
          )}
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {isExpanded && <span className="truncate">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
};

export default NavigationRail;
