// R1.2 · PRODUCTION-SHAPED signals (audited 2026-11-16): no lisa block, no
// verification level, `verification_status: unverified`; hiring and funding
// carry `normalized_value.company_name` and no source URL; market and competitor
// signals are TOPICS (subject_key like "buyer-intent") with a source URL; event
// dates only on 2 of 37. With 61 lead "inferences" ranked above 37 "unverified"
// signals, R1.1's 50-item retrieval cap kept zero signals. Fictional rows.
import { TABLES as R11, NOW, OTHER_WS, USER, OUTSIDER, WS, mockDb } from "./orionR11Fixture.ts";
export { NOW, OTHER_WS, USER, OUTSIDER, WS, mockDb };
type Row = Record<string, unknown>;
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const signals: Row[] = [];
const types = [...Array(21).fill("sales_hiring"), ...Array(11).fill("market_problem_discussion"), ...Array(3).fill("competitor_activity"), ...Array(2).fill("recent_funding")];
types.forEach((t, i) => {
  const companyish = t === "sales_hiring" || t === "recent_funding";
  signals.push({
    id: `psig-${i}`, workspace_id: WS, signal_type: t, lifecycle_status: "active", verification_status: "unverified", confidence: "medium",
    occurred_at: i < 2 ? day(40) : null, observed_at: day(t === "sales_hiring" ? 33 + (i % 40) : 73 + (i % 10)),
    source_url: companyish ? null : `https://forum.example/thread-${i}`,
    subject_key: companyish ? `synthco${i}-com` : (t === "competitor_activity" ? "outreach" : "buyer-intent"),
    normalized_value: companyish ? { company_name: `Synthco ${i}` } : { title: `Discussion ${i}` },
  });
});
export const TABLES: Record<string, Row[]> = {
  ...R11,
  signal_events: [...signals, { id: "psig-x", workspace_id: OTHER_WS, signal_type: "sales_hiring", observed_at: day(1), subject_key: "other-ws",
    normalized_value: { company_name: "OTHER WORKSPACE SIGNAL" }, verification_status: "unverified", lifecycle_status: "active" }],
};
