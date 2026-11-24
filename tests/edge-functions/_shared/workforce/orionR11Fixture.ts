// SYNTHETIC workspace shaped like the audited production one (2026-11-13):
// 145 accounts, 61 lead candidates (all `new`, none scored), 0 contacts,
// 37 signals (21 sales_hiring, 35 without an event date), 1 disabled
// monitoring subject; Laminar / Epsilon3 / Civilgrid are accounts, not leads.
// All names below except those four are invented. Plus a SECOND workspace whose
// rows must never appear. No network; the mock applies eq/limit like PostgREST.
export const WS = "aaaaaaaa-0000-4000-8000-00000000r111";
export const OTHER_WS = "bbbbbbbb-0000-4000-8000-00000000r111";
export const USER = "11111111-0000-4000-8000-00000000r111";
export const OUTSIDER = "11111111-0000-4000-8000-0000000000ff";
export const NOW = new Date("2026-11-13T15:00:00Z");
type Row = Record<string, unknown>;

const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const accounts: Row[] = [];
const leads: Row[] = [];
for (let i = 0; i < 145; i++) {
  const name = i === 0 ? "Hyperbound" : i === 1 ? "Laminar" : i === 2 ? "Epsilon3" : i === 3 ? "Civilgrid" : `Synthco ${i}`;
  accounts.push({ id: `acc-${i}`, workspace_id: WS, name, domain: `${name.toLowerCase().replace(/\s+/g, "")}.example`,
    stage: null, industry: i < 4 ? "Software" : null, location: null, employee_count: null, created_at: day(40 - (i % 10)) });
}
// 61 leads: account 0 (Hyperbound) and accounts 4..63 — never Laminar/Epsilon3/Civilgrid.
for (const i of [0, ...Array.from({ length: 60 }, (_, k) => k + 4)]) {
  leads.push({ id: `lead-${i}`, workspace_id: WS, account_id: `acc-${i}`, contact_id: null, status: "new", fit_score: null,
    next_action: null, priority: null, created_at: day(31 + (i % 2)),
    reason: i === 0 ? "Hiring signal: Enterprise Account Executive role" : `Hiring signal: Business Development Representative (${i})`,
    accounts: { name: accounts[i].name, domain: accounts[i].domain, linkedin_url: null } });
}
const signals: Row[] = [];
for (let i = 0; i < 37; i++) {
  const hiring = i < 21;
  signals.push({ id: `sig-${i}`, workspace_id: WS, signal_type: hiring ? "sales_hiring" : ["market_problem_discussion", "competitor_activity", "recent_funding"][i % 3],
    lifecycle_status: "active", verification_status: "unverified", confidence: "medium",
    occurred_at: i < 2 ? day(5) : null, observed_at: hiring ? day(31 + (i % 3)) : day(2 + i),
    source_url: `https://news.example/${i}`, subject_key: `synthco${i + 4}.example`,
    normalized_value: { lisa: { company: { name: `Synthco ${i + 4}`, domain: `synthco${i + 4}.example` },
      title: hiring ? `Hiring: Sales Development Representative (${i})` : `Signal ${i}`, verification: { level: "single_source" } } } });
}
export const TABLES: Record<string, Row[]> = {
  workspace_members: [{ workspace_id: WS, user_id: USER }],
  company_brain: [{ workspace_id: WS, onboarding_completed: true, updated_at: day(20),
    profile: { schema_version: 2, company: { name: "Agentory (synthetic)" },
      target_customer: { industries: ["B2B Software"], geography: ["United States"], company_size: { min: 2, max: 2, label: "5" } } } }],
  company_brain_memory: [],
  accounts: [...accounts, { id: "acc-x", workspace_id: OTHER_WS, name: "Laminar", domain: "laminar-other.example", stage: "qualified", created_at: day(1) }],
  lead_candidates: [...leads, { id: "lead-x", workspace_id: OTHER_WS, account_id: "acc-x", status: "qualified", fit_score: 99, created_at: day(1),
    reason: "OTHER WORKSPACE — must never appear", accounts: { name: "Laminar", domain: "laminar-other.example" } }],
  contacts: [{ id: "c-x", workspace_id: OTHER_WS, account_id: "acc-x" }],
  signal_events: [...signals, { id: "sig-x", workspace_id: OTHER_WS, signal_type: "sales_hiring", observed_at: day(1), subject_key: "x" }],
  monitoring_subjects: [{ id: "m1", workspace_id: WS, enabled: false }],
};

/** PostgREST-shaped mock: eq filters, limit, exact counts, optional per-table failure. */
export function mockDb(tables: Record<string, Row[]>, failing: string[] = []) {
  return { from(t: string) {
    let rows = [...(tables[t] ?? [])];
    let wantCount = false;
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select(_c?: string, o?: { count?: string }) { wantCount = o?.count === "exact"; return q; },
      order() { return q; }, in() { return q; }, gte() { return q; }, not() { return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      limit(n: number) { q._limit = n; return q; },
      maybeSingle() { return Promise.resolve(failing.includes(t) ? { data: null, error: { message: "boom" } } : { data: rows[0] ?? null, error: null }); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        if (failing.includes(t)) return Promise.resolve({ data: null, error: { message: "relation unavailable" }, count: null }).then(res, rej);
        const count = rows.length;
        const page = q._limit ? rows.slice(0, q._limit) : rows;
        return Promise.resolve({ data: page, error: null, count: wantCount ? count : null }).then(res, rej);
      },
    };
    return q;
  } };
}
