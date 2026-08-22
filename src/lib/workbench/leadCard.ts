// THE SEVEN THINGS A LEAD HAS TO SAY, DERIVED ONCE.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// A fourteen-column table behind a horizontal scroll (`w-max min-w-full`):
//
//   select · Company/Account · Signal · Company Context · Analyst ·
//   Recommended Persona · Contact Status · Decision Maker 🔒 · Contact Info 🔒 ·
//   Company Enrichment 🔒 · Personalized Message 🔒 · Fit · Source · Status
//
// FIT AND STATUS WERE COLUMNS 12 AND 14. The two facts a reader most needs —
// how good is this, and what happens next — sat past four padlocked columns,
// off the right edge of the panel on any normal width. Four of the fourteen
// were locks: cells whose entire content was an upsell for an action.
//
// A table is the right shape for comparing many values of the same kind. These
// are not that: they are seven different KINDS of fact about one company, and a
// row forced them into one visual rank where the important ones landed last.
//
// ── WHY A VIEW-MODEL AND NOT JUST A COMPONENT ───────────────────────────────
//
// Every one of the seven has a fallback chain — `why_this_lead` then
// `fit_reason` then the matched-ICP list; `signal_title` then `signal_summary`.
// Written inline in JSX those chains are invisible and untestable, and the card
// silently renders an empty region when the first choice is missing. Here they
// are one pure function with a test per field.
//
// ── AND WHY `accepted` IS NOT `!rejected` ───────────────────────────────────
//
// Same scar as everywhere else in this codebase: `level !== 'not_qualified'`
// once reported 20 qualified companies for a run that qualified none. The card
// asks `resolveQualification` and reads its explicit answer.
//
// Pure — no React, no network.

import { resolveQualification, type QualificationRecord } from '../qualifiedLead/qualification.ts';

export const LEAD_CARD_VERSION = 'workbench-lead-card-v1' as const;

/** What the reader should do with this lead, in plain words. */
export type LeadCardState =
  /** Everything needed is present. */
  | 'ready'
  /** Accepted, but a contact is still missing. */
  | 'needs_contact'
  /** Looked at, waiting on one more check. */
  | 'in_review';

export interface LeadCardModel {
  version: typeof LEAD_CARD_VERSION;
  company: string;
  /** Bare host, for display. Null when no site was found. */
  websiteLabel: string | null;
  /** Absolute URL, for the link. Null when unlinkable. */
  websiteHref: string | null;
  /** The single strongest reason this company surfaced at all. */
  signal: string | null;
  /** Where the signal came from, when it is a real source. */
  signalHref: string | null;
  /** 0–100, or null when nothing scored it. Never rendered as 0 for unscored. */
  fit: number | null;
  /** "Strong match" / "Good match" / "Possible match". Null when unscored. */
  fitLabel: string | null;
  /** Why it was accepted, in one sentence. */
  reason: string | null;
  state: LeadCardState;
  stateLabel: string;
  /** The single next step, or null when there is nothing to do. */
  nextStep: string | null;
}

export interface LeadCardInput extends QualificationRecord {
  company_name?: string | null;
  website?: string | null;
  signal_title?: string | null;
  signal_summary?: string | null;
  signal_source_url?: string | null;
  fit_score?: number | null;
  fit_reason?: string | null;
  why_this_lead?: string | null;
  matched_icp?: string[] | null;
  contact_name?: string | null;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * A displayable host, and a URL that will actually navigate.
 *
 * Rows carry the site in both shapes — `acme.com` and `https://acme.com/jobs` —
 * so the label is stripped to the host and the href is repaired to absolute. A
 * bare host in an `href` resolves against the app's own origin, which is how a
 * "website" link lands the user back on Agentory.
 */
export function websiteParts(raw: unknown): { label: string | null; href: string | null } {
  const v = clean(raw);
  if (!v) return { label: null, href: null };
  const href = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    return { label: host || null, href };
  } catch {
    // Unparseable: show what we have, link to nothing. A broken link is worse
    // than no link — it looks checked.
    return { label: v, href: null };
  }
}

/** The score band, in words. Tier A/B/C are internal names for these. */
export function fitLabelFor(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 85) return 'Strong match';
  if (score >= 70) return 'Good match';
  return 'Possible match';
}

export function buildLeadCard(row: LeadCardInput): LeadCardModel {
  const q = resolveQualification(row);
  const { label, href } = websiteParts(row.website);

  // FIT: a missing score is null, never 0. `0` reads as "we scored it and it is
  // terrible", which is a different and much stronger claim than "unscored".
  const rawFit = typeof row.fit_score === 'number' && Number.isFinite(row.fit_score)
    ? Math.max(0, Math.min(100, Math.round(row.fit_score)))
    : null;

  // WHY IT WAS ACCEPTED, most specific first. `matched_icp` is the weakest —
  // a list of criteria names rather than a sentence — so it is last and is
  // joined into something readable rather than dumped as tags.
  const matched = Array.isArray(row.matched_icp)
    ? row.matched_icp.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const reason = clean(row.why_this_lead)
    ?? clean(row.fit_reason)
    ?? (matched.length ? `Matched ${matched.slice(0, 3).join(', ')}` : null);

  // THE STRONGEST SIGNAL. Title first: it is the specific fact ("Hiring 3
  // senior ML engineers"); the summary is prose about it.
  const signal = clean(row.signal_title) ?? clean(row.signal_summary);

  const state: LeadCardState = q.qualified
    ? (clean(row.contact_name) ? 'ready' : 'needs_contact')
    : 'in_review';

  return {
    version: LEAD_CARD_VERSION,
    company: clean(row.company_name) ?? 'Unknown company',
    websiteLabel: label,
    websiteHref: href,
    signal,
    signalHref: websiteParts(row.signal_source_url).href,
    fit: rawFit,
    fitLabel: fitLabelFor(rawFit),
    reason,
    state,
    stateLabel: STATE_LABEL[state],
    nextStep: NEXT_STEP[state],
  };
}

/**
 * What the state IS, not what stage of a pipeline produced it.
 *
 * "contact-ready" and "verified decision-maker" are the internal names. They
 * describe the machinery; these describe the reader's situation.
 */
const STATE_LABEL: Readonly<Record<LeadCardState, string>> = Object.freeze({
  ready: 'Ready to contact',
  needs_contact: 'No contact yet',
  in_review: 'Still checking',
});

/**
 * One next step per state, or none.
 *
 * `ready` has no next step ON THE CARD — the action bar owns what happens to a
 * finished lead, and a card that suggests something for every state trains the
 * reader to ignore the suggestion.
 */
const NEXT_STEP: Readonly<Record<LeadCardState, string | null>> = Object.freeze({
  ready: null,
  needs_contact: 'Find decision-makers',
  in_review: null,
});
