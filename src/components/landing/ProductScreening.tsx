import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { GyroTilt } from '../shared/GyroTilt';
import { X, Loader2, Link as LinkIcon } from 'lucide-react';

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
    const mockupRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const lineRef = useRef<HTMLDivElement>(null);

    // Interactive State
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

        const ctx = gsap.context(() => {
            const masterTL = gsap.timeline({
                scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', toggleActions: 'play none none none' },
            });
            masterTL.fromTo(mockupRef.current, { opacity: 0, x: -80, rotateY: 5, scale: 0.92, filter: 'blur(10px)' }, {
                opacity: 1, x: 0, rotateY: 0, scale: 1, filter: 'blur(0px)', duration: 1.2, ease: 'expo.out',
            }, 0);
            masterTL.fromTo(textRef.current, { opacity: 0, y: 40, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.0, ease: 'expo.out' }, 0.15);
            if (lineRef.current) {
                masterTL.fromTo(lineRef.current, { scaleY: 0 }, { scaleY: 1, duration: 1.4, ease: 'power3.out' }, 0.6);
            }
            masterTL.add(() => {
                steps.forEach((_, idx) => { setTimeout(() => setActiveStep(idx + 1), idx * 350); });
            }, 0.7);

            // Tags pop in
            const tagEls = mockupRef.current?.querySelectorAll('.req-tag');
            if (tagEls) {
                tagEls.forEach((tag, i) => { masterTL.fromTo(tag, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, 1.0 + i * 0.1); });
            }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    const handleGenerate = () => {
        if (isGenerating || showToast) return;
        setIsGenerating(true);
        setActiveStep(3); // Update progress to "Generate link"
        setTimeout(() => {
            setIsGenerating(false);
            setBtnGlow(true);
            setShowToast(true);
            setActiveStep(4); // Advance to final step
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
                    <div ref={textRef} className="flex-[45] scr-text opacity-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/40 bg-transparent mb-6 opacity-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            <span className="font-mono text-[11px] uppercase tracking-[2px] text-primary font-semibold mt-px">AI JOB SCREENING</span>
                        </div>
                        <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.0] tracking-[-0.04em] text-white mb-5">
                            CREATE A SCREENING<br />IN 60 SECONDS
                        </h2>
                        <p className="text-white/60 text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Configure your role, set requirements, and generate a shareable AI-screening link. Our engine handles the rest — reading, scoring, and ranking every applicant automatically. Try the form!
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
                                        <p className="text-[10px] text-white/40 font-medium mb-3 uppercase tracking-wider">Requirements</p>
                                        <div className="flex flex-wrap gap-2">
                                            {tags.map((r) => (
                                                <div key={r} onClick={() => removeTag(r)} className="req-tag group cursor-pointer bg-emerald-500/10 hover:bg-red-500/10 hover:border-red-500/30 border border-emerald-500/20 rounded-md px-2.5 py-1.5 text-[10px] text-emerald-400 font-medium transition-colors flex items-center gap-1.5">
                                                    {r}
                                                    <X className="w-3 h-3 opacity-50 group-hover:text-red-400 group-hover:opacity-100" />
                                                </div>
                                            ))}
                                            <button className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] rounded-md px-3 py-1.5 text-[10px] text-white/50 font-medium transition-colors border-dashed" onClick={() => setTags([...tags, 'New Requirement'])}>
                                                + Add Requirement
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleGenerate}
                                        disabled={isGenerating || showToast || !title || !company}
                                        className={`w-full h-[44px] flex items-center justify-center gap-2 text-white text-[14px] font-[600] rounded-full mt-2 transition-all duration-300 ${btnGlow ? 'bg-emerald-500 shadow-[0_0_24px_rgba(5,150,105,0.5)] scale-[1.02] text-black' :
                                            isGenerating ? 'bg-emerald-600/50 cursor-not-allowed' :
                                                'bg-[#00C853] hover:bg-emerald-500 hover:shadow-[0_4px_16px_rgba(5,150,105,0.4)]'
                                            }`}>
                                        {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating AI Link...</> :
                                            showToast ? 'Link Generated!' : 'Generate Screening Link →'}
                                    </button>
                                </div>
                            </div>
                        </GyroTilt>
                    </div>
                </div>
            </div>
        </section >
    );
};

export default ProductScreening;
