import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';

type ActorRole = 'founder' | 'agent';

interface TimelineNode {
    id: string;
    time: string;
    side: 'left' | 'right';
    role: ActorRole;
    agentName: string;
    department: string;
    accent: string;
    message: string;
    secondary?: string;
    isFounder?: boolean;
}

const TIMELINE_NODES: TimelineNode[] = [
    {
        id: "n1", time: "07:00 AM", side: "right", role: "agent",
        agentName: "Brief Agent", department: "Intelligence Dept", accent: "#00FF94",
        message: "Morning brief delivered.",
        secondary: "3 signals need attention today, 1 urgent, 2 informational."
    },
    {
        id: "n2", time: "07:12 AM", side: "left", role: "founder",
        agentName: "You", department: "Founder / Admin", accent: "#4285F4",
        message: "Reviewed brief. Approved Growth agent to pursue Acme Corp lead.",
        isFounder: true
    },
    {
        id: "n3", time: "07:13 AM", side: "right", role: "agent",
        agentName: "Radar", department: "Growth Dept", accent: "#00FF94",
        message: "Lead research initiated for Acme Corp.",
        secondary: "Found James Park, Co-Founder. Trigger: €8M Series A. Pain signal isolated."
    },
    {
        id: "n4", time: "07:45 AM", side: "left", role: "agent",
        agentName: "Penn", department: "Growth Dept", accent: "#F59E0B",
        message: "Personalized outreach drafted.",
        secondary: "Sequence hook references the specific hiring pain signal and Series A timing."
    },
    {
        id: "n5", time: "09:10 AM", side: "right", role: "agent",
        agentName: "Scout", department: "Talent Dept", accent: "#97D700",
        message: "Talent shortlist refreshed against updated ICP.",
        secondary: "Scraped 145 competitors. 12 tier-1 candidates identified."
    },
    {
        id: "n6", time: "11:30 AM", side: "left", role: "agent",
        agentName: "Aria", department: "Evaluate Dept", accent: "#CC785C",
        message: "Candidate evaluations updated and queued for founder review."
    }
];

const DayTimelineSection = () => {
    const sectionRef = useRef<HTMLElement>(null);
    const isMobile = useIsMobile();
    
    const { scrollYProgress } = useScroll({
        target: sectionRef,
        offset: ["start start", "end end"]
    });

    const yTranslation = useTransform(scrollYProgress, [0.1, 0.95], ["0%", isMobile ? "-65%" : "-35%"]);

    return (
        <section ref={sectionRef} id="daily-brief" className="relative w-full h-[400vh] bg-transparent border-t border-white/5">
            <div className="sticky top-0 w-full h-screen overflow-hidden flex flex-col py-16 md:py-24">
                
                {/* ── HEADER ── */}
                <div className="relative z-20 text-center shrink-0 mb-8 md:mb-16 px-6">
                    <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-mint font-bold mb-4 md:mb-6 block">
                        A MONDAY WITH YOUR WORKFORCE
                    </span>
                    <h2 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-white leading-[1.05] tracking-tight mb-4 max-w-4xl mx-auto">
                        47 minutes of your time.<br className="hidden md:block"/> A full week of work done.
                    </h2>
                    <p className="text-lg md:text-xl text-white/40 leading-relaxed font-medium">
                        The AI handles the volume. You handle the decisions.
                    </p>
                </div>

                {/* ── TIMELINE TREE ── */}
                <motion.div 
                    className="relative w-full max-w-5xl mx-auto flex-1 px-4 md:px-0 mt-8"
                    style={{ y: yTranslation }}
                >
                    {/* Spine background */}
                    <div className="absolute left-6 md:left-1/2 top-0 bottom-[-200px] w-[2px] bg-white/[0.05] -translate-x-1/2 rounded-full" />
                    
                    {/* Spine fill */}
                    <motion.div 
                        style={{ scaleY: useTransform(scrollYProgress, [0.1, 0.95], [0, 1]) }}
                        className="absolute left-6 md:left-1/2 top-0 bottom-[-200px] w-[2px] bg-accent-mint -translate-x-1/2 origin-top shadow-[0_0_15px_rgba(0,255,148,0.5)] rounded-full" 
                    />

                    {/* Nodes Array */}
                    <div className="flex flex-col gap-8 md:gap-12 relative z-10 pt-4 pb-32">
                        {TIMELINE_NODES.map((node, i) => (
                            <TimelineNode 
                                key={node.id} 
                                node={node} 
                                index={i} 
                                total={TIMELINE_NODES.length} 
                                scrollYProgress={scrollYProgress} 
                                isMobile={isMobile}
                            />
                        ))}
                    </div>
                </motion.div>

                {/* Bottom Fade Gradient */}
                <div className="absolute bottom-0 left-0 w-full h-40 bg-gradient-to-t from-[#050505] to-transparent pointer-events-none z-30" />
            </div>
        </section>
    );
};

const TimelineNode = ({ node, index, total, scrollYProgress, isMobile }: any) => {
    // Reveal mapping
    const start = 0.15 + (index * 0.13); 
    
    const opacity = useTransform(
        scrollYProgress,
        [start - 0.05, start, start + 0.1, start + 0.25],
        [0, 1, 1, 0.5]
    );
    
    const y = useTransform(
        scrollYProgress,
        [start - 0.05, start],
        [40, 0]
    );

    const scale = useTransform(
        scrollYProgress,
        [start - 0.05, start],
        [0.95, 1]
    );

    const activeColor = node.accent;
    const inactiveColor = "rgba(255,255,255,0)";
    const semiActiveColor = `rgba(255,255,255,0.05)`;

    const borderColor = useTransform(
        scrollYProgress,
        [start - 0.05, start, start + 0.1, start + 0.25],
        [inactiveColor, activeColor, activeColor, semiActiveColor]
    );

    const glowShadow = useTransform(
        scrollYProgress,
        [start - 0.05, start, start + 0.1, start + 0.25],
        ["0 0 0px rgba(0,0,0,0)", `0 0 30px ${activeColor}25`, `0 0 30px ${activeColor}25`, "0 0 0px rgba(0,0,0,0)"]
    );

    const dotBg = useTransform(
        scrollYProgress,
        [start - 0.05, start, start + 0.1, start + 0.25],
        ["#000000", activeColor, activeColor, "#111111"]
    );

    const dotShadow = useTransform(
        scrollYProgress,
        [start - 0.05, start, start + 0.1, start + 0.25],
        ["0 0 0px rgba(0,0,0,0)", `0 0 15px ${activeColor}`, `0 0 15px ${activeColor}`, "0 0 0px rgba(0,0,0,0)"]
    );

    const isRight = isMobile ? true : node.side === 'right';

    return (
        <div className={`flex w-full ${isRight ? 'md:justify-end' : 'md:justify-start'} relative pl-16 md:pl-0 min-h-[140px] items-center`}>
            
            {/* Horizontal Connector Line */}
            <motion.div 
                style={{ opacity, backgroundColor: borderColor }}
                className={`absolute top-1/2 -translate-y-1/2 w-6 md:w-[calc(6%+1rem)] h-[1px] z-0 ${isRight ? 'left-6 md:left-1/2' : 'right-0 md:right-1/2'}`}
            />

            {/* Spine Dot */}
            <div className="absolute top-1/2 -translate-y-1/2 left-6 md:left-[50%] -translate-x-1/2 flex items-center justify-center z-10 w-8 h-8 pointer-events-none">
                <motion.div 
                    style={{ backgroundColor: dotBg, boxShadow: dotShadow }}
                    className="w-3 h-3 rounded-full border-2 border-black" 
                />
            </div>

            {/* Message Card */}
            <motion.div
                style={{ opacity, y, scale }}
                className={`w-full md:w-[calc(50%-3rem)] flex flex-col z-20`}
            >
                <motion.div
                    style={{ borderColor, boxShadow: glowShadow }}
                    className="w-full glass-card-premium rounded-[1.5rem] p-6 md:p-8 flex flex-col gap-4 bg-white/[0.02] border transition-all duration-300"
                >
                    {/* Actor Profile Head */}
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <div 
                                className="w-10 h-10 rounded-[1.2rem] flex items-center justify-center shrink-0"
                                style={{ 
                                    background: `radial-gradient(circle, ${node.accent}30 0%, transparent 80%)`, 
                                    border: `1px solid ${node.accent}40`,
                                    boxShadow: `0 0 20px ${node.accent}20` 
                                }}
                            >
                                <div className="w-2 h-2 rounded-full" style={{ background: node.accent }} />
                            </div>
                            <div className="flex flex-col">
                                <span className={`font-display font-black text-[15px] md:text-base tracking-wide uppercase ${node.isFounder ? 'text-white' : 'text-white/90'}`}>
                                    {node.agentName}
                                </span>
                                <span className="font-mono text-[9px] md:text-[10px] uppercase tracking-widest text-[#A1A1AA] mt-0.5">
                                    {node.department}
                                </span>
                            </div>
                        </div>
                        <div className="font-mono text-[10px] font-bold tracking-widest text-[#A1A1AA] bg-[#050505] border border-white/5 shadow-inner px-2 py-1 rounded-md">
                            {node.time}
                        </div>
                    </div>

                    {/* Message Body */}
                    <h4 className="text-white/80 font-medium leading-[1.6] text-sm md:text-base tracking-[-0.01em]">
                        {node.message}
                    </h4>

                    {/* Secondary Data Detail */}
                    {node.secondary && (
                        <p className="text-[#A1A1AA] text-xs md:text-sm leading-relaxed mt-1 border-l-2 pl-4 py-0.5" style={{ borderColor: `${node.accent}40` }}>
                            {node.secondary}
                        </p>
                    )}
                </motion.div>
            </motion.div>
        </div>
    );
};

export default DayTimelineSection;