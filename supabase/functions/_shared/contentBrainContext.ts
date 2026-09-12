// THE COMPANY BRAIN, AS A CONTENT STRATEGIST READS IT.
//
// `renderCompanyBrainBlock` gives every agent a compact identity: name, ICP,
// goals, competitors. That is enough to find leads and far too little to decide
// what content to make. A strategist needs to know what we BELIEVE (the point
// of view a post argues), what we can CLAIM (proof points — and what to avoid
// saying), how we SOUND (voice rules), what the audience is struggling with
// (pains), and what we have already said (so the next post is not the last one
// again).
//
// ── WHO WE ARE vs WHAT HAPPENED ─────────────────────────────────────────────
//
// This block is headed COMPANY BRAIN and says, in so many words, that it is
// who we are. The signal lives in the brief under THE SOURCE and says it is
// what happened to someone else. Two blocks, two headings, never merged — the
// fix for a competitor's launch becoming "We just shipped…" was separating
// exactly these two, and this keeps them separate as the brain gets deeper.
// Competitors are listed here explicitly as NOT us.
//
// PURE. Only present fields are emitted; nothing is invented to fill a gap.

type Profile = Record<string, unknown> | null | undefined;

const o = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const a = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  const one = s(v);
  return one ? [one] : [];
};
const uniq = (xs: string[]) => xs.filter((x, i) => xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);

/** What the strategist gets, as data — tested directly, rendered below. */
export interface ContentBrain {
  company: string | null;
  what_we_sell: string | null;
  offer: string | null;
  who_we_sell_to: string | null;
  customer_pains: string[];
  differentiation: string[];
  beliefs: string[];
  use_cases: string[];
  competitors: string[];
  voice: { tone: string | null; rules: string[]; avoid: string[]; example: string | null };
  claims_we_can_make: string[];
  claims_to_avoid: string[];
  topics: string[];
  founder: string | null;
}

export function contentBrainFrom(p: Profile): ContentBrain {
  const b = o(p);
  const company = o(b.company), icp = o(b.icp), pos = o(b.positioning), voice = o(b.brand_voice);
  const comp = o(b.competitors), goals = o(b.goals), founder = o(b.founder);

  const icpParts = [
    s(b.who_we_sell_to),
    a(icp.buyer_roles).join(", ") || null,
    a(icp.industries).join(", ") || null,
    s(icp.company_size), s(icp.geography),
  ].filter((x): x is string => !!x);

  const founderName = s(founder.name), founderRole = s(founder.role);
  return {
    company: s(company.name) ?? s(b.company_name) ?? s(b.name),
    what_we_sell: s(company.description) ?? s(b.what_we_do) ?? s(b.description),
    offer: s(pos.offer),
    who_we_sell_to: icpParts.length ? uniq(icpParts).join("; ") : null,
    customer_pains: uniq(a(icp.pain_points)),
    differentiation: uniq(a(pos.differentiators)),
    // The promise is the belief a post argues from; "avoid positioning" is not
    // a belief, it is a constraint, and goes to claims_to_avoid.
    beliefs: uniq([...a(pos.promise), ...a(b.beliefs), ...a(pos.beliefs)]),
    use_cases: uniq(a(pos.use_cases)),
    competitors: uniq([...a(comp.known), ...a(comp.adjacent), ...(Array.isArray(b.competitors) ? a(b.competitors) : [])]),
    voice: {
      tone: s(voice.tone) ?? s(b.voice_and_tone) ?? (a(voice.tags).join(", ") || null),
      rules: uniq(a(voice.style_rules)),
      avoid: uniq(a(voice.avoid)),
      example: s(voice.example_message),
    },
    claims_we_can_make: uniq(a(pos.proof_points)),
    claims_to_avoid: uniq(a(pos.avoid_positioning)),
    topics: uniq([...a(goals.content), ...a(b.content_topics)]),
    founder: founderName ? (founderRole ? `${founderName}, ${founderRole}` : founderName) : null,
  };
}

/** What we have already published or drafted — so the next piece is new. */
export interface RecentContent {
  title: string;
  content_format: string | null;
  angle: string | null;
}

const line = (label: string, v: string | null) => (v ? [`- ${label}: ${v}`] : []);
const lines = (label: string, vs: string[], max = 6) =>
  vs.length ? [`- ${label}:`, ...vs.slice(0, max).map((x) => `    • ${x}`)] : [];

/**
 * The block Scribe's system prompt carries when it is writing content.
 *
 * `useCompanyBrain: false` is the user's switch: only who is writing survives,
 * so the draft is still ours without drawing on beliefs, claims or voice.
 */
export function renderContentBrain(p: Profile, opts: {
  onboardingCompleted?: boolean | null;
  useCompanyBrain?: boolean | null;
  recent?: RecentContent[];
} = {}): string {
  const brain = contentBrainFrom(p);
  const identity = brain.company ? `${brain.company}${brain.what_we_sell ? ` — ${brain.what_we_sell}` : ""}` : null;

  if (opts.useCompanyBrain === false) {
    return [
      "COMPANY BRAIN — who we are (the user switched the rest off for this draft):",
      identity ? `- We are: ${identity}` : "- Not configured.",
    ].join("\n");
  }

  const body = [
    ...line("We are", identity),
    ...line("Founder voice", brain.founder),
    ...line("What we offer", brain.offer),
    ...line("Who we sell to (ICP)", brain.who_we_sell_to),
    ...lines("Their pains", brain.customer_pains),
    ...lines("What we believe (our point of view)", brain.beliefs),
    ...lines("How we are different", brain.differentiation),
    ...lines("Use cases we can speak to", brain.use_cases),
    ...lines("Claims we can safely make (proof)", brain.claims_we_can_make),
    ...lines("Never position us as / never claim", brain.claims_to_avoid),
    ...(brain.competitors.length
      ? [`- Competitors — these are NOT us; their news is theirs: ${brain.competitors.slice(0, 10).join(", ")}`]
      : []),
    ...line("Brand voice", brain.voice.tone),
    ...lines("Voice rules", brain.voice.rules),
    ...lines("Words and moves to avoid", brain.voice.avoid),
    ...line("A message in our voice", brain.voice.example ? `"${brain.voice.example.slice(0, 280)}"` : null),
    ...lines("Topics we care about", brain.topics),
  ];

  const recent = (opts.recent ?? []).filter((r) => s(r.title)).slice(0, 8);
  const recentLines = recent.length
    ? [
      "",
      "OUR RECENT CONTENT — do not repeat these angles or hooks; build on them or go somewhere new:",
      ...recent.map((r) => `- [${r.content_format ?? "text"}] ${r.title.trim().slice(0, 110)}${r.angle ? ` (angle: ${r.angle.slice(0, 80)})` : ""}`),
    ]
    : [];

  if (!body.length) {
    return [
      "COMPANY BRAIN — who we are and what we believe:",
      "- Not configured yet. Write from the user's goal alone; make no claims about the company, its customers or its results.",
      ...recentLines,
    ].join("\n");
  }
  return [
    "COMPANY BRAIN — who we are and what we believe (this is US; a signal is somebody else's news):",
    ...(opts.onboardingCompleted === false ? ["- (Onboarding is not finished — treat gaps as unknown, never fill them.)"] : []),
    ...body,
    ...recentLines,
  ].join("\n");
}
