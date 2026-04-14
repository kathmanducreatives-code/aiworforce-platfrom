import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ChevronRight, Activity, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import NotificationCenter from '@/components/shared/NotificationCenter';

/* ─── Types ─── */

interface SystemPulse {
  status: 'healthy' | 'degraded' | 'offline';
  activeAgents: number;
  totalAgents: number;
  tasksToday: number;
}

interface ContextHeaderProps {
  systemPulse?: SystemPulse;
}

/* ─── Route-to-Breadcrumb Map ─── */

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': 'Command Center',
  '/agent-studio': 'Agent Studio',
  '/departments/talent': 'Talent Dept',
  '/screening-jobs': 'Job Screening',
  '/candidates': 'Candidates',
  '/lead-scraper': 'Scout (Source)',
  '/icp-intelligence': 'ICP Intelligence',
  '/deep-search': 'Deep Search',
  '/expert-marketplace': 'Expert Interviews',
  '/interview-scheduler': 'Interview Scheduler',
  '/email-sequences': 'Email Sequences',
  '/distribution': 'Job Distribution',
  '/post-interceptor': 'Post Interceptor',
  '/lead-crm': 'Lead CRM',
  '/outreach-engine': 'Outreach Engine',
  '/competitor-intel': 'Competitor Intel',
  '/competitors': 'Job Tracker',
  '/growth-signals': 'Growth Signals',
  '/talent-intel': 'Talent Intel',
  '/analytics': 'Analytics',
};

/* ─── Helpers ─── */

const getGreeting = (): string => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

const getFormattedDate = (): string => {
  const now = new Date();
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

/* ─── Component ─── */

const DEFAULT_PULSE: SystemPulse = {
  status: 'healthy',
  activeAgents: 5,
  totalAgents: 8,
  tasksToday: 42,
};

const ContextHeader = ({ systemPulse = DEFAULT_PULSE }: ContextHeaderProps) => {
  const location = useLocation();
  const { profile } = useAuth();

  // Generate breadcrumbs from current path
  const buildBreadcrumbs = () => {
    const path = location.pathname;
    const crumbs: { label: string; href?: string }[] = [
      { label: 'HQ', href: '/dashboard' },
    ];

    const label = ROUTE_LABELS[path];
    if (label && path !== '/dashboard') {
      crumbs.push({ label });
    }

    return crumbs;
  };

  const breadcrumbs = buildBreadcrumbs();
  const isCommandCenter = location.pathname === '/dashboard';

  const statusColor = systemPulse.status === 'healthy'
    ? 'bg-[#34d399]'
    : systemPulse.status === 'degraded'
      ? 'bg-amber-500'
      : 'bg-red-500';

  const statusLabel = systemPulse.status.toUpperCase();

  return (
    <header
      className="flex items-center justify-between px-6 border-b flex-shrink-0"
      style={{
        height: 56,
        background: 'rgba(3,10,12,0.85)',
        borderColor: 'rgba(52,211,153,0.08)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 30,
      }}
    >
      {/* ─── Left: Greeting (on dashboard) or Breadcrumbs ─── */}
      <div className="flex flex-col justify-center">
        {isCommandCenter ? (
          <>
            <span style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: 16,
              fontWeight: 600,
              color: '#f0f0f0',
              lineHeight: 1.2,
            }}>
              {getGreeting()}, {profile?.full_name?.split(' ')[0] || 'Commander'}
            </span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: 'rgba(255,255,255,0.35)',
              marginTop: 2,
            }}>
              {getFormattedDate()}
            </span>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            {breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-white/15" />}
                {crumb.href ? (
                  <Link
                    to={crumb.href}
                    className="text-[11px] font-mono text-white/30 hover:text-white/60 transition-colors tracking-wider"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-[11px] font-mono text-white/50 tracking-wider">
                    {crumb.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Center: Status Pills (larger, styled) ─── */}
      <div className="hidden md:flex items-center gap-3">
        {/* Pill 1: Agents Online */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.15)',
            borderRadius: 20,
            padding: '4px 12px',
          }}
        >
          <span className="relative flex h-2 w-2">
            <span className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-75',
              statusColor,
              systemPulse.status === 'healthy' && 'animate-ping'
            )} />
            <span className={cn('relative inline-flex rounded-full h-2 w-2', statusColor)} />
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: '#34d399',
            letterSpacing: '0.1em',
          }}>
            {systemPulse.activeAgents}/{systemPulse.totalAgents} AGENTS ONLINE
          </span>
        </div>

        {/* Pill 2: Tasks Today */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.15)',
            borderRadius: 20,
            padding: '4px 12px',
          }}
        >
          <Activity style={{ width: 12, height: 12, color: '#34d399' }} />
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: '#34d399',
            letterSpacing: '0.1em',
          }}>
            {systemPulse.tasksToday} TASKS TODAY
          </span>
        </div>

        {/* Pill 3: Status */}
        <div
          style={{
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.15)',
            borderRadius: 20,
            padding: '4px 12px',
          }}
        >
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: '#34d399',
            letterSpacing: '0.15em',
            fontWeight: 600,
          }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* ─── Right: Notification + Avatar ─── */}
      <div className="flex items-center gap-3">
        <NotificationCenter collapsed />

        {/* Profile avatar */}
        <div
          style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'rgba(52,211,153,0.15)',
            border: '1px solid rgba(52,211,153,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#34d399',
          }}
        >
          {profile?.full_name?.[0] || 'U'}
        </div>
      </div>
    </header>
  );
};

export default ContextHeader;
