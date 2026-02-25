const ticker1 = 'REPLACE YOUR AGENCY ◆ €149/MONTH UNLIMITED ◆ 2,000+ CANDIDATES IN 15 MIN ◆ ZERO PER-HIRE FEES ◆ AI-POWERED SOURCING ◆ ';
const ticker2 = 'SAVE €80,000+/YEAR ◆ 70% LESS SOURCING TIME ◆ AUTOMATED OUTREACH ◆ RANKED MATCH SCORES ◆ FULL RECRUITING OS ◆ ';

const MarqueeBanner = () => {
    return (
        <div className="bg-white border-y border-zinc-100 py-5 overflow-hidden">
            <div className="mb-2 overflow-hidden">
                <div className="ticker-track font-mono text-sm tracking-[0.15em] whitespace-nowrap text-emerald-600 uppercase font-medium">
                    <span>{ticker1.repeat(8)}</span>
                    <span>{ticker1.repeat(8)}</span>
                </div>
            </div>
            <div className="overflow-hidden">
                <div className="font-mono text-sm tracking-[0.15em] whitespace-nowrap text-emerald-300 uppercase font-medium flex" style={{ animation: 'ticker-scroll-reverse 45s linear infinite' }}>
                    <span>{ticker2.repeat(8)}</span>
                    <span>{ticker2.repeat(8)}</span>
                </div>
            </div>
        </div>
    );
};

export default MarqueeBanner;
