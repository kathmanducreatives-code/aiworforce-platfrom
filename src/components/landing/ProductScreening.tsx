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

    const fullTitle = 'Senior Frontend Engineer';
    const fullCompany = 'Acme Corp';
    const fullDesc = "We're looking for a senior engineer who...";

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Mirror of page 1 — mockup from LEFT
            gsap.fromTo(mockupRef.current, {
                opacity: 0, x: -80, rotateY: 4,
            }, {
                opacity: 1, x: 0, rotateY: 0, duration: 0.8, ease: 'expo.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', toggleActions: 'play none none none' },
            });

            // Text from right
            gsap.fromTo(textRef.current, { opacity: 0, y: 40 }, {
                opacity: 1, y: 0, duration: 0.6, ease: 'expo.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
            });

            // Step line draws down (scaleY 0→1)
            if (lineRef.current) {
                gsap.fromTo(lineRef.current, { scaleY: 0 }, {
                    scaleY: 1, duration: 1.2, ease: 'power3.out',
                    scrollTrigger: { trigger: sectionRef.current, start: 'top 50%', toggleActions: 'play none none none' },
                });
            }

            // Steps activate as line draws
            ScrollTrigger.create({
                trigger: sectionRef.current,
                start: 'top 50%',
                onEnter: () => {
                    steps.forEach((_, idx) => {
                        setTimeout(() => setActiveStep(idx + 1), 300 + idx * 300);
                    });

                    // Typewriter after steps complete
                    setTimeout(() => {
                        let i = 0;
                        const titleInt = setInterval(() => {
                            setTypedTitle(fullTitle.slice(0, i + 1));
                            i++;
                            if (i >= fullTitle.length) {
                                clearInterval(titleInt);
                                let j = 0;
                                const compInt = setInterval(() => {
                                    setTypedCompany(fullCompany.slice(0, j + 1));
                                    j++;
                                    if (j >= fullCompany.length) {
                                        clearInterval(compInt);
                                        let k = 0;
                                        const descInt = setInterval(() => {
                                            setTypedDesc(fullDesc.slice(0, k + 1));
                                            k++;
                                            if (k >= fullDesc.length) {
                                                clearInterval(descInt);
                                                // Show toast after typing
                                                setTimeout(() => setShowToast(true), 600);
                                                setTimeout(() => setShowToast(false), 3000);
                                            }
                                        }, 40);
                                    }
                                }, 60);
                            }
                        }, 40);
                    }, 1800);
                },
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    const cursor = <span className="animate-pulse text-emerald-500 font-light">|</span>;

    return (
        <section ref={sectionRef} className="relative bg-white px-4 py-28 md:py-36 overflow-hidden">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
                    {/* Right — Text */}
                    <div ref={textRef} className="flex-[45] opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-600 font-semibold">
                            ◆ AI Job Screening
                        </p>
                        <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.1] tracking-[-0.03em] text-zinc-950 mb-5">
                            CREATE A SCREENING<br />IN 60 SECONDS
                        </h2>
                        <p className="text-[#4b5563] text-base md:text-lg leading-[1.7] mb-8 max-w-[480px]">
                            Configure your role, set requirements, and generate a shareable AI-screening link. Our engine handles the rest — reading, scoring, and ranking every applicant automatically.
                        </p>

                        {/* Step flow with connecting line */}
                        <div className="relative pl-4">
                            <div className="absolute left-[15px] top-3 bottom-3 w-[2px] bg-zinc-100" />
                            <div ref={lineRef} className="absolute left-[15px] top-3 bottom-3 w-[2px] bg-emerald-500 origin-top" style={{ transform: 'scaleY(0)' }} />
                            {steps.map((step) => (
                                <div key={step.num} className="flex items-start gap-4 py-3 relative">
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 z-10 transition-all duration-500 ${activeStep >= step.num
                                            ? 'bg-emerald-600 text-white shadow-[0_0_12px_rgba(5,150,105,0.3)]'
                                            : 'bg-zinc-100 text-zinc-400'
                                        }`}>
                                        {step.num}
                                    </div>
                                    <div className={`transition-all duration-400 ${activeStep >= step.num ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-[15px]'}`}>
                                        <p className="font-semibold text-sm text-zinc-900">{step.title}</p>
                                        <p className="text-xs text-zinc-400">{step.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Left — Browser Mockup */}
                    <div ref={mockupRef} className="flex-[55] opacity-0 relative" style={{ perspective: '1200px' }}>
                        {/* Toast notification */}
                        <div className={`absolute -top-2 right-4 z-20 bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-lg transition-all duration-500 ${showToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
                            ✓ Screening link created!
                        </div>

                        <div className="rounded-xl overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.06),0_0_100px_rgba(5,150,105,0.06)] border border-zinc-200/50">
                            <div className="bg-[#1f2937] px-4 py-2.5 flex items-center gap-3">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
                                    <div className="w-3 h-3 rounded-full bg-[#eab308]" />
                                    <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
                                </div>
                                <div className="flex-1 text-center">
                                    <span className="text-xs text-zinc-400 bg-zinc-700/50 rounded-md px-3 py-1">app.screeningpilot.com</span>
                                </div>
                            </div>

                            <div className="bg-white p-6">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-sm font-bold text-zinc-900">Create New Screening</h3>
                                    <div className="flex gap-4 text-[10px] text-zinc-400">
                                        <span>Total Applicants: <strong className="text-zinc-700">348</strong></span>
                                        <span>Active Jobs: <strong className="text-zinc-700">5</strong></span>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-zinc-400 font-medium mb-1 block">Job Title *</label>
                                        <div className="border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 min-h-[36px] bg-zinc-50/50">
                                            {typedTitle}{typedTitle.length < fullTitle.length && cursor}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-400 font-medium mb-1 block">Company Name *</label>
                                        <div className="border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 min-h-[36px] bg-zinc-50/50">
                                            {typedCompany}{typedTitle.length >= fullTitle.length && typedCompany.length < fullCompany.length && cursor}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-400 font-medium mb-1 block">Job Description</label>
                                        <div className="border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-600 min-h-[60px] bg-zinc-50/50">
                                            {typedDesc || <span className="text-zinc-300">Describe the role...</span>}
                                            {typedCompany.length >= fullCompany.length && typedDesc.length < fullDesc.length && cursor}
                                        </div>
                                    </div>
                                    <div className="border-t border-zinc-100 pt-4">
                                        <p className="text-[10px] text-zinc-400 font-medium mb-3">Requirements</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            {['Experience: 5+ years', 'Education: BS CS', 'Skills: React, TypeScript', 'Salary: $120-160K'].map((r) => (
                                                <div key={r} className="bg-emerald-50/50 border border-emerald-100 rounded-md px-3 py-1.5 text-[10px] text-emerald-700">{r}</div>
                                            ))}
                                        </div>
                                    </div>
                                    <button className={`w-full text-white text-xs font-semibold py-2.5 rounded-lg mt-2 transition-all duration-500 ${showToast ? 'bg-emerald-700 scale-[0.98]' : 'bg-emerald-600'}`}>
                                        Generate Screening Link →
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="h-8 bg-gradient-to-b from-zinc-200/20 to-transparent rounded-b-xl" />
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductScreening;
