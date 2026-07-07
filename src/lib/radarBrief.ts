// "Today's Radar Brief" derivation. Pure, Deno-testable (no React/network).
// Summarizes real signal data only — strongest signal type, count of useful
// (verified) signals, the single best next action, and any source gaps. Never
// fabricates: when there is nothing verified, isEmpty is true and callers show
// honest empty copy.

export interface BriefSignal {
  signal_type: string;
  title: string;
  score: number; // 0..100 (raw.score / fit_score); 0 when unknown
  verified: boolean; // show_by_default
  recommended_action?: string | null;
  company?: string | null;
}

export interface RadarBrief {
  usefulCount: number;
  strongestType: { type: string; label: string; count: number; topScore: number } | null;
  topAction: { title: string; action: string; company: string | null } | null;
  missingSources: string[];
  isEmpty: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  hiring: "Hiring",
  hiring_signal: "Hiring",
  funding: "Funding",
  competitor: "Competitor",
  competitor_engagement: "Competitor",
  workflow_trend: "Workflow trend",
  linkedin_intent: "LinkedIn posts",
  linkedin_engagement: "LinkedIn posts",
  people: "People",
  people_profile: "People",
};

export function signalTypeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Summarize verified signals into a brief. `missingSourceLabels` = sources not runnable. */
export function deriveRadarBrief(signals: BriefSignal[], missingSourceLabels: string[] = []): RadarBrief {
  const verified = signals.filter((s) => s.verified);
  if (verified.length === 0) {
    return { usefulCount: 0, strongestType: null, topAction: null, missingSources: missingSourceLabels, isEmpty: true };
  }

  // Strongest type: rank by count, tie-broken by best score in that group.
  const groups = new Map<string, { count: number; topScore: number }>();
  for (const s of verified) {
    const g = groups.get(s.signal_type) ?? { count: 0, topScore: 0 };
    g.count += 1;
    g.topScore = Math.max(g.topScore, s.score);
    groups.set(s.signal_type, g);
  }
  let strongestType: RadarBrief["strongestType"] = null;
  for (const [type, g] of groups) {
    if (!strongestType || g.count > strongestType.count || (g.count === strongestType.count && g.topScore > strongestType.topScore)) {
      strongestType = { type, label: signalTypeLabel(type), count: g.count, topScore: g.topScore };
    }
  }

  // Top action: highest-scored verified signal with a recommended action.
  const ranked = [...verified].sort((a, b) => b.score - a.score);
  const best = ranked.find((s) => (s.recommended_action ?? "").trim()) ?? ranked[0];
  const topAction = best
    ? { title: best.title, action: (best.recommended_action ?? "Review this signal").trim(), company: best.company ?? null }
    : null;

  return {
    usefulCount: verified.length,
    strongestType,
    topAction,
    missingSources: missingSourceLabels,
    isEmpty: false,
  };
}
