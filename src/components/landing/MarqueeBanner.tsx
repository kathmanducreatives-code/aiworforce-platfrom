const row1 = '5 DEPARTMENTS · 15 AGENTS · 1 COMPANY BRAIN ◆ YOUR ENTIRE AI WORKFORCE FOR €149/MONTH ◆ ';
const row2 = 'TALENT · GROWTH · CONTENT · INTELLIGENCE · COMMAND ◆ SET UP IN 10 MINUTES ◆ CANCEL ANYTIME ◆ ';

const MarqueeBanner = () => (
    <section className="py-12 md:py-16 overflow-hidden border-y border-white/5 bg-galaxy-void/80 backdrop-blur-sm">
        <div className="overflow-hidden whitespace-nowrap mb-4">
            <div className="ticker-track">
                {[...Array(6)].map((_, i) => (
                    <span key={i} className="font-mono text-[10px] font-black tracking-[0.3em] text-accent-mint uppercase px-8 opacity-40 hover:opacity-100 transition-opacity duration-500">{row1}</span>
                ))}
            </div>
        </div>
        <div className="overflow-hidden whitespace-nowrap">
            <div className="ticker-track" style={{ animationDirection: 'reverse' }}>
                {[...Array(6)].map((_, i) => (
                    <span key={i} className="font-mono text-[10px] font-black tracking-[0.3em] text-accent-mint uppercase px-8 opacity-20 hover:opacity-80 transition-opacity duration-500">{row2}</span>
                ))}
            </div>
        </div>
    </section>
);

export default MarqueeBanner;