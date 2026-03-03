import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const steps = [
    { num: 1, title: 'Define the role', desc: 'Job title, company, description' },
    { num: 2, title: 'Set requirements', desc: 'Experience, education, skills, salary' },
    { num: 3, title: 'Generate link', desc: 'Share with candidates or post anywhere' },
    { num: 4, title: 'AI screens everyone', desc: 'Automatic scoring against your ICP' },
];

const fullTitle = 'Senior Frontend Engineer';
const fullCompany = 'Acme Corp';
const fullDesc = "We're looking for a senior engineer who...";

const ProductScreening = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const [activeStep, setActiveStep] = useState(0);
    const [typedTitle, setTypedTitle] = useState('');
    const [typedCompany, setTypedCompany] = useState('');
    const [typedDesc, setTypedDesc] = useState('');
    const [btnGlow, setBtnGlow] = useState(false);

    useEffect(() => {
        const section = sectionRef.current;
        if (!section) return;

        const ctx = gsap.context(() => {
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: section,
                    start: 'top top',
                    end: '+=2500',
                    pin: true,
                    scrub: 2.5,
                    anticipatePin: 1,
                    onUpdate: (self) => {
                        const p = self.progress;
                        // Step activation at scroll milestones
                        if (p < 0.15) setActiveStep(0);
                        else if (p < 0.25) setActiveStep(1);
                        else if (p < 0.35) setActiveStep(2);
                        else if (p < 0.5) setActiveStep(3);
                        else setActiveStep(4);

                        // Auto-typing synced to scroll progress
                        if (p >= 0.28 && p < 0.5) {
                            const typingProgress = (p - 0.28) / 0.22;
                            const phase1 = Math.min(typingProgress / 0.4, 1);
                            const phase2 = typingProgress > 0.4 ? Math.min((typingProgress - 0.4) / 0.25, 1) : 0;
                            const phase3 = typingProgress > 0.65 ? Math.min((typingProgress - 0.65) / 0.35, 1) : 0;
                            setTypedTitle(fullTitle.slice(0, Math.round(phase1 * fullTitle.length)));
                            setTypedCompany(fullCompany.slice(0, Math.round(phase2 * fullCompany.length)));
                            setTypedDesc(fullDesc.slice(0, Math.round(phase3 * fullDesc.length)));
                        } else if (p < 0.28) {
                            setTypedTitle(''); setTypedCompany(''); setTypedDesc('');
                        }

                        // Button glow at 85%+
                        setBtnGlow(p >= 0.85);
                    }
                }
            });

            // Power line grows from top to bottom
            tl.fromTo('.scr-power-line', { height: '0%' }, { height: '100%', duration: 10, ease: 'none' }, 0);

            // Phase 0: Fly in (0 → 2)
            tl.fromTo('.scr-text', { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 1.5, ease: 'expo.out' }, 0);
            tl.fromTo('.scr-mockup', { opacity: 0, x: -60, scale: 0.92 }, { opacity: 1, x: 0, scale: 1, duration: 2, ease: 'expo.out' }, 0.3);

            // Phase 1: Step line grows (2 → 5)
            tl.fromTo('.scr-line-fill', { scaleY: 0 }, { scaleY: 1, duration: 3, ease: 'power3.out' }, 2);

            // Phase 2: Requirement tags pop in (6 → 8)
            const tags = section.querySelectorAll('.req-tag');
            if (tags) {
                tags.forEach((tag, i) => {
                    tl.fromTo(tag, { opacity: 0, scale: 0 }, {
                        opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)'
                    }, 6 + i * 0.2);
                });
            }

            // Phase 3: Button activation glow (8 → 10)
            tl.fromTo('.scr-btn', { boxShadow: '0 0 0 0 rgba(34,197,94,0)' }, {
                boxShadow: '0 0 30px rgba(34,197,94,0.5)', duration: 1
            }, 8);

        }, section);

        return () => ctx.revert();
    }, []);

    const cursor = <span className="animate-pulse text-emerald-400 font-light">|</span>;

    return (
        <section
            ref={sectionRef}
            className="relative w-full h-screen overflow-hidden font-display"
            style={{ background: '#000000' }}
        >
            {/* Blueprint Grid */}
            <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: `linear-gradient(rgba(34,197,94,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.07) 1px, transparent 1px)`,
                backgroundSize: '100px 100px',
            }} />

            {/* Vertical Power Line */}
            <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-emerald-500/10 z-[5] pointer-events-none">
                <div className="scr-power-line relative w-full bg-emerald-500" style={{ height: '0%', boxShadow: '0 0 12px rgba(34,197,94,0.8), 0 0 24px rgba(34,197,94,0.4)' }}>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_20px_4px_rgba(34,197,94,0.8)] animate-ping" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,1)]" />
                </div>
            </div>

            <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex items-center">
                <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16 w-full">

                    {/* RIGHT: Text + Steps */}
                    <div className="flex-[45] scr-text opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.2em] mb-4 text-emerald-400 font-semibold">◆ AI Job Screening</p>
                        <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.03em] text-white mb-5">
                            CREATE A SCREENING<br />IN 60 SECONDS
                        </h2>
                        <p className="text-white/50 text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Configure your role, set requirements, and generate a shareable AI-screening link. Our engine handles the rest.
                        </p>

                        {/* Steps */}
                        <div className="relative pl-4">
                            <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-white/[0.06]" />
                            <div className="scr-line-fill absolute left-[15px] top-4 bottom-4 w-[2px] bg-emerald-500 origin-top" style={{ transform: 'scaleY(0)', boxShadow: '0 0 8px rgba(34,197,94,0.4)' }} />

                            {steps.map((step) => (
                                <div key={step.num} className="flex items-start gap-4 py-3.5 relative">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 z-10 transition-all duration-500 ${activeStep >= step.num
                                        ? 'bg-emerald-600 text-white shadow-[0_0_16px_rgba(5,150,105,0.5)] scale-110'
                                        : 'bg-white/[0.06] text-white/30 scale-100'
                                        }`}>{step.num}</div>
                                    <div className={`transition-all duration-500 ${activeStep >= step.num ? 'opacity-100 translate-x-0' : 'opacity-30 translate-x-[20px]'}`}>
                                        <p className="font-semibold text-sm text-white">{step.title}</p>
                                        <p className="text-xs text-white/30 mt-0.5">{step.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* LEFT: Mockup */}
                    <div className="flex-[55] scr-mockup opacity-0">
                        <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-[#0a0a0a] shadow-[0_0_60px_rgba(34,197,94,0.08)]">
                            {/* Browser chrome */}
                            <div className="bg-white/[0.03] px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.06]">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-400/60" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
                                    <div className="w-3 h-3 rounded-full bg-green-400/60" />
                                </div>
                                <div className="flex-1 text-center"><span className="text-xs text-white/30 bg-white/5 rounded-md px-3 py-1">app.screeningpilot.com</span></div>
                            </div>

                            <div className="p-6">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-sm font-bold text-white">Create New Screening</h3>
                                    <div className="flex gap-4 text-[10px] text-white/30">
                                        <span>Applicants: <strong className="text-white/60">348</strong></span>
                                        <span>Active: <strong className="text-white/60">5</strong></span>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-white/30 font-medium mb-1 block">Job Title *</label>
                                        <div className="border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white min-h-[36px] bg-white/[0.03]">
                                            {typedTitle || <span className="text-white/15">e.g. Senior Engineer</span>}
                                            {typedTitle.length > 0 && typedTitle.length < fullTitle.length && cursor}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/30 font-medium mb-1 block">Company Name *</label>
                                        <div className="border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white min-h-[36px] bg-white/[0.03]">
                                            {typedCompany || <span className="text-white/15">e.g. Acme Inc</span>}
                                            {typedTitle.length >= fullTitle.length && typedCompany.length > 0 && typedCompany.length < fullCompany.length && cursor}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/30 font-medium mb-1 block">Job Description</label>
                                        <div className="border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/60 min-h-[60px] bg-white/[0.03]">
                                            {typedDesc || <span className="text-white/15">Describe the role...</span>}
                                            {typedCompany.length >= fullCompany.length && typedDesc.length > 0 && typedDesc.length < fullDesc.length && cursor}
                                        </div>
                                    </div>

                                    <div className="border-t border-white/[0.06] pt-4">
                                        <p className="text-[10px] text-white/30 font-medium mb-3">Requirements</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['Experience: 5+ years', 'Education: BS CS', 'Skills: React, TS', 'Salary: $120-160K'].map((r) => (
                                                <div key={r} className="req-tag bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-1.5 text-[10px] text-emerald-400 font-medium opacity-0 scale-0">{r}</div>
                                            ))}
                                        </div>
                                    </div>

                                    <button className={`scr-btn w-full text-white text-xs font-semibold py-2.5 rounded-lg mt-2 transition-all duration-500 ${btnGlow ? 'bg-emerald-500 shadow-[0_0_24px_rgba(5,150,105,0.5)] scale-[1.02]' : 'bg-emerald-600'}`}>
                                        Generate Screening Link →
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductScreening;
