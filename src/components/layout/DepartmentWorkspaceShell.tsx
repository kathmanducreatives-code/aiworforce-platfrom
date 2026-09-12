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
import { METRIC_LABEL, METRIC_STRIP, METRIC_VALUE, PRIMARY_ACTION, SECONDARY_ACTION } from '@/components/layout/workspaceStyles';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { MessageSquare } from 'lucide-react';

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
}: Props<T>) {
  const [imgFailed, setImgFailed] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const accent = agent.accentHex;

  return (
    <div className="flex min-h-screen">
      {/* Main workspace */}
      <div className="flex-1 min-w-0 overflow-x-hidden">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-6 pb-32 lg:px-8 lg:py-8">
          {/* Compact header */}
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p
                className="text-[10.5px] font-semibold uppercase tracking-[0.22em]"
                style={{ color: `${accent}99` }}
              >
                {eyebrow}
              </p>
              <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.01em] text-foreground lg:text-[30px]">
                {title}
              </h1>
              <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-muted-foreground/85">
                {description}
              </p>
            </div>

            {/* Agent chip + actions */}
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div
                className="flex items-center gap-2.5 rounded-xl border bg-[rgba(12,16,15,0.6)] px-2.5 py-1.5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
                style={{ borderColor: `${accent}26` }}
              >
                <div
                  className="overflow-hidden rounded-full border"
                  style={{ borderColor: `${accent}40`, boxShadow: `0 0 10px -3px ${accent}40` }}
                >
                  {imgFailed ? (
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-foreground"
                      style={{ background: `${accent}22`, color: accent }}
                    >
                      {agent.fallbackInitial ?? agent.name[0]}
                    </div>
                  ) : (
                    <img
                      src={agent.avatar}
                      alt={agent.name}
                      onError={() => setImgFailed(true)}
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  )}
                </div>
                <div className="leading-tight">
                  <p className="text-[12.5px] font-semibold text-foreground">{agent.name}</p>
                  <p className="text-[11px] text-muted-foreground/75">
                    {agent.role}
                    {agent.status && (
                      <>
                        {' · '}
                        <span className="inline-flex items-center gap-1" style={{ color: accent }}>
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: accent }}
                            aria-hidden
                          />
                          {agent.status}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {(primaryAction || secondaryAction) && (
                <div className="flex items-center gap-2">
                  {secondaryAction && (
                    <button
                      onClick={secondaryAction.onClick}
                      disabled={secondaryAction.disabled || secondaryAction.loading}
                      className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] transition-all duration-200', SECONDARY_ACTION)}
                    >
                      {secondaryAction.icon}
                      {secondaryAction.label}
                    </button>
                  )}
                  {primaryAction && (
                    <button
                      onClick={primaryAction.onClick}
                      disabled={primaryAction.disabled || primaryAction.loading}
                      className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] transition-all duration-200', PRIMARY_ACTION)}
                    >
                      {primaryAction.icon}
                      {primaryAction.label}
                    </button>
                  )}
                </div>
              )}
            </div>
          </header>

          {/* Metric strip */}
          {metrics.length > 0 && (
            <div className={cn('mb-5', METRIC_STRIP)}>
              {metrics.map((m, i) => (
                <div
                  key={m.label + i}
                  className={cn('flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-4 py-3', i !== 0 && 'border-l border-white/[0.05]')}
                >
                  <span className={cn(METRIC_LABEL, 'truncate')}>{m.label}</span>
                  <span className={METRIC_VALUE}>{m.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          {tabs && tabs.length > 0 && (
            <nav
              role="tablist"
              aria-label="Department views"
              className="mb-3 flex gap-0.5 border-b border-white/[0.06]"
            >
              {tabs.map((t) => {
                const isActive = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onTabChange?.(t.id)}
                    className={cn(
                      'relative px-3.5 py-2 text-[13.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
                      isActive ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground/85',
                    )}
                    style={isActive ? { color: accent } : undefined}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {t.label}
                      {t.badge !== undefined && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                          style={{ background: `${accent}1A`, color: accent }}
                        >
                          {t.badge}
                        </span>
                      )}
                    </span>
                    {isActive && (
                      <motion.div
                        layoutId="dept-tab-underline"
                        className="absolute inset-x-2 -bottom-px h-[2px] rounded-full motion-reduce:transition-none"
                        style={{ background: `${accent}CC`, boxShadow: `0 0 12px ${accent}80` }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>
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
      <aside className="sticky top-0 hidden h-screen w-[360px] shrink-0 border-l border-white/[0.05] bg-[#050505]/60 backdrop-blur-xl lg:block xl:w-[380px]">
        {rail}
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
              {agent.name}
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full max-w-[380px] border-l-white/10 bg-[#050505]/95 p-0 backdrop-blur-2xl sm:max-w-[400px]">
            {rail}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
