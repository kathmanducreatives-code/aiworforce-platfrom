// Contact enrichment — separate from discovery, separately authorized.
//
// Only an EnrichmentAuthorization for this workspace and mission, naming each
// person, unlocks a call; a discovery approval does not. Each call reserves 1
// credit under its own idempotency key (LeadOcean bills enrichment per call,
// found or not), so a repeated request replays instead of paying twice.
//
// Every phone that comes back stays `provider_supplied_unverified` (or
// `provider_flagged` for do-not-call). Only `attachIndependentEvidence` can
// raise a contact point to `independently_verified`, and only with evidence.

import type { AdapterDeps } from "./adapter.ts";
import { leadOceanEnrichPerson } from "./adapters/leadocean.ts";
import type { EnrichmentAuthorization, UsageLedger } from "./budget.ts";
import type { CanonicalPerson } from "./normalize.ts";
import { ProviderError, type ContactPoint } from "./types.ts";

export interface EnrichOutcome {
  personKey: string;
  status: "enriched" | "not_found" | "refused" | "failed" | "replayed";
  reason: string | null;
  contactPoints: ContactPoint[];
  credits: number;
}

export async function enrichContacts(input: {
  workspaceId: string;
  missionId: string;
  authorization: EnrichmentAuthorization | null;
  people: CanonicalPerson[];
  deps: AdapterDeps;
  ledger: UsageLedger;
  /** For tests: the call to make. Defaults to LeadOcean /v1/enrich. */
  call?: typeof leadOceanEnrichPerson;
}): Promise<EnrichOutcome[]> {
  const a = input.authorization;
  const refuse = (reason: string) => input.people.map((p): EnrichOutcome => ({ personKey: p.key, status: "refused", reason, contactPoints: [], credits: 0 }));
  if (!a) return refuse("enrichment needs its own authorization");
  if (a.kind !== "enrichment") return refuse("a discovery approval does not authorize enrichment");
  if (a.workspaceId !== input.workspaceId) return refuse("authorization belongs to another workspace");
  if (a.missionId !== input.missionId) return refuse("authorization belongs to another mission");
  const call = input.call ?? leadOceanEnrichPerson;
  const out: EnrichOutcome[] = [];
  for (const p of input.people) {
    if (!a.personKeys.includes(p.key)) { out.push({ personKey: p.key, status: "refused", reason: "person not named in the authorization", contactPoints: [], credits: 0 }); continue; }
    const lo = p.sources.find((s) => s.provider === "leadocean");
    const linkedin = p.linkedinUrl[0]?.value ?? null;
    if (!lo && !linkedin) { out.push({ personKey: p.key, status: "failed", reason: "no LeadOcean id or LinkedIn URL to enrich by", contactPoints: [], credits: 0 }); continue; }
    const key = `${input.missionId}:enrich:${p.key}:${a.revealEmail ? "e" : ""}${a.phones ? "p" : ""}`;
    const r = await input.ledger.reserve({ workspaceId: input.workspaceId, missionId: input.missionId, provider: "leadocean", key, credits: 1, providerCap: a.maxCredits, missionCap: a.maxCredits });
    if (!r.ok) { out.push({ personKey: p.key, status: "refused", reason: `ledger: ${r.reason}`, contactPoints: [], credits: 0 }); continue; }
    if (r.replay) { out.push({ ...(r.result as EnrichOutcome), status: "replayed", credits: 0 }); continue; }
    try {
      const res = await call(input.deps, { personId: lo?.recordId ?? null, linkedinUrl: linkedin, revealEmail: a.revealEmail });
      const points = res.contactPoints.filter((c) => (c.kind === "email" ? a.revealEmail : a.phones));
      const o: EnrichOutcome = { personKey: p.key, status: res.found ? "enriched" : "not_found", reason: null, contactPoints: points, credits: res.credits };
      await input.ledger.settle(key, res.credits, o);
      out.push(o);
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      if (pe?.kind === "charge_uncertain") await input.ledger.markUncertain(key); else await input.ledger.release(key);
      out.push({ personKey: p.key, status: "failed", reason: pe?.message ?? "enrichment failed", contactPoints: [], credits: 0 });
    }
  }
  return out;
}

/** Raise a contact point to independently verified — only with evidence. */
export function attachIndependentEvidence(cp: ContactPoint, evidence: { kind: string; ref: string; at: string }[]): ContactPoint {
  const real = evidence.filter((e) => e.kind && e.ref && e.at && e.kind !== cp.provider);
  if (!real.length) return cp;
  return { ...cp, verification: "independently_verified", evidence: [...(cp.evidence ?? []), ...real] };
}
