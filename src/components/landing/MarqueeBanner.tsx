const row1 = '5 DEPARTMENTS · 15 AGENTS · 1 COMPANY BRAIN ◆ YOUR ENTIRE AI WORKFORCE FOR €149/MONTH ◆ ';
const row2 = 'TALENT · GROWTH · CONTENT · INTELLIGENCE · COMMAND ◆ SET UP IN 10 MINUTES ◆ CANCEL ANYTIME ◆ ';

const MarqueeBanner = () => (
    <section className="py-8 overflow-hidden border-y border-white/[0.04]">
        <div className="overflow-hidden whitespace-nowrap mb-2">
            <div className="ticker-track">
                {[...Array(4)].map((_, i) => (
                    <span key={i} className="font-mono text-xs tracking-[0.15em] text-emerald-400/40 uppercase px-2">{row1}</span>
                ))}
            </div>
        </div>
        <div className="overflow-hidden whitespace-nowrap">
            <div className="ticker-track" style={{ animationDirection: 'reverse' }}>
                {[...Array(4)].map((_, i) => (
                    <span key={i} className="font-mono text-xs tracking-[0.15em] text-emerald-400/40 uppercase px-2">{row2}</span>
                ))}
            </div>
        </div>
    </section>
);

export default MarqueeBanner;