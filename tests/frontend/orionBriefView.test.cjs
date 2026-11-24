// ORION V1 — the dashboard view actually renders: bundles OrionBriefView with
// esbuild and renders it with react-dom/server against fictional briefs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '../..');

function load() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/components/dashboard/OrionBriefView.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    alias: { '@': path.join(ROOT, 'src') },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
    logLevel: 'silent',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports.default;
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const View = load();

const ev = (kind, table, id, title, route) => ({ kind, table, id, title, occurred_at: '2026-11-07T07:00:00.000Z', route });
const brief = (at, summary) => ({
  version: 'orion-brief-v1', agent: 'orion', workspace_id: 'ws-a', generated_at: at, window_days: 7, summary,
  priorities: [
    { id: 'P1', rank: 1, category: 'decision', title: 'Decide on “Send outreach”', why: 'Work is paused until you decide.', action: { label: 'Review approvals', route: '/awaiting-you' }, confidence: 'high', evidence: [ev('approval', 'approvals', 'ap1', 'Send outreach', '/awaiting-you')] },
    { id: 'P2', rank: 2, category: 'opportunity', title: 'Act on Fictional Freight', why: 'fit 86/100', action: { label: 'Open lead', route: '/leads?lead=a1' }, confidence: 'medium', evidence: [ev('lead', 'lead_candidates', 'l1', 'Fictional Freight', '/leads?lead=a1')] },
  ],
  opportunities: [{ id: 'lead_candidates:l1', title: 'Fictional Freight', detail: 'Next: Email the COO', confidence: 'medium', evidence: [ev('lead', 'lead_candidates', 'l1', 'Fictional Freight', '/leads?lead=a1')] }],
  market_changes: [], pending_decisions: [],
  recommended_actions: [{ id: 'R-P1', action: 'Review approvals', why: 'Work is paused.', route: '/awaiting-you', confidence: 'high', evidence: [ev('approval', 'approvals', 'ap1', 'Send outreach', '/awaiting-you')] }],
  sources: [], counts: { signals: 0, leads: 1, content: 0, approvals: 1, plans_in_flight: 0, failed_work: 0 },
  confidence: { overall: 'high', notes: [] }, brain: { used: true, company: 'Northwind', missing: [] },
  synthesis: { mode: 'deterministic', model: null, rejected_reason: null },
});

const base = { selectedId: null, loading: false, generating: false, error: null, now: new Date('2026-11-07T09:00:00.000Z'), onGenerate() {}, onSelect() {}, onNavigate() {} };
const render = (p) => renderToStaticMarkup(React.createElement(View, { ...base, ...p }));

test('empty state invites a first brief and invents nothing', () => {
  const html = render({ history: [] });
  assert.match(html, /No executive brief yet/);
  assert.match(html, /Brief me/);
  assert.doesNotMatch(html, /Top priorities|Evidence/);
});

test('latest brief: summary, ranked priorities with confidence and evidence, sections, actions', () => {
  const html = render({ history: [{ id: 'b1', created_at: '', brief: brief('2026-11-07T08:30:00.000Z', 'In the last 7 days: 1 qualified lead.') }] });
  assert.match(html, /Orion · Executive brief/);
  assert.match(html, /In the last 7 days: 1 qualified lead\./);
  assert.match(html, /Generated 30 min ago/);
  assert.match(html, /Tailored to Northwind/);
  assert.ok(html.indexOf('Decide on') < html.indexOf('Act on Fictional Freight'), 'rank order');
  assert.match(html, /High confidence/);
  assert.match(html, /Medium confidence/);
  assert.match(html, /title="approvals · ap1"/, 'evidence names its source row');
  assert.match(html, /Opportunities/);
  assert.match(html, /Market alerts/);
  assert.match(html, /No new market signals this week\./);
  assert.match(html, /Pending decisions/);
  assert.match(html, /Recommended next actions/);
  assert.match(html, /New brief/);
});

test('history: an older selection is labelled historical; the picker lists every brief', () => {
  const history = [
    { id: 'new', created_at: '', brief: brief('2026-11-07T08:30:00.000Z', 'Today.') },
    { id: 'old', created_at: '', brief: brief('2026-11-04T08:30:00.000Z', 'Three days ago.') },
  ];
  const html = render({ history, selectedId: 'old' });
  assert.match(html, /Historical brief/);
  assert.match(html, /may be out of date/);
  assert.match(html, /Three days ago\./);
  assert.equal((html.match(/<option /g) || []).length, 2);
});

test('loading, generating and error states', () => {
  assert.match(render({ history: [], loading: true }), /Loading your latest brief/);
  assert.match(render({ history: [], generating: true }), /Briefing…/);
  assert.match(render({ history: [], error: 'Orion could not build the brief' }), /role="alert"[^>]*>Orion could not build the brief/);
});
