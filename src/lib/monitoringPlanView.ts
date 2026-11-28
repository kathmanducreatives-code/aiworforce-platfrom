// Display words for monitoring-plan categories (mirrors supabase/functions/_shared/monitoringPlan.ts).
const CATEGORY_LABEL: Record<string, string> = {
  hiring: 'Hiring', expansion: 'Expansion', funding: 'Funding', leadership_change: 'Leadership changes',
  technology: 'Technology adoption', product_launch: 'Product launches', partnership: 'Partnerships',
  acquisition: 'Acquisitions', pricing: 'Pricing changes', competitor: 'Competitor moves',
};
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.replace(/_/g, ' ');
