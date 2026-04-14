import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Calendar, Search, Brain, Target, TrendingUp,
  Mail, Share2, BarChart3, LogOut, HelpCircle,
  PanelLeftClose, PanelLeft, Users, Briefcase, Crosshair, Zap, Radar, Eye, Bot,
  Terminal
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavGroup {
  label: string;
  items: { path: string; icon: any; label: string }[];
}

const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { path: '/dashboard', icon: LayoutDashboard, label: 'Command Center' },
      { path: '/agent-studio', icon: Bot, label: 'Agent Studio' },
    ],
  },
  {
    label: 'Talent',
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
    label: 'Growth',
    items: [
      { path: '/email-sequences', icon: Mail, label: 'Email Sequences' },
      { path: '/distribution', icon: Share2, label: 'Job Distribution' },
      { path: '/post-interceptor', icon: Crosshair, label: 'Post Interceptor' },
      { path: '/lead-crm', icon: Zap, label: 'Lead CRM' },
      { path: '/outreach-engine', icon: Mail, label: 'Outreach Engine' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { path: '/competitor-intel', icon: Eye, label: 'Competitor Intel' },
      { path: '/competitors', icon: Radar, label: 'Job Tracker' },
      { path: '/growth-signals', icon: TrendingUp, label: 'Growth Signals' },
      { path: '/talent-intel', icon: Users, label: 'Talent Intel' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

const Sidebar = ({ collapsed, onToggle, onOpenCommandPalette }: SidebarProps) => {
  const { signOut, profile } = useAuth();
  const location = useLocation();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col transition-all duration-300',
        'bg-[rgba(15,20,18,0.4)] backdrop-blur-[24px] border-r border-[rgba(0,255,148,0.1)]',
        collapsed ? 'w-[64px]' : 'w-[248px]'
      )}
    >
      {/* User Profile */}
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-[rgba(255,255,255,0.08)]', collapsed && 'justify-center px-0')}>
        {!collapsed && (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#00FF94]/10 border border-[#00FF94]/20 flex items-center justify-center text-sm font-bold text-[#00FF94] flex-shrink-0 shadow-[0_0_12px_rgba(0,255,148,0.1)]">
              {profile?.full_name?.[0] || 'S'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{profile?.full_name || 'ScreeningPilot'}</p>
              <p className="text-[10px] text-white/40 truncate font-mono">operator</p>
            </div>
            <span className="text-[9px] font-bold text-[#00FF94] bg-[#00FF94]/10 border border-[#00FF94]/20 px-1.5 py-0.5 rounded font-mono tracking-wider flex-shrink-0">PRO</span>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-[#00FF94]/10 border border-[#00FF94]/20 flex items-center justify-center text-sm font-bold text-[#00FF94] shadow-[0_0_12px_rgba(0,255,148,0.1)]">
            {profile?.full_name?.[0] || 'S'}
          </div>
        )}
      </div>

      {/* Futuristic Command Search */}
      {!collapsed && onOpenCommandPalette && (
        <button
          onClick={onOpenCommandPalette}
          className="mx-3 mt-3 flex items-center gap-2 px-3 py-2.5 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-xs text-white/40 hover:text-white/70 hover:border-[#00FF94]/40 hover:shadow-[0_0_20px_rgba(0,255,148,0.08)] transition-all duration-300 font-mono group"
        >
          <Terminal className="h-3.5 w-3.5 text-white/30 group-hover:text-[#00FF94] transition-colors" />
          <span className="flex-1 text-left tracking-wide text-[11px]">SYS_COMMAND: enter directive...</span>
          <kbd className="text-[9px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 font-mono text-[#00FF94]/60">⌘K</kbd>
        </button>
      )}
      {collapsed && onOpenCommandPalette && (
        <button onClick={onOpenCommandPalette} className="mx-auto mt-3 p-2 rounded-full hover:bg-white/5 border border-transparent hover:border-[#00FF94]/30 transition-all duration-300">
          <Terminal className="h-4 w-4 text-white/40 hover:text-[#00FF94]" />
        </button>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5 scrollbar-thin scrollbar-thumb-white/5">
        {navGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && group.label && (
              <p className="text-[9px] font-medium text-white/25 uppercase tracking-[0.2em] px-3 mb-2 font-mono">
                {group.label}
              </p>
            )}
            {collapsed && group.label && (
              <div className="w-6 h-px bg-white/8 mx-auto mb-2" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 relative group',
                      isActive
                        ? 'bg-[#00FF94]/[0.08] text-[#00FF94]'
                        : 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]',
                      collapsed && 'justify-center px-2'
                    )}
                  >
                    {/* Active indicator bar */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#00FF94] rounded-r-full shadow-[0_0_8px_#00FF94]" />
                    )}
                    <item.icon className={cn('h-4 w-4 flex-shrink-0 transition-colors', isActive ? 'text-[#00FF94]' : 'text-white/40 group-hover:text-white/70')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {/* Hover tooltip for collapsed */}
                    {collapsed && (
                      <div className="absolute left-full ml-2 px-2 py-1 rounded-md bg-[#0a0a0a] border border-white/10 text-[11px] text-white/80 font-mono opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-xl">
                        {item.label}
                      </div>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-[rgba(255,255,255,0.08)] px-3 py-3 space-y-0.5">
        <button
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <HelpCircle className="h-4 w-4" />
          {!collapsed && <span>Help & Support</span>}
        </button>
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/40 hover:text-red-400 hover:bg-red-500/[0.06] transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <div className="pt-1.5 border-t border-[rgba(255,255,255,0.06)] mt-1.5">
          <button
            onClick={onToggle}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all w-full',
              collapsed && 'justify-center px-2'
            )}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
