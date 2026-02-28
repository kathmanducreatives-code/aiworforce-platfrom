import React, { useRef, useState, useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import {
    Users, ShieldCheck, Video, CreditCard,
    Send, CheckCircle, FileText, BadgeCheck, Play, ListChecks
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

export function ScrollJourneySection() {
    const sectionRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<gsap.core.Timeline | null>(null);

    // Text Refs
    const text1Ref = useRef<HTMLDivElement>(null);
    const text2Ref = useRef<HTMLDivElement>(null);
    const text3Ref = useRef<HTMLDivElement>(null);
    const text4Ref = useRef<HTMLDivElement>(null);

    // Progress Bar Indicator Refs
    const progressPulseRef = useRef<HTMLDivElement>(null);
    const dot1Ref = useRef<HTMLDivElement>(null);
    const dot2Ref = useRef<HTMLDivElement>(null);
    const dot3Ref = useRef<HTMLDivElement>(null);
    const dot4Ref = useRef<HTMLDivElement>(null);

    // UI Stage Master Ref (for Phase 4 shift)
    const uiStageRef = useRef<HTMLDivElement>(null);

    // Stacked Cards Refs
    const card3Ref = useRef<HTMLDivElement>(null); // Bottom card
    const card2Ref = useRef<HTMLDivElement>(null); // Middle card
    const card1ContainerRef = useRef<HTMLDivElement>(null); // Top card container (for flip)
    const card1InnerRef = useRef<HTMLDivElement>(null); // Top card inner (for preserve-3d)

    // Phase 3 UI
    const videoFrameRef = useRef<HTMLDivElement>(null);
    const questionsContainerRef = useRef<HTMLDivElement>(null);

    // Phase 4 UI
    const escrowModalRef = useRef<HTMLDivElement>(null);
    const payoutStampRef = useRef<HTMLDivElement>(null);

    const [activePillar, setActivePillar] = useState(1);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Main scrub timeline attached to the pinned section
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: "top top",
                    end: "+=4000", // 400vh scroll distance
                    scrub: 1,
                    pin: true,
                    anticipatePin: 1,
                    onUpdate: (self) => {
                        const prog = self.progress;
                        if (prog < 0.25) setActivePillar(1);
                        else if (prog < 0.5) setActivePillar(2);
                        else if (prog < 0.75) setActivePillar(3);
                        else setActivePillar(4);
                    }
                }
            });
            timelineRef.current = tl;

            // --- PROGRESS BAR ---
            // The pulse travels from top (0%) to bottom (100%) of the track
            tl.to(progressPulseRef.current, { top: "100%", ease: "none" }, 0);

            // Hide text 2, 3, 4 initially
            gsap.set([text2Ref.current, text3Ref.current, text4Ref.current], { opacity: 0, y: 50, filter: 'blur(10px)' });
            gsap.set(text1Ref.current, { opacity: 1, y: 0, filter: 'blur(0px)' });

            // Initial Card Positions (offscreen explicitly)
            gsap.set([card1ContainerRef.current, card2Ref.current, card3Ref.current], { y: 800, opacity: 0 });
            gsap.set(videoFrameRef.current, { x: 400, opacity: 0, scale: 0.8 });
            gsap.set(questionsContainerRef.current, { x: 400, opacity: 0 });
            gsap.set(escrowModalRef.current, { y: 400, opacity: 0 });


            // ==========================================
            // PHASE 1: Expert Marketplace (0% - 25%)
            // ==========================================

            // Cards fly in and form a stack
            tl.to(card3Ref.current, { y: 0, opacity: 0.3, scale: 0.9, duration: 0.1, ease: "power3.out" }, 0.05);
            tl.to(card2Ref.current, { y: -20, opacity: 0.6, zIndex: 10, scale: 0.95, duration: 0.1, ease: "power3.out" }, 0.07);
            tl.to(card1ContainerRef.current, { y: -40, opacity: 1, zIndex: 20, scale: 1, duration: 0.1, ease: "power3.out" }, 0.09);

            // Phase 1 -> 2 Transition
            tl.to(text1Ref.current, { opacity: 0, y: -50, filter: 'blur(10px)', duration: 0.05 }, 0.2);
            tl.to(text2Ref.current, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.05 }, 0.25);


            // ==========================================
            // PHASE 2: The Trust Layer (25% - 50%)
            // ==========================================

            // Background cards dim out
            tl.to([card2Ref.current, card3Ref.current], { opacity: 0, y: 50, duration: 0.08 }, 0.28);

            // Top card performs a 3D flip to show verification back
            tl.to(card1InnerRef.current, { rotationY: 180, duration: 0.12, ease: "power3.inOut" }, 0.3);

            // Phase 2 -> 3 Transition
            tl.to(text2Ref.current, { opacity: 0, y: -50, filter: 'blur(10px)', duration: 0.05 }, 0.45);
            tl.to(text3Ref.current, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.05 }, 0.5);


            // ==========================================
            // PHASE 3: Integrated Video Hub (50% - 75%)
            // ==========================================

            // Flipped Card slides left
            tl.to(card1ContainerRef.current, { x: -180, duration: 0.1, ease: "power2.inOut" }, 0.52);

            // Video Frame slides in from right to dock
            tl.to(videoFrameRef.current, { x: 180, y: -40, opacity: 1, scale: 1, zIndex: 30, duration: 0.1, ease: "back.out(1.2)" }, 0.55);

            // Questions stagger in under the video frame
            tl.to(questionsContainerRef.current, { x: 180, y: 140, opacity: 1, duration: 0.1 }, 0.58);
            const questions = questionsContainerRef.current?.children;
            if (questions) {
                tl.fromTo(questions,
                    { opacity: 0, x: 20 },
                    { opacity: 1, x: 0, duration: 0.1, stagger: 0.03 },
                    0.6
                );
            }

            // Phase 3 -> 4 Transition
            tl.to(text3Ref.current, { opacity: 0, y: -50, filter: 'blur(10px)', duration: 0.05 }, 0.7);
            tl.to(text4Ref.current, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.05 }, 0.75);


            // ==========================================
            // PHASE 4: Escrow Logic (75% - 100%)
            // ==========================================

            // Entire cluster shifts up to make room
            tl.to(uiStageRef.current, { y: -120, duration: 0.1, ease: "power3.inOut" }, 0.78);

            // Escrow modal slides up into the space
            tl.to(escrowModalRef.current, { y: 200, opacity: 1, duration: 0.1, ease: "power3.out" }, 0.8);

            // Stamp checkmark slams down
            tl.fromTo(payoutStampRef.current,
                { opacity: 0, scale: 3, rotation: 15 },
                { opacity: 1, scale: 1, rotation: -5, duration: 0.08, ease: "bounce.out" },
                0.85
            );

        }, sectionRef);

        return () => ctx.revert();
    }, []);

    // Helper for dot styling
    const getDotStyle = (stepNum: number) => {
        const isActive = activePillar >= stepNum;
        return {
            borderColor: isActive ? '#10b981' : 'rgba(255,255,255,0.1)',
            backgroundColor: isActive ? '#0a0a0a' : 'transparent',
            color: isActive ? '#10b981' : 'rgba(255,255,255,0.3)',
            boxShadow: isActive ? '0 0 15px rgba(16,185,129,0.3)' : 'none'
        };
    };

    return (
        <div ref={sectionRef} className="relative w-full h-screen bg-[#050505] font-display overflow-hidden">
            {/* Viewport Container (Pinned) */}
            <div className="w-full h-full flex items-center max-w-[90rem] mx-auto px-4 md:px-12 xl:px-20 pt-20">

                {/* 1. Left Side: Narrative Texts (z-20) */}
                <div className="w-full md:w-5/12 h-[400px] relative z-20 flex flex-col justify-center">

                    {/* Phase 1 Text */}
                    <div ref={text1Ref} className="absolute inset-x-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold flex items-center gap-2">
                            <Users className="w-4 h-4" /> 01. The Expert Marketplace
                        </p>
                        <h2 className="font-black text-[clamp(2rem,3vw,3.5rem)] leading-[1.05] tracking-tight text-white mb-6">
                            ELITE TALENT.<br />ON DEMAND.
                        </h2>
                        <p className="text-white/40 text-lg leading-[1.6] max-w-md">
                            Access a curated network of top-tier engineering talent. Our unified marketplace lets you launch personalized outreach sequences with a single click.
                        </p>
                    </div>

                    {/* Phase 2 Text */}
                    <div ref={text2Ref} className="absolute inset-x-0 opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4" /> 02. The Trust Layer
                        </p>
                        <h2 className="font-black text-[clamp(2rem,3vw,3.5rem)] leading-[1.05] tracking-tight text-white mb-6">
                            VERIFIED.<br />INVINCIBLE.
                        </h2>
                        <p className="text-white/40 text-lg leading-[1.6] max-w-md">
                            No more fake profiles. Every expert undergoes rigorous OCR credential verification and live technical assessment before joining the network.
                        </p>
                    </div>

                    {/* Phase 3 Text */}
                    <div ref={text3Ref} className="absolute inset-x-0 opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold flex items-center gap-2">
                            <Video className="w-4 h-4" /> 03. Integrated Video Hub
                        </p>
                        <h2 className="font-black text-[clamp(2rem,3vw,3.5rem)] leading-[1.05] tracking-tight text-white mb-6">
                            SEE THEM<br />SOLVE IT.
                        </h2>
                        <p className="text-white/40 text-lg leading-[1.6] max-w-md">
                            Dynamically generate technical questions based on the candidate's exact profile. Review their asynchronous video answers within the platform.
                        </p>
                    </div>

                    {/* Phase 4 Text */}
                    <div ref={text4Ref} className="absolute inset-x-0 opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold flex items-center gap-2">
                            <CreditCard className="w-4 h-4" /> 04. Escrow Logic
                        </p>
                        <h2 className="font-black text-[clamp(2rem,3vw,3.5rem)] leading-[1.05] tracking-tight text-white mb-6">
                            AUTOMATED<br />TRUST.
                        </h2>
                        <p className="text-white/40 text-lg leading-[1.6] max-w-md">
                            Smart contracts handle the money. Payouts are held in escrow and released automatically only when the detailed technical scorecard is uploaded and approved.
                        </p>
                    </div>
                </div>

                {/* 2. Center: The Layered UI Stage (z-10) */}
                <div className="hidden md:flex w-6/12 h-full items-center justify-center relative z-10 [perspective:2000px]">

                    {/* Master Shift Container for Phase 4 upward motion */}
                    <div ref={uiStageRef} className="relative w-full h-full flex items-center justify-center transform-gpu">

                        {/* THE CARD STACK */}
                        {/* Bottom Card (Card 3) */}
                        <div
                            ref={card3Ref}
                            className="absolute z-0 w-[380px] h-[460px] rounded-2xl bg-[#0a0a0a] border border-white/5 opacity-0 transform-gpu"
                        />
                        {/* Middle Card (Card 2) */}
                        <div
                            ref={card2Ref}
                            className="absolute z-10 w-[380px] h-[460px] rounded-2xl bg-[#0e0e0e] border border-white/10 opacity-0 transform-gpu shadow-xl"
                        />

                        {/* Top Card (Card 1) - Has the 3D Flip */}
                        <div
                            ref={card1ContainerRef}
                            className="absolute z-20 w-[380px] h-[460px] opacity-0 transform-gpu"
                            style={{ perspective: "1500px" }}
                        >
                            <div
                                ref={card1InnerRef}
                                className="relative w-full h-full [transform-style:preserve-3d]"
                            >
                                {/* Front of Card (Outreach Panel) */}
                                <div className="absolute inset-0 w-full h-full p-8 rounded-2xl bg-[#141414] border border-white/10 shadow-2xl flex flex-col [backface-visibility:hidden]">
                                    <div className="flex items-center gap-4 mb-8 pb-8 border-b border-white/10">
                                        <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-500/20 to-emerald-900 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-2xl">JD</div>
                                        <div>
                                            <h3 className="text-white font-bold text-xl">Jane Doe</h3>
                                            <p className="text-white/50 text-base">Principal ML Engineer</p>
                                            <div className="flex gap-2 mt-3">
                                                <span className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">Available</span>
                                                <span className="px-2 py-1 text-xs bg-white/5 text-white/60 rounded border border-white/10">99% Match</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4 mt-auto">
                                        <button className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 transition-colors text-black font-bold text-lg rounded-xl flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                                            <Send className="w-5 h-5" /> Sequence Outreach
                                        </button>
                                        <button className="w-full py-4 bg-white/5 text-white font-medium text-lg rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
                                            View Full Profile
                                        </button>
                                    </div>
                                </div>

                                {/* Back of Card (Verification OCR Data) */}
                                <div className="absolute inset-0 w-full h-full p-8 rounded-2xl bg-gradient-to-b from-[#111] to-[#0a1f16] border border-emerald-500/30 shadow-[0_0_50px_rgba(16,185,129,0.15)] flex flex-col items-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
                                    <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mb-6 relative">
                                        <BadgeCheck className="w-12 h-12 text-emerald-400" />
                                        <div className="absolute -bottom-2 -right-4 bg-emerald-500 text-black text-[10px] font-bold px-3 py-1 rounded">VERIFIED</div>
                                    </div>
                                    <h3 className="text-white font-bold text-2xl mb-2">Identity Confirmed</h3>
                                    <p className="text-emerald-400/80 text-sm mb-8 flex items-center gap-1 font-mono">
                                        <ShieldCheck className="w-4 h-4" /> OCR Matching Passed
                                    </p>

                                    <div className="w-full space-y-3 mt-auto">
                                        <div className="flex justify-between items-center bg-white/5 p-4 rounded-lg border border-white/10">
                                            <span className="text-white/60 text-sm">Gov ID Scan</span>
                                            <CheckCircle className="w-5 h-5 text-emerald-500" />
                                        </div>
                                        <div className="flex justify-between items-center bg-white/5 p-4 rounded-lg border border-white/10">
                                            <span className="text-white/60 text-sm">Live Selfie Check</span>
                                            <CheckCircle className="w-5 h-5 text-emerald-500" />
                                        </div>
                                        <div className="flex justify-between items-center bg-white/5 p-4 rounded-lg border border-white/10">
                                            <span className="text-white/60 text-sm">Work History sync</span>
                                            <CheckCircle className="w-5 h-5 text-emerald-500" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ====== PHASE 3 UI: Video Hub (Slides in from right) ====== */}
                        <div
                            ref={videoFrameRef}
                            className="absolute z-30 w-[380px] rounded-2xl overflow-hidden bg-black border border-white/20 shadow-2xl opacity-0 transform-gpu"
                        >
                            {/* Video Player Mockup */}
                            <div className="aspect-video relative bg-gradient-to-br from-zinc-800 to-[#111] flex items-center justify-center border-b border-white/10">
                                <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center pl-2 backdrop-blur shadow-[0_0_30px_rgba(16,185,129,0.5)] cursor-pointer hover:scale-105 transition-transform">
                                    <Play className="w-6 h-6 text-black" fill="currentColor" />
                                </div>
                                <div className="absolute top-4 left-4 text-xs bg-black/60 px-2 py-1 rounded text-white font-mono flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> 04:12 REC
                                </div>
                            </div>
                            <div className="p-4 bg-[#141414]">
                                <h4 className="text-white font-semibold text-sm mb-1">Jane Doe - System Design </h4>
                                <p className="text-white/40 text-xs">Assessing PostgreSQL latency optimization</p>
                            </div>
                        </div>

                        {/* Dynamic Questions (Under Video) */}
                        <div
                            ref={questionsContainerRef}
                            className="absolute z-30 w-[380px] flex flex-col gap-3 opacity-0 transform-gpu"
                        >
                            <div className="w-full p-4 rounded-xl bg-[#1a1a1a] border border-emerald-500/30 shadow-lg relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
                                <p className="text-[10px] text-emerald-400 font-mono mb-1 ml-2">Q1. DYNAMICALLY GENERATED</p>
                                <p className="text-white text-sm ml-2">"Explain how you optimized the PostgreSQL query latency at Stripe."</p>
                            </div>
                            <div className="w-full p-4 rounded-xl bg-[#141414] border border-white/10 shadow-lg ml-4 opacity-50">
                                <p className="text-[10px] text-white/50 font-mono mb-1">Q2. PROFILE MATCH</p>
                                <p className="text-white text-sm line-clamp-1">"Walk me through your system design for the microservices..."</p>
                            </div>
                        </div>

                        {/* ====== PHASE 4 UI: Escrow Logic ====== */}
                        <div
                            ref={escrowModalRef}
                            className="absolute z-40 w-[600px] p-8 rounded-2xl bg-[#0f0f0f] border border-white/10 shadow-[0_40px_80px_rgba(0,0,0,0.8)] opacity-0 transform-gpu"
                        >
                            <div className="flex items-center gap-4 mb-8 border-b border-white/10 pb-6">
                                <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center">
                                    <FileText className="w-6 h-6 text-indigo-400" />
                                </div>
                                <div>
                                    <h4 className="text-white text-lg font-bold">Technical Scorecard Validated</h4>
                                    <p className="text-white/40 text-sm font-mono mt-1">ID: SC-8921-A • Hash: 0x9f...2a4c</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-6 mb-8">
                                <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                    <div className="text-white/50 text-xs mb-2">System Design</div>
                                    <div className="text-2xl font-display text-white mb-2">9.2<span className="text-white/30 text-base">/10</span></div>
                                    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 w-[92%]" /></div>
                                </div>
                                <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                    <div className="text-white/50 text-xs mb-2">Code Quality</div>
                                    <div className="text-2xl font-display text-white mb-2">8.8<span className="text-white/30 text-base">/10</span></div>
                                    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 w-[88%]" /></div>
                                </div>
                                <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                    <div className="text-white/50 text-xs mb-2">Communication</div>
                                    <div className="text-2xl font-display text-white mb-2">9.5<span className="text-white/30 text-base">/10</span></div>
                                    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 w-[95%]" /></div>
                                </div>
                            </div>

                            <div className="w-full p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <CreditCard className="w-5 h-5 text-emerald-400" />
                                    <div>
                                        <div className="text-white font-bold text-sm">Escrow Funds Released</div>
                                        <div className="text-emerald-400/80 text-xs font-mono">Transferring $12,500.00 to Expert Wallet</div>
                                    </div>
                                </div>
                                <span className="text-emerald-400 text-sm font-bold animate-pulse">Processing...</span>
                            </div>

                            {/* The Stamp */}
                            <div
                                ref={payoutStampRef}
                                className="absolute -top-6 -right-6 z-50 bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 px-6 py-4 rounded-2xl shadow-[0_0_50px_rgba(16,185,129,0.3)] backdrop-blur-md flex items-center gap-3 opacity-0 transform-gpu"
                            >
                                <ListChecks className="w-8 h-8" />
                                <div>
                                    <div className="text-[10px] font-mono tracking-widest text-emerald-500/80 mb-0.5">SMART CONTRACT</div>
                                    <div className="text-xl font-black tracking-tight leading-none text-emerald-400">PAYOUT RELEASED</div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* 3. Right Side: Progress Indicator (z-30) */}
                <div className="hidden md:flex w-1/12 h-full flex-col items-center justify-center relative z-30">
                    <div className="relative h-[300px] w-[2px] bg-white/10 rounded-full py-4 flex flex-col justify-between items-center">

                        {/* The Pulse that moves down */}
                        <div
                            ref={progressPulseRef}
                            className="absolute left-1/2 -translate-x-1/2 w-[2px] h-12 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] -translate-y-full rounded-full z-0"
                        />

                        {/* 1, 2, 3, 4 Dots */}
                        {[
                            { ref: dot1Ref, val: "01" },
                            { ref: dot2Ref, val: "02" },
                            { ref: dot3Ref, val: "03" },
                            { ref: dot4Ref, val: "04" },
                        ].map((dot, i) => (
                            <div
                                key={i}
                                ref={dot.ref}
                                className="relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center font-mono text-[10px] font-bold transition-all duration-300 bg-[#050505]"
                                style={getDotStyle(i + 1)}
                            >
                                {dot.val}
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
}
