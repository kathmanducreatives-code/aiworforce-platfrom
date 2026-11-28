// LISA · the Signals specialist's conversation (Signals page panel).
//
// The panel used to forward plain text to the general chat with no agent, no prompt and no
// mode. Now a panel message carries `{ department: "lisa", lisa_mode }` and is answered by LISA:
//   brief    what the workspace's RECORDED, canonical signals say (and that nothing is recorded
//            when nothing is) — then what to watch, from the Company Brain
//   watch    becomes a monitoring DRAFT plan (handled by the monitor route, not here)
//   analyze  one or more signals against the Company Brain: relevance, verification, what is
//            missing, a recommended action
//   ask      anything about signals, grounded in the same context
// The context is the Company Brain block (with approved memory), the canonical signal rows
// (`signal_events`, newest first) and the monitoring plans. LISA never claims to have collected,
// verified or monitored anything that is not in those rows. PURE.

export const LISA_MODES = ["brief", "watch", "analyze", "ask"] as const;
export type LisaMode = typeof LISA_MODES[number];
export const parseLisaMode = (v: unknown): LisaMode =>
  (LISA_MODES as readonly string[]).includes(String(v)) ? String(v) as LisaMode : "ask";

/** A canonical signal row as LISA reads it (signal_events). */
export interface LisaSignalRow {
  id: string;
  signal_type: string;
  verification_status: string | null;
  confidence: string | null;
  occurred_at: string | null;
  observed_at: string | null;
  source_url: string | null;
  subject_key: string | null;
  normalized_value: Record<string, unknown> | null;
}
export interface LisaPlanRow { status: string; title: string; signal_categories: string[] }

const lisaOf = (r: LisaSignalRow) => ((r.normalized_value ?? {}) as { lisa?: Record<string, unknown> }).lisa ?? {};
/** One line per signal, citable as [S1]…; only what the row holds. */
export function signalFacts(rows: readonly LisaSignalRow[]): string[] {
  return rows.map((r, i) => {
    const l = lisaOf(r) as { company?: { name?: string; domain?: string }; title?: string; relevance?: { band?: string; reasons?: string[] }; verification?: { level?: string } };
    const who = l.company?.name ?? r.subject_key ?? "unknown company";
    const what = l.title ?? r.signal_type.replace(/_/g, " ");
    const verified = l.verification?.level ?? r.verification_status ?? "unverified";
    const rel = l.relevance?.band ? `; relevance ${l.relevance.band}${l.relevance.reasons?.length ? ` (${l.relevance.reasons.slice(0, 2).join("; ")})` : ""}` : "";
    return `[S${i + 1}] ${who}: ${what} — type ${r.signal_type}; event ${r.occurred_at ?? "date unknown"}; detected ${r.observed_at ?? "?"}; verification ${verified}; confidence ${r.confidence ?? "?"}${rel}; source ${r.source_url ?? "none"}`;
  });
}

const MODE_TASK: Record<Exclude<LisaMode, "watch">, string> = {
  brief: "Give a short brief of the RECORDED signals below: what matters most and why, against the Company Brain. If there are none, say plainly that no signals are recorded yet, then recommend the 3 buying signals worth watching for this business and why (from its goals, target customers and declared buying signals).",
  analyze: "Analyse the signals the user points at (or the strongest recorded ones): is the evidence verified, how relevant is it to the Company Brain's target market, what is missing, and one recommended next action (review it, ask ATLAS to research the company, suggest a content topic, or include it in ORION's brief). If there are no recorded signals, say so and explain what LISA would need to analyse.",
  ask: "Answer the question as LISA, the Signals specialist, using only the context below. Strategy questions (what to watch, which signals matter) are answered from the Company Brain even when no signals are recorded.",
};

export function lisaSystemPrompt(i: {
  mode: Exclude<LisaMode, "watch">;
  workspaceContext: string | null;
  signals: readonly LisaSignalRow[];
  plans: readonly LisaPlanRow[] | null;
}): string {
  const active = (i.plans ?? []).filter((p) => p.status === "active");
  const facts = signalFacts(i.signals);
  return [
    "You are LISA, the Signals and market-intelligence specialist of an AI workforce (ORION coordinates; ATLAS finds and qualifies companies; LYRA writes content). You are talking with the owner of this workspace on the Signals page.",
    "",
    `TASK (${i.mode}): ${MODE_TASK[i.mode]}`,
    "",
    "RULES:",
    "- Use ONLY the Company Brain and the recorded signals below. Cite a recorded signal as [S#].",
    "- Never claim you collected, verified, scanned or monitored anything that is not in the recorded signals. Nothing was fetched for this answer.",
    "- A signal is verified only if its row says so. Never present an unverified or AI-generated claim as market evidence.",
    `- Monitoring: ${i.plans === null ? "monitoring plans are not enabled on this project — nothing is being monitored." : active.length ? `${active.length} active monitoring plan(s): ${active.map((p) => p.title).join("; ")}.` : "no monitoring plan is active, so nothing is being monitored right now. Say so if it matters."}`,
    "- Recommend actions only (review, research with ATLAS, a content idea, include in ORION's brief). Never send outreach or start work.",
    "- Plain, specific, no emojis. Use short paragraphs or bullets.",
    "",
    i.workspaceContext ? `<company_brain>\n${i.workspaceContext}\n</company_brain>` : "The Company Brain is not set up, so relevance to this business cannot be judged. Say so.",
    "",
    facts.length ? `<recorded_signals count="${facts.length}">\n${facts.join("\n")}\n</recorded_signals>` : "<recorded_signals count=\"0\">No signals are recorded for this workspace.</recorded_signals>",
  ].join("\n");
}
