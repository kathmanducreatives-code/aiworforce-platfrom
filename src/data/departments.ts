import { Target, TrendingUp, PenTool, Eye, LayoutDashboard } from 'lucide-react';
import type { DepartmentId } from './agents';

export type DepartmentStatus = 'active' | 'coming-soon' | 'partial';

export interface DepartmentDef {
  id: DepartmentId;
  name: string;
  icon: any;
  color: string;
  glowColor: string;
  status: DepartmentStatus;
  description: string;
  href: string | null;
}

export const DEPARTMENTS: DepartmentDef[] = [
  {
    id: 'talent',
    name: 'Talent',
    icon: Target,
    color: 'emerald',
    glowColor: 'rgba(16, 185, 129, 0.15)',
    status: 'active',
    description: 'Source, screen, and hire top candidates',
    href: '/departments/talent',
  },
  {
    id: 'growth',
    name: 'Growth',
    icon: TrendingUp,
    color: 'blue',
    glowColor: 'rgba(59, 130, 246, 0.15)',
    status: 'coming-soon',
    description: 'Outbound campaigns and lead generation',
    href: null,
  },
  {
    id: 'content',
    name: 'Content',
    icon: PenTool,
    color: 'purple',
    glowColor: 'rgba(139, 92, 246, 0.15)',
    status: 'coming-soon',
    description: 'AI-powered content creation',
    href: null,
  },
  {
    id: 'intelligence',
    name: 'Intelligence',
    icon: Eye,
    color: 'amber',
    glowColor: 'rgba(245, 158, 11, 0.15)',
    status: 'partial',
    description: 'Market signals and competitor monitoring',
    href: '/departments/intelligence',
  },
];

export const MOCK_ACTIVITY = [
  { time: '9:31 AM', agentId: 'aria', action: 'Screened 12 candidates for Senior Engineer role', href: '/candidates' },
  { time: '8:45 AM', agentId: 'scout', action: 'Found 34 new leads matching ICP criteria', href: '/lead-scraper' },
  { time: '7:12 AM', agentId: 'hawk', action: 'Detected 3 competitor hiring signals', href: '/competitor-intel' },
  { time: 'Yesterday', agentId: 'penn', action: 'Drafted 5 outreach emails', href: null, badge: 'Coming Soon' },
  { time: 'Yesterday', agentId: 'expert', action: 'Scheduled 2 expert interviews', href: '/interview-scheduler' },
];
