import { useState, useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Types ─── */

export interface ActivityEntry {
  id: string;
  timestamp: Date;
  agentName: string;
  agentPhoto?: string;
  action: string;
  department: string;
  status: 'in-progress' | 'completed' | 'failed';
}

interface ActivityTerminalProps {
  entries?: ActivityEntry[];
}

/* ─── Mock Data Generator ─── */

const MOCK_AGENTS = [
  { name: 'Scout', dept: 'Talent', photo: '/agents/20260324_2120_Image Generation_simple_compose_01kmg7r0naeadvd5qprmxwn76w.png' },
  { name: 'Aria', dept: 'Talent', photo: '/agents/20260328_1020_Futuristic Executive Portrait_simple_compose_01kmsbjdytefjt5nzrafx7mg7h.png' },
  { name: 'Radar', dept: 'Intelligence', photo: '/agents/20260328_1022_Image Generation_simple_compose_01kmsbp7yde03bwrm6pz483pfj.png' },
  { name: 'Penn', dept: 'Growth', photo: '/agents/20260328_1030_Image Generation_simple_compose_01kmsc4292fpfbv69fth1q7v79.png' },
  { name: 'Constructor', dept: 'Content', photo: '/agents/20260328_1027_Image Generation_simple_compose_01kmsbyw6sfkg8grk4hgm9qvp9.png' },
];

const MOCK_ACTIONS = [
  'screening candidate #4021 against ICP criteria...',
  'sourcing 12 new leads from LinkedIn...',
  'analyzing competitor pricing page changes...',
  'completed outreach sequence "Q1 Pipeline"',
  'generated content brief for hiring campaign',
  'detected growth signal: TechCorp raised Series B',
  'scheduled 3 interviews for Senior SWE role',
  'completed deep-search scan on 48 profiles',
  'flagged 2 high-priority candidates for review',
  'parsed 15 new job postings from target companies',
];

const generateMockEntry = (id: number): ActivityEntry => {
  const agent = MOCK_AGENTS[Math.floor(Math.random() * MOCK_AGENTS.length)];
  const action = MOCK_ACTIONS[Math.floor(Math.random() * MOCK_ACTIONS.length)];
  const statuses: ActivityEntry['status'][] = ['in-progress', 'completed', 'completed', 'completed'];
  return {
    id: `activity-${id}-${Date.now()}`,
    timestamp: new Date(Date.now() - Math.random() * 600000),
    agentName: agent.name,
    agentPhoto: agent.photo,
    action,
    department: agent.dept,
    status: statuses[Math.floor(Math.random() * statuses.length)],
  };
};

/* ─── Component ─── */

const ActivityTerminal = ({ entries: externalEntries }: ActivityTerminalProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[]>(() =>
    externalEntries || Array.from({ length: 6 }, (_, i) => generateMockEntry(i))
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);

  // Auto-add new entries periodically (demo mode)
  useEffect(() => {
    if (externalEntries) return; // Don't auto-generate if external data is provided

    const interval = setInterval(() => {
      if (!isHovering) {
        setEntries(prev => {
          const newEntry = generateMockEntry(prev.length);
          const updated = [newEntry, ...prev];
          return updated.slice(0, 30); // Keep max 30 entries
        });
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [isHovering, externalEntries]);

  // Auto-scroll on new entries
  useEffect(() => {
    if (scrollRef.current && !isHovering) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries, isHovering]);

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    return `${diffH}h ago`;
  };

  return (
    <div
      className={cn(
        'border-t border-[rgba(255,255,255,0.04)] bg-[rgba(5,8,6,0.6)] backdrop-blur-[16px] transition-all duration-300 flex-shrink-0',
        isCollapsed ? 'h-[32px]' : 'h-[180px]'
      )}
    >
      {/* ─── Title Bar ─── */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center justify-between w-full px-6 h-[32px] group"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#00FF94] opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00FF94]" />
          </span>
          <span className="text-[9px] font-mono text-white/25 tracking-[0.2em] uppercase">
            Live Workforce Activity
          </span>
          <span className="text-[9px] font-mono text-white/15 tracking-wider">
            ({entries.length})
          </span>
        </div>
        {isCollapsed ? (
          <ChevronUp className="h-3 w-3 text-white/20 group-hover:text-white/40 transition-colors" />
        ) : (
          <ChevronDown className="h-3 w-3 text-white/20 group-hover:text-white/40 transition-colors" />
        )}
      </button>

      {/* ─── Entry List ─── */}
      {!isCollapsed && (
        <div
          ref={scrollRef}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          className="h-[calc(100%-32px)] overflow-y-auto overflow-x-hidden px-6 pb-2 scrollbar-thin scrollbar-thumb-white/5"
        >
          {entries.map((entry, i) => (
            <div
              key={entry.id}
              className={cn(
                'flex items-center gap-3 py-2 border-b border-[rgba(255,255,255,0.02)] last:border-0',
                i === 0 && 'animate-in slide-in-from-left-2 fade-in duration-300'
              )}
            >
              {/* Agent micro-portrait */}
              <div className="relative flex-shrink-0">
                {entry.agentPhoto ? (
                  <img
                    src={entry.agentPhoto}
                    alt={entry.agentName}
                    className="w-6 h-6 rounded-full object-cover border border-[rgba(0,255,148,0.15)]"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-[#00FF94]/10 border border-[#00FF94]/20 flex items-center justify-center text-[9px] font-bold text-[#00FF94]">
                    {entry.agentName[0]}
                  </div>
                )}
                {entry.status === 'in-progress' && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#00FF94] border border-[#030507]">
                    <span className="absolute inset-0 rounded-full bg-[#00FF94] animate-ping opacity-75" />
                  </span>
                )}
              </div>

              {/* Agent name */}
              <span className="text-[11px] font-semibold text-white/70 flex-shrink-0 w-20 truncate">
                {entry.agentName}
              </span>

              {/* Action text */}
              <span className="text-[10px] font-mono text-white/30 truncate flex-1">
                {entry.action}
              </span>

              {/* Status indicator */}
              <span className={cn(
                'text-[9px] font-mono tracking-wider flex-shrink-0',
                entry.status === 'in-progress' ? 'text-[#00FF94]/50' :
                entry.status === 'completed' ? 'text-white/20' :
                'text-red-400/50'
              )}>
                {entry.status === 'in-progress' ? '● ACTIVE' : entry.status === 'completed' ? '✓ DONE' : '✗ FAIL'}
              </span>

              {/* Timestamp */}
              <span className="text-[9px] font-mono text-white/15 flex-shrink-0 w-14 text-right">
                {formatTimestamp(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ActivityTerminal;
