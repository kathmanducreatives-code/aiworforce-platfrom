// Buying signals from Apify, collected AFTER discovery and never required by it.
//
// Every signal records: subject (company or person key), type, source URL, the
// EVENT date when the source gives one, the collection time, the evidence
// excerpt, confidence, provider + actor, and retrieval cost. An undated item is
// `undated` — never `recent`. A signal source that fails or is not enabled
// leaves that signal type `unavailable` for the subject: discovery and
// eligibility go on without it.
//
// Actors (Apify store, read 2026-10-31; FREE/BRONZE tier per-event prices):
//   harvestapi/linkedin-profile-posts   $0.002 / post, $0.001 / empty query, $0.00005 / start
//   harvestapi/linkedin-company-posts   same
//   harvestapi/linkedin-job-search      $0.001 / job,  $0.001 / start
// Funding comes from the discovery record itself (LeadOcean company_funding,
// dated) — no extra purchase. Expansion and leadership changes are read from the
// company's own posts (text cues), so they are low confidence and single source.
//
// Job rows go through the Apify engine's normalizeLinkedInJob (fields known from
// its canaries). Post OUTPUT field names are read defensively (several candidate
// paths) and are not yet confirmed against a live run.

import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { FundingClaim } from "../discoveryProviders/types.ts";
import { sha256Hex } from "../providerInputFingerprint.ts";
import { normalizeLinkedInJob } from "../hiringActorNormalizers.ts";

export type SignalType = "linkedin_post" | "hiring" | "funding" | "expansion" | "leadership_change";
export type Recency = "recent" | "stale" | "undated";

export interface Signal {
  signalId: string;
  subject: { kind: "company" | "person"; key: string };
  type: SignalType;
  sourceUrl: string | null;
  /** When the EVENT happened (posting date, round date). Null when the source gives none. */
  eventDate: string | null;
  collectedAt: string;
  recency: Recency;
  evidence: { excerpt: string | null; fields: Record<string, unknown> };
  confidence: "high" | "medium" | "low";
  provider: "apify" | "leadocean";
  actor: string | null;
  /** USD for the purchase this signal came from; `estimated` when Apify did not report the charge. */
  cost: { usd: number; basis: "charged" | "estimated" | "included" };
  /** Single source unless a second, independent source states the same event. */
  corroboration: "single_source" | "corroborated";
}

export interface SignalStatus {
  subject: string;
  type: SignalType;
  state: "collected" | "none_found" | "unavailable" | "not_requested" | "skipped_budget";
  reason: string | null;
}

export interface SignalActor {
  key: string;
  actorId: string;
  perItemUsd: number;
  perStartUsd: number;
  emptyUsd: number;
}

export const SIGNAL_ACTORS = Object.freeze({
  profilePosts: { key: "apify_linkedin_profile_posts", actorId: "harvestapi/linkedin-profile-posts", perItemUsd: 0.002, perStartUsd: 0.00005, emptyUsd: 0.001 },
  companyPosts: { key: "apify_linkedin_company_posts", actorId: "harvestapi/linkedin-company-posts", perItemUsd: 0.002, perStartUsd: 0.00005, emptyUsd: 0.001 },
  jobs: { key: "apify_linkedin_job_search", actorId: "harvestapi/linkedin-job-search", perItemUsd: 0.001, perStartUsd: 0.001, emptyUsd: 0 },
} satisfies Record<string, SignalActor>);

/** Worst case for one run: every item billed, plus the start (and an empty-result charge never exceeds an item). */
export function worstCaseUsd(a: SignalActor, maxItems: number): number {
  return Math.round((a.perStartUsd + Math.max(a.perItemUsd * maxItems, a.emptyUsd)) * 1e6) / 1e6;
}

const DAY = 86_400_000;

function pickStr(o: unknown, paths: string[]): string | null {
  for (const p of paths) {
    let cur: unknown = o;
    for (const k of p.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (typeof cur === "number" && Number.isFinite(cur) && p.toLowerCase().includes("timestamp")) return new Date(cur > 1e12 ? cur : cur * 1000).toISOString();
  }
  return null;
}

/** An ISO date, or null. "2 weeks ago" and other relative text are NOT dates. */
export function eventDateOf(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function recencyOf(eventDate: string | null, windowDays: number, now: Date): Recency {
  if (!eventDate) return "undated";
  const age = (now.getTime() - Date.parse(eventDate)) / DAY;
  if (age < -1) return "undated"; // a future date is not evidence of anything recent
  return age <= windowDays ? "recent" : "stale";
}

/** Text cues for signals derived from a company's own posts. Low confidence by design. */
export const POST_CUES: Readonly<Record<Exclude<SignalType, "linkedin_post" | "funding">, RegExp>> = Object.freeze({
  hiring: /\b(we(?:'re| are) hiring|join our team|open roles?|now hiring|hiring an? )/i,
  expansion: /\b(new office|opened? (?:our|a) (?:new )?office|expanding (?:to|into)|launch(?:ed|ing) in|now serving)\b/i,
  leadership_change: /\b(welcome(?:s)? (?:our )?new|joins? (?:us )?as|appointed|promoted to|named (?:our )?(?:new )?(?:ceo|cro|cmo|cto|coo|vp|head))\b/i,
});
const FUNDING_CUE = /\b(raised|funding round|series [a-e]\b|seed round|pre-seed|led by)\b/i;

function signalId(parts: unknown[]): string {
  return `sig_${sha256Hex(JSON.stringify(parts)).slice(0, 20)}`;
}

/** Posts of one subject → a post signal each, plus low-confidence derived signals. */
export function signalsFromPosts(
  items: readonly unknown[], subject: Signal["subject"], actor: SignalActor, run: { chargedUsd?: number | null }, now: Date, windowDays: number,
): Signal[] {
  const out: Signal[] = [];
  const per = items.length ? (run.chargedUsd ?? worstCaseUsd(actor, items.length)) / items.length : 0;
  const basis: Signal["cost"]["basis"] = run.chargedUsd != null ? "charged" : "estimated";
  for (const it of items) {
    const text = pickStr(it, ["content", "text", "commentary", "postText"]);
    const url = pickStr(it, ["linkedinUrl", "url", "postUrl", "shareUrl"]);
    const eventDate = eventDateOf(pickStr(it, ["postedAt.date", "postedAt.timestamp", "postedAtISO", "postedAt", "publishedAt", "date"]));
    const recency = recencyOf(eventDate, windowDays, now);
    const excerpt = text ? text.slice(0, 280) : null;
    const base = { subject, sourceUrl: url, eventDate, collectedAt: now.toISOString(), recency, provider: "apify" as const, actor: actor.actorId, corroboration: "single_source" as const };
    out.push({ ...base, signalId: signalId([actor.key, url, eventDate, subject.key, "post"]), type: "linkedin_post", evidence: { excerpt, fields: {} },
      confidence: eventDate && url ? "medium" : "low", cost: { usd: Math.round(per * 1e6) / 1e6, basis } });
    if (!text) continue;
    for (const [type, re] of Object.entries(POST_CUES) as [SignalType, RegExp][]) {
      if (re.test(text)) out.push({ ...base, signalId: signalId([actor.key, url, subject.key, type]), type, evidence: { excerpt, fields: { cue: re.exec(text)?.[0] ?? null } }, confidence: "low", cost: { usd: 0, basis: "included" } });
    }
    if (FUNDING_CUE.test(text)) out.push({ ...base, signalId: signalId([actor.key, url, subject.key, "funding"]), type: "funding", evidence: { excerpt, fields: { cue: FUNDING_CUE.exec(text)?.[0] ?? null } }, confidence: "low", cost: { usd: 0, basis: "included" } });
  }
  return out;
}

/** Dated job postings → hiring signals. A posting is the source; the role decides relevance. */
export function signalsFromJobs(
  items: readonly unknown[], subject: Signal["subject"], actor: SignalActor, run: { chargedUsd?: number | null }, now: Date, windowDays: number, relevantRoles: RegExp,
): Signal[] {
  const per = items.length ? (run.chargedUsd ?? worstCaseUsd(actor, items.length)) / items.length : 0;
  const basis: Signal["cost"]["basis"] = run.chargedUsd != null ? "charged" : "estimated";
  // The Apify engine's own normalizer knows the actor's real output fields.
  return items.flatMap((it): Signal[] => {
    const j = normalizeLinkedInJob((it ?? {}) as Record<string, unknown>);
    const eventDate = eventDateOf(j.posted_date);
    return [{
      signalId: signalId([actor.key, j.job_url ?? j.job_id, subject.key, "hiring"]), subject, type: "hiring", sourceUrl: j.job_url, eventDate, collectedAt: now.toISOString(),
      recency: recencyOf(eventDate, windowDays, now), evidence: { excerpt: j.title, fields: { relevantRole: !!j.title && relevantRoles.test(j.title), location: j.location, employer: j.company_name } },
      confidence: eventDate && j.job_url ? "high" : "low", provider: "apify", actor: actor.actorId, corroboration: "single_source",
      cost: { usd: Math.round(per * 1e6) / 1e6, basis },
    }];
  });
}

/** The discovery record's own funding event (LeadOcean company_funding): no extra purchase, a provider claim. */
export function signalFromFunding(f: FundingClaim | null | undefined, subject: Signal["subject"], recordId: string, now: Date, windowDays: number): Signal | null {
  if (!f || (!f.lastRoundType && !f.roundDate && !f.lastRoundYear)) return null;
  // A year alone is not a date.
  const eventDate = f.roundDate ? new Date(f.roundDate).toISOString() : null;
  return {
    signalId: signalId(["leadocean", recordId, "funding", f.roundDate, f.lastRoundType]), subject, type: "funding", sourceUrl: null, eventDate,
    collectedAt: now.toISOString(), recency: recencyOf(eventDate, windowDays, now),
    evidence: { excerpt: [f.lastRoundType, f.roundDate ?? f.lastRoundYear, f.totalUsd ? `$${f.totalUsd.toLocaleString("en-US")} total` : null].filter(Boolean).join(" · "), fields: { ...f, recordId } },
    confidence: eventDate ? "medium" : "low", provider: "leadocean", actor: null, corroboration: "single_source", cost: { usd: 0, basis: "included" },
  };
}

/** Two independent sources stating the same event type within a window corroborate each other. */
export function corroborate(signals: Signal[], windowDays = 45): Signal[] {
  return signals.map((s) => {
    if (!s.eventDate) return s;
    const t = Date.parse(s.eventDate);
    const other = signals.find((o) => o !== s && o.type === s.type && o.subject.key === s.subject.key && o.eventDate &&
      (o.provider !== s.provider || o.actor !== s.actor) && Math.abs(Date.parse(o.eventDate) - t) <= windowDays * DAY);
    return other ? { ...s, corroboration: "corroborated" } : s;
  });
}

export interface SignalPlan {
  /** Which collectors to run; anything absent is `not_requested`. */
  collect: { founderPosts?: boolean; companyPosts?: boolean; jobs?: boolean };
  maxPostsPerSubject: number;
  maxJobsPerCompany: number;
  windowDays: number;
  /** The Apify spend ceiling for the whole run, USD. */
  maxUsd: number;
  relevantRoles: RegExp;
}

export interface SignalSubject {
  companyKey: string;
  companyLinkedinUrl: string | null;
  companyName: string | null;
  personKey: string | null;
  personLinkedinUrl: string | null;
  funding: FundingClaim | null;
  fundingRecordId: string | null;
}

export interface SignalRun { signals: Signal[]; statuses: SignalStatus[]; spentUsd: number; stopped: string | null }

/**
 * Collect signals for each subject inside a USD ceiling. A run's worst case is
 * reserved BEFORE it starts; a run that would exceed the ceiling is skipped, not
 * shrunk silently. An invoker failure marks that signal type unavailable for the
 * subject and the rest continues. No run is retried.
 */
export async function collectSignals(subjects: readonly SignalSubject[], plan: SignalPlan, invoke: ActorInvoker | null, now: Date, idPrefix: string): Promise<SignalRun> {
  const signals: Signal[] = [];
  const statuses: SignalStatus[] = [];
  let committed = 0;
  let spent = 0;
  let stopped: string | null = null;
  const tasks: { s: SignalSubject; type: SignalType; actor: SignalActor; input: Record<string, unknown>; maxItems: number; subject: Signal["subject"] }[] = [];
  for (const s of subjects) {
    const f = signalFromFunding(s.funding, { kind: "company", key: s.companyKey }, s.fundingRecordId ?? s.companyKey, now, plan.windowDays);
    if (f) signals.push(f);
    statuses.push({ subject: s.companyKey, type: "funding", state: f ? "collected" : "none_found", reason: f ? null : "the discovery record holds no funding event" });
    if (plan.collect.founderPosts && s.personKey) {
      if (s.personLinkedinUrl) tasks.push({ s, type: "linkedin_post", actor: SIGNAL_ACTORS.profilePosts, maxItems: plan.maxPostsPerSubject, subject: { kind: "person", key: s.personKey },
        input: { targetUrls: [s.personLinkedinUrl], maxPosts: plan.maxPostsPerSubject, postedLimit: "3months", scrapeReactions: false, scrapeComments: false } });
      else statuses.push({ subject: s.personKey, type: "linkedin_post", state: "unavailable", reason: "no LinkedIn profile URL for this person" });
    }
    if (plan.collect.companyPosts) {
      if (s.companyLinkedinUrl) tasks.push({ s, type: "expansion", actor: SIGNAL_ACTORS.companyPosts, maxItems: plan.maxPostsPerSubject, subject: { kind: "company", key: s.companyKey },
        input: { targetUrls: [s.companyLinkedinUrl], maxPosts: plan.maxPostsPerSubject, postedLimit: "3months", scrapeReactions: false, scrapeComments: false } });
      else statuses.push({ subject: s.companyKey, type: "expansion", state: "unavailable", reason: "no LinkedIn company URL" });
    }
    if (plan.collect.jobs) {
      if (s.companyName) tasks.push({ s, type: "hiring", actor: SIGNAL_ACTORS.jobs, maxItems: plan.maxJobsPerCompany, subject: { kind: "company", key: s.companyKey },
        // Input schema (harvestapi/linkedin-job-search): company accepts a LinkedIn URL or a name; postedLimit 1h|24h|week|month.
        input: { company: [s.companyLinkedinUrl ?? s.companyName], maxItems: plan.maxJobsPerCompany, postedLimit: "month", sortBy: "date", locations: ["United States"] } });
      else statuses.push({ subject: s.companyKey, type: "hiring", state: "unavailable", reason: "no company name to search jobs by" });
    }
  }
  if (!plan.collect.founderPosts) statuses.push({ subject: "*", type: "linkedin_post", state: "not_requested", reason: null });
  if (!plan.collect.companyPosts) statuses.push({ subject: "*", type: "expansion", state: "not_requested", reason: null });
  if (!plan.collect.jobs) statuses.push({ subject: "*", type: "hiring", state: "not_requested", reason: null });

  for (const t of tasks) {
    const subjectKey = t.subject.key;
    if (!invoke) { statuses.push({ subject: subjectKey, type: t.type, state: "unavailable", reason: "Apify is not connected for this run" }); continue; }
    if (stopped) { statuses.push({ subject: subjectKey, type: t.type, state: "unavailable", reason: `signals stopped: ${stopped}` }); continue; }
    const worst = worstCaseUsd(t.actor, t.maxItems);
    if (committed + worst > plan.maxUsd + 1e-9) { statuses.push({ subject: subjectKey, type: t.type, state: "skipped_budget", reason: `worst case $${worst} would exceed the $${plan.maxUsd} signal ceiling` }); continue; }
    committed += worst;
    try {
      const run = await invoke(t.actor.key, t.input, { maxItems: t.maxItems, idempotencyKey: `${idPrefix}:${t.actor.key}:${subjectKey}` });
      const items = run.items.slice(0, t.maxItems);
      const got = t.actor === SIGNAL_ACTORS.jobs
        ? signalsFromJobs(items, t.subject, t.actor, run, now, plan.windowDays, plan.relevantRoles)
        : signalsFromPosts(items, t.subject, t.actor, run, now, plan.windowDays);
      // A company-posts run feeds every cue type; a profile-posts run is the founder's posts.
      signals.push(...got);
      spent += run.chargedUsd ?? (items.length ? worstCaseUsd(t.actor, items.length) : t.actor.perStartUsd + t.actor.emptyUsd);
      statuses.push({ subject: subjectKey, type: t.type, state: got.length ? "collected" : "none_found", reason: got.length ? null : "the source returned nothing in the window" });
    } catch (e) {
      // The run may have been billed: count its worst case, stop further signal spend, never retry.
      spent += worst;
      stopped = `${t.actor.key} failed (${(e as Error)?.name ?? "error"}); its worst case is counted`;
      statuses.push({ subject: subjectKey, type: t.type, state: "unavailable", reason: stopped });
    }
  }
  return { signals: corroborate(signals), statuses, spentUsd: Math.round(spent * 1e6) / 1e6, stopped };
}
