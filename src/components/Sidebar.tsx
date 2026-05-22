import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Calendar, Search, Brain, Target, TrendingUp,
  Mail, BarChart3, LogOut, HelpCircle,
  PanelLeftClose, PanelLeft, Users, Eye, Inbox,
  Sparkles, Megaphone, BookOpen, Plus, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { openAgentBuilder } from '@/hooks/useAgentBuilder';

interface NavGroup {
  label: string;
  items: { path: string; icon: any; label: string; badge?: string; badgeColor?: 'amber' | 'emerald' }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/awaiting-you', icon: Inbox, label: 'Awaiting You', badge: '4', badgeColor: 'amber' },
      // TODO: route to /conversations in later pass
      { path: '/dashboard', icon: MessageSquare, label: 'Conversations' },
    ],
  },
  {
    label: 'Workforce',
    items: [
      { path: '/rooms/talent',       icon: Sparkles,  label: 'Talent' },
      { path: '/rooms/growth',       icon: Megaphone, label: 'Growth' },
      { path: '/rooms/intelligence', icon: Eye,       label: 'Intelligence' },
      { path: '/rooms/content',      icon: BookOpen,  label: 'Content' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { path: '/lead-scraper', icon: Search, label: 'Lead Scraper' },
      { path: '/icp-intelligence', icon: Target, label: 'ICP Intelligence' },
      { path: '/deep-search', icon: Brain, label: 'Deep Search' },
      { path: '/growth-signals', icon: TrendingUp, label: 'Growth Signals' },
      { path: '/talent-intel', icon: Users, label: 'Talent Intel' },
      { path: '/competitor-intel', icon: Eye, label: 'Competitor Intel' },
      { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/interview-scheduler', icon: Calendar, label: 'Interviews' },
      { path: '/email-sequences', icon: Mail, label: 'Email Sequences' },
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
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col bg-background transition-all duration-300',
        collapsed ? 'w-[64px]' : 'w-[248px]'
      )}
    >
      {/* Workspace header */}
      <div className={cn('flex items-center gap-3 px-3 py-4', collapsed && 'justify-center px-0')}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-medium text-white shrink-0"
             style={{ background: 'linear-gradient(135deg, #10B981 0%, #0EA5E9 100%)' }}>
          {profile?.full_name?.[0]?.toUpperCase() || 'S'}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate leading-tight">{profile?.full_name || 'ScreeningPilot'}</p>
            </div>
            <span className="text-[9px] tracking-wider text-primary border border-primary/40 rounded-full px-1.5 py-px">
              PRO
            </span>
          </>
        )}
      </div>

      {/* Search */}
      {!collapsed && onOpenCommandPalette && (
        <button
          onClick={onOpenCommandPalette}
          className="mx-3 mb-2 flex items-center gap-2 px-3 h-8 rounded-md bg-white/[0.03] hover:bg-white/[0.06] text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[9px] text-text-tertiary font-mono">⌘K</kbd>
        </button>
      )}
      {collapsed && onOpenCommandPalette && (
        <button onClick={onOpenCommandPalette} className="mx-auto mb-2 p-2 rounded-md hover:bg-white/[0.04] transition-colors">
          <Search className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {navGroups.map((group) => (
          <div key={group.label} className="mt-6 first:mt-1">
            {!collapsed && (
              <div className="flex items-center justify-between pl-3 pr-2 mb-1">
                <p className="text-mono-label text-text-tertiary">
                  {group.label}
                </p>
              </div>
            )}
            <div className="space-y-px">
              {group.items.map((item) => {
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                return (
                  <NavLink
                    key={`${group.label}-${item.path}-${item.label}`}
                    to={item.path}
                    className={cn(
                      'group relative flex items-center gap-2.5 h-9 px-3 rounded-md text-[13px] transition-colors',
                      isActive
                        ? 'bg-surface-hover text-foreground pl-[10px] border-l-2 border-primary rounded-l-none'
                        : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]',
                      collapsed && 'justify-center px-2',
                    )}
                  >
                    <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
                    {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                    {!collapsed && item.badge && (
                      <span className={cn(
                        'text-[10px] font-semibold px-1.5 py-px rounded-full tabular-nums',
                        item.badgeColor === 'amber'
                          ? 'bg-amber-900/60 text-amber-200'
                          : 'bg-emerald-500/15 text-primary',
                      )}>
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
              {group.label === 'Workforce' && (
                <button
                  onClick={() => openAgentBuilder()}
                  className={cn(
                    'flex items-center gap-2.5 h-9 px-3 rounded-md text-[13px] text-primary hover:bg-emerald-500/[0.08] transition-colors w-full',
                    collapsed && 'justify-center px-2',
                  )}
                  aria-label="New agent"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  {!collapsed && <span className="truncate flex-1 text-left">New Agent</span>}
                </button>
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom utility */}
      <div className="border-t border-white/[0.06] px-2 py-2 space-y-px">
        <button
          className={cn(
            'flex items-center gap-2.5 h-8 px-3 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          {!collapsed && <span>Help & Support</span>}
        </button>
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-2.5 h-8 px-3 rounded-md text-[12px] text-muted-foreground hover:text-rose-400 hover:bg-white/[0.04] transition-colors w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-3.5 w-3.5" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <button
          onClick={onToggle}
          className={cn(
            'flex items-center gap-2.5 h-8 px-3 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          {collapsed ? <PanelLeft className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
