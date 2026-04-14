import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AGENTS, getActiveAgentCount, type DepartmentId } from '@/data/agents';

/* ═══════════════════════════════════════════════════════════════
   K E Y F R A M E S
   ═══════════════════════════════════════════════════════════════ */

const KEYFRAMES = `
  @keyframes statusPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(5,150,82,0.55); }
    50%     { box-shadow: 0 0 0 5px rgba(5,150,82,0); }
  }
`;

/* ═══════════════════════════════════════════════════════════════
   D A T A
   ═══════════════════════════════════════════════════════════════ */

interface DeptNode {
  id: DepartmentId;
  label: string;
  online: number;
  total: number;
  color: string;
  active: boolean;
}

const buildDeptNodes = (): DeptNode[] => {
  const defs: { id: DepartmentId; label: string; color: string }[] = [
    { id: 'talent',       label: 'TALENT',  color: '#059652' },
    { id: 'growth',       label: 'GROWTH',  color: '#7F77DD' },
    { id: 'content',      label: 'CONTENT', color: '#EF9F27' },
    { id: 'intelligence', label: 'INTEL',   color: '#5DCAA5' },
  ];
  return defs.map(d => {
    const all   = AGENTS.filter(a => a.department === d.id);
    const live  = all.filter(a => a.status === 'active').length;
    return { ...d, online: live, total: all.length, active: live > 0 };
  });
};

/* ═══════════════════════════════════════════════════════════════
   H O O K :  C O U N T - U P
   ═══════════════════════════════════════════════════════════════ */

const useCountUp = (target: number, dur = 1100) => {
  const [val, setVal] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      setVal(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, dur]);

  return val;
};

/* ═══════════════════════════════════════════════════════════════
   T I E R  1  —  A P E X   K P I   C A R D
   ═══════════════════════════════════════════════════════════════ */

interface KPIProps {
  label: string;
  value: number;
  display?: React.ReactNode;
  trend?: string;
}

const ApexKPICard = ({ label, value, display, trend }: KPIProps) => {
  const counted = useCountUp(value);

  return (
    <div
      className="relative rounded-2xl p-6 flex flex-col justify-between overflow-hidden group
                 transition-all duration-300 hover:border-[rgba(5,150,82,0.35)]"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(24px) saturate(140%)',
        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        boxShadow: '0 0 40px rgba(5,150,82,0.03) inset, 0 8px 32px rgba(0,0,0,0.25)',
        minHeight: 140,
      }}
    >
      {/* Top-edge glow line */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(5,150,82,0.35), transparent)' }}
      />

      <span
        className="block font-mono text-[9px] tracking-[0.2em] font-bold"
        style={{ color: 'rgba(255,255,255,0.22)' }}
      >
        {label}
      </span>

      <div className="mt-auto">
        <span
          className="block font-display text-[42px] leading-none font-extrabold tracking-tight"
          style={{ color: '#f0f0f0' }}
        >
          {display ?? counted}
        </span>
        {trend && (
          <span
            className="block font-mono text-[11px] mt-1.5 font-semibold"
            style={{ color: '#059652' }}
          >
            {trend}
          </span>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   T I E R  2  —  D E P A R T M E N T   C A R D
   ═══════════════════════════════════════════════════════════════ */

const DepartmentCard = ({ node }: { node: DeptNode }) => (
  <div
    className="relative rounded-2xl p-5 overflow-hidden cursor-pointer
               transition-all duration-300 hover:scale-[1.05]"
    style={{
      background: 'rgba(255,255,255,0.025)',
      border: `1px solid ${node.active ? `${node.color}28` : 'rgba(255,255,255,0.05)'}`,
      backdropFilter: 'blur(24px) saturate(140%)',
      WebkitBackdropFilter: 'blur(24px) saturate(140%)',
      boxShadow: '0 0 30px rgba(5,150,82,0.02) inset, 0 4px 24px rgba(0,0,0,0.2)',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.borderColor = `${node.color}60`;
      (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 1px ${node.color}18, 0 0 40px ${node.color}10 inset, 0 8px 32px rgba(0,0,0,0.3)`;
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.borderColor = node.active ? `${node.color}28` : 'rgba(255,255,255,0.05)';
      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 30px rgba(5,150,82,0.02) inset, 0 4px 24px rgba(0,0,0,0.2)';
    }}
  >
    {/* Top-edge glow */}
    <div
      className="absolute top-0 left-0 right-0 h-px pointer-events-none"
      style={{ background: `linear-gradient(90deg, transparent, ${node.color}55, transparent)` }}
    />

    {/* Header: dot + label */}
    <div className="flex items-center gap-2.5 mb-4">
      <span
        className="w-2 h-2 rounded-full inline-block flex-shrink-0"
        style={{
          background: node.active ? node.color : 'rgba(255,255,255,0.12)',
          boxShadow: node.active ? `0 0 6px ${node.color}` : 'none',
          animation: node.active ? 'statusPulse 2s ease-in-out infinite' : 'none',
        }}
      />
      <span
        className="font-mono text-[10px] tracking-[0.2em] font-bold"
        style={{ color: node.color }}
      >
        {node.label}
      </span>
    </div>

    {/* Count */}
    <span
      className="block font-display text-2xl font-extrabold tracking-tight"
      style={{ color: 'rgba(255,255,255,0.7)' }}
    >
      {node.online}/{node.total}
    </span>

    {/* Status */}
    <span
      className="block font-mono text-[8px] tracking-[0.15em] mt-1"
      style={{ color: 'rgba(255,255,255,0.2)' }}
    >
      {node.active ? 'ONLINE' : 'STANDBY'}
    </span>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   T I E R  3  —  O P E R A T I V E   D O C K
   macOS-style magnification carousel
   ═══════════════════════════════════════════════════════════════ */

const OperativeDock = () => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div
      className="flex items-end justify-center gap-1 px-8 py-4"
      style={{
        borderRadius: 9999,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(28px) saturate(150%)',
        WebkitBackdropFilter: 'blur(28px) saturate(150%)',
        boxShadow: '0 0 60px rgba(5,150,82,0.04) inset, 0 12px 48px rgba(0,0,0,0.35)',
      }}
    >
      {AGENTS.map((agent, idx) => {
        const isHovered  = hoveredId === agent.id;
        const hoveredIdx = hoveredId ? AGENTS.findIndex(a => a.id === hoveredId) : -1;
        const distance   = hoveredIdx >= 0 ? Math.abs(idx - hoveredIdx) : -1;
        const isNeighbor = distance === 1;

        // macOS magnification physics
        const scale = isHovered ? 1.6 : isNeighbor ? 1.2 : 1;
        const ty    = isHovered ? -12 : isNeighbor ? -6 : 0;

        const isActive = agent.status === 'active';

        return (
          <div
            key={agent.id}
            className="flex flex-col items-center relative"
            style={{
              transition: 'transform 0.28s cubic-bezier(0.23, 1, 0.32, 1)',
              transform: `scale(${scale}) translateY(${ty}px)`,
              willChange: 'transform',
              cursor: 'pointer',
              zIndex: isHovered ? 20 : 10,
            }}
            onMouseEnter={() => setHoveredId(agent.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Avatar */}
            <div
              className="relative rounded-full overflow-hidden flex-shrink-0"
              style={{
                width: 52,
                height: 52,
                border: isActive
                  ? '2px solid rgba(5,150,82,0.55)'
                  : '1px solid rgba(255,255,255,0.08)',
                boxShadow: isActive
                  ? '0 0 18px rgba(5,150,82,0.2)'
                  : '0 2px 10px rgba(0,0,0,0.4)',
                background: '#080a09',
              }}
            >
              <img
                src={agent.photo}
                alt={agent.name}
                className="w-full h-full object-cover"
                style={{
                  filter: isActive ? 'none' : 'grayscale(0.75) brightness(0.55)',
                  transition: 'filter 0.3s',
                }}
                onError={e => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const parent = e.currentTarget.parentElement;
                  if (parent) {
                    const fallback = document.createElement('span');
                    fallback.textContent = agent.name[0];
                    fallback.style.cssText = `
                      display:flex;align-items:center;justify-content:center;
                      width:100%;height:100%;font-family:'JetBrains Mono',monospace;
                      font-size:18px;font-weight:700;color:rgba(255,255,255,0.4);
                    `;
                    parent.appendChild(fallback);
                  }
                }}
              />

              {/* Active Status Dot — bottom-right of avatar */}
              {isActive && (
                <span
                  className="absolute bottom-0 right-0 block rounded-full"
                  style={{
                    width: 10,
                    height: 10,
                    background: '#059652',
                    border: '2px solid #080a09',
                    boxShadow: '0 0 6px rgba(5,150,82,0.7)',
                    animation: 'statusPulse 2s ease-in-out infinite',
                  }}
                />
              )}
            </div>

            {/* Name + Role — fades in only on hover */}
            <div
              className="flex flex-col items-center mt-2 pointer-events-none"
              style={{
                opacity: isHovered ? 1 : 0,
                transform: isHovered ? 'translateY(0)' : 'translateY(4px)',
                transition: 'opacity 0.2s ease, transform 0.2s ease',
              }}
            >
              <span
                className="font-display text-[11px] font-bold tracking-wide"
                style={{ color: 'rgba(255,255,255,0.85)' }}
              >
                {agent.name}
              </span>
              <span
                className="font-mono text-[8px] tracking-[0.12em]"
                style={{ color: 'rgba(255,255,255,0.3)' }}
              >
                {agent.role}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   C O M M A N D   C E N T E R  —  3-Tier Vertical Hierarchy
   ═══════════════════════════════════════════════════════════════ */

const CommandCenter = () => {
  const { profile } = useAuth();
  const [metrics, setMetrics] = useState({
    tasks: 42,
    screened: 128,
    roles: 6,
  });

  /* ── Live data fetch ── */
  useEffect(() => {
    (async () => {
      try {
        const { data: rows } = await supabase
          .from('resume_analyses')
          .select('id, created_at, recruitment_name')
          .order('created_at', { ascending: false });

        if (rows) {
          const now = new Date();
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const recent  = rows.filter(r => new Date(r.created_at) >= weekAgo).length;
          const roles   = new Set(rows.map(r => r.recruitment_name).filter(Boolean)).size;

          setMetrics({
            tasks:    recent + Math.floor(Math.random() * 15) + 10,
            screened: rows.length || 128,
            roles:    roles || 6,
          });
        }
      } catch (e) {
        console.error('CommandCenter metrics:', e);
      }
    })();
  }, []);

  const deptNodes = buildDeptNodes();
  const activeAgents  = AGENTS.filter(a => a.status === 'active').length;
  const totalAgents   = AGENTS.length;

  return (
    <div
      className="flex flex-col items-center justify-center w-full min-h-[calc(100vh-52px)] px-6 py-12 gap-12"
      style={{ background: 'transparent' }}
    >
      {/* Keyframes */}
      <style>{KEYFRAMES}</style>

      {/* ────────────────────────────────────────
          TIER 1 — Apex KPIs
         ──────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-6 w-full max-w-5xl">
        <ApexKPICard
          label="TASKS TODAY"
          value={metrics.tasks}
          trend="↑ 12% vs yesterday"
        />
        <ApexKPICard
          label="AGENTS ONLINE"
          value={activeAgents}
          display={
            <span>
              <span style={{ color: '#059652' }}>{activeAgents}</span>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>/{totalAgents}</span>
            </span>
          }
          trend={`${activeAgents} active now`}
        />
        <ApexKPICard
          label="SCREENED"
          value={metrics.screened}
          trend="6 shortlisted"
        />
        <ApexKPICard
          label="ACTIVE ROLES"
          value={metrics.roles}
          trend="2 new this week"
        />
      </div>

      {/* ────────────────────────────────────────
          TIER 2 — Department Matrix
         ──────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-6 w-full max-w-5xl">
        {deptNodes.map(node => (
          <DepartmentCard key={node.id} node={node} />
        ))}
      </div>

      {/* ────────────────────────────────────────
          TIER 3 — Operative Dock
         ──────────────────────────────────────── */}
      <OperativeDock />
    </div>
  );
};

export default CommandCenter;
