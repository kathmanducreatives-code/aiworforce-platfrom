import type { ComponentType } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion, type Transition } from 'framer-motion';
import CreditPill from './credits/CreditPill';
import ProfileMenu from './account/ProfileMenu';
import { TOUR_TAG_BY_NAV_KEY } from './tour/tourSteps';
import {
  IconDashboard, IconAwaiting, IconWorkflows,
  IconSignals, IconLeads, IconContent, IconSequences,
  IconAgents, IconCompanyBrain, IconIntegrations,
  IconHelp, IconCollapse, IconExpand, type NavIconProps,
} from './nav/NavIcons';
import './nav/sidebar.css';

interface NavItem {
  key: string;
  path: string;
  icon: ComponentType<NavIconProps>;
  label: string;
  badge?: string;
  badgeColor?: 'amber' | 'emerald';
  matchExact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// THE canonical navigation. productTourGuide.test.ts parses these literals
// (`{ key, path, …, label }`) straight from this file, so keep each item on
// that shape and keep the icon an identifier, never an inline component.
const navGroups: NavGroup[] = [
  {
    label: 'Command',
    items: [
      { key: 'dashboard', path: '/dashboard', icon: IconDashboard, label: 'Dashboard', matchExact: true },
      { key: 'awaiting', path: '/awaiting-you', icon: IconAwaiting, label: 'Awaiting You', badge: '4', badgeColor: 'amber' },
      { key: 'workflows', path: '/workflows', icon: IconWorkflows, label: 'Workflows' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { key: 'signals', path: '/signals', icon: IconSignals, label: 'Signals' },
      { key: 'leads', path: '/leads', icon: IconLeads, label: 'Leads' },
      { key: 'content', path: '/content', icon: IconContent, label: 'Content' },
      { key: 'email-sequences', path: '/email-sequences', icon: IconSequences, label: 'Email Sequences' },
    ],
  },
  {
    label: 'AI Workforce',
    items: [
      { key: 'agents', path: '/agents', icon: IconAgents, label: 'Agents' },
      { key: 'company-brain', path: '/company-brain', icon: IconCompanyBrain, label: 'Company Brain' },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'integrations', path: '/settings/integrations', icon: IconIntegrations, label: 'Integrations' },
    ],
  },
];

// Anchor tags come from the canonical tour config so the sidebar cannot emit a
// `data-tour` the guide does not look for (or vice versa). Previously this was a
// second hand-maintained map that could silently drift.
const TOUR_TAG_BY_KEY: Record<string, string | undefined> = TOUR_TAG_BY_NAV_KEY;

/**
 * How the shared active indicator travels between rows: a flat tween, never a
 * spring, so it cannot overshoot. The row's icon colour (CSS, 120ms) resolves
 * just ahead of the surface arriving under it.
 */
const INDICATOR_TRAVEL: Transition = { type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] };
const INDICATOR_INSTANT: Transition = { duration: 0 };

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenCommandPalette?: () => void;
}

function resolveActiveKey(pathname: string): string | null {
  for (const group of navGroups) {
    for (const item of group.items) {
      const match = item.matchExact ? pathname === item.path : pathname === item.path || pathname.startsWith(item.path + '/');
      if (match) return item.key;
    }
  }
  return null;
}

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const { pathname } = useLocation();
  const activeKey = resolveActiveKey(pathname);
  const travel = useReducedMotion() ? INDICATOR_INSTANT : INDICATOR_TRAVEL;

  return (
    <aside className="sb" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sb__account">
        <ProfileMenu collapsed={collapsed} />
      </div>

      {/* layoutScroll: the indicator measures correctly even if the nav scrolls. */}
      <motion.nav aria-label="Primary" className="sb__nav" layoutScroll>
        {navGroups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className="sb__group">
            <p className="sb__section" aria-hidden="true">{group.label}</p>
            {group.items.map((item) => (
              <SidebarNavItem
                key={item.key}
                item={item}
                active={item.key === activeKey}
                collapsed={collapsed}
                travel={travel}
              />
            ))}
          </div>
        ))}
      </motion.nav>

      <div className="sb__footer">
        <CreditPill collapsed={collapsed} />
        <button
          type="button"
          className="sb__row sb__button"
          aria-label="Help and support"
          title={collapsed ? 'Help & Support' : undefined}
        >
          <IconHelp className="sb__icon" size={18} />
          <span className="sb__label">Help &amp; Support</span>
        </button>
        <button
          type="button"
          className="sb__row sb__button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed
            ? <IconExpand className="sb__icon" size={18} />
            : <IconCollapse className="sb__icon" size={18} />}
          <span className="sb__label">Collapse</span>
        </button>
      </div>
    </aside>
  );
};

function SidebarNavItem({ item, active, collapsed, travel }: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  travel: Transition;
}) {
  const Icon = item.icon;
  // Collapsed, the visible label is gone, so the accessible name carries it —
  // and the pending count, which is otherwise only a dot.
  const collapsedName = item.badge ? `${item.label}, ${item.badge} pending` : item.label;

  return (
    <Link
      to={item.path}
      className="sb__row"
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? collapsedName : undefined}
      title={collapsed ? item.label : undefined}
      data-tour={TOUR_TAG_BY_KEY[item.key]}
    >
      {/* ONE indicator for the whole rail: the same layoutId mounts under
          whichever row is active, so framer-motion carries it there. */}
      {active && (
        <>
          <motion.span
            layoutId="sidebar-active-surface"
            className="sb__surface"
            style={{ borderRadius: 9 }}
            transition={travel}
            aria-hidden
          />
          <motion.span
            layoutId="sidebar-active-rail"
            className="sb__rail"
            transition={travel}
            aria-hidden
          />
        </>
      )}
      <Icon className="sb__icon" size={20} />
      <span className="sb__label">{item.label}</span>
      {item.badge && (
        <>
          <span
            className={item.badgeColor === 'emerald' ? 'sb__badge sb__badge--emerald' : 'sb__badge'}
            aria-hidden={collapsed || undefined}
          >
            {item.badge}
            <span className="sr-only"> pending</span>
          </span>
          <span className="sb__dot" aria-hidden />
        </>
      )}
    </Link>
  );
}

export default Sidebar;
