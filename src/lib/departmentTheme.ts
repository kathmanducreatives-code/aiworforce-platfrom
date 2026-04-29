import { Sparkles, Megaphone, Eye, BookOpen, type LucideIcon } from 'lucide-react';
import type { AgentDept } from '@/data/agentProfiles';

export interface DeptTheme {
  key: AgentDept;
  label: string;
  tagline: string;
  hex: string;
  icon: LucideIcon;
  workflow: [string, string, string, string];
  /** Tailwind-friendly accent classes that all reference the hex via inline style for borders/glows */
  accentText: string;
  accentBg: string;
  accentBorder: string;
}

export const DEPT_THEME: Record<Exclude<AgentDept, 'operations'>, DeptTheme> = {
  talent: {
    key: 'talent',
    label: 'Talent',
    tagline: 'Sourcing, screening & shortlists',
    hex: '#8B7BFF',
    icon: Sparkles,
    workflow: ['Sourced', 'Screened', 'Reviewed', 'Outreach Ready'],
    accentText: 'text-[#A99CFF]',
    accentBg: 'bg-[#8B7BFF]/10',
    accentBorder: 'border-[#8B7BFF]/30',
  },
  growth: {
    key: 'growth',
    label: 'Growth',
    tagline: 'Outreach, leads & pipeline',
    hex: '#10B981',
    icon: Megaphone,
    workflow: ['Leads Found', 'Qualified', 'Outreach Sent', 'Replied'],
    accentText: 'text-emerald-300',
    accentBg: 'bg-emerald-500/10',
    accentBorder: 'border-emerald-500/30',
  },
  intelligence: {
    key: 'intelligence',
    label: 'Intelligence',
    tagline: 'Competitor & market signals',
    hex: '#14B8A6',
    icon: Eye,
    workflow: ['Monitoring', 'Analysing', 'Report Ready', 'Delivered'],
    accentText: 'text-teal-300',
    accentBg: 'bg-teal-500/10',
    accentBorder: 'border-teal-500/30',
  },
  content: {
    key: 'content',
    label: 'Content',
    tagline: 'Posts, copy & brand voice',
    hex: '#A855F7',
    icon: BookOpen,
    workflow: ['Brief', 'Drafting', 'Review', 'Published'],
    accentText: 'text-purple-300',
    accentBg: 'bg-purple-500/10',
    accentBorder: 'border-purple-500/30',
  },
};

export const ALL_DEPTS: DeptTheme[] = [
  DEPT_THEME.talent,
  DEPT_THEME.growth,
  DEPT_THEME.intelligence,
  DEPT_THEME.content,
];

export function getDeptTheme(dept: AgentDept | string | undefined): DeptTheme {
  return (DEPT_THEME as any)[dept ?? 'talent'] ?? DEPT_THEME.talent;
}
