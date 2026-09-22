export type AgentEffectType = 'research' | 'analysis' | 'outreach' | 'content' | 'pipeline';

function ResearchEffect() {
  return <><path className="work-trace" d="M9 20 26 10 43 24M26 10 20 48 8 65M20 48 45 67" />{[[9,20],[26,10],[43,24],[20,48],[8,65]].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />)}<circle className="work-pulse" cx="20" cy="48" r="5" /></>;
}
function AnalysisEffect() {
  return <><g className="work-fragment"><rect x="5" y="12" width="23" height="28" rx="3" /><path d="M10 20h12M10 25h8" /></g><g className="work-fragment work-fragment--later"><rect x="24" y="43" width="23" height="28" rx="3" /><path className="work-trace" d="m30 58 4 4 7-10" /></g></>;
}
function OutreachEffect() {
  return <><path className="work-fragment" d="M5 14h29v19H15l-7 5v-5H5zM11 21h16M11 26h10" /><path className="work-trace" d="M12 44q0 15 24 15" /><path className="work-fragment work-fragment--later" d="M30 51h16v15H30zM34 57h8M34 61h5" /></>;
}
function ContentEffect() {
  return <><rect className="work-fragment" x="7" y="13" width="26" height="33" rx="3" /><rect className="work-fragment work-fragment--later" x="20" y="36" width="26" height="34" rx="3" /><path className="work-trace" d="M12 22h14M12 28h10M25 46h15M25 52h15M25 58h10" /></>;
}
function PipelineEffect() {
  return <><path className="work-trace" d="M11 20v40h27" /><rect x="5" y="13" width="21" height="12" rx="3" /><rect className="work-fragment" x="18" y="34" width="25" height="12" rx="3" /><path className="work-fragment work-fragment--later" d="m31 60 4 4 8-9" /></>;
}
const effects = { research: ResearchEffect, analysis: AnalysisEffect, outreach: OutreachEffect, content: ContentEffect, pipeline: PipelineEffect };
export function AgentWorkEffect({ type }: { type: AgentEffectType }) {
  const Effect = effects[type];
  return <svg className="agent-work-effect" viewBox="0 0 52 80" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><Effect /></svg>;
}
