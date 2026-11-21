// PROTOTYPE (offline, not imported by any live code). Architecture review 2026-11-20.
//
// CAPABILITY-AWARE ACTOR SELECTION, FIVE SEPARATE STEPS:
//
//   1 needs      Mission Contract → the capabilities this mission needs (deterministic;
//                the contract is the ONLY reading of the request — no second interpreter)
//   2 candidates catalogue entries that provide each capability (approved first)
//   3 input      semantic slots → the chosen Actor's own properties; any requirement the
//                Actor cannot filter is DISCLOSED (post-filtered by a named step, or
//                unverifiable) — never silently dropped, widened or narrowed
//   4 validate   the built input against the Actor's CAPTURED input schema (types, enums,
//                bounds, required, unknown properties)
//   5 gate       cost (worst case from the Actor's own pricing and limit semantics) and
//                authorization (only `approved` Actors are executable; `catalogued` ones
//                are proposals that need an owner-approved allowlist change)
//
// A model never picks an Actor id, writes an Actor input or approves spend here.
import type { MissionContract, Requirement } from "../../supabase/functions/_shared/missionContract/contract.ts";
import { CATALOG, LINKEDIN_INDUSTRY_IDS, LINKEDIN_LOCATIONS, ROLE_FAMILY_FUNCTIONS, type ActorEntry, type Capability, type Slot } from "./catalog.ts";

type Req<D extends Requirement["dimension"]> = Extract<Requirement, { dimension: D }>;

export interface Need { capability: Capability; why: string; requirementIds: string[] }
export interface Disclosure { requirementId: string; label: string; handling: "filtered_at_source" | "post_filtered" | "unverifiable"; by: string | null; note: string }
export interface InputCheck { ok: boolean; errors: string[] }
export interface StepPlan {
  capability: Capability; actorId: string | null; approval: "approved" | "catalogued" | "none";
  input: Record<string, unknown> | null; runOptions: { maxItems: number; maxTotalChargeUsd?: number; memoryMb?: number; timeoutS?: number } | null;
  worstUsd: number; check: InputCheck; disclosures: Disclosure[]; executable: boolean; reason: string;
}
export interface SelectionPlan { needs: Need[]; steps: StepPlan[]; worstUsd: number; ceilingUsd: number; executable: boolean; blockers: string[] }

const SNAPSHOTS = new URL("./snapshots/", import.meta.url);
const schemaOf = (e: ActorEntry): Record<string, unknown> | null =>
  e.schemaFile ? JSON.parse(Deno.readTextFileSync(new URL(e.schemaFile, SNAPSHOTS))) : null;
const reqs = <D extends Requirement["dimension"]>(c: MissionContract, d: D) =>
  c.requirements.filter((r): r is Req<D> => r.dimension === d);

// ── 1 needs ──────────────────────────────────────────────────────────────────
export function needsOf(c: MissionContract): Need[] {
  const out: Need[] = [];
  const hiring = reqs(c, "signal").filter((s) => s.kind === "hiring" && s.necessity === "required");
  const firmo = [...reqs(c, "industry").filter((r) => r.facet === "industry" && r.polarity === "include"), ...reqs(c, "company_size")];
  if (hiring.length) out.push({ capability: "discover_companies_by_hiring", why: "the request requires a hiring signal: discover BY it", requirementIds: hiring.map((r) => r.id) });
  else if (firmo.length || reqs(c, "geography").length) out.push({ capability: "discover_companies_by_firmographics", why: "no signal is required: discover by industry, size and location", requirementIds: firmo.map((r) => r.id) });
  const hq = reqs(c, "geography").filter((g) => g.necessity === "required");
  const size = reqs(c, "company_size");
  if (hq.length || size.length) out.push({ capability: "verify_company_record", why: "headquarters and size are proven only by the company's own record", requirementIds: [...hq, ...size].map((r) => r.id) });
  const bm = reqs(c, "industry").filter((r) => r.facet === "business_model");
  const consumerExcluded = reqs(c, "exclusion").some((x) => JSON.stringify(x.values).toLowerCase().includes("consumer"));
  if (bm.some((r) => r.necessity === "required") || consumerExcluded) out.push({ capability: "verify_business_model", why: "a REQUIRED business model is proven only by first-party pages", requirementIds: bm.map((r) => r.id) });
  if (c.deliverable.entity === "person") out.push({ capability: "people_at_companies", why: `the deliverable is people (${c.deliverable.personRoles.join(", ") || "any role"})`, requirementIds: [] });
  return out;
}

// ── 2 candidates ─────────────────────────────────────────────────────────────
export function candidatesFor(cap: Capability): ActorEntry[] {
  return CATALOG.filter((e) => e.capability === cap).sort((a, b) => (a.approval === b.approval ? 0 : a.approval === "approved" ? -1 : 1));
}

// ── 3 input ──────────────────────────────────────────────────────────────────
const SIZE_BANDS: [number, number | null, string][] = [[1, 10, "1-10"], [11, 50, "11-50"], [51, 200, "51-200"], [201, 500, "201-500"], [501, 1000, "501-1000"], [1001, 5000, "1001-5000"], [5001, 10000, "5001-10000"], [10001, null, "10001+"]];
/** Every LinkedIn size band that OVERLAPS [min, max]. A band wider than the range is post-filtered by the record. */
export function sizeBands(min: number | null, max: number | null): { bands: string[]; exact: boolean } {
  const lo = min ?? 1, hi = max ?? Infinity;
  const hit = SIZE_BANDS.filter(([a, b]) => (b ?? Infinity) >= lo && a <= hi);
  const exact = hit.length > 0 && hit[0][0] === lo && (hit.at(-1)![1] ?? Infinity) === hi;
  return { bands: hit.map(([, , l]) => l), exact };
}
const postedLimit = (days: number | null) => (days === null ? "month" : days <= 1 ? "24h" : days <= 7 ? "week" : "month");

export function buildInput(e: ActorEntry, c: MissionContract, opts: { limit: number; companyUrls?: string[]; startUrls?: { url: string }[] }) {
  const input: Record<string, unknown> = { ...(e.fixed ?? {}) };
  const disclosures: Disclosure[] = [];
  const put = (slot: Slot, value: unknown) => { const prop = e.slots[slot]; if (prop) input[prop] = value; return !!prop; };
  const verifier = (what: string) => CATALOG.find((x) => x.approval === "approved" && x.proves.includes(what))?.actorId ?? null;
  const disclose = (r: Requirement, filtered: boolean, proves: string, note: string) => {
    const by = verifier(proves);
    disclosures.push({ requirementId: r.id, label: r.display.label, handling: filtered ? "filtered_at_source" : by ? "post_filtered" : "unverifiable", by: filtered ? e.actorId : by, note });
  };
  const isDiscovery = e.capability.startsWith("discover_");

  if (isDiscovery) {
    for (const s of reqs(c, "signal").filter((x) => x.kind === "hiring")) {
      const titles = s.roleTerms ?? [];
      const functions = [...new Set((s.roleFamilies ?? []).flatMap((f) => ROLE_FAMILY_FUNCTIONS[f] ?? []))];
      let filtered = false;
      if (titles.length) filtered = put("jobTitles", titles.slice(0, 3));
      // A FAMILY IS A FUNCTION, NOT ONE TITLE: "expanding their sales teams" searches the Sales
      // function, never just "Account Executive" (live behaviour today: review r3).
      if (!titles.length && functions.length) filtered = put("jobFunctions", functions);
      if (s.window?.days != null || e.slots.recencyDays) put("recencyDays", postedLimit(s.window?.days ?? null));
      disclose(s, filtered, "hiring", filtered ? `searched as ${titles.length ? `titles ${JSON.stringify(titles.slice(0, 3))}` : `LinkedIn functions ${JSON.stringify(functions)}`}` : "no title or function filter on this Actor");
    }
    const places = reqs(c, "geography").filter((g) => g.polarity === "include");
    const locs = places.map((g) => LINKEDIN_LOCATIONS[g.place] ?? g.place);
    const placed = locs.length ? put("locations", locs) : false;
    for (const g of places) disclose(g, false, "headquarters", placed ? `narrowed by LinkedIn location "${LINKEDIN_LOCATIONS[g.place] ?? g.place}" (job or company location, not HQ): HQ is proven by the record` : "not filterable here");
    const inds = reqs(c, "industry").filter((r) => r.facet === "industry" && r.polarity === "include");
    const ids = [...new Set(inds.flatMap((r) => LINKEDIN_INDUSTRY_IDS[r.value] ?? []))];
    const unmapped = inds.filter((r) => !LINKEDIN_INDUSTRY_IDS[r.value]);
    const industryFiltered = ids.length ? put("industries", ids) : false;
    // NEVER A CONCEPT IN A NAME INDEX. linkedin-company-search's `searchQuery` matches company
    // NAMES; a concept ("B2B SaaS") returns a successful, empty, still-billed run (V2 learned this
    // live: leadCapabilityEngine.ts, compileHarvestCompanySearchInput). An industry with no
    // reviewed code is disclosed as not narrowed — it is never written into `query`.
    for (const r of inds) disclose(r, false, "industry_verified", LINKEDIN_INDUSTRY_IDS[r.value] && industryFiltered ? `narrowed by LinkedIn industry ids ${JSON.stringify(LINKEDIN_INDUSTRY_IDS[r.value])}; a taxonomy label proves no industry` : "no reviewed LinkedIn industry code: not narrowed at source (searchQuery matches names, never concepts)");
    void unmapped;
    for (const s of reqs(c, "company_size")) {
      const b = sizeBands(s.min, s.max);
      const sized = put("companySize", b.bands);
      disclose(s, sized && b.exact, "size_band", sized ? (b.exact ? `LinkedIn bands ${JSON.stringify(b.bands)}` : `LinkedIn bands ${JSON.stringify(b.bands)} are wider than ${s.min ?? "any"}–${s.max ?? "any"}: post-filtered by the record`) : "no size filter on this Actor");
    }
  }
  if (opts.companyUrls) put("companyUrls", opts.companyUrls);
  if (opts.startUrls) put("startUrls", opts.startUrls);
  put("limit", opts.limit);
  for (const k of Object.keys(input)) if (input[k] === "" || (Array.isArray(input[k]) && !(input[k] as unknown[]).length)) delete input[k];
  return { input, disclosures };
}

// ── 4 validate ───────────────────────────────────────────────────────────────
type Prop = { type?: string; enum?: unknown[]; items?: { enum?: unknown[] }; maximum?: number; minimum?: number };
export function validateInput(schema: Record<string, unknown> | null, input: Record<string, unknown>): InputCheck {
  if (!schema) return { ok: false, errors: ["no captured input schema: cannot validate, so cannot run"] };
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const errors: string[] = [];
  for (const req of (schema.required ?? []) as string[]) if (!(req in input)) errors.push(`missing required property "${req}"`);
  for (const [k, v] of Object.entries(input)) {
    const p = props[k];
    if (!p) { errors.push(`unknown property "${k}"`); continue; }
    const t = Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
    if (p.type && p.type !== t && !(p.type === "number" && t === "integer")) errors.push(`"${k}" is ${t}, schema says ${p.type}`);
    if (p.enum && !p.enum.includes(v)) errors.push(`"${k}"=${JSON.stringify(v)} is not one of ${JSON.stringify(p.enum)}`);
    if (p.items?.enum && Array.isArray(v)) for (const x of v) if (!p.items.enum.includes(x)) errors.push(`"${k}" item ${JSON.stringify(x)} is not one of the schema's ${p.items.enum.length} values`);
    if (typeof v === "number" && p.maximum !== undefined && v > p.maximum) errors.push(`"${k}"=${v} exceeds maximum ${p.maximum}`);
    if (typeof v === "number" && p.minimum !== undefined && v < p.minimum) errors.push(`"${k}"=${v} is below minimum ${p.minimum}`);
  }
  return { ok: !errors.length, errors };
}

// ── 5 gate ───────────────────────────────────────────────────────────────────
export function worstCaseUsd(e: ActorEntry, input: Record<string, unknown>, runMaxItems: number): number {
  if (e.pricing.model === "compute") return Math.ceil((e.pricing.memoryMb / 1024) * (e.pricing.timeoutS / 3600) * e.pricing.usdPerComputeUnit * 1e5) / 1e5;
  // per_query Actors return up to maxItems PER (title × location) query; the run-level
  // maxItems option caps the charged items for the run as a whole.
  const queries = e.limitSemantics === "per_query" ? Math.max(1, ((input[e.slots.jobTitles ?? ""] as unknown[] | undefined)?.length ?? 1)) * Math.max(1, ((input[e.slots.locations ?? ""] as unknown[] | undefined)?.length ?? 1)) : 1;
  const items = Math.min(runMaxItems, (Number(input[e.slots.limit ?? ""]) || runMaxItems) * queries);
  return Math.round((e.pricing.startUsd + e.pricing.perItemUsd * items) * 1e6) / 1e6;
}

export function planSelection(c: MissionContract, opts: { ceilingUsd?: number; allowReviewOnly?: boolean } = {}): SelectionPlan {
  const ceilingUsd = opts.ceilingUsd ?? 0.25;
  const wanted = c.deliverable.count ?? 5;
  const needs = needsOf(c);
  const steps: StepPlan[] = [];
  const blockers: string[] = [];
  for (const n of needs) {
    const [e] = candidatesFor(n.capability);
    if (!e) { steps.push({ capability: n.capability, actorId: null, approval: "none", input: null, runOptions: null, worstUsd: 0, check: { ok: false, errors: [] }, disclosures: [], executable: false, reason: "no Actor in the catalogue provides this capability" }); blockers.push(`${n.capability}: no Actor`); continue; }
    // Over-fetch for losses to verification, but stay proportional to the request.
    // Same proportions as the live strategy (20 jobs / 10 records for 5; 80 / 40 for 25).
    const limit = n.capability === "verify_business_model" ? Math.min(24, Math.ceil(wanted * 1.5) * 3)
      : n.capability === "verify_company_record" ? Math.max(10, Math.ceil(wanted * 1.6)) : Math.max(20, Math.ceil(wanted * 3.2));
    const sample = n.capability === "verify_company_record" ? { companyUrls: Array.from({ length: limit }, (_, i) => `https://www.linkedin.com/company/discovered-${i + 1}`) }
      : n.capability === "verify_business_model" ? { startUrls: [{ url: "https://discovered.example/" }] } : {};
    const { input, disclosures } = buildInput(e, c, { limit, ...sample });
    const check = validateInput(schemaOf(e), input);
    const worstUsd = worstCaseUsd(e, input, limit);
    const executable = e.approval === "approved" && check.ok;
    const reason = e.approval !== "approved" ? `${e.actorId} is catalogued, not approved: an owner-reviewed allowlist change is needed before it can run`
      : !check.ok ? `input fails the Actor's schema: ${check.errors.join("; ")}` : "approved Actor, schema-valid input";
    if (!executable) blockers.push(`${n.capability}: ${reason}`);
    steps.push({ capability: n.capability, actorId: e.actorId, approval: e.approval, input, runOptions: { maxItems: limit, ...(e.pricing.model === "compute" ? { memoryMb: e.pricing.memoryMb, timeoutS: e.pricing.timeoutS } : { maxTotalChargeUsd: worstUsd }) }, worstUsd, check, disclosures, executable, reason });
  }
  const worstUsd = Math.round(steps.reduce((s, x) => s + x.worstUsd, 0) * 1e6) / 1e6;
  if (worstUsd > ceilingUsd) blockers.push(`worst case $${worstUsd} exceeds the $${ceilingUsd} ceiling`);
  // NO DISCOVERY STEP, NO PLAN: a mission none of whose needs DISCOVERS anything is not
  // "executable at $0" — it has no way to find a single company.
  if (!needs.some((n) => n.capability.startsWith("discover_"))) blockers.push("no capability in the catalogue can discover companies for this mission");
  // A REQUIRED signal with no capability (funding, news, headcount…) blocks, by name.
  for (const s of reqs(c, "signal").filter((x) => x.necessity === "required" && x.kind !== "hiring")) blockers.push(`"${s.display.label}": no capability provides a ${s.kind} signal`);
  // A REQUIRED disclosed requirement ("Not checked: using HubSpot") blocks, as in the live engine.
  for (const u of reqs(c, "unsupported").filter((x) => x.necessity === "required")) blockers.push(`"${u.display.label}": cannot be checked by any capability`);
  // As the live engine: a REQUIRED requirement no approved step can prove blocks the plan
  // unless the owner explicitly accepts review-only results (they stay "needs verification").
  if (!opts.allowReviewOnly) for (const d of steps.flatMap((s) => s.disclosures)) if (d.handling === "unverifiable") blockers.push(`"${d.label}": no approved step can prove it (allow review-only to run)`);
  return { needs, steps, worstUsd, ceilingUsd, executable: blockers.length === 0, blockers };
}

// ── AI-assisted discovery: PROPOSALS ONLY ───────────────────────────────────
// What Apify's Store search (the same backend as Apify AI and the MCP server's
// `search-actors`) adds: CANDIDATES for a capability the catalogue lacks. A proposal is never
// executable. It names the checks a reviewer must complete before an allowlist change.
export interface StoreSnapshot { capturedAt: string; results: Record<string, { id: string; title: string; totalUsers?: number; pricingModel?: string | null }[]> }
export function proposeFromStore(snap: StoreSnapshot, storeCapability: string, catalogued = CATALOG.map((e) => e.actorId)) {
  return (snap.results[storeCapability] ?? [])
    .filter((a) => a.pricingModel === "PAY_PER_EVENT" || a.pricingModel === "FREE")
    .sort((a, b) => (b.totalUsers ?? 0) - (a.totalUsers ?? 0))
    .map((a) => ({
      actorId: a.id, title: a.title, users: a.totalUsers ?? null, alreadyCatalogued: catalogued.includes(a.id), executable: false as const,
      reviewChecklist: ["capture input schema (GET /v2/acts/{id}/builds/default)", "capture pricing events and limit semantics", "field-test on fixtures, then one owner-approved capped run", "map its fields to evidence dimensions (what it PROVES vs CLAIMS)", "add to the allowlist in a reviewed PR"],
    }));
}
