// ONE COMPANY, ONE LEAD (MRLE Phase 0, audit 2026-11-07 X3 / S5).
//
// `mergeRecords` deliberately keeps two provider rows apart when they share a domain but name
// different LinkedIn pages (two companies, or a stale page): the identity is not certain at
// the RECORD level. But a LEAD is persisted per account, and accounts are keyed by domain —
// so two leads for one domain became two qualified rows for one company (S5: one company
// reached through two LinkedIn pages was counted twice toward the requested number).
//
// Here, after qualification, leads that resolve to the same canonical company are collapsed:
//   identity   canonical website domain; else the LinkedIn company slug; else the record key
//   keeper     the STRONGEST verdict (eligible > pending > ineligible), then the rank score
//   conflict   one page eligible and another DISPROVEN is a contradiction about one company:
//              the keeper is held at `pending` and the conflict is recorded — weaker or
//              contradicting evidence never silently overwrites, and never silently wins
//   provenance every merged page, key and provider id is kept on the keeper
//
// Pure.

import type { PipelineLead } from "./pipeline.ts";

/** Lower-case host without scheme, `www.`, port, path or a trailing dot; null when empty. */
export function canonicalDomain(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\d?\./, "");
  return host.includes(".") ? host : null;
}

/** LinkedIn company slug, case- and slash-insensitive. */
export function linkedinCompanySlug(u: string | null | undefined): string | null {
  const m = /linkedin\.com\/company\/([^/?#\s]+)/i.exec(String(u ?? ""));
  return m ? decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, "") : null;
}

export function companyIdentityKey(l: Pick<PipelineLead, "company">): string {
  const d = canonicalDomain(l.company.domain);
  if (d) return `domain:${d}`;
  const s = linkedinCompanySlug(l.company.linkedinUrl);
  return s ? `li:${s}` : `key:${l.company.key}`;
}

const STRENGTH: Record<string, number> = { eligible: 3, pending: 2, ineligible: 1 };

export interface MergedLead {
  identity: string;
  kept: string;
  merged: { leadKey: string; companyKey: string; linkedinUrl: string | null; qualification: string }[];
  /** Set when the merged pages disagree on a hard requirement (eligible vs ineligible). */
  conflict: string | null;
}

/** Collapse leads that are one company. Returns the surviving leads (input order) and what merged. */
export function collapseDuplicateLeads(leads: readonly PipelineLead[]): { leads: PipelineLead[]; merged: MergedLead[] } {
  const groups = new Map<string, PipelineLead[]>();
  for (const l of leads) {
    const k = companyIdentityKey(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const merged: MergedLead[] = [];
  const keepers = new Map<PipelineLead, PipelineLead>();
  for (const [identity, g] of groups) {
    if (g.length === 1) { keepers.set(g[0], g[0]); continue; }
    const best = [...g].sort((a, b) => (STRENGTH[b.statuses.qualification] ?? 0) - (STRENGTH[a.statuses.qualification] ?? 0) || b.rank.score - a.rank.score)[0];
    const others = g.filter((x) => x !== best);
    const contradicted = best.statuses.qualification === "eligible" && others.some((x) => x.statuses.qualification === "ineligible");
    const conflict = contradicted
      ? `one company, ${g.length} records: ${others.filter((x) => x.statuses.qualification === "ineligible").map((x) => x.company.linkedinUrl ?? x.company.key).join(", ")} disproves a requirement that ${best.company.linkedinUrl ?? best.company.key} passes`
      : null;
    const kept: PipelineLead = {
      ...best,
      company: { ...best.company, providerCompanyIds: [...new Set([...best.company.providerCompanyIds, ...others.flatMap((x) => x.company.providerCompanyIds)])] },
      statuses: contradicted ? { ...best.statuses, qualification: "pending" } : best.statuses,
      ...(contradicted ? { rank: { ...best.rank, lane: "review" as const } } : {}),
      provenance: {
        ...best.provenance,
        providers: [...new Set([...best.provenance.providers, ...others.flatMap((x) => x.provenance.providers)])],
        conflicts: [...(best.provenance.conflicts ?? []), ...(conflict ? [{ field: "identity", values: g.map((x) => ({ provider: x.company.linkedinUrl ?? x.company.key, value: x.statuses.qualification })) }] : [])],
        mergedFrom: others.map((x) => ({ leadKey: x.leadKey, companyKey: x.company.key, linkedinUrl: x.company.linkedinUrl, qualification: x.statuses.qualification })),
      },
    };
    keepers.set(best, kept);
    merged.push({ identity, kept: best.leadKey, merged: kept.provenance.mergedFrom!, conflict });
  }
  return { leads: leads.filter((l) => keepers.has(l)).map((l) => keepers.get(l)!), merged };
}
