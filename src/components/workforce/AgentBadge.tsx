import { useState, useRef, MouseEvent } from 'react';
import { Sparkles, Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeptAgent } from './DepartmentColumn';

/* ─── Types ─── */

interface AgentBadgeProps {
  agent: DeptAgent & { description?: string };
  deptColor: string;       // hex color for department theming
  onClick: (id: string) => void;
}

// Map real tools to their function categories for the UI
const getToolCategory = (tool: string) => {
  const map: Record<string, string> = {
    'Claude': 'Reasoning',
    'GPT-4o': 'Intelligence',
    'Firecrawl': 'Web Scraping',
    'LinkedIn': 'Networking',
    'Apify': 'Data Extraction',
    'Checkr': 'Verification',
    'Zoom': 'Communication',
    'Calendar': 'Scheduling',
    'Instantly': 'Outreach',
    'Midjourney': 'Creation',
  };
  return map[tool] || 'Skill';
};

/* ─── Component ─── */

const AgentBadge = ({ agent, deptColor, onClick }: AgentBadgeProps) => {
  const [imgFailed, setImgFailed] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  
  const isActive = agent.status === 'active';
  const isIdle = agent.status === 'idle';

  // JS-based cinematic 3D tilt effect on hover
  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -6; // Max 6 deg
    const rotateY = ((x - centerX) / centerX) * 6;
    
    cardRef.current.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
  };

  const handleMouseLeave = () => {
    if (!cardRef.current) return;
    cardRef.current.style.transform = 'rotateX(0) rotateY(0) scale3d(1, 1, 1)';
  };

  // Mock Lifetime Performance Stats based on rarity
  const mockRoi = agent.isOriginal ? '€80K' : '€25K';
  const mockTasks = agent.isOriginal ? '1.2K' : '340';

  return (
    <div className="perspective-container w-full h-[340px] mb-5">
      <button
        ref={cardRef}
        onClick={() => onClick(agent.id)}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={cn(
          'w-full h-full relative rounded-xl text-left overflow-hidden tilt-card hologram-glass group',
          isActive ? 'animate-[deployment-climax_0.8s_ease-out_forwards]' : '',
          isIdle ? 'opacity-85' : (!isActive && 'opacity-60 grayscale-[40%]')
        )}
      >
        {/* Active: Pulsing Pilot Green Edge */}
        {isActive && (
          <div 
            className="absolute inset-0 rounded-xl pointer-events-none z-50 animate-[plasma-glow-edge_3s_ease-in-out_infinite]"
            style={{ border: `1px solid ${deptColor}`, boxShadow: `inset 0 0 10px ${deptColor}10` }}
          />
        )}
        
        {/* Active: Comet Particle Trail */}
        {isActive && (
          <div className="absolute inset-0 z-40 overflow-hidden rounded-xl pointer-events-none opacity-80 mix-blend-screen">
            <div 
              className="absolute w-[200%] h-[200%] -top-[50%] -left-[50%] animate-[comet-trail_5s_linear_infinite]"
              style={{
                background: `conic-gradient(from 0deg, transparent 60%, ${deptColor} 100%)`,
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                padding: '1.5px'
              }}
            />
          </div>
        )}

        {/* ─── Top 60%: Portrait Presence ─── */}
        <div className="h-[55%] relative overflow-hidden bg-[#030507]">
           {/* Elite Original Geometry / Rarity Texture */}
           {agent.isOriginal && (
             <div className="absolute inset-0 z-10 opacity-30 mix-blend-overlay pointer-events-none"
                  style={{
                    backgroundImage: `repeating-linear-gradient(45deg, ${deptColor}30 0, ${deptColor}30 1px, transparent 1px, transparent 8px)`
                  }}
             />
           )}
           
           {!imgFailed && agent.avatar ? (
             <img
               src={agent.avatar}
               alt={agent.name}
               onError={() => setImgFailed(true)}
               className={cn(
                 'w-full h-full object-cover transition-all duration-700 ease-out group-hover:scale-105',
                 isActive ? 'scale-105 brightness-110 saturate-[1.1] contrast-[1.05]' : 'scale-100 grayscale-[70%] brightness-75',
                 isIdle && 'grayscale-[30%] brightness-90',
               )}
             />
           ) : (
             <div className="w-full h-full flex items-center justify-center bg-white/[0.02] text-4xl font-black text-white/5">
               {agent.name.charAt(0)}
             </div>
           )}

           {/* Active States: Intense Internal Halo */}
           {isActive && (
             <div 
               className="absolute inset-x-0 bottom-0 top-1/2 z-10 opacity-80 pointer-events-none mix-blend-screen bg-gradient-to-t"
               style={{ backgroundImage: `linear-gradient(to top, ${deptColor}40, transparent)` }}
             />
           )}
           
           {/* Seamless gradient fade into the info panel */}
           <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[rgba(15,20,18,0.95)] to-transparent z-20 pointer-events-none" />
        </div>

        {/* ─── Bottom 45%: Information Cluster ─── */}
        <div className="h-[45%] px-4 py-3.5 flex flex-col justify-between relative z-30 bg-gradient-to-b from-[rgba(15,20,18,0.95)] to-[rgba(8,12,10,1)]">
          
          {/* Identity Header */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <h3 className="text-[18px] font-bold text-white tracking-tight leading-none drop-shadow-md">
                  {agent.name}
                </h3>
                {agent.isOriginal && (
                  <Sparkles className="h-[14px] w-[14px]" style={{ color: deptColor }} />
                )}
              </div>
              
              {/* Active Dot Indication */}
              {isActive && (
                <div className="flex items-center gap-1">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full opacity-[0.85] animate-ping" style={{ backgroundColor: deptColor }} />
                    <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: deptColor }} />
                  </span>
                </div>
              )}
            </div>
            
            <p className="text-[11px] font-mono text-white/60 tracking-[0.1em] uppercase">
              {agent.role.replace(/ /g, '_')}
            </p>
          </div>

          {/* Skill Matrix */}
          <div className="flex flex-wrap gap-1.5 mt-2.5 mb-2.5 flex-1 content-start">
            {agent.enabledTools?.slice(0, 2).map((tool) => (
              <div 
                key={tool}
                className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] bg-white/[0.04] border border-white/[0.08] text-white/70 backdrop-blur-md shadow-sm"
              >
                <span className="text-[10px] font-semibold tracking-wide text-white drop-shadow-sm">{tool}</span>
                <div className="w-[1px] h-2.5 bg-white/20" />
                <span className="text-[9px] font-mono text-emerald-400/80 uppercase tracking-wide">{getToolCategory(tool)}</span>
              </div>
            ))}
            {agent.enabledTools && agent.enabledTools.length > 2 && (
              <div className="flex items-center px-1.5 py-1 rounded-[6px] bg-white/[0.02] border border-white/[0.04] text-[9px] font-mono text-white/40">
                +{agent.enabledTools.length - 2}
              </div>
            )}
          </div>

          {/* Lifetime Stats & Flavor Text */}
          <div className="mt-auto border-t border-white/[0.06] pt-2.5">
            <div className="flex justify-between items-center mb-1.5 opacity-90">
              <span className="text-[10px] font-mono font-bold text-white/80 tracking-wider">
                <span className="text-white/40 mr-1.5 font-normal">ROI</span>{mockRoi}
              </span>
              <span className="text-[10px] font-mono font-bold text-white/80 tracking-wider">
                <span className="text-white/40 mr-1.5 font-normal">TASKS</span>{mockTasks}
              </span>
            </div>
            <p className="text-[9.5px] leading-[1.35] font-mono text-white/30 line-clamp-2 mt-1">
              {agent.description || `Specialized ${agent.department} operative. Awaiting directives.`}
            </p>
          </div>
          
        </div>
      </button>
    </div>
  );
};

export default AgentBadge;

