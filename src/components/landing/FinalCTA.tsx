import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const FinalCTA = () => {
    const navigate = useNavigate();
    const sectionRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(contentRef.current, { opacity: 0, y: 40 }, {
                opacity: 1, y: 0, duration: 0.8, ease: 'power3.out',
                scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', toggleActions: 'play none none none' },
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section
            ref={sectionRef}
            className="relative px-4 py-28 md:py-36 overflow-hidden"
            style={{
                background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 30%, #a7f3d0 70%, #6ee7b7 100%)',
            }}
        >
            {/* Decorative orb */}
            <div
                className="absolute w-[500px] h-[500px] rounded-full bg-emerald-400/10 blur-[100px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            />

            <div ref={contentRef} className="max-w-3xl mx-auto text-center relative z-10 opacity-0">
                <h2 className="font-sans font-extrabold text-[clamp(2rem,5vw,4rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 mb-6">
                    READY TO FIRE YOUR<br />RECRUITING AGENCY?
                </h2>
                <p className="font-sans text-lg text-zinc-600 mb-10 max-w-xl mx-auto">
                    Join 200+ SaaS companies that have eliminated agency dependency with ScreeningPilot.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button
                        onClick={() => navigate('/auth')}
                        className="group inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-lg px-8 py-4 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_30px_rgba(5,150,105,0.35)] active:scale-[0.98]"
                    >
                        Start Free Trial
                        <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                    </button>
                    <button
                        onClick={() => navigate('/get-demo')}
                        className="inline-flex items-center gap-3 bg-transparent border-2 border-emerald-600 text-emerald-700 font-semibold text-lg px-8 py-4 rounded-full transition-all duration-300 hover:bg-emerald-600 hover:text-white hover:scale-[1.03] active:scale-[0.98]"
                    >
                        Book a Demo
                    </button>
                </div>

                <p className="text-sm text-zinc-500 mt-6 font-medium">
                    No credit card required · Setup in 5 minutes · Cancel anytime
                </p>
            </div>
        </section>
    );
};

export default FinalCTA;
