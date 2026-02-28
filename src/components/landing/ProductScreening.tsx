import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { GyroTilt } from '../shared/GyroTilt';

gsap.registerPlugin(ScrollTrigger);

const steps = [
    { num: 1, title: 'Define the role', desc: 'Job title, company, description' },
    { num: 2, title: 'Set requirements', desc: 'Experience, education, skills, salary' },
    { num: 3, title: 'Generate link', desc: 'Share with candidates or post anywhere' },
    { num: 4, title: 'AI screens everyone', desc: 'Automatic scoring against your ICP' },
];

const ProductScreening = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const mockupRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const lineRef = useRef<HTMLDivElement>(null);
    const [activeStep, setActiveStep] = useState(0);
    const [typedTitle, setTypedTitle] = useState('');
    const [typedCompany, setTypedCompany] = useState('');
    const [typedDesc, setTypedDesc] = useState('');
    const [showToast, setShowToast] = useState(false);
    const [btnGlow, setBtnGlow] = useState(false);

    const fullTitle = 'Senior Frontend Engineer';
    const fullCompany = 'Acme Corp';
    const fullDesc = "We're looking for a senior engineer who...";

    useEffect(() => {
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
            masterTL.add(() => {
                setTimeout(() => {
                    let i = 0;
                    const titleInt = setInterval(() => {
                        setTypedTitle(fullTitle.slice(0, i + 1)); i++; if (i >= fullTitle.length) {
                            clearInterval(titleInt);
                            let j = 0; setTimeout(() => {
                                const compInt = setInterval(() => {
                                    setTypedCompany(fullCompany.slice(0, j + 1)); j++; if (j >= fullCompany.length) {
                                        clearInterval(compInt);
                                        let k = 0; setTimeout(() => {
                                            const descInt = setInterval(() => {
                                                setTypedDesc(fullDesc.slice(0, k + 1)); k++; if (k >= fullDesc.length) {
                                                    clearInterval(descInt);
                                                    setBtnGlow(true); setTimeout(() => { setBtnGlow(false); setShowToast(true); setTimeout(() => setShowToast(false), 2500); }, 600);
                                                }
                                            }, 35);
                                        }, 200);
                                    }
                                }, 50);
                            }, 200);
                        }
                    }, 35);
                }, 1200);
            }, 0.8);
            const tags = mockupRef.current?.querySelectorAll('.req-tag');
            if (tags) { tags.forEach((tag, i) => { masterTL.fromTo(tag, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, 1.2 + i * 0.1); }); }
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    const cursor = <span className="animate-pulse text-emerald-400 font-light">|</span>;

    return (
        <section ref={sectionRef} className="relative px-4 py-28 md:py-36 overflow-hidden">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
                    <div ref={textRef} className="flex-[45] opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ AI Job Screening</p>
                        <h2 className="font-display font-black text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.03em] text-white mb-5">
                            CREATE A SCREENING<br />IN 60 SECONDS
                        </h2>
                        <p className="text-white/40 text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Configure your role, set requirements, and generate a shareable AI-screening link. Our engine handles the rest — reading, scoring, and ranking every applicant automatically.
                        </p>
                        <div className="relative pl-4">
                            <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-white/[0.06]" />
                            <div ref={lineRef} className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-emerald-500 origin-top" style={{ transform: 'scaleY(0)' }} />
                            {steps.map((step) => (
                                <div key={step.num} className="flex items-start gap-4 py-3.5 relative">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 z-10 transition-all duration-500 ${activeStep >= step.num ? 'bg-emerald-600 text-white shadow-[0_0_16px_rgba(5,150,105,0.4)] scale-110' : 'bg-white/[0.06] text-white/30 scale-100'
                                        }`}>{step.num}</div>
                                    <div className={`transition-all duration-500 ${activeStep >= step.num ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-[20px]'}`}>
                                        <p className="font-semibold text-sm text-white">{step.title}</p>
                                        <p className="text-xs text-white/30 mt-0.5">{step.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div ref={mockupRef} className="flex-[55] opacity-0 relative">
                        <div className={`absolute -top-3 right-4 z-20 bg-emerald-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-[0_8px_24px_rgba(5,150,105,0.3)] transition-all duration-500 ${showToast ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-90'}`}>
                            ✓ Screening link created!
                        </div>
                        <GyroTilt intensity={8} contentClassName="rounded-xl overflow-hidden glow-green border border-white/[0.06] bg-[#0a0a0a]">
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
                                            {typedTitle}{typedTitle.length > 0 && typedTitle.length < fullTitle.length && cursor}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/30 font-medium mb-1 block">Company Name *</label>
                                        <div className="border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white min-h-[36px] bg-white/[0.03]">
                                            {typedCompany}{typedTitle.length >= fullTitle.length && typedCompany.length > 0 && typedCompany.length < fullCompany.length && cursor}
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
                                    <button className={`w-full text-white text-xs font-semibold py-2.5 rounded-lg mt-2 transition-all duration-500 ${btnGlow ? 'bg-emerald-500 shadow-[0_0_24px_rgba(5,150,105,0.5)] scale-[1.02]' : 'bg-emerald-600'
                                        }`}>Generate Screening Link →</button>
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
