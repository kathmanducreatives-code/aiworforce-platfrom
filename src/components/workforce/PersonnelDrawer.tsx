import { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Shield, Power, Zap, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

/* ─── Types ─── */

export interface PersonnelAgent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  department: string;
  status: 'active' | 'idle' | 'disabled';
  isOriginal?: boolean;
  description?: string;
  enabledTools?: string[];
  collaboratesWith?: string[];
  responsibilities?: string[];
  lastActive?: string;
}

interface PersonnelDrawerProps {
  agent: PersonnelAgent | null;
  deptColor: string;
  onClose: () => void;
}

/* ─── All Available Tools (Tool Arsenal) ─── */

const TOOL_CATALOG = [
  { id: 'firecrawl', name: 'Firecrawl', category: 'research' },
  { id: 'claude', name: 'Claude', category: 'ai-models' },
  { id: 'gpt-4o', name: 'GPT-4o', category: 'ai-models' },
  { id: 'linkedin', name: 'LinkedIn', category: 'research' },
  { id: 'apify', name: 'Apify', category: 'research' },
  { id: 'calendar', name: 'Calendar', category: 'communication' },
  { id: 'zoom', name: 'Zoom', category: 'communication' },
  { id: 'slack', name: 'Slack', category: 'communication' },
  { id: 'email', name: 'Email', category: 'communication' },
  { id: 'midjourney', name: 'Midjourney', category: 'creation' },
  { id: 'checkr', name: 'Checkr', category: 'monitoring' },
  { id: 'instantly', name: 'Instantly', category: 'communication' },
  { id: 'crm', name: 'CRM', category: 'research' },
];

/* ─── Component ─── */

const PersonnelDrawer = ({ agent, deptColor, onClose }: PersonnelDrawerProps) => {
  const navigate = useNavigate();
  const [imgFailed, setImgFailed] = useState(false);
  const [isExpanded, setIsExpanded] = useState({ tools: true, responsibilities: false });
  const drawerRef = useRef<HTMLDivElement>(null);

  // Reset image state when agent changes
  useEffect(() => {
    setImgFailed(false);
  }, [agent?.id]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (agent) {
      setTimeout(() => window.addEventListener('mousedown', handleClick), 100);
    }
    return () => window.removeEventListener('mousedown', handleClick);
  }, [agent, onClose]);

  if (!agent) return null;

  const isActive = agent.status === 'active';
  const toolSet = new Set(agent.enabledTools || []);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 transition-opacity duration-300',
          agent ? 'bg-black/40 backdrop-blur-[2px]' : 'opacity-0 pointer-events-none'
        )}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed right-0 top-0 h-screen w-[380px] z-50',
          'bg-[rgba(8,12,10,0.92)] backdrop-blur-[32px]',
          'border-l border-[rgba(255,255,255,0.06)]',
          'transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'flex flex-col',
          agent ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* ─── Header ─── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.04)]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-white/25 tracking-[0.2em] uppercase">
              Personnel File
            </span>
            {agent.isOriginal && (
              <span
                className="text-[9px] font-mono tracking-wider px-1.5 py-0.5 rounded-md"
                style={{
                  backgroundColor: `${deptColor}15`,
                  color: `${deptColor}90`,
                  border: `1px solid ${deptColor}25`,
                }}
              >
                ORIGINAL
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors"
          >
            <X className="h-3.5 w-3.5 text-white/40" />
          </button>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 space-y-5 scrollbar-thin scrollbar-thumb-white/5">

          {/* Identity Panel */}
          <div className="flex flex-col items-center text-center">
            {/* Large portrait */}
            <div className="relative mb-4">
              {agent.isOriginal && isActive && (
                <div
                  className="absolute -inset-[6px] rounded-full opacity-30 animate-[rim-pulse_4s_ease-in-out_infinite]"
                  style={{
                    border: `2px solid ${deptColor}`,
                    boxShadow: `0 0 20px ${deptColor}40`,
                  }}
                />
              )}
              {imgFailed || !agent.avatar ? (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
                  style={{
                    backgroundColor: `${deptColor}15`,
                    border: `2px solid ${deptColor}40`,
                    color: deptColor,
                    boxShadow: `0 0 30px ${deptColor}20`,
                  }}
                >
                  {agent.name[0]}
                </div>
              ) : (
                <img
                  src={agent.avatar}
                  alt={agent.name}
                  onError={() => setImgFailed(true)}
                  className="w-20 h-20 rounded-full object-cover"
                  style={{
                    border: `2px solid ${deptColor}50`,
                    boxShadow: isActive ? `0 0 30px ${deptColor}30` : 'none',
                  }}
                />
              )}
              {/* Status ring */}
              {isActive && (
                <span className="absolute bottom-0 right-0 flex h-4 w-4">
                  <span
                    className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                    style={{ backgroundColor: deptColor }}
                  />
                  <span
                    className="relative inline-flex rounded-full h-4 w-4 border-[3px] border-[#0a0f0d]"
                    style={{ backgroundColor: deptColor }}
                  />
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">{agent.name}</h2>
              {agent.isOriginal && (
                <Sparkles className="h-4 w-4" style={{ color: `${deptColor}90` }} />
              )}
            </div>
            <p className="text-[12px] text-white/40 mt-1">{agent.role}</p>
            <span
              className="text-[10px] font-mono tracking-[0.15em] uppercase mt-2 px-2 py-1 rounded-md"
              style={{
                color: isActive ? deptColor : agent.status === 'idle' ? '#F59E0B' : 'rgba(255,255,255,0.25)',
                backgroundColor: isActive ? `${deptColor}12` : agent.status === 'idle' ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isActive ? `${deptColor}20` : agent.status === 'idle' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)'}`,
              }}
            >
              {agent.status}
            </span>

            {agent.description && (
              <p className="text-[11px] text-white/30 mt-3 leading-relaxed max-w-[280px]">
                {agent.description}
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-[rgba(255,255,255,0.04)]" />

          {/* ─── Tool Arsenal ─── */}
          <div>
            <button
              onClick={() => setIsExpanded(p => ({ ...p, tools: !p.tools }))}
              className="flex items-center justify-between w-full group"
            >
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-white/25" />
                <span className="text-[10px] font-mono text-white/30 tracking-[0.2em] uppercase">
                  Tool Arsenal
                </span>
                <span className="text-[10px] font-mono text-white/15">({toolSet.size})</span>
              </div>
              {isExpanded.tools ? (
                <ChevronUp className="h-3 w-3 text-white/15" />
              ) : (
                <ChevronDown className="h-3 w-3 text-white/15" />
              )}
            </button>

            {isExpanded.tools && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {TOOL_CATALOG.map(tool => {
                  const isEnabled = toolSet.has(tool.id) || toolSet.has(tool.name);
                  return (
                    <div
                      key={tool.id}
                      className={cn(
                        'px-2 py-2 rounded-lg text-center transition-all duration-200 cursor-default',
                        isEnabled
                          ? 'bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]'
                          : 'bg-transparent border border-[rgba(255,255,255,0.03)] opacity-30'
                      )}
                    >
                      <span
                        className={cn(
                          'text-[10px] font-mono',
                          isEnabled ? 'text-white/60' : 'text-white/20'
                        )}
                      >
                        {tool.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-[rgba(255,255,255,0.04)]" />

          {/* ─── Responsibilities ─── */}
          {agent.responsibilities && agent.responsibilities.length > 0 && (
            <div>
              <button
                onClick={() => setIsExpanded(p => ({ ...p, responsibilities: !p.responsibilities }))}
                className="flex items-center justify-between w-full group"
              >
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-white/25" />
                  <span className="text-[10px] font-mono text-white/30 tracking-[0.2em] uppercase">
                    Core Directives
                  </span>
                </div>
                {isExpanded.responsibilities ? (
                  <ChevronUp className="h-3 w-3 text-white/15" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-white/15" />
                )}
              </button>

              {isExpanded.responsibilities && (
                <ul className="mt-3 space-y-2">
                  {agent.responsibilities.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span
                        className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                        style={{ backgroundColor: `${deptColor}50` }}
                      />
                      <span className="text-[11px] text-white/35 leading-relaxed">{r}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ─── Collaborators ─── */}
          {agent.collaboratesWith && agent.collaboratesWith.length > 0 && (
            <>
              <div className="h-px bg-[rgba(255,255,255,0.04)]" />
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono text-white/25 tracking-[0.2em] uppercase">
                    Collaborates With
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {agent.collaboratesWith.map(name => (
                    <span
                      key={name}
                      className="text-[10px] font-mono text-white/35 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05] capitalize"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ─── Footer Actions ─── */}
        <div className="px-5 py-4 border-t border-[rgba(255,255,255,0.04)] space-y-2">
          <button
            onClick={() => {
              navigate(`/agent-studio?agent=${agent.id}`);
              onClose();
            }}
            className="w-full py-2.5 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-2 transition-all duration-200"
            style={{
              backgroundColor: `${deptColor}15`,
              color: deptColor,
              border: `1px solid ${deptColor}25`,
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Agent Studio
          </button>

          <button
            onClick={() => {
              // Toggle power status mock
              console.log(`Toggle ${agent.id} status`);
            }}
            className={cn(
              'w-full py-2 rounded-lg text-[11px] font-mono flex items-center justify-center gap-2 transition-all duration-200',
              isActive
                ? 'bg-[rgba(239,68,68,0.08)] text-red-400/60 border border-red-500/15 hover:bg-red-500/12'
                : 'bg-[rgba(0,255,148,0.05)] text-[#00FF94]/50 border border-[#00FF94]/15 hover:bg-[#00FF94]/10'
            )}
          >
            <Power className="h-3 w-3" />
            {isActive ? 'DEACTIVATE' : 'ACTIVATE'}
          </button>
        </div>
      </div>
    </>
  );
};

export default PersonnelDrawer;
