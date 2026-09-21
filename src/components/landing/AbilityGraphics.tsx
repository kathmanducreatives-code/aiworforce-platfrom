import { useId, type ReactNode, type CSSProperties } from 'react';

function Graphic({ color, label, children }: { color: string; label: string; children: ReactNode }) {
  const id = useId().replace(/:/g, '');
  return <svg className="ability-graphic" viewBox="0 0 560 360" role="img" aria-label={label} style={{ '--ability-accent': color } as CSSProperties}>
    <defs>
      <radialGradient id={id}><stop stopColor={color} stopOpacity=".1" /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient>
    </defs>
    <ellipse cx="280" cy="185" rx="280" ry="170" fill={`url(#${id})`} />
    {children}
    <style>{`
      .ability-graphic { width:100%; height:100%; min-height:0; align-self:center; overflow:visible; font-family:'Geist',sans-serif; }
      .ability-graphic .ag-surface { fill:#10171b; stroke:#ffffff19; stroke-width:1; }
      .ability-graphic .ag-front { fill:#151e23; stroke:#ffffff29; stroke-width:1; filter:drop-shadow(0 12px 15px #0005); }
      .ability-graphic text { fill:#dce5eb; font-size:12px; font-weight:400; }
      .ability-graphic .ag-label { font-family:'Geist Mono',monospace; font-size:9px; letter-spacing:1.3px; fill:#94a6b3; }
      .ability-graphic .ag-muted { fill:#93a6b2; font-size:11px; }
      .ability-graphic .ag-title { font-size:17px; font-weight:600; letter-spacing:-.5px; }
      .ability-graphic .ag-accent { fill:var(--ability-accent); }
      .ability-graphic .ag-line { fill:none; stroke:#ffffff16; }
      .ability-graphic .ag-wire { fill:none; stroke:var(--ability-accent); stroke-opacity:.3; stroke-width:1; }
      .ability-graphic .ag-flow { fill:none; stroke:var(--ability-accent); stroke-width:2; stroke-dasharray:8 220; animation:ag-flow 8s linear infinite; }
      .ability-graphic .ag-result { animation:ag-result 8s ease-in-out infinite; }
      .ability-graphic .ag-late { animation-delay:.6s; }
      .ability-graphic .ag-later { animation-delay:1.2s; }
      .ability-graphic .ag-pulse { animation:ag-pulse 8s ease-in-out infinite; }
      .ability-graphic .ag-scan { animation:ag-scan 8s ease-in-out infinite; }
      @keyframes ag-flow { 0% { stroke-dashoffset:230; } 45%,100% { stroke-dashoffset:0; } }
      @keyframes ag-result { 0%,100% { opacity:.82; transform:translateY(3px); } 20%,85% { opacity:1; transform:translateY(0); } }
      @keyframes ag-pulse { 0%,65%,100% { opacity:.35; } 30%,45% { opacity:1; } }
      @keyframes ag-scan { 0% { transform:translateX(0); opacity:0; } 8% { opacity:.65; } 55%,100% { transform:translateX(210px); opacity:0; } }
      @media(prefers-reduced-motion:reduce) { .ability-graphic * { animation:none!important; } .ability-graphic .ag-flow,.ability-graphic .ag-scan { display:none; } }
    `}</style>
  </svg>;
}

function Surface({ x, y, w, h, front = false }: { x: number; y: number; w: number; h: number; front?: boolean }) {
  return <rect x={x} y={y} width={w} height={h} rx="12" className={front ? 'ag-front' : 'ag-surface'} />;
}

export function LisaGraphic() {
  return <Graphic color="#5bd6a2" label="Lisa filters pricing, hiring and funding sources into verified alerts, including a 20 percent pricing change.">
    <text x="20" y="38" className="ag-label">MARKET INPUTS</text><text x="317" y="38" className="ag-label">SIGNALS THAT MATTER</text>
    {['Pricing pages', 'Hiring activity', 'Funding news', 'Product updates'].map((s, i) => <g key={s}>
      <Surface x={16} y={65 + i * 54} w={143} h={38} /><circle cx="32" cy={84 + i * 54} r="3" fill="#5bd6a2" opacity={.8 - i * .12} /><text x="44" y={88 + i * 54}>{s}</text>
      <path d={`M159 ${84 + i * 54} H176 Q188 ${84 + i * 54} 188 ${96 + i * 38} V173 H207`} className="ag-wire" />
    </g>)}
    <path d="M159 84 H176 Q188 84 188 96 V173 H207 M259 173 H277 Q290 173 290 150 V105 H310" className="ag-flow" />
    <rect x="205" y="142" width="56" height="62" rx="18" fill="#102d24" stroke="#5bd6a255" />
    <path d="M220 162 H246 L237 174 V186 L229 182 V174 Z" fill="none" stroke="#88e6bb" strokeWidth="1.5" />
    <text x="233" y="225" textAnchor="middle" className="ag-label">FILTER</text>
    <path d="M261 173 H287 V105 H311 M287 173 V225 H311 M287 225 V284 H311" className="ag-wire" />
    <g className="ag-result"><Surface x={309} y={62} w={234} h={124} front /><text x="326" y="84" className="ag-label">ASHBY · PRICING</text><text x="326" y="112" className="ag-title">A move worth watching.</text><text x="326" y="143" className="ag-muted">$100</text><path d="M325 138 H354" stroke="#94a6b3" /><text x="366" y="143" className="ag-muted">→</text><text x="389" y="144" className="ag-title">$80</text><rect x="451" y="124" width="73" height="27" rx="6" fill="#5bd6a218" /><text x="464" y="142" className="ag-accent">↓ 20%</text><text x="326" y="170" className="ag-muted">Verified change · just detected</text></g>
    {[['GREENHOUSE', '+6 engineering hires'], ['PERSONIO', '14 sales roles opened']].map(([name, result], i) => <g key={name} className={`ag-result ${i ? 'ag-later' : 'ag-late'}`}><Surface x={309} y={201 + i * 61} w={234} h={50} /><text x="325" y={220 + i * 61} className="ag-label">{name}</text><text x="325" y={238 + i * 61}>{result}</text><circle cx="523" cy={225 + i * 61} r="3" fill="#5bd6a2" /></g>)}
    <text x="20" y="332" className="ag-muted">The noise stays here.</text><text x="317" y="332" className="ag-muted">The important changes reach you.</text>
  </Graphic>;
}

export function AtlasGraphic() {
  const uid = useId().replace(/:/g, '');
  return <Graphic color="#edb85b" label="Atlas discovers companies, qualifies Acme AI with a 94 percent fit score, and enriches its decision-maker profile.">
    <defs>
      <linearGradient id={`${uid}-card`} x2="1" y2="1"><stop stopColor="#1d2427" /><stop offset="1" stopColor="#0e1418" /></linearGradient>
      <radialGradient id={`${uid}-radar`}><stop stopColor="#edb85b" stopOpacity=".12" /><stop offset="1" stopColor="#edb85b" stopOpacity="0" /></radialGradient>
    </defs>
    <g className="atlas-refined">
      {[['01', 'Discover'], ['02', 'Qualify'], ['03', 'Enrich']].map(([n, t], i) => <g key={n}>
        <circle cx={29 + i * 182} cy="25" r="10" fill="#edb85b12" stroke="#edb85b35" />
        <text x={29 + i * 182} y="28" textAnchor="middle" className="ag-accent" style={{ fontSize: 8 }}>{n}</text>
        <text x={47 + i * 182} y="29" style={{ fontSize: 11 }}>{t}</text>
        {i < 2 && <path d={`M${108 + i * 182} 25 H${179 + i * 182}`} className="ag-line" />}
      </g>)}
      <circle cx="128" cy="181" r="115" fill={`url(#${uid}-radar)`} />
      {[36, 69, 101].map(r => <circle key={r} cx="128" cy="181" r={r} fill="none" stroke="#edb85b" strokeOpacity={r === 101 ? .19 : .1} />)}
      <path d="M20 181 H236 M128 73 V289" stroke="#edb85b12" />
      <g className="atlas-radar-sweep"><path d="M128 181 L128 80 A101 101 0 0 1 209 121 Z" fill="#edb85b0b" /><path d="M128 181 V80" stroke="#edb85b60" /></g>
      {Array.from({ length: 26 }, (_, i) => {
        const angle = i * 2.4, r = 24 + Math.sqrt(i / 26) * 69;
        return <circle key={i} cx={128 + Math.cos(angle) * r} cy={181 + Math.sin(angle) * r} r={i % 6 === 0 ? 3 : 1.8} fill={i % 6 === 0 ? '#edb85b' : '#91a1a5'} opacity={i % 6 === 0 ? .75 : .3} />;
      })}
      <rect x="17" y="83" width="87" height="24" rx="5" fill="#121b1e" stroke="#ffffff12" /><circle cx="28" cy="95" r="2.5" fill="#edb85b" /><text x="37" y="99" className="ag-muted" style={{ fontSize: 9 }}>Market discovery</text>
      <circle cx="160" cy="161" r="21" fill="#edb85b0b" stroke="#edb85b25" className="ag-pulse" /><circle cx="160" cy="161" r="13" fill="#191d1c" stroke="#edb85b90" /><circle cx="160" cy="161" r="4.5" fill="#f4cc81" />
      <path d="M174 161 H210 Q220 161 220 151 V131 Q220 121 230 121 H258" className="ag-wire" /><path d="M174 161 H210 Q220 161 220 151 V131 Q220 121 230 121 H258" className="ag-flow" />
      <rect x="75" y="207" width="106" height="29" rx="6" fill="#111a1d" stroke="#edb85b35" /><text x="88" y="225" style={{ fontSize: 10 }}>Acme AI</text><text x="168" y="225" textAnchor="end" className="ag-accent" style={{ fontSize: 9 }}>94%</text>
      <text x="128" y="312" textAnchor="middle" className="ag-label" style={{ fontSize: 8 }}>YOUR IDEAL CUSTOMER, FOUND.</text>
      <g className="atlas-profile">
        <rect x="266" y="66" width="277" height="270" rx="14" fill="#0b1013" stroke="#ffffff09" />
        <rect x="258" y="59" width="285" height="273" rx="14" fill={`url(#${uid}-card)`} stroke="#ffffff26" />
        <path d="M275 59 H526" stroke="#e7c38c45" />
        <rect x="275" y="77" width="34" height="34" rx="10" fill="#edb85b13" stroke="#edb85b25" />
        <path d="M284 101 L292 85 L300 101 M288 96 H296" fill="none" stroke="#f0c77e" strokeWidth="1.8" strokeLinejoin="round" />
        <text x="320" y="92" className="ag-title">Acme AI</text><text x="320" y="109" className="ag-muted" style={{ fontSize: 10 }}>B2B software · Series A</text>
        <circle cx="523" cy="90" r="4" fill="#edb85b" /><circle cx="523" cy="90" r="8" fill="none" stroke="#edb85b25" />
        <rect x="275" y="125" width="251" height="65" rx="8" fill="#edb85b08" stroke="#edb85b18" />
        <text x="287" y="146" className="ag-label" style={{ fontSize: 8 }}>IDEAL CUSTOMER FIT</text><text x="287" y="172" style={{ fontSize: 15, fontWeight: 500 }}>An exceptional match.</text>
        <circle cx="497" cy="157" r="21" fill="none" stroke="#edb85b18" strokeWidth="3" /><circle cx="497" cy="157" r="21" fill="none" stroke="#edb85b" strokeWidth="3" strokeDasharray="124 132" transform="rotate(-90 497 157)" strokeLinecap="round" />
        <text x="497" y="162" textAnchor="middle" className="ag-accent" style={{ fontSize: 15, fontWeight: 500 }}>94<tspan style={{ fontSize: 8 }}>%</tspan></text>
        {[['Company fit', 'B2B SaaS · 20–200'], ['Buying signal', 'Hiring Head of Sales'], ['Evidence', 'Hiring activity verified']].map(([label, value], i) => <g key={label} className="atlas-evidence" style={{ animationDelay: `${1 + i * .3}s` }}>
          <text x="276" y={211 + i * 24} className="ag-muted" style={{ fontSize: 9 }}>{label}</text><text x="513" y={211 + i * 24} textAnchor="end" style={{ fontSize: 10 }}>{value}</text><path d={`M520 ${207 + i * 24} l2 2 4 -5`} fill="none" stroke="#edb85b" strokeWidth="1.1" />
        </g>)}
        <path d="M275 274 H526" className="ag-line" />
        <circle cx="290" cy="299" r="13" fill="#c8d4df0b" stroke="#ffffff12" /><text x="290" y="302" textAnchor="middle" style={{ fontSize: 8 }}>SC</text><text x="312" y="295" style={{ fontSize: 11 }}>Sarah Chen</text><text x="312" y="310" className="ag-muted" style={{ fontSize: 9 }}>VP Growth</text>
        <rect x="463" y="290" width="64" height="21" rx="5" fill="#edb85b0e" stroke="#edb85b23" /><text x="495" y="304" textAnchor="middle" className="ag-accent" style={{ fontSize: 8 }}>Enriched ✓</text>
      </g>
    </g>
    <style>{`
      .atlas-radar-sweep { transform-origin:128px 181px; animation:atlas-orbit 12s linear infinite; }
      .atlas-profile { filter:drop-shadow(0 12px 18px #0006); }
      .atlas-evidence { animation:atlas-evidence 9s ease-in-out infinite; }
      @keyframes atlas-orbit { to { transform:rotate(360deg); } }
      @keyframes atlas-evidence { 0%,100% { opacity:.65; } 20%,85% { opacity:1; } }
      @media(prefers-reduced-motion:reduce) { .atlas-radar-sweep,.atlas-evidence { animation:none; } }
    `}</style>
  </Graphic>;
}

export function LyraGraphic() {
  return <Graphic color="#7baeff" label="Lyra turns company knowledge into a LinkedIn draft, a carousel, and a blog, ready for review.">
    <text x="20" y="34" className="ag-label">COMPANY KNOWLEDGE → CONTENT</text>
    {['Market insights', 'Your point of view', 'Brand voice'].map((s, i) => <g key={s}><Surface x={18} y={69 + i * 49} w={140} h={34} /><text x="31" y={90 + i * 49}>{s}</text></g>)}
    <path d="M158 85 H175 V119 H198 M158 134 H175 M158 183 H175 V119" className="ag-wire" /><path d="M158 85 H175 V119 H198" className="ag-flow" />
    <g className="ag-result"><Surface x={197} y={61} w={344} h={174} front /><rect x="214" y="79" width="24" height="24" rx="5" fill="#7baeff25" /><text x="221" y="96" className="ag-accent" style={{ fontWeight: 600 }}>in</text><text x="249" y="89">Your company</text><text x="249" y="105" className="ag-muted">LinkedIn · draft</text><text x="519" y="93" textAnchor="end" className="ag-label">01 / 04</text>
      <text x="216" y="137" className="ag-title">Your next hire shouldn't</text><text x="216" y="158" className="ag-title">be another browser tab.</text><text x="216" y="181" className="ag-muted">Give the research a home. Give the work an owner.</text><path d="M215 195 H522" className="ag-line" /><text x="216" y="216" className="ag-accent" style={{ fontSize: 10 }}>✓ Brand voice applied</text><text x="521" y="216" textAnchor="end" className="ag-muted">Ready for review</text>
    </g>
    <path d="M368 235 V248 H280 V259 M368 248 H459 V259" className="ag-wire" />
    <g className="ag-result ag-late"><Surface x={197} y={258} w={162} h={79} /><rect x="207" y="268" width="43" height="59" rx="5" fill="#253b60" /><text x="214" y="281" className="ag-label" style={{ fontSize: 7 }}>01—05</text><text x="213" y="299" style={{ fontSize: 9 }}>Less</text><text x="213" y="310" style={{ fontSize: 9 }}>busywork.</text><text x="261" y="285">Carousel</text><text x="261" y="305" className="ag-muted">5 slides</text><text x="261" y="321" className="ag-accent" style={{ fontSize: 9 }}>Same insight.</text></g>
    <g className="ag-result ag-later"><Surface x={375} y={258} w={166} h={79} /><text x="391" y="280" className="ag-label">FROM THE BLOG</text><text x="391" y="300">A better way to work</text><text x="391" y="320" className="ag-muted">4 min read · draft</text></g>
    <text x="21" y="244" className="ag-muted">One idea.</text><text x="21" y="261" className="ag-muted">Every format.</text>
  </Graphic>;
}

export function OrionGraphic() {
  return <Graphic color="#bb9aff" label="Orion combines Lisa, Atlas and Lyra's reports into three ranked priorities and a recommended next action.">
    {[['LISA', 'Market signals'], ['ATLAS', 'Priority accounts'], ['LYRA', 'Content drafts']].map(([name, type], i) => <g key={name} className={`ag-result ${i === 1 ? 'ag-late' : i === 2 ? 'ag-later' : ''}`}><Surface x={27 + i * 173} y={17} w={159} h={48} /><circle cx={42 + i * 173} cy="34" r="3" fill={['#5bd6a2', '#edb85b', '#7baeff'][i]} /><text x={52 + i * 173} y="37" className="ag-label">{name}</text><text x={41 + i * 173} y="54" className="ag-muted">{type}</text><path d={`M${106 + i * 173} 65 V79 H280 V95`} className="ag-wire" /></g>)}
    <g className="ag-result ag-late"><Surface x={37} y={95} w={486} h={250} front /><text x="57" y="119" className="ag-label">YOUR MORNING BRIEF</text><text x="502" y="119" textAnchor="end" className="ag-muted">07:00 · 3 min read</text><text x="57" y="150" className="ag-title" style={{ fontSize: 23 }}>The day, in perspective.</text><text x="57" y="171" className="ag-muted">Three priorities. A clear next move.</text>
      {[["Competitor pricing changed", 'LISA', 'Review'], ['7 priority accounts active', 'ATLAS', 'Opportunity'], ['Pricing POV ready', 'LYRA', 'Approve']].map(([title, source, tag], i) => <g key={source}><path d={`M57 ${186 + i * 32} H502`} className="ag-line" /><text x="58" y={207 + i * 32} className="ag-accent" style={{ fontSize: 10 }}>0{i + 1}</text><text x="81" y={207 + i * 32}>{title}</text><text x="381" y={207 + i * 32} className="ag-label" style={{ fontSize: 8 }}>{source}</text><text x="502" y={207 + i * 32} textAnchor="end" className="ag-muted" style={{ fontSize: 9 }}>{tag}</text></g>)}
      <rect x="53" y="288" width="454" height="42" rx="7" fill="#bb9aff12" stroke="#bb9aff35" /><text x="66" y="304" className="ag-label ag-accent" style={{ fontSize: 8 }}>RECOMMENDED NEXT ACTION</text><text x="66" y="321">Contact your top 3 accounts today</text><text x="485" y="316" className="ag-accent">↗</text>
    </g>
  </Graphic>;
}
