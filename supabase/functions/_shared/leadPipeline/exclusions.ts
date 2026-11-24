// What Agentory already knows: existing Leads, CRM relationships, outreach
// history and holds. Discovery must respect all of them.
//
//   existing Lead     the company/person keeps its Lead ID; the candidate is
//                     marked `existing`, never re-created as new
//   CRM relationship  customer / partner / open deal: never queued for outreach
//   outreach hold     do-not-contact, opted out, bounced, recently contacted:
//                     outreach readiness is BLOCKED with the hold's reason
//
// Identity is matched on identifiers only (company domain / LinkedIn slug /
// provider id; person LinkedIn slug / provider person id). A name alone never
// matches — two "Acme"s are not one company.

import { companyLinkedInSlug, normalizeDomain } from "../decisionMaker/companyIdentity.ts";
import { personLinkedInSlug } from "../decisionMaker/personProfile.ts";

export type HoldReason = "do_not_contact" | "opted_out" | "bounced" | "recently_contacted" | "legal_hold" | "other";

export interface ExistingRecord {
  /** Agentory's own id for the lead / account / contact. */
  leadId: string | null;
  kind: "account" | "contact" | "lead_candidate";
  companyDomain?: string | null;
  companyLinkedinUrl?: string | null;
  providerCompanyIds?: string[];
  personLinkedinUrl?: string | null;
  providerPersonIds?: string[];
  crmRelationship?: "customer" | "partner" | "open_deal" | "former_customer" | null;
  hold?: { reason: HoldReason; until?: string | null; note?: string | null } | null;
}

export interface ExclusionVerdict {
  existingLeadIds: string[];
  crmRelationship: ExistingRecord["crmRelationship"];
  holds: { reason: HoldReason; until: string | null; source: string | null }[];
  /** Blocks outreach (not discovery): a CRM relationship or an active hold. */
  blocksOutreach: boolean;
  reasons: string[];
}

export class ExclusionIndex {
  private byKey = new Map<string, ExistingRecord[]>();
  constructor(records: readonly ExistingRecord[], private now: () => Date = () => new Date()) {
    for (const r of records) for (const k of this.keysOf(r)) this.byKey.set(k, [...(this.byKey.get(k) ?? []), r]);
  }

  private keysOf(r: ExistingRecord): string[] {
    const out: string[] = [];
    const d = normalizeDomain(r.companyDomain ?? null);
    if (d) out.push(`co:d:${d}`);
    const li = companyLinkedInSlug(r.companyLinkedinUrl ?? null);
    if (li) out.push(`co:li:${li}`);
    for (const id of r.providerCompanyIds ?? []) out.push(`co:id:${id}`);
    const pl = personLinkedInSlug(r.personLinkedinUrl ?? null);
    if (pl) out.push(`pe:li:${pl}`);
    for (const id of r.providerPersonIds ?? []) out.push(`pe:id:${id}`);
    return out;
  }

  private verdict(hits: ExistingRecord[], scope: string): ExclusionVerdict {
    const uniq = [...new Set(hits)];
    const now = this.now().getTime();
    const holds = uniq.flatMap((r) => r.hold && (!r.hold.until || Date.parse(r.hold.until) > now)
      ? [{ reason: r.hold.reason, until: r.hold.until ?? null, source: r.leadId }] : []);
    const crm = uniq.find((r) => r.crmRelationship)?.crmRelationship ?? null;
    const ids = [...new Set(uniq.map((r) => r.leadId).filter((x): x is string => !!x))];
    const reasons = [
      ...(ids.length ? [`${scope} already in Agentory (${ids.join(", ")})`] : []),
      ...(crm ? [`${scope} has a CRM relationship: ${crm}`] : []),
      ...holds.map((h) => `${scope} outreach hold: ${h.reason}${h.until ? ` until ${h.until.slice(0, 10)}` : ""}`),
    ];
    return { existingLeadIds: ids, crmRelationship: crm, holds, blocksOutreach: !!crm || holds.length > 0, reasons };
  }

  company(c: { domains: string[]; linkedinUrls: string[]; providerIds: string[] }): ExclusionVerdict {
    const keys = [
      ...c.domains.map((d) => normalizeDomain(d)).filter(Boolean).map((d) => `co:d:${d}`),
      ...c.linkedinUrls.map((u) => companyLinkedInSlug(u)).filter(Boolean).map((s) => `co:li:${s}`),
      ...c.providerIds.map((id) => `co:id:${id}`),
    ];
    return this.verdict(keys.flatMap((k) => this.byKey.get(k) ?? []), "company");
  }

  person(p: { linkedinUrls: string[]; providerIds: string[] }): ExclusionVerdict {
    const keys = [
      ...p.linkedinUrls.map((u) => personLinkedInSlug(u)).filter(Boolean).map((s) => `pe:li:${s}`),
      ...p.providerIds.map((id) => `pe:id:${id}`),
    ];
    return this.verdict(keys.flatMap((k) => this.byKey.get(k) ?? []), "person");
  }
}
