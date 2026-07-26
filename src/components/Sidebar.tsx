import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Radar, MessageSquare, Inbox,
  Users, Eye, BookOpen, Sparkles, Brain,
  Mail, Plug, HelpCircle, PanelLeftClose, PanelLeft, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CreditPill from './credits/CreditPill';
import ProfileMenu from './account/ProfileMenu';

type Accent = 'emerald' | 'teal' | 'amber' | 'violet' | 'blue' | 'neutral';

interface NavItem {
  key: string;
  path: string;
  icon: any;
  label: string;
  accent: Accent;
  badge?: string;
  badgeColor?: 'amber' | 'emerald';
  matchExact?: boolean;
  /** Excluded from auto-active matching (e.g. Pilot shares /dashboard with Dashboard) */
  neverActive?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Command',
    items: [
      { key: 'dashboard', path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', accent: 'emerald', matchExact: true },
      { key: 'pilot', path: '/dashboard', icon: MessageSquare, label: 'Pilot', accent: 'emerald', neverActive: true },
      { key: 'awaiting', path: '/awaiting-you', icon: Inbox, label: 'Awaiting You', accent: 'emerald', badge: '4', badgeColor: 'amber' },
      { key: 'workflows', path: '/workflows', icon: Workflow, label: 'Workflows', accent: 'emerald' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { key: 'signals', path: '/signals', icon: Radar, label: 'Signals', accent: 'teal' },
      { key: 'leads', path: '/leads', icon: Users, label: 'Leads', accent: 'amber' },
      { key: 'content', path: '/content', icon: BookOpen, label: 'Content', accent: 'violet' },
      { key: 'competitors', path: '/competitors', icon: Eye, label: 'Competitors', accent: 'blue' },
      { key: 'email-sequences', path: '/email-sequences', icon: Mail, label: 'Email Sequences', accent: 'emerald' },
    ],
  },
  {
    label: 'AI Workforce',
    items: [
      { key: 'agents', path: '/agents', icon: Sparkles, label: 'Agents', accent: 'emerald' },
      { key: 'company-brain', path: '/company-brain', icon: Brain, label: 'Company Brain', accent: 'emerald' },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'integrations', path: '/settings/integrations', icon: Plug, label: 'Integrations', accent: 'neutral' },
    ],
  },
];

const TOUR_TAG_BY_KEY: Record<string, string | undefined> = {
  dashboard: 'sidebar-dashboard',
  pilot: 'sidebar-conversations',
  workflows: 'sidebar-workflows',
  awaiting: 'sidebar-awaiting',
  'company-brain': 'sidebar-company-brain',
};

const ACCENT: Record<Accent, {
  bar: string;
  bg: string;
  icon: string;
  border: string;
}> = {
  emerald: { bar: 'bg-emerald-400', bg: 'bg-emerald-500/[0.08]', icon: 'text-emerald-300', border: 'border-emerald-400/40' },
  teal:    { bar: 'bg-teal-400',    bg: 'bg-teal-500/[0.08]',    icon: 'text-teal-300',    border: 'border-teal-400/40' },
  amber:   { bar: 'bg-amber-400',   bg: 'bg-amber-500/[0.08]',   icon: 'text-amber-300',   border: 'border-amber-400/40' },
  violet:  { bar: 'bg-violet-400',  bg: 'bg-violet-500/[0.08]',  icon: 'text-violet-300',  border: 'border-violet-400/40' },
  blue:    { bar: 'bg-blue-400',    bg: 'bg-blue-500/[0.08]',    icon: 'text-blue-300',    border: 'border-blue-400/40' },
  neutral: { bar: 'bg-neutral-300', bg: 'bg-white/[0.05]',       icon: 'text-neutral-200', border: 'border-white/20' },
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

function resolveActiveKey(pathname: string): string | null {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.neverActive) continue;
      const match = item.matchExact ? pathname === item.path : pathname === item.path || pathname.startsWith(item.path + '/');
      if (match) return item.key;
    }
  }
  return null;
}

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const { pathname } = useLocation();
  const activeKey = resolveActiveKey(pathname);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col bg-[#050505]/60 backdrop-blur-xl border-r border-white/[0.04] transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[256px]'
      )}
    >
      {/* Workspace header */}
      <div className={cn('px-2 py-2 border-b border-white/[0.03]', collapsed && 'px-1')}>
        <ProfileMenu collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto px-2 py-3 space-y-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {navGroups.map((group) => (
          <div
            key={group.label}
            role="group"
            aria-label={group.label}
            className="space-y-0.5"
          >
            {!collapsed && (
              <p className="px-3.5 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const isActive = item.key === activeKey;
              const accent = ACCENT[item.accent];
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                  data-tour={TOUR_TAG_BY_KEY[item.key]}
                  className={cn(
                    'group relative flex items-center h-11 rounded-md transition-colors duration-150 outline-none',
                    'focus-visible:ring-1 focus-visible:ring-emerald-400/50',
                    collapsed ? 'justify-center px-0' : 'gap-3 px-3.5',
                    isActive
                      ? cn(accent.bg, 'text-white')
                      : 'text-neutral-300 hover:bg-white/[0.035] hover:text-white',
                  )}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-5 rounded-r',
                        accent.bar,
                      )}
                    />
                  )}
                  <span className="relative flex items-center justify-center">
                    <Icon
                      className={cn(
                        'h-[19px] w-[19px] shrink-0 transition-colors',
                        isActive ? accent.icon : 'text-neutral-500 group-hover:text-neutral-200',
                      )}
                    />
                    {collapsed && item.badge && (
                      <span
                        aria-hidden
                        className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full bg-amber-500/90 text-[9px] font-semibold text-black flex items-center justify-center leading-none"
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                  {!collapsed && (
                    <span
                      className={cn(
                        'flex-1 truncate text-[15px]',
                        isActive ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {item.label}
                    </span>
                  )}
                  {!collapsed && item.badge && (
                    <span
                      className={cn(
                        'ml-auto inline-flex items-center h-[18px] px-1.5 rounded text-[11px] font-mono tabular-nums border',
                        item.badgeColor === 'amber'
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
                      )}
                    >
                      {item.badge}
                      <span className="sr-only"> pending</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom utility */}
      <div className="border-t border-white/[0.04] px-2 py-2 space-y-1">
        <div className={cn('px-1', collapsed && 'px-0')}>
          <CreditPill collapsed={collapsed} />
        </div>
        <button
          type="button"
          aria-label="Help and support"
          title={collapsed ? 'Help & Support' : undefined}
          className={cn(
            'flex items-center h-9 rounded-md text-[13.5px] text-neutral-300 hover:text-white hover:bg-white/[0.035] transition-colors w-full',
            collapsed ? 'justify-center px-0' : 'gap-3 px-3'
          )}
        >
          <HelpCircle className="h-4 w-4 text-neutral-400 shrink-0" />
          {!collapsed && <span>Help & Support</span>}
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
          className={cn(
            'flex items-center h-9 rounded-md text-[13.5px] text-neutral-300 hover:text-white hover:bg-white/[0.035] transition-colors w-full',
            collapsed ? 'justify-center px-0' : 'gap-3 px-3'
          )}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4 text-neutral-400 shrink-0" />
          ) : (
            <PanelLeftClose className="h-4 w-4 text-neutral-400 shrink-0" />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
