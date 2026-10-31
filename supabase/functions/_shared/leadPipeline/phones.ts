// Founder / decision-maker phone enrichment and classification.
//
// Enrichment is separate from discovery and separately authorized: only an
// EnrichmentAuthorization naming the person (budget.ts) unlocks a lookup, and
// only for a lead the shared engine judged ELIGIBLE, whose provider row says it
// holds a number (has_phone), and that no outreach hold or CRM relationship
// blocks. One lookup = 1 LeadOcean record, found or not, under an idempotency
// key — a repeated request replays, a charge-uncertain one is never retried.
//
// Every number is put in exactly one class:
//
//   verified_person_direct        independently verified to reach THIS person
//                                 (attachIndependentEvidence with evidence from a
//                                 source other than the provider). Never set by
//                                 a provider's word alone.
//   unverified_person_associated  the provider associates it with the person
//                                 (mobile / direct); nothing independent yet
//   company_switchboard           an office line, or a number equal to the
//                                 company's own published number
//   invalid_or_mismatched         not a dialable number, or the person's
//                                 current employment contradicts the company
//   no_number                     the lookup returned nothing (or none held)
//
// do-not-call is a FLAG on any class: it blocks outreach, it does not reclassify.
// Phone values never enter reports: `masked` and `valueHash` do.
//
// Endpoint: POST /v1/people/phone (OpenAPI, read 2026-10-31): exactly one of
// linkedin_url | email | phone | person_id; 1 record per call, found or not; the
// same cached lookup as /v2/people/phone and /v1/people/enrich ("doors onto the
// same lookup"). Response: {success, data:{key, has_phone, contact_phones:[{phone,
// type, ddi, dnc, carrier, priority, score}]}, meta}. `dnc` is published but not
// populated at source: null is UNKNOWN, never clearance (`dnc` below).
//
// Why v1: in test E the v2 path answered 401 "Missing or malformed x-api-key"
// while /v1/search succeeded — the workspace's Network Secret for api.leadocean.io
// is injected on /v1/* paths only (confirmed with rejected, uncounted requests).
// `leadOceanPhoneAuthProbe` runs before any paid lookup and stops on 401.

import type { AdapterDeps } from "../discoveryProviders/adapter.ts";
import { pickStr } from "../discoveryProviders/adapter.ts";
import { callProvider } from "../discoveryProviders/http.ts";
import type { EnrichmentAuthorization, UsageLedger } from "../discoveryProviders/budget.ts";
import { ProviderError, type ContactPoint, type ContactPointVerification } from "../discoveryProviders/types.ts";
import { sha256Hex } from "../providerInputFingerprint.ts";

export type PhoneClass = "verified_person_direct" | "unverified_person_associated" | "company_switchboard" | "invalid_or_mismatched" | "no_number";
export const PHONE_CLASSES: readonly PhoneClass[] = ["verified_person_direct", "unverified_person_associated", "company_switchboard", "invalid_or_mismatched", "no_number"];

/** Whether the person still works at the company, and on whose word. */
export type EmploymentStatus =
  /** A source other than the phone's provider shows current employment. */
  | "independent_current"
  /** Only the provider's own record says so (LeadOcean contact_current_experiences). Self-consistent, not verified. */
  | "provider_consistent"
  /** Evidence shows the person is no longer, or never was, at this company. */
  | "mismatch"
  | "unknown";

export interface EmploymentEvidence { status: EmploymentStatus; sources: string[]; checkedAt: string | null }

export interface PhoneRecord {
  /** Agentory's Lead id for the person/company when it already exists, else null (a new candidate). */
  leadId: string | null;
  personKey: string;
  providerPersonId: string | null;
  provider: "leadocean";
  endpoint: string;
  /** Only when a lookup returned a number; never written to logs or reports. */
  value: string | null;
  e164: string | null;
  masked: string | null;
  valueHash: string | null;
  type: string | null;
  priority: number | null;
  class: PhoneClass;
  verification: ContactPointVerification | null;
  doNotCall: boolean;
  /** The provider's do-not-call field: `flagged` only when it says true; `unknown` otherwise (it is unpopulated at source). */
  dnc: "flagged" | "unknown";
  /** True when the number is outside the NANP (+1). Phone test P1: 3 of 5 founder numbers at US-HQ companies were. */
  international: boolean | null;
  /** How sure the number belongs to this person (not whether it connects). */
  matchConfidence: "high" | "medium" | "low" | "none";
  employment: EmploymentEvidence;
  cost: { records: number; basis: "charged" | "assumed_worst_case" | "replayed" | "none" };
  retrievedAt: string | null;
  reasons: string[];
}

/** US/NANP-aware normalisation. Anything that is not 10–15 digits is not dialable. */
export function toE164(raw: string | null | undefined, defaultCountry = "US"): string | null {
  if (!raw) return null;
  const plus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D+/g, "");
  if (plus) return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  if (defaultCountry === "US") {
    if (digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1") && /^1[2-9]\d{2}[2-9]/.test(digits)) return `+${digits}`;
    return null;
  }
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
}

export const maskPhone = (e164: string | null) => (e164 ? `${e164.slice(0, 2)}•••••${e164.slice(-4)}` : null);

export interface ClassifyContext {
  /** The company's own published numbers (switchboards). */
  companyNumbers?: string[];
  employment: EmploymentEvidence;
}

/** Classify one contact point. The provider's word never makes a number verified. */
export function classifyPhone(cp: ContactPoint | null, ctx: ClassifyContext): { class: PhoneClass; e164: string | null; matchConfidence: PhoneRecord["matchConfidence"]; reasons: string[] } {
  if (!cp) return { class: "no_number", e164: null, matchConfidence: "none", reasons: ["no number returned"] };
  const e164 = toE164(cp.value);
  if (!e164) return { class: "invalid_or_mismatched", e164: null, matchConfidence: "none", reasons: ["not a dialable number"] };
  if (ctx.employment.status === "mismatch") return { class: "invalid_or_mismatched", e164, matchConfidence: "none", reasons: ["the person's current employment does not match this company"] };
  const company = new Set((ctx.companyNumbers ?? []).map((n) => toE164(n)).filter(Boolean));
  const type = (cp.type ?? "").toLowerCase();
  if (company.has(e164)) return { class: "company_switchboard", e164, matchConfidence: "low", reasons: ["equals the company's published number"] };
  if (type === "office" || type === "work" || type === "hq" || type === "switchboard") return { class: "company_switchboard", e164, matchConfidence: "low", reasons: [`the provider types it "${type}"`] };
  const independent = cp.verification === "independently_verified" && (cp.evidence ?? []).some((e) => e.kind !== cp.provider);
  if (independent && ctx.employment.status === "independent_current") {
    return { class: "verified_person_direct", e164, matchConfidence: "high", reasons: ["independent evidence ties the number to the person", "independent evidence of current employment"] };
  }
  const reasons = [`the provider associates it with the person${type ? ` (${type})` : ""}; not independently verified`];
  if (independent) reasons.push("number evidence is independent but current employment is not");
  return { class: "unverified_person_associated", e164, matchConfidence: type === "mobile" || type === "direct" ? "medium" : "low", reasons };
}

export const LEADOCEAN_PHONE_PATH = "/v1/people/phone";

/**
 * FREE authentication check for the phone path: an empty body is rejected by
 * validation (400) after the key is accepted, and LeadOcean does not count
 * rejected requests ("Requests we reject are not counted"). 400 → the key reaches
 * this path; 401/403 → it does not, so no lookup may be attempted.
 */
export async function leadOceanPhoneAuthProbe(deps: AdapterDeps): Promise<{ ok: boolean; status: number | null; reason: string }> {
  const base = deps.baseUrl ?? "https://api.leadocean.io";
  try {
    const res = await deps.fetch(`${base}${LEADOCEAN_PHONE_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": deps.apiKey }, body: "{}" });
    let message = "";
    try { message = String(((await res.json()) as { error?: { message?: unknown } })?.error?.message ?? "").slice(0, 120); } catch { /* non-JSON */ }
    if (res.status === 400) return { ok: true, status: 400, reason: "key accepted on the phone path (validation rejected the empty probe, not counted)" };
    if (res.status === 401) return { ok: false, status: 401, reason: `key not accepted on ${LEADOCEAN_PHONE_PATH}: ${message || "unauthorized"}` };
    if (res.status === 403) return { ok: false, status: 403, reason: `key lacks the scope for ${LEADOCEAN_PHONE_PATH}: ${message || "forbidden"}` };
    return { ok: false, status: res.status, reason: `unexpected ${res.status} from the probe; no lookup attempted` };
  } catch (e) {
    return { ok: false, status: null, reason: `probe failed (${(e as Error)?.name ?? "error"})` };
  }
}

/** One LeadOcean phone lookup (1 record). Only enrichPhones calls this. */
export async function leadOceanFindPhone(deps: AdapterDeps, input: { personId?: string | null; linkedinUrl?: string | null }): Promise<{ found: boolean; points: ContactPoint[]; credits: number; recordId: string }> {
  const base = deps.baseUrl ?? "https://api.leadocean.io";
  const body: Record<string, unknown> = {};
  if (input.linkedinUrl) body.linkedin_url = input.linkedinUrl;
  else if (input.personId) body.person_id = input.personId;
  else throw new ProviderError("leadocean", "invalid_request", "a phone lookup needs a person id or LinkedIn URL");
  // maxRetries 0: a metered call is never repeated automatically.
  const r = await callProvider(deps.fetch, { provider: "leadocean", url: `${base}${LEADOCEAN_PHONE_PATH}`, method: "POST", headers: { "x-api-key": deps.apiKey }, body, paid: true, maxRetries: 0 }, deps.sleep);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const j = (r.json ?? {}) as Record<string, unknown>;
  const d = (j.data && typeof j.data === "object" ? j.data : j) as Record<string, unknown>;
  const list = (Array.isArray(d.phones) ? d.phones : Array.isArray(d.contact_phones) ? d.contact_phones : []) as unknown[];
  const recordId = input.personId ?? pickStr(d, ["meta.source_ids.person_id", "person_id"]) ?? "phone-lookup";
  const points: ContactPoint[] = list.flatMap((p): ContactPoint[] => {
    const value = pickStr(p, ["phone", "number"]);
    if (!value) return [];
    const dnc = (p as { dnc?: unknown }).dnc === true;
    return [{ kind: "phone", value, type: pickStr(p, ["type"]), provider: "leadocean", recordId, providerStatus: dnc ? "dnc" : null,
      verification: dnc ? "provider_flagged" : "provider_supplied_unverified", retrievedAt: at }];
  });
  const priority = (p: unknown) => Number((p as { priority?: unknown }).priority ?? 99);
  points.sort((a, b) => priority(list.find((x) => pickStr(x, ["phone", "number"]) === a.value)) - priority(list.find((x) => pickStr(x, ["phone", "number"]) === b.value)));
  const meta = (j.meta ?? {}) as { credits?: unknown };
  return { found: d.has_phone !== false && d.found !== false && points.length > 0, points, credits: typeof meta.credits === "number" ? meta.credits : 1, recordId };
}

export interface PhoneTarget {
  personKey: string;
  leadId: string | null;
  providerPersonId: string | null;
  linkedinUrl: string | null;
  /** The shared engine's verdict for the lead's company. */
  eligibility: "eligible" | "pending" | "ineligible";
  hasPhone: boolean | null;
  /** An outreach hold or CRM relationship (exclusions.ts). */
  outreachBlocked: boolean;
  employment: EmploymentEvidence;
  companyNumbers?: string[];
}

export interface PhoneEnrichment {
  records: PhoneRecord[];
  /** Targets not looked up, and why. Costs nothing. */
  skipped: { personKey: string; reason: string }[];
  recordsCharged: number;
  stopped: string | null;
}

const NOT_LOOKED_UP = (t: PhoneTarget, cls: PhoneClass, reasons: string[], cost: PhoneRecord["cost"]["basis"] = "none", records = 0): PhoneRecord => ({
  leadId: t.leadId, personKey: t.personKey, providerPersonId: t.providerPersonId, provider: "leadocean", endpoint: LEADOCEAN_PHONE_PATH,
  value: null, e164: null, masked: null, valueHash: null, type: null, priority: null, class: cls, verification: null, doNotCall: false, dnc: "unknown", international: null,
  matchConfidence: "none", employment: t.employment, cost: { records, basis: cost }, retrievedAt: null, reasons,
});

/** Who may be looked up: eligible, has a number, not blocked, named in the authorization. */
export function phoneLookupGate(t: PhoneTarget, a: EnrichmentAuthorization | null): string | null {
  if (!a) return "enrichment needs its own authorization";
  if (a.kind !== "enrichment") return "a discovery approval does not authorize enrichment";
  if (!a.phones) return "the authorization does not include phones";
  if (t.eligibility !== "eligible") return `the lead is ${t.eligibility}, not eligible`;
  if (t.outreachBlocked) return "an outreach hold or CRM relationship blocks this person";
  if (t.hasPhone === false) return "the provider holds no number (has_phone false)";
  if (t.hasPhone == null) return "the provider did not say it holds a number";
  if (t.employment.status === "mismatch") return "current employment does not match this company";
  if (!a.personKeys.includes(t.personKey)) return "person not named in the authorization";
  if (!t.providerPersonId && !t.linkedinUrl) return "no LeadOcean id or LinkedIn URL to look up by";
  return null;
}

export async function enrichPhones(input: {
  workspaceId: string; missionId: string; authorization: EnrichmentAuthorization | null;
  targets: readonly PhoneTarget[]; deps: AdapterDeps; ledger: UsageLedger;
  call?: typeof leadOceanFindPhone;
  /** The free auth check run before the first lookup; defaults to the real probe unless `call` is injected (tests). */
  probe?: ((deps: AdapterDeps) => Promise<{ ok: boolean; reason: string }>) | null;
}): Promise<PhoneEnrichment> {
  const a = input.authorization;
  const call = input.call ?? leadOceanFindPhone;
  const records: PhoneRecord[] = [];
  const skipped: PhoneEnrichment["skipped"] = [];
  let charged = 0;
  let stopped: string | null = null;
  if (a && (a.workspaceId !== input.workspaceId || a.missionId !== input.missionId)) {
    return { records, skipped: input.targets.map((t) => ({ personKey: t.personKey, reason: "authorization belongs to another workspace or mission" })), recordsCharged: 0, stopped: "authorization_scope" };
  }
  const probe = input.probe !== undefined ? input.probe : input.call ? null : leadOceanPhoneAuthProbe;
  let probed = false;
  for (const t of input.targets) {
    const refuse = phoneLookupGate(t, a);
    if (refuse) { skipped.push({ personKey: t.personKey, reason: refuse }); continue; }
    if (stopped) { skipped.push({ personKey: t.personKey, reason: `stopped: ${stopped}` }); continue; }
    if (probe && !probed) {
      probed = true;
      const pr = await probe(input.deps);
      if (!pr.ok) { stopped = `auth_probe: ${pr.reason}`; skipped.push({ personKey: t.personKey, reason: `stopped: ${stopped}` }); continue; }
    }
    const key = `${input.missionId}:phone:${t.personKey}`;
    const r = await input.ledger.reserve({ workspaceId: input.workspaceId, missionId: input.missionId, provider: "leadocean", key, credits: 1, providerCap: a!.maxCredits, missionCap: a!.maxCredits });
    if (!r.ok) { skipped.push({ personKey: t.personKey, reason: `ledger: ${r.reason}` }); if (r.reason !== "in_flight") stopped = `ledger ${r.reason}`; continue; }
    if (r.replay) { records.push({ ...(r.result as PhoneRecord), cost: { records: 0, basis: "replayed" } }); continue; }
    try {
      const res = await call(input.deps, { personId: t.providerPersonId, linkedinUrl: t.linkedinUrl });
      const best = res.points.find((p) => p.verification !== "provider_flagged") ?? res.points[0] ?? null;
      const c = classifyPhone(best, { companyNumbers: t.companyNumbers, employment: t.employment });
      const rec: PhoneRecord = {
        ...NOT_LOOKED_UP(t, c.class, c.reasons, "charged", res.credits),
        value: best?.value ?? null, e164: c.e164, masked: maskPhone(c.e164), valueHash: c.e164 ? sha256Hex(c.e164).slice(0, 16) : null,
        type: best?.type ?? null, priority: best ? res.points.indexOf(best) + 1 : null,
        verification: best?.verification ?? null, doNotCall: res.points.some((p) => p.verification === "provider_flagged" && p.value === best?.value),
        dnc: res.points.some((p) => p.verification === "provider_flagged" && p.value === best?.value) ? "flagged" : "unknown",
        matchConfidence: c.matchConfidence, retrievedAt: best?.retrievedAt ?? null,
        international: c.e164 ? !c.e164.startsWith("+1") : null,
      };
      charged += res.credits;
      // The ledger keeps the classification, never the number.
      await input.ledger.settle(key, res.credits, redactPhoneRecord(rec));
      records.push(rec);
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      if (pe?.kind === "invalid_request" && pe.status === 404) {
        // LeadOcean: nobody carries that id, or no identifier to look up by. Counted as a record (worst case).
        await input.ledger.settle(key, 1, NOT_LOOKED_UP(t, "no_number", ["the provider has no record to look up"], "assumed_worst_case", 1));
        charged += 1;
        records.push(NOT_LOOKED_UP(t, "no_number", ["the provider has no record to look up"], "assumed_worst_case", 1));
        continue;
      }
      if (pe?.kind === "charge_uncertain") { await input.ledger.markUncertain(key); charged += 1; stopped = "charge_uncertain"; }
      else { await input.ledger.release(key); if (pe?.kind === "allowance_exhausted" || pe?.kind === "auth_failed" || pe?.kind === "forbidden_scope") stopped = pe.kind; }
      skipped.push({ personKey: t.personKey, reason: `lookup failed (${pe?.kind ?? "error"}); not retried` });
    }
  }
  return { records, skipped, recordsCharged: charged, stopped };
}

/** A report-safe copy: no number in any form (a 10-digit number's hash is reversible by enumeration). `masked` stays. */
export function redactPhoneRecord(r: PhoneRecord): PhoneRecord & { value: null; e164: null; valueHash: null } {
  return { ...r, value: null, e164: null, valueHash: null };
}

/** Employment evidence from what the pipeline holds. LeadOcean's own current-employer flag is provider_consistent at best. */
export function employmentFrom(input: {
  providerSaysCurrent: boolean | null; providerEmployerDomain: string | null; companyDomains: string[];
  independent?: { current: boolean; source: string; at: string } | null;
}): EmploymentEvidence {
  const dom = (d: string | null) => (d ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  if (input.independent) return { status: input.independent.current ? "independent_current" : "mismatch", sources: [input.independent.source], checkedAt: input.independent.at };
  const d = dom(input.providerEmployerDomain);
  if (d && input.companyDomains.length && !input.companyDomains.map(dom).includes(d)) return { status: "mismatch", sources: ["leadocean"], checkedAt: null };
  if (input.providerSaysCurrent === false) return { status: "mismatch", sources: ["leadocean"], checkedAt: null };
  if (input.providerSaysCurrent === true && d) return { status: "provider_consistent", sources: ["leadocean"], checkedAt: null };
  return { status: "unknown", sources: [], checkedAt: null };
}
