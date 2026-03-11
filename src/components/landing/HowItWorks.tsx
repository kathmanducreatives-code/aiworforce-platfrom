import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ClipboardList, Target, Bot, Trophy } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const steps = [
    { icon: ClipboardList, time: '30 sec', title: 'Paste One Profile', desc: "Drop in the LinkedIn URL of your ideal candidate. That's your seed." },
    { icon: Target, time: '15 min', title: 'AI Finds Everyone', desc: 'The engine analyzes their career trajectory, skills, industry, and seniority — then finds every similar professional on LinkedIn. 200, 1,000, even 2,000+ matches.' },
    { icon: Bot, time: 'Instant', title: 'Ranked & Revealed', desc: 'Every match is ranked by score. Emails are revealed. You see the entire talent market for that role.' },
    { icon: Trophy, time: 'Automated', title: 'Outreach on Autopilot', desc: 'Personalized email sequences go out automatically. You focus on interviewing, not sourcing.' },
];

const HowItWorks = () => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const [activeStep, setActiveStep] = useState(0);

    useEffect(() => {
        const ctx = gsap.context(() => {
            ScrollTrigger.create({
                trigger: sectionRef.current,
                start: 'top 60%',
                end: 'bottom 40%',
                onUpdate: (self) => {
                    const step = Math.min(4, Math.floor(self.progress * 5));
                    setActiveStep(step);
                },
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative bg-background px-4 py-28 md:py-36">
            <div className="max-w-5xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.25em] mb-4 text-primary font-semibold text-center">
                    ◆ How It Works
                </p>
                <h2 className="font-sans font-extrabold text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.05] tracking-[-0.03em] text-foreground text-center mb-16">
                    FROM ONE LINKEDIN PROFILE TO 2,000<br />RANKED CANDIDATES. IN 15 MINUTES.
                </h2>

                {/* Desktop */}
                <div className="hidden md:block">
                    <div className="relative">
                        <div className="absolute top-6 left-[calc(12.5%)] right-[calc(12.5%)] h-[2px] bg-muted" />
                        <div className="absolute top-6 left-[calc(12.5%)] h-[2px] bg-primary transition-all duration-700 ease-out" style={{ width: `${Math.min(100, (activeStep / 3) * 75)}%` }} />
                        <div className="grid grid-cols-4 gap-6 relative z-10">
                            {steps.map((step, i) => (
                                <div key={i} className="flex flex-col items-center text-center">
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-all duration-500 ${activeStep > i ? 'bg-primary shadow-[0_0_20px_rgba(16,185,129,0.3)]' : activeStep === i ? 'bg-primary/15 border-2 border-primary' : 'bg-muted'
                                        }`}>
                                        <step.icon className={`w-5 h-5 transition-colors duration-300 ${activeStep > i ? 'text-white' : activeStep === i ? 'text-primary' : 'text-muted-foreground'}`} />
                                    </div>
                                    <span className={`font-mono text-[10px] uppercase tracking-wider mb-2 font-bold transition-colors duration-300 ${activeStep >= i ? 'text-primary' : 'text-muted-foreground/40'
                                        }`}>{step.time}</span>
                                    <h3 className={`font-sans font-bold text-sm mb-2 transition-colors duration-300 ${activeStep >= i ? 'text-foreground' : 'text-muted-foreground'}`}>{step.title}</h3>
                                    <p className={`text-xs leading-relaxed transition-colors duration-300 ${activeStep >= i ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}>{step.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Mobile */}
                <div className="md:hidden space-y-0 relative">
                    <div className="absolute left-6 top-0 bottom-0 w-[2px] bg-muted" />
                    <div className="absolute left-6 top-0 w-[2px] bg-primary transition-all duration-700" style={{ height: `${Math.min(100, (activeStep / 4) * 100)}%` }} />
                    {steps.map((step, i) => (
                        <div key={i} className="flex gap-5 py-5 relative">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 z-10 transition-all duration-500 ${activeStep > i ? 'bg-primary' : 'bg-muted'}`}>
                                <step.icon className={`w-5 h-5 ${activeStep > i ? 'text-white' : 'text-muted-foreground'}`} />
                            </div>
                            <div>
                                <span className="font-mono text-[10px] text-primary uppercase tracking-wider font-bold">{step.time}</span>
                                <h3 className="font-sans font-bold text-sm text-foreground mb-1">{step.title}</h3>
                                <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default HowItWorks;