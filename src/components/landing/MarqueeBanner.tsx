const row1 = 'AUTOMATE 90% OF YOUR HIRING ◆ FILTER OUT 95% OF UNQUALIFIED APPLICANTS ◆ GENERATE INTERVIEW BLUEPRINTS INSTANTLY ◆ ';
const row2 = 'FIND THE TOP 1% TALENT FOR YOUR COMPANY ◆ ACCESS EXPERT INTERVIEWERS ON DEMAND ◆ NO PER-HIRE AGENCY FEES ◆ ';

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
