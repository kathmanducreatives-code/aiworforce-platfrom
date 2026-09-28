// DepartmentWorkspaceShell — reusable two-pane layout for department pages.
//
// Left ~70%: eyebrow, title, description, metric strip, tabs, filters, body.
// Right ~30%: persistent agent copilot rail (desktop) / drawer (mobile).
//
// Visual layer only. No backend calls, no data fetching. Consumers pass in
// the metrics, actions, tabs and rail contents.

import { type ReactNode, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { METRIC_CELL, METRIC_DIVIDER, METRIC_LABEL, METRIC_STRIP, METRIC_STRIP_H, METRIC_VALUE, PRIMARY_ACTION, SECONDARY_ACTION } from '@/components/layout/workspaceStyles';
import DepartmentHeader, { DEPT_ACTION } from '@/components/layout/department/DepartmentHeader';
import AgentStatus from '@/components/layout/department/AgentStatus';
import DepartmentTabs from '@/components/layout/department/DepartmentTabs';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { MessageSquare, X } from 'lucide-react';

export interface DeptAgent {
  name: string;
  role: string;
  status?: string; // "On duty" etc
  avatar: string;
  accentHex: string; // department accent
  fallbackInitial?: string;
}

export interface DeptMetric {
  label: string;
  value: string | number;
  hint?: string;
}

export interface DeptTab<T extends string = string> {
  id: T;
  label: string;
  badge?: number | string;
}

export interface DeptAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
}

interface Props<T extends string = string> {
  eyebrow: string;
  title: string;
  description: string;
  agent: DeptAgent;
  metrics: DeptMetric[];
  primaryAction?: DeptAction;
  secondaryAction?: DeptAction;
  tabs?: DeptTab<T>[];
  activeTab?: T;
  onTabChange?: (id: T) => void;
  filtersSlot?: ReactNode;
  children: ReactNode;
  rail: ReactNode;
  mobileRailLabel?: string;
  collapsibleRail?: boolean;
}

export default function DepartmentWorkspaceShell<T extends string = string>({
  eyebrow,
  title,
  description,
  agent,
  metrics,
  primaryAction,
  secondaryAction,
  tabs,
  activeTab,
  onTabChange,
  filtersSlot,
  children,
  rail,
  mobileRailLabel = 'Open agent',
  collapsibleRail = false,
}: Props<T>) {
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const accent = agent.accentHex;

  return (
    <div className="flex min-h-screen">
      {/* Main workspace */}
      <div className="flex-1 min-w-0 overflow-x-hidden">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-6 pb-32 lg:px-8 lg:py-8">
          {/* Header — shared with Leads and Content (department/DepartmentHeader). */}
          <DepartmentHeader
            className="mb-5"
            eyebrow={eyebrow}
            title={title}
            description={description}
            aside={
              <div className="rounded-xl border border-white/[0.07] bg-[rgba(12,16,15,0.6)] px-2.5 py-1.5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
                <AgentStatus size="sm" name={agent.name} role={agent.role} src={agent.avatar} status={agent.status} />
              </div>
            }
            actions={(collapsibleRail || primaryAction || secondaryAction) && (
              <>
                {collapsibleRail && (
                  <button
                    onClick={() => setRailOpen(open => !open)}
                    aria-expanded={railOpen}
                    aria-controls="department-agent-chat"
                    className={cn('hidden lg:inline-flex', DEPT_ACTION, SECONDARY_ACTION)}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {railOpen ? 'Close' : 'Open'} {agent.name} chat
                  </button>
                )}
                {secondaryAction && (
                  <button
                    onClick={secondaryAction.onClick}
                    disabled={secondaryAction.disabled || secondaryAction.loading}
                    className={cn(DEPT_ACTION, SECONDARY_ACTION)}
                  >
                    {secondaryAction.icon}
                    {secondaryAction.label}
                  </button>
                )}
                {primaryAction && (
                  <button
                    onClick={primaryAction.onClick}
                    disabled={primaryAction.disabled || primaryAction.loading}
                    className={cn(DEPT_ACTION, 'px-3.5', PRIMARY_ACTION)}
                  >
                    {primaryAction.icon}
                    {primaryAction.label}
                  </button>
                )}
              </>
            )}
          />

          {/* Metric strip */}
          {metrics.length > 0 && (
            <div className={cn('mb-5', METRIC_STRIP, METRIC_STRIP_H)}>
              {metrics.map((m, i) => (
                <div key={m.label + i} className={cn(METRIC_CELL, i !== 0 && METRIC_DIVIDER)}>
                  <span className={cn(METRIC_LABEL, 'truncate')}>{m.label}</span>
                  <span className={METRIC_VALUE}>{m.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          {tabs && tabs.length > 0 && (
            <DepartmentTabs
              className="mb-3"
              label="Department views"
              layoutId="dept-tab-underline"
              tabs={tabs}
              active={activeTab}
              onChange={(id) => onTabChange?.(id)}
            />
          )}

          {/* Filters slot */}
          {filtersSlot && <div className="mb-4">{filtersSlot}</div>}

          {/* Body */}
          <div className="min-h-[420px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab ?? 'default'}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Right rail — sticky desktop */}
      <aside
        id="department-agent-chat"
        aria-label={`${agent.name} chat`}
        className={cn("sticky top-0 hidden h-screen w-[360px] shrink-0 border-l border-white/[0.06] bg-[#050505]/80", (!collapsibleRail || railOpen) && "lg:flex lg:flex-col", "xl:w-[380px]", collapsibleRail && "h-[calc(100dvh-52px)]")}
      >
        {collapsibleRail && <div className="flex justify-end border-b border-white/[0.05] px-4 py-2">
          <button onClick={() => setRailOpen(false)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/[0.04] hover:text-foreground" aria-label={`Close ${agent.name} chat`}>
            <X className="h-3.5 w-3.5" />Close chat
          </button>
        </div>}
        <div className="min-h-0 flex-1">{rail}</div>
      </aside>

      {/* Mobile / tablet drawer */}
      <div className="fixed bottom-24 right-4 z-30 lg:hidden">
        <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
          <SheetTrigger asChild>
            <button
              aria-label={mobileRailLabel}
              className="flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-semibold shadow-lg backdrop-blur-md"
              style={{
                background: `${accent}1F`,
                borderColor: `${accent}55`,
                color: accent,
              }}
            >
              <MessageSquare className="h-4 w-4" />
              {collapsibleRail ? `Open ${agent.name} chat` : agent.name}
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full max-w-[380px] border-l-white/10 bg-[#050505]/95 p-0 backdrop-blur-2xl sm:max-w-[400px]">
            <SheetTitle className="sr-only">{agent.name} chat</SheetTitle>
            <SheetDescription className="sr-only">Ask {agent.name} about this workspace. Close with the close button or Escape.</SheetDescription>
            {rail}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
