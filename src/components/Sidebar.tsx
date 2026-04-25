import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Target, TrendingUp, Palette, Brain,
  Search, Users, SearchCheck, Mail, HelpCircle, LogOut,
  PanelLeftClose, PanelLeft, MessageSquare, Briefcase, Calendar,
  Eye, Settings, FileText, Inbox
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Types for our navigation system
type NavItemType = {
  label: string;
  path?: string;
  icon?: any;
  color?: 'talent' | 'growth' | 'content' | 'intelligence' | 'command';
  badge?: string;
  isDisabled?: boolean;
  subItems?: { label: string; path?: string; icon?: any; isDisabled?: boolean }[];
};

type NavSectionType = {
  label?: string;
  items: NavItemType[];
};

const navigation: NavSectionType[] = [
  {
    items: [
      {
        label: 'Command Center',
        path: '/dashboard',
        icon: LayoutDashboard,
        badge: 'new'
      }
    ]
  },
  {
    label: 'DEPARTMENTS',
    items: [
      {
        label: 'Talent Department',
        path: '/departments/talent',
        icon: Target,
        color: 'talent',
        badge: '3 active',
        subItems: [
          { label: 'Scout', path: '/lead-scraper', icon: Search },
          // Using /talent-intel routing for Aria as an example, adjust as needed based on actual agent paths
          { label: 'Aria', path: '/talent-intel', icon: MessageSquare },
          { label: 'Job Screening', path: '/screening-jobs', icon: Briefcase },
          { label: 'Candidates', path: '/candidates', icon: Users },
          { label: 'Interviews', path: '/interview-scheduler', icon: Calendar },
        ]
      },
      {
        label: 'Growth Department',
        path: '/departments/growth',
        icon: TrendingUp,
        color: 'growth',
        badge: 'soon',
        isDisabled: true,
        subItems: [
          { label: 'Radar', isDisabled: true },
          { label: 'Penn', isDisabled: true },
          { label: 'Relay', isDisabled: true },
        ]
      },
      {
        label: 'Content Department',
        path: '/departments/content',
        icon: Palette,
        color: 'content',
        badge: 'soon',
        isDisabled: true,
        subItems: [
          { label: 'Ink', isDisabled: true },
          { label: 'Palette', isDisabled: true },
          { label: 'Chronos', isDisabled: true },
        ]
      },
      {
        label: 'Intelligence Department',
        path: '/departments/intelligence',
        icon: Brain,
        color: 'intelligence',
        badge: '1 active',
        subItems: [
          { label: 'Brief', path: '/growth-signals' },
          { label: 'Competitor Intel', path: '/competitor-intel' },
          { label: 'Talent Intel', path: '/talent-intel' },
        ]
      }
    ]
  },
  {
    label: 'TOOLS',
    items: [
      // Remaining tools that don't fit perfectly in a department yet
      { label: 'Lead Scraper', path: '/lead-scraper', icon: Search },
      { label: 'ICP Intelligence', path: '/icp-intelligence', icon: Users },
      { label: 'Deep Search', path: '/deep-search', icon: SearchCheck },
    ]
  },
  {
    label: 'SETTINGS',
    items: [
      { label: 'Company Brain', path: '/dashboard', icon: Brain, badge: 'setup' }, // Points to dashboard for now as placeholder
      { label: 'Email Sequences', path: '/email-sequences', icon: Mail },
      { label: 'Help & Support', path: '/help', icon: HelpCircle },
    ]
  }
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

export default function Sidebar({ collapsed, onToggle, onOpenCommandPalette }: SidebarProps) {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Color mapping logic for CSS vars
  const getColorClasses = (color?: string, isActive?: boolean) => {
    switch (color) {
      case 'talent': return isActive ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[inset_2px_0_0_0_#10b981]' : 'group-hover:text-emerald-500';
      case 'growth': return isActive ? 'text-blue-500 bg-blue-500/10 border-blue-500/20 shadow-[inset_2px_0_0_0_#3b82f6]' : 'group-hover:text-blue-500';
      case 'content': return isActive ? 'text-purple-500 bg-purple-500/10 border-purple-500/20 shadow-[inset_2px_0_0_0_#8b5cf6]' : 'group-hover:text-purple-500';
      case 'intelligence': return isActive ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[inset_2px_0_0_0_#f59e0b]' : 'group-hover:text-amber-500';
      case 'command': return isActive ? 'text-pink-500 bg-pink-500/10 border-pink-500/20 shadow-[inset_2px_0_0_0_#ec4899]' : 'group-hover:text-pink-500';
      default: return isActive ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_hsl(var(--primary))]' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50';
    }
  };

  const isRouteActive = (item: NavItemType) => {
    if (!item.path) return false;
    // Strict match for Dashboard / Departments
    if (item.path === '/dashboard') return location.pathname === '/dashboard';
    
    // Check if current route is exactly the item path or inside a sub-item
    const activeSub = item.subItems?.some(sub => sub.path && location.pathname.startsWith(sub.path));
    const activeMain = location.pathname.startsWith(item.path);
    return activeMain || activeSub;
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col border-r border-border bg-[#0a0f1a]/95 backdrop-blur-xl transition-all duration-300',
        collapsed ? 'w-[64px]' : 'w-[256px]'
      )}
    >
      {/* Header (Logo & Profile) */}
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-white/5', collapsed && 'justify-center px-0')}>
        {!collapsed ? (
          <div className="flex items-center gap-3 flex-1 min-w-0 group cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-sm font-bold text-emerald-500 flex-shrink-0 transition-transform group-hover:scale-105">
              {profile?.full_name?.[0] || 'S'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{profile?.full_name || 'ScreeningPilot'}</p>
              <p className="text-xs text-zinc-400 truncate">Professional</p>
            </div>
            <span className="text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded flex-shrink-0">PRO</span>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-sm font-bold text-emerald-500">
            {profile?.full_name?.[0] || 'S'}
          </div>
        )}
      </div>

      {/* Command Palette Shortcuts */}
      {!collapsed && onOpenCommandPalette && (
        <button
          onClick={onOpenCommandPalette}
          className="mx-4 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg border border-white/5 bg-white/5 text-sm text-zinc-400 hover:text-white hover:border-white/10 hover:bg-white/10 transition-all hover-lift"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Deploy Agent...</span>
          <kbd className="text-[10px] bg-black/40 border border-white/10 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
        </button>
      )}

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navigation.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {section.label && !collapsed && (
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-3 mb-2">
                {section.label}
              </p>
            )}

            <div className="space-y-1">
              {section.items.map((item, itemIdx) => {
                const isActive = isRouteActive(item);
                const colorConfig = getColorClasses(item.color, isActive);

                return (
                  <div key={itemIdx} className="flex flex-col">
                    <button
                      onClick={() => !item.isDisabled && item.path && navigate(item.path)}
                      disabled={item.isDisabled}
                      className={cn(
                        'flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative',
                        item.isDisabled ? 'opacity-40 cursor-not-allowed grayscale' : 'cursor-pointer',
                        (!item.isDisabled && !item.color) ? colorConfig : '',
                        (!item.isDisabled && item.color && !isActive) ? 'text-zinc-400 hover:bg-white/5' : '',
                        (isActive && item.color) ? colorConfig : '',
                        collapsed ? 'justify-center' : ''
                      )}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        {item.icon && (
                          <item.icon className={cn(
                            'h-[18px] w-[18px] flex-shrink-0',
                            (!item.isDisabled && !isActive) && getColorClasses(item.color, false).replace('group-hover:', '')
                          )} />
                        )}
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </div>

                      {/* Badge */}
                      {!collapsed && item.badge && (
                        <span className={cn(
                          "flex-shrink-0 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-sm z-10",
                          item.badge === 'soon' ? 'bg-zinc-800 text-zinc-400' :
                          isActive ? 'bg-black/20' : 'bg-primary/10 text-primary'
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </button>

                    {/* SubItems (only show if section expanded or active, and not collapsed sidebar) */}
                    {!collapsed && item.subItems && (isActive) && (
                      <div className="ml-5 pl-4 mt-1 border-l border-white/5 space-y-1">
                        {item.subItems.map((sub, j) => {
                          const isSubActive = sub.path && location.pathname.startsWith(sub.path);
                          return (
                            <button
                              key={j}
                              disabled={sub.isDisabled}
                              onClick={() => !sub.isDisabled && sub.path && navigate(sub.path)}
                              className={cn(
                                'flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer',
                                sub.isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5 hover:text-white',
                                isSubActive ? 'text-white' : 'text-zinc-400'
                              )}
                            >
                              {sub.icon && <sub.icon className="h-3.5 w-3.5 text-zinc-500" />}
                              <span className="truncate">{sub.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer Actions */}
      <div className="border-t border-white/5 p-3 space-y-1 bg-[#0a0f1a]/50">
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-[18px] w-[18px]" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <button
          onClick={onToggle}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors w-full mt-1',
            collapsed && 'justify-center px-2'
          )}
        >
          {collapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          {!collapsed && <span>Collapse Sidebar</span>}
        </button>
      </div>
    </aside>
  );
}
