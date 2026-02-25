const ticker1 = 'TIME REDUCED 94% ◆ BUILT FOR SAAS FOUNDERS ◆ ICP LOOKALIKE ENGINE ◆ 300 CVS IN 8 MINUTES ◆ ';
const ticker2 = 'AGENCY FEES ELIMINATED ◆ BLIND SCORING ◆ BEHAVIORAL DNA MAPPING ◆ 8 MINUTE SHORTLISTS ◆ ZERO BIAS HIRING ◆ ';

const MarqueeBanner = () => {
    return (
        <div className="bg-white border-y border-zinc-100 py-5 overflow-hidden">
            {/* Row 1 — left to right */}
            <div className="mb-2 overflow-hidden">
                <div className="ticker-track font-mono text-sm tracking-[0.15em] whitespace-nowrap text-emerald-600 uppercase font-medium">
                    <span>{ticker1.repeat(8)}</span>
                    <span>{ticker1.repeat(8)}</span>
                </div>
            </div>
            {/* Row 2 — right to left */}
            <div className="overflow-hidden">
                <div
                    className="font-mono text-sm tracking-[0.15em] whitespace-nowrap text-emerald-300 uppercase font-medium flex"
                    style={{ animation: 'ticker-scroll-reverse 45s linear infinite' }}
                >
                    <span>{ticker2.repeat(8)}</span>
                    <span>{ticker2.repeat(8)}</span>
                </div>
            </div>
        </div>
    );
};

export default MarqueeBanner;
