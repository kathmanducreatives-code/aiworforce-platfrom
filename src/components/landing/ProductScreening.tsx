import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { GyroTilt } from '../shared/GyroTilt';
import { X, Loader2, Link as LinkIcon } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const steps = [
    { num: 1, title: 'Paste your job description', desc: 'Title, requirements, salary — takes 30 seconds' },
    { num: 2, title: 'AI generates screening criteria', desc: 'Custom questions + scoring rubric built automatically' },
    { num: 3, title: 'Share the screening link', desc: 'Candidates apply through your branded AI link' },
    { num: 4, title: 'AI rejects 95% of bad fits', desc: 'Only top candidates reach your inbox' },
];

const fullTitle = 'Senior Frontend Engineer';
const fullCompany = 'Acme Corp';
const fullDesc = "We're looking for a senior engineer with strong React fundamentals and a deep understanding of system architecture...";

const ProductScreening = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const mockupRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const lineRef = useRef<HTMLDivElement>(null);

    const [activeStep, setActiveStep] = useState(0);
    const [title, setTitle] = useState('Senior Frontend Engineer');
    const [company, setCompany] = useState('Acme Corp');
    const [desc, setDesc] = useState("We're looking for a senior engineer with strong React fundamentals and a deep understanding of system architecture...");
    const [tags, setTags] = useState(['Experience: 5+ yr', 'Edu: BS CS', 'React / TS', 'Salary: $120K+']);

    const [isGenerating, setIsGenerating] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [btnGlow, setBtnGlow] = useState(false);

    useEffect(() => {
        const section = sectionRef.current;
        if (!section) return;
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let lastStep = 0;
        let lastTitle = '';
        let lastCompany = '';
        let lastDesc = '';
        let lastGenerating = false;
        let lastToast = false;
        let lastGlow = false;

        const typedValue = (source: string, progress: number, start: number, end: number) => {
            if (progress <= start) return '';
            if (progress >= end) return source;
            const ratio = (progress - start) / (end - start);
            const count = Math.max(1, Math.round(source.length * ratio));
            return source.slice(0, count);
        };

        const ctx = gsap.context(() => {
            gsap.set('.scr-line-fill', { scaleY: 0, transformOrigin: 'top top' });
            gsap.set('.scr-step-row', { opacity: prefersReduced ? 1 : 0.35, x: prefersReduced ? 0 : 28 });
            gsap.set('.req-tag', { opacity: prefersReduced ? 1 : 0, scale: prefersReduced ? 1 : 0.92, y: prefersReduced ? 0 : 10 });
            gsap.set('.scr-badge', { opacity: prefersReduced ? 1 : 0, y: prefersReduced ? 0 : 18 });
            gsap.set('.scr-headline, .scr-subtext', { opacity: prefersReduced ? 1 : 0, y: prefersReduced ? 0 : 40, filter: prefersReduced ? 'none' : 'blur(8px)' });

            const masterTL = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top top',
                    end: '+=1850',
                    pin: true,
                    scrub: prefersReduced ? false : 1.1,
                    anticipatePin: 1,
                    fastScrollEnd: true,
                    onUpdate: (self) => {
                        const p = self.progress;
                        const stepProgress = [0.17, 0.4, 0.64, 0.85];
                        let nextStep = 1;
                        if (p >= stepProgress[3]) nextStep = 4;
                        else if (p >= stepProgress[2]) nextStep = 3;
                        else if (p >= stepProgress[1]) nextStep = 2;

                        if (nextStep !== lastStep) {
                            setActiveStep(nextStep);
                            lastStep = nextStep;
                        }

                        const typedTitle = typedValue(fullTitle, p, 0.08, 0.35);
                        const typedCompany = typedValue(fullCompany, p, 0.18, 0.48);
                        const typedDesc = typedValue(fullDesc, p, 0.26, 0.74);

                        if (typedTitle !== lastTitle) { setTitle(typedTitle); lastTitle = typedTitle; }
                        if (typedCompany !== lastCompany) { setCompany(typedCompany); lastCompany = typedCompany; }
                        if (typedDesc !== lastDesc) { setDesc(typedDesc); lastDesc = typedDesc; }

                        const shouldGenerate = p >= 0.74 && p < 0.89;
                        const shouldToast = p >= 0.89;
                        const shouldGlow = p >= 0.9;

                        if (shouldGenerate !== lastGenerating) { setIsGenerating(shouldGenerate); lastGenerating = shouldGenerate; }
                        if (shouldToast !== lastToast) { setShowToast(shouldToast); lastToast = shouldToast; }
                        if (shouldGlow !== lastGlow) { setBtnGlow(shouldGlow); lastGlow = shouldGlow; }
                    }
                },
            });

            masterTL.fromTo('.scr-power-line', { height: '0%' }, { height: '100%', duration: 11, ease: 'none' }, 0);
            masterTL.fromTo(mockupRef.current, { opacity: 0, x: -120, rotateY: 8, scale: 0.9, filter: 'blur(10px)' }, {
                opacity: 1, x: 0, rotateY: 0, scale: 1, filter: 'blur(0px)', duration: 2.2, ease: 'expo.out',
            }, 0);
            masterTL.to('.scr-badge', { opacity: 1, y: 0, duration: 1, ease: 'power2.out' }, 0.35);
            masterTL.to('.scr-headline, .scr-subtext', { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, stagger: 0.18, ease: 'power3.out' }, 0.45);
            masterTL.to(textRef.current, { opacity: 1, duration: 0.4, ease: 'none' }, 0.5);
            if (lineRef.current) {
                masterTL.to(lineRef.current, { scaleY: 1, duration: 3.8, ease: 'none' }, 1.0);
            }
            masterTL.to('.scr-step-row', { opacity: 1, x: 0, duration: 1.8, stagger: 0.28, ease: 'power3.out' }, 1.05);
            masterTL.to('.req-tag', { opacity: 1, scale: 1, y: 0, duration: 0.8, stagger: 0.1, ease: 'back.out(1.8)' }, 2.8);
            masterTL.fromTo('.scr-generate-btn', { scale: 0.98 }, { scale: 1.03, duration: 0.9, repeat: 1, yoyo: true, ease: 'power2.inOut' }, 6.8);
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    const handleGenerate = () => {
        if (isGenerating || showToast) return;
        setIsGenerating(true);
        setActiveStep(3);
        setTimeout(() => {
            setIsGenerating(false);
            setBtnGlow(true);
            setShowToast(true);
            setActiveStep(4);
            setTimeout(() => setBtnGlow(false), 600);
            setTimeout(() => setShowToast(false), 3500);
        }, 1500);
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(t => t !== tagToRemove));
    };

    return (
        <section
            ref={sectionRef}
            className="relative w-full h-screen overflow-hidden font-display"
            style={{ background: '#000000' }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: `linear-gradient(rgba(34,197,94,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.07) 1px, transparent 1px)`,
                backgroundSize: '100px 100px',
            }} />

            <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-emerald-500/10 z-[5] pointer-events-none">
                <div className="scr-power-line relative w-full bg-emerald-500" style={{ height: '0%', boxShadow: '0 0 12px rgba(34,197,94,0.8), 0 0 24px rgba(34,197,94,0.4)' }}>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_20px_4px_rgba(34,197,94,0.8)] animate-ping" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,1)]" />
                </div>
            </div>

            <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex items-center">
                <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16 w-full">

                    {/* RIGHT: Text + Steps */}
                    <div ref={textRef} className="flex-[45] scr-text opacity-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/40 bg-transparent mb-6 opacity-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            <span className="font-mono text-[11px] uppercase tracking-[2px] text-primary font-semibold mt-px">KILL THE AGENCY MIDDLEMAN</span>
                        </div>
                        <h2 className="scr-headline font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.0] tracking-[-0.04em] text-white mb-5">
                            30 SECONDS TO SET UP.<br />95% OF BAD CANDIDATES GONE.
                        </h2>
                        <p className="scr-subtext text-white/60 text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Paste your job description. AI builds screening criteria, generates your application link, and auto-rejects unqualified candidates. Your agency charges €24K for this.
                        </p>

                        {/* Steps */}
                        <div className="relative pl-4">
                            <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-white/[0.06]" />
                            <div ref={lineRef} className="scr-line-fill absolute left-[15px] top-4 bottom-4 w-[2px] bg-emerald-500 origin-top" style={{ transform: 'scaleY(0)', boxShadow: '0 0 8px rgba(34,197,94,0.4)' }} />

                            {steps.map((step) => (
                                <div key={step.num} className="scr-step-row flex items-start gap-4 py-3.5 relative">
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

                    <div ref={mockupRef} className="flex-[55] opacity-0 relative group">
                        <div className={`absolute -top-3 right-4 z-20 bg-emerald-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-[0_8px_24px_rgba(5,150,105,0.3)] border border-emerald-400/30 flex items-center gap-2 transition-all duration-500 ${showToast ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-90'}`}>
                            <LinkIcon className="w-3.5 h-3.5" /> Screening link copied!
                        </div>

                        <GyroTilt intensity={8} contentClassName="rounded-xl overflow-hidden glow-green border border-border bg-background">
                            <div className="bg-white/[0.03] px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.06]">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-400/60" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
                                    <div className="w-3 h-3 rounded-full bg-green-400/60" />
                                </div>
                                <div className="flex-1 text-center"><span className="text-xs text-white/30 bg-white/5 rounded-md px-3 py-1 select-none">app.screeningpilot.com</span></div>
                            </div>

                            <div className="p-6">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        Create New Screening
                                    </h3>
                                    <div className="flex gap-4 text-[10px] text-white/30">
                                        <span>Draft <strong className="text-white/60">Auto-saved</strong></span>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-white/40 font-medium mb-1.5 block uppercase tracking-wider">Job Title *</label>
                                        <input
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white bg-white/[0.02] focus:bg-white/[0.05] focus:border-emerald-500/50 outline-none transition-all placeholder:text-white/20"
                                            placeholder="e.g. Senior Frontend Engineer"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/40 font-medium mb-1.5 block uppercase tracking-wider">Company Name *</label>
                                        <input
                                            value={company}
                                            onChange={(e) => setCompany(e.target.value)}
                                            className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white bg-white/[0.02] focus:bg-white/[0.05] focus:border-emerald-500/50 outline-none transition-all placeholder:text-white/20"
                                            placeholder="Your Company"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/40 font-medium mb-1.5 block uppercase tracking-wider">Job Description</label>
                                        <textarea
                                            value={desc}
                                            onChange={(e) => setDesc(e.target.value)}
                                            className="w-full border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white/80 min-h-[70px] bg-white/[0.02] focus:bg-white/[0.05] focus:border-emerald-500/50 outline-none transition-all resize-none placeholder:text-white/20"
                                            placeholder="Paste your JD here..."
                                        />
                                    </div>

                                    <div className="border-t border-white/[0.06] pt-4">
                                        <p className="text-[10px] text-white/40 font-medium mb-3 uppercase tracking-wider">Auto-Generated Requirements</p>
                                        <div className="flex flex-wrap gap-2">
                                            {tags.map((r) => (
                                                <div key={r} onClick={() => removeTag(r)} className="req-tag group cursor-pointer bg-emerald-500/10 hover:bg-red-500/10 hover:border-red-500/30 border border-emerald-500/20 rounded-md px-2.5 py-1.5 text-[10px] text-emerald-400 font-medium transition-colors flex items-center gap-1.5">
                                                    {r}
                                                    <X className="w-3 h-3 opacity-50 group-hover:text-red-400 group-hover:opacity-100" />
                                                </div>
                                            ))}
                                            <button className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] rounded-md px-3 py-1.5 text-[10px] text-white/50 font-medium transition-colors border-dashed" onClick={() => setTags([...tags, 'New Requirement'])}>
                                                + Add
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleGenerate}
                                        disabled={isGenerating || showToast || !title || !company}
                                        className={`scr-generate-btn w-full mt-2 rounded-lg py-3 font-bold text-sm tracking-wide text-white transition-all duration-300 flex items-center justify-center gap-2
                                            ${isGenerating ? 'bg-emerald-700 cursor-wait' : showToast ? 'bg-emerald-800 cursor-default' : 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-[0_4px_24px_rgba(5,150,105,0.4)] cursor-pointer'}
                                            ${btnGlow ? 'shadow-[0_0_30px_rgba(5,150,105,0.6)]' : ''}
                                        `}
                                    >
                                        {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> :
                                            showToast ? '✓ Link Ready — Agency Replaced' :
                                                'Generate Screening Link'}
                                    </button>
                                </div>
                            </div>
                        </GyroTilt>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductScreening;
