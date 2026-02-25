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
    const [activeStep, setActiveStep] = useState(0);
    const [typedTitle, setTypedTitle] = useState('');
    const [typedCompany, setTypedCompany] = useState('');

    const fullTitle = 'Senior Frontend Engineer';
    const fullCompany = 'Acme Corp';

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(mockupRef.current, { opacity: 0, x: -80 }, {
                opacity: 1, x: 0, duration: 1, ease: 'power3.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 65%', toggleActions: 'play none none none' },
            });
            gsap.fromTo(textRef.current, { opacity: 0, x: 40 }, {
                opacity: 1, x: 0, duration: 0.8, ease: 'power3.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
            });

            // Typewriter effect
            ScrollTrigger.create({
                trigger: sectionRef.current,
                start: 'top 50%',
                onEnter: () => {
                    let i = 0;
                    const titleInterval = setInterval(() => {
                        setTypedTitle(fullTitle.slice(0, i + 1));
                        i++;
                        if (i >= fullTitle.length) {
                            clearInterval(titleInterval);
                            // Start company name
                            let j = 0;
                            const companyInterval = setInterval(() => {
                                setTypedCompany(fullCompany.slice(0, j + 1));
                                j++;
                                if (j >= fullCompany.length) clearInterval(companyInterval);
                            }, 60);
                        }
                    }, 50);

                    // Step indicators
                    steps.forEach((_, idx) => {
                        setTimeout(() => setActiveStep(idx + 1), 1500 + idx * 800);
                    });
                },
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-white px-4 py-28 md:py-36 overflow-hidden">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
                    {/* Right — Text */}
                    <div ref={textRef} className="flex-[4] opacity-0">
                        <p className="font-mono text-xs uppercase tracking-[0.25em] mb-4 text-emerald-600 font-semibold">
                            ◆ AI Job Screening
                        </p>
                        <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 mb-5">
                            CREATE A SCREENING<br />IN 60 SECONDS
                        </h2>
                        <p className="text-zinc-500 text-base md:text-lg leading-relaxed mb-8 max-w-md">
                            Configure your role, set requirements, and generate a shareable AI-screening link. Our engine handles the rest.
                        </p>

                        {/* Step flow */}
                        <div className="space-y-0 relative">
                            <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-zinc-100" />
                            {steps.map((step) => (
                                <div key={step.num} className="flex items-start gap-4 py-3 relative">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 z-10 transition-all duration-500 ${activeStep >= step.num
                                            ? 'bg-emerald-600 text-white shadow-[0_0_12px_rgba(5,150,105,0.3)]'
                                            : 'bg-zinc-100 text-zinc-400'
                                        }`}>
                                        {step.num}
                                    </div>
                                    <div>
                                        <p className={`font-semibold text-sm transition-colors duration-300 ${activeStep >= step.num ? 'text-zinc-900' : 'text-zinc-400'}`}>
                                            {step.title}
                                        </p>
                                        <p className="text-xs text-zinc-400">{step.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Left — Browser Mockup */}
                    <div ref={mockupRef} className="flex-[6] opacity-0" style={{ perspective: '1200px' }}>
                        <div className="rounded-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.1),0_8px_20px_rgba(0,0,0,0.05)] border border-zinc-200/50">
                            {/* Title bar */}
                            <div className="bg-zinc-800 px-4 py-2.5 flex items-center gap-3">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-400" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                                    <div className="w-3 h-3 rounded-full bg-green-400" />
                                </div>
                                <div className="flex-1 text-center">
                                    <span className="text-xs text-zinc-400 bg-zinc-700/50 rounded-md px-3 py-1">
                                        app.screeningpilot.com/screening
                                    </span>
                                </div>
                            </div>

                            {/* Screening UI */}
                            <div className="bg-white p-6">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-sm font-bold text-zinc-900">Create New Screening</h3>
                                    <div className="flex gap-4 text-[10px] text-zinc-400">
                                        <span>Total Applicants: <strong className="text-zinc-700">348</strong></span>
                                        <span>Active Jobs: <strong className="text-zinc-700">5</strong></span>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {/* Job Title */}
                                    <div>
                                        <label className="text-[10px] text-zinc-400 font-medium mb-1 block">Job Title *</label>
                                        <div className="border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 min-h-[36px] bg-zinc-50/50">
                                            {typedTitle}<span className="animate-pulse text-emerald-500">|</span>
                                        </div>
                                    </div>

                                    {/* Company Name */}
                                    <div>
                                        <label className="text-[10px] text-zinc-400 font-medium mb-1 block">Company Name *</label>
                                        <div className="border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 min-h-[36px] bg-zinc-50/50">
                                            {typedCompany}{typedTitle.length >= fullTitle.length && <span className="animate-pulse text-emerald-500">|</span>}
                                        </div>
                                    </div>

                                    {/* Job Description */}
                                    <div>
                                        <label className="text-[10px] text-zinc-400 font-medium mb-1 block">Job Description</label>
                                        <div className="border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-400 min-h-[60px] bg-zinc-50/50">
                                            Describe the role, responsibilities, and ideal candidate...
                                        </div>
                                    </div>

                                    {/* Requirements */}
                                    <div className="border-t border-zinc-100 pt-4">
                                        <p className="text-[10px] text-zinc-400 font-medium mb-3">Requirements</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            {['Experience: 5+ years', 'Education: BS CS', 'Skills: React, TypeScript', 'Salary: $120-160K'].map((r) => (
                                                <div key={r} className="bg-emerald-50/50 border border-emerald-100 rounded-md px-3 py-1.5 text-[10px] text-emerald-700">
                                                    {r}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Generate button */}
                                    <button className="w-full bg-emerald-600 text-white text-xs font-semibold py-2.5 rounded-lg mt-2">
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
