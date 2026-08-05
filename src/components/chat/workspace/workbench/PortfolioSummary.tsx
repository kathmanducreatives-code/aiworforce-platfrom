import { readPortfolio, STATE_LABEL, type PortfolioView } from '@/lib/workbench/portfolioView';

/**
 * The portfolio, with every number named.
 *
 * Delivered, tiers, qualified, review, watch and contact-ready are genuinely
 * different quantities. The old header showed one "results" figure that meant
 * whichever count was nearest — which is how "0 qualified" got read as "the
 * Brain rejected everything" for a run where the Brain had never executed.
 */
export default function PortfolioSummary({ portfolio }: { portfolio: PortfolioView }) {
  const c = portfolio.counts;
  const cell = (label: string, value: number | string, tone = 'text-[#C9D1D9]') => (
    <div key={label} className="text-[11px] text-[#7D8590]">
      {label} <span className={`${tone} font-medium`}>{value}</span>
    </div>
  );

  return (
    <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] shrink-0">
      <div className="text-[11px] uppercase tracking-wider text-[#7D8590] mb-1.5">
        Opportunity portfolio
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {cell('Requested', portfolio.requested_opportunities)}
        {cell('Delivered', c.delivered)}
        {cell('Tier A', c.tier_a, 'text-emerald-300')}
        {cell('Tier B', c.tier_b, 'text-emerald-200/80')}
        {cell('Tier C', c.tier_c, 'text-[#7D8590]')}
        {cell('Qualified', c.qualified, 'text-emerald-300')}
        {cell('Review', c.review, 'text-amber-300/90')}
        {cell('Watch', c.watch)}
        {cell('Contact-ready', c.contact_ready, 'text-emerald-300')}
      </div>
      {portfolio.opportunity_shortfall > 0 && (
        <div className="text-[11px] text-amber-300/80 mt-1">
          {portfolio.opportunity_shortfall} short of the request
          {portfolio.opportunity_shortfall_reason ? ` — ${portfolio.opportunity_shortfall_reason}` : ''}.
        </div>
      )}
      {portfolio.contact_ready_shortfall > 0 && (
        <div className="text-[11px] text-amber-300/80 mt-0.5">
          {portfolio.contact_ready_shortfall_reason}
        </div>
      )}
      {/* NOT ALL DELIVERED OPPORTUNITIES ARE QUALIFIED, and the header must
          never imply otherwise. */}
      {c.delivered > c.qualified && (
        <div className="text-[11px] text-[#7D8590] mt-0.5">
          {c.qualified} of {c.delivered} delivered opportunities passed the Company Brain;
          the rest are review or watch items.
        </div>
      )}
    </div>
  );
}

export { readPortfolio, STATE_LABEL };
