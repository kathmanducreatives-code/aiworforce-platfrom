// BROWSER CHECK PAGE for the ORION Evidence panel (no auth, no network): renders
// the real OrionEvidencePanel with metadata produced by the REAL server digest
// (orionEvidenceContext) over the fictional pilot seed. Driven by Playwright.
import { createRoot } from 'react-dom/client';
import '@/index.css';
import OrionEvidencePanel from '@/components/chat/workspace/bubbles/OrionEvidencePanel';
import { buildOrionEvidenceDigest } from '../../supabase/functions/_shared/orionEvidenceContext';
import type { EvidenceItem } from '../../supabase/functions/_shared/evidence/model';

const WS = 'a71a0000-0000-4000-8000-0000000011a1';
const NOW = new Date('2026-11-11T12:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const item = (id: string, name: string, content: string, verification: EvidenceItem['verification'], d: number, url: string): EvidenceItem => ({
  id: `lisa_signal:${id}`, workspace_id: WS, source_type: 'lisa_signal', source_url: url, published_at: ago(d), retrieved_at: ago(d - 1),
  subject: { name, domain: null }, content, verification, confidence: 'medium',
  permissions: { scope: 'workspace', workspace_id: WS }, provenance: { table: 'signal_events', record_id: id } });
const items = [
  item('s1', 'Kestrel Fabrication', 'Kestrel Fabrication opens a second plant in Dayton, Ohio', 'verified', 6, 'https://plant-news.example/kestrel'),
  item('s2', 'Harbor Valve Works', 'Harbor Valve Works is hiring 12 machinists', 'single_source', 9, 'https://jobs.example/harbor'),
  item('s3', 'Pinecrest Tooling', 'Pinecrest Tooling adds a CNC line (forum post)', 'stale', 130, 'https://forum.example/pinecrest'),
  item('s4', 'Ridgeway Castings', 'Ridgeway Castings expansion — denied by the company', 'contradicted', 8, 'https://trade-blog.example/ridgeway'),
  item('s5', 'Cloudnova Software', 'Cloudnova Software opens a new software office', 'verified', 7, 'https://news.example/cloudnova'),
];
const brain = { exclusions: { industries: ['Software'], companies: [], geographies: [], keywords: [], items: [] } } as never;
const digest = buildOrionEvidenceDigest({ items, brain, sources: { lisa_signal: 'ok' }, now: NOW });
const metadata = { orion_evidence: { version: 'orion-evidence-context-v1', cited_ids: digest.cited_ids, items: digest.items } };

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#0B0C0E] p-6 text-[#ECE9E4]">
    <div className="max-w-[760px] rounded-2xl bg-white/[0.04] px-4 py-3 text-[14px]">
      Focus on Kestrel Fabrication [E1]: its second plant is verified. Harbor [E2] is single-source; Pinecrest [E3] is stale; Ridgeway [E4] is contradicted.
    </div>
    <OrionEvidencePanel metadata={metadata} />
    <div id="empty-case"><OrionEvidencePanel metadata={{ orion_evidence: { items: [{ ref: 'bad' }] } }} /></div>
  </div>,
);
