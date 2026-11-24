// Phase 2 capability notice. Renders only with VITE_BRAIN_READINESS_V2 on and
// only when this page's capability isn't available yet.

import { Link } from 'react-router-dom';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { brainReadinessV2, readinessOfRow } from '@/lib/brainReadinessFlag';
import { capabilityNotice } from '@/lib/brainCapabilityNotice';
import type { BrainCapability } from '@/lib/companyBrainReadiness';

export function BrainCapabilityNotice({ capability }: { capability: Exclude<BrainCapability, 'read_only'> }) {
  const { data } = useCompanyBrain();
  if (!brainReadinessV2()) return null;
  const notice = capabilityNotice(readinessOfRow(data), capability);
  if (!notice) return null;
  return (
    <div role="status" className="mx-4 mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm sm:mx-6">
      <div className="font-medium text-amber-700 dark:text-amber-300">{notice.title}</div>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        {notice.needs.map((n) => <li key={n}>{n}</li>)}
      </ul>
      <Link to={notice.href} className="mt-2 inline-block font-medium text-foreground underline underline-offset-4">
        {notice.cta}
      </Link>
    </div>
  );
}
