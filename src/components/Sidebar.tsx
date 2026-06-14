import { NavLink } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, Radar, MessageSquare, Inbox,
  Users, Eye, BookOpen, Sparkles, Brain,
  Mail, Plug, LogOut, HelpCircle, PanelLeftClose, PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavGroup {
  label: string;
  items: { path: string; icon: any; label: string; badge?: string; badgeColor?: 'amber' | 'emerald' }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/signals', icon: Radar, label: 'Signals' },
      { path: '/dashboard', icon: MessageSquare, label: 'Conversations' },
      { path: '/awaiting-you', icon: Inbox, label: 'Awaiting You', badge: '4', badgeColor: 'amber' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { path: '/leads', icon: Users, label: 'Leads' },
      { path: '/competitors', icon: Eye, label: 'Competitors' },
      { path: '/content', icon: BookOpen, label: 'Content' },
    ],
  },
  {
    label: 'AI Team',
    items: [
      { path: '/agents', icon: Sparkles, label: 'Agents' },
      { path: '/onboarding/company-brain', icon: Brain, label: 'Company Brain' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings/integrations', icon: Plug, label: 'Integrations' },
      { path: '/email-sequences', icon: Mail, label: 'Email Sequences' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const { signOut, profile } = useAuth();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col bg-[#050505]/40 backdrop-blur-xl border-r border-white/[0.04] transition-all duration-300',
        collapsed ? 'w-[64px]' : 'w-[248px]'
      )}
    >
      {/* Workspace header */}
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-white/[0.03]', collapsed && 'justify-center px-0')}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-medium text-white shrink-0 shadow-inner"
             style={{ background: 'linear-gradient(135deg, hsl(var(--primary-dark)) 0%, hsl(var(--primary)) 100%)' }}>
          {profile?.full_name?.[0]?.toUpperCase() || 'A'}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate leading-tight">{profile?.full_name || 'Agentory'}</p>
            </div>
            <span className="text-[9px] font-mono tracking-wider text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 rounded px-1.5 py-px">
              PRO
            </span>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            {!collapsed && (
              <div className="flex items-center justify-between pl-3 pr-2 mb-1.5">
                <p className="text-[10px] font-mono font-medium tracking-wider text-neutral-600 uppercase">
                  {group.label}
                </p>
              </div>
            )}
            <div className="space-y-px">
              {group.items.map((item) => (
                <NavLink
                  key={`${group.label}-${item.path}-${item.label}`}
                  to={item.path}
                  end={item.path === '/dashboard'}
                  className={({ isActive }) => cn(
                    'group relative flex items-center gap-2.5 h-8.5 px-3 rounded-md text-[13px] transition-all duration-200 border',
                    isActive
                      ? 'bg-emerald-500/[0.08] text-white border-emerald-500/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_0_18px_-6px_rgba(16,185,129,0.45)] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-emerald-400 before:shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                      : 'text-neutral-400 hover:text-foreground hover:bg-white/[0.02] border-transparent',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-emerald-400' : 'text-neutral-400 group-hover:text-foreground')} />
                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                      {!collapsed && item.badge && (
                        <span className={cn(
                          'text-[10px] font-mono font-medium px-1.5 py-px rounded border tabular-nums',
                          item.badgeColor === 'amber'
                            ? 'bg-amber-500/5 border-amber-500/20 text-amber-400'
                            : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400',
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom utility */}
      <div className="border-t border-white/[0.04] px-2 py-2 space-y-px">
        <button
          className={cn(
            'flex items-center gap-2.5 h-8 px-3 rounded-md text-[12px] text-neutral-400 hover:text-foreground hover:bg-white/[0.02] border border-transparent transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <HelpCircle className="h-3.5 w-3.5 text-neutral-500" />
          {!collapsed && <span>Help & Support</span>}
        </button>
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-2.5 h-8 px-3 rounded-md text-[12px] text-neutral-400 hover:text-rose-400 hover:bg-white/[0.02] border border-transparent transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-3.5 w-3.5 text-neutral-500 group-hover:text-rose-400" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <button
          onClick={onToggle}
          className={cn(
            'flex items-center gap-2.5 h-8 px-3 rounded-md text-[12px] text-neutral-400 hover:text-foreground hover:bg-white/[0.02] border border-transparent transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          {collapsed ? <PanelLeft className="h-3.5 w-3.5 text-neutral-500" /> : <PanelLeftClose className="h-3.5 w-3.5 text-neutral-500" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
