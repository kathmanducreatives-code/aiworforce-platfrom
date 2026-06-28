import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Radar, MessageSquare, Inbox,
  Users, Eye, BookOpen, Sparkles, Brain,
  Mail, Plug, HelpCircle, PanelLeftClose, PanelLeft, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CreditPill from './credits/CreditPill';
import ProfileMenu from './account/ProfileMenu';

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
      { path: '/workflows', icon: Workflow, label: 'Workflows' },
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

const TOUR_TAG_BY_LABEL: Record<string, string | undefined> = {
  Dashboard: 'sidebar-dashboard',
  Conversations: 'sidebar-conversations',
  Workflows: 'sidebar-workflows',
  'Awaiting You': 'sidebar-awaiting',
  'Company Brain': 'sidebar-company-brain',
};

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
        collapsed ? 'w-[68px]' : 'w-[260px]'
      )}
    >
      {/* Workspace header */}
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-white/[0.03]', collapsed && 'justify-center px-0')}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold text-white shrink-0 shadow-inner"
             style={{ background: 'linear-gradient(135deg, hsl(var(--primary-dark)) 0%, hsl(var(--primary)) 100%)' }}>
          {profile?.full_name?.[0]?.toUpperCase() || 'A'}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[14.5px] font-medium text-foreground truncate leading-tight">{profile?.full_name || 'Agentory'}</p>
            </div>
            <span
              className="text-[10.5px] font-mono font-semibold tracking-[0.1em] text-emerald-300 rounded px-2 py-[3px]"
              style={{
                background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06))',
                border: '1px solid rgba(16,185,129,0.28)',
                boxShadow: '0 0 12px -4px rgba(16,185,129,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              PRO
            </span>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            {!collapsed && (
              <div className="flex items-center justify-between pl-3 pr-2 mb-2">
                <p className="text-[10.5px] font-mono font-semibold tracking-[0.16em] text-neutral-500 uppercase">
                  {group.label}
                </p>
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const tourTag = TOUR_TAG_BY_LABEL[item.label];
                return (
                <NavLink
                  key={`${group.label}-${item.path}-${item.label}`}
                  to={item.path}
                  end={item.path === '/dashboard'}
                  data-tour={tourTag}
                  className={({ isActive }) => cn(
                    'group relative flex items-center gap-3 h-10 px-3 rounded-md text-[14.5px] transition-all duration-200 border',
                    isActive
                      ? 'bg-emerald-500/[0.09] text-white font-semibold border-emerald-500/25 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_22px_-6px_rgba(16,185,129,0.5)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-full before:bg-emerald-400 before:shadow-[0_0_8px_rgba(16,185,129,0.75)]'
                      : 'text-neutral-300 font-medium hover:text-white hover:bg-white/[0.03] border-transparent',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cn('h-[18px] w-[18px] shrink-0 transition-colors', isActive ? 'text-emerald-400' : 'text-neutral-400 group-hover:text-white')} />
                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                      {!collapsed && item.badge && (
                        <span className={cn(
                          'text-[11px] font-mono font-semibold px-1.5 py-[2px] rounded border tabular-nums',
                          item.badgeColor === 'amber'
                            ? 'bg-amber-500/8 border-amber-500/25 text-amber-300'
                            : 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300',
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom utility */}
      <div className="border-t border-white/[0.04] px-2 py-2.5 space-y-1.5">
        <div className={cn('px-1', collapsed && 'px-0')}>
          <CreditPill collapsed={collapsed} />
        </div>
        <button
          className={cn(
            'flex items-center gap-3 h-9 px-3 rounded-md text-[13.5px] text-neutral-300 hover:text-white hover:bg-white/[0.03] border border-transparent transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <HelpCircle className="h-4 w-4 text-neutral-400" />
          {!collapsed && <span>Help & Support</span>}
        </button>
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-3 h-9 px-3 rounded-md text-[13.5px] text-neutral-300 hover:text-rose-300 hover:bg-white/[0.03] border border-transparent transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-4 w-4 text-neutral-400 group-hover:text-rose-300" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <button
          onClick={onToggle}
          className={cn(
            'flex items-center gap-3 h-9 px-3 rounded-md text-[13.5px] text-neutral-300 hover:text-white hover:bg-white/[0.03] border border-transparent transition-all w-full',
            collapsed && 'justify-center px-2'
          )}
        >
          {collapsed ? <PanelLeft className="h-4 w-4 text-neutral-400" /> : <PanelLeftClose className="h-4 w-4 text-neutral-400" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
