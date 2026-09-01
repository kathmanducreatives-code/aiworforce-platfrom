const row1 = 'RESEARCH · LEADS · SIGNALS · CONTENT · OUTREACH · RECRUITING · MONITORING ◆ ONE PLACE ◆ ';
const row2 = 'AI EMPLOYEES FOR YOUR BUSINESS ◆ ONE COMPANY BRAIN ◆ SET UP IN MINUTES ◆ CANCEL ANYTIME ◆ ';

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