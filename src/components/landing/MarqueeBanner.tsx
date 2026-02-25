const row1 = 'REPLACE YOUR AGENCY ◆ €149/MONTH UNLIMITED ◆ 2,000+ CANDIDATES IN 15 MIN ◆ ZERO PER-HIRE FEES ◆ ';
const row2 = 'SAVE €80,000+/YEAR ◆ 70% LESS SOURCING TIME ◆ AUTOMATED OUTREACH ◆ FULL RECRUITING OS ◆ ';

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
