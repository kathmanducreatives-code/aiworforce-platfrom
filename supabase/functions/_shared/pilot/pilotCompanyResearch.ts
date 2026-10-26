// Supplied-source validation ONLY. No research execution, fetch, provider or model seam.
import {
  type CompanyIdentity,
  resolveCompanyIdentity,
} from "../companyIdentity.ts";
import { object, PilotRefusal } from "./pilotPolicy.ts";
export function refuse(code: string): never {
  throw new PilotRefusal(code, 409);
}
export function exactKeys(v: Record<string, unknown>, keys: readonly string[]) {
  if (
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some((k) => !keys.includes(k))
  ) refuse("snapshot_invalid_fields");
}
export function boundedJson<T>(v: T, limit: number): T {
  let text: string;
  try {
    text = JSON.stringify(v);
  } catch {
    return refuse("snapshot_invalid_json");
  }
  if (!text! || new TextEncoder().encode(text).length > limit) {
    refuse("snapshot_too_large");
  }
  return JSON.parse(text!);
}
export function text(v: unknown, max = 2048): string {
  if (
    typeof v !== "string" || !v.trim() || v.length > max || [...v].some((c) => {
      const n = c.codePointAt(0)!;
      return n === 0 || n === 0xfffd || n >= 0xd800 && n <= 0xdfff ||
        n < 32 && ![9, 10, 13].includes(n);
    })
  ) refuse("snapshot_invalid_text");
  return v as string; // Never trim/clean evidence excerpts or rewrite negation.
}
export function timestamp(v: unknown, nullable = false): string | null {
  if (v === null && nullable) return null;
  const s = text(v, 40),
    m =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
        .exec(s);
  if (
    !m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 ||
    Number(m[3]) >
      new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() ||
    Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59 ||
    !Number.isFinite(Date.parse(s))
  ) refuse("snapshot_invalid_timestamp");
  return s;
}
export function publicSourceUrl(v: unknown): string {
  const s = text(v, 1024);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return refuse("snapshot_invalid_url");
  }
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return refuse("snapshot_invalid_url");
  }
  const h = u.hostname;
  if (
    !["http:", "https:"].includes(u.protocol) || u.username || u.password ||
    u.port || u.search || u.hash || !h.includes(".") ||
    !/^[a-z0-9.-]+$/.test(h) || !/\.[a-z]{2,}$/.test(h) ||
    h.split(".").some((p) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p)) ||
    /\.(local|localhost|internal|test|example|invalid)$/.test(h) ||
    [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  ) refuse("snapshot_unsafe_url");
  return u.href;
}
export interface Subject {
  domain: string | null;
  linkedin_url: string | null;
  apollo_account_id: string | null;
}
export function subject(raw: unknown): Subject {
  const s = object(raw);
  exactKeys(s, ["domain", "linkedin_url", "apollo_account_id"]);
  let domain: string | null = null, linkedin: string | null = null;
  if (s.domain !== null) {
    const u = new URL(publicSourceUrl(`https://${text(s.domain, 253)}`));
    if (u.pathname !== "/") refuse("snapshot_invalid_domain");
    domain = u.hostname.replace(/^www\./, "");
  }
  if (s.linkedin_url !== null) {
    const u = new URL(publicSourceUrl(s.linkedin_url));
    if (
      !["linkedin.com", "www.linkedin.com"].includes(u.hostname) ||
      !/^\/company\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname)
    ) refuse("snapshot_invalid_company_linkedin");
    linkedin = `https://www.linkedin.com${u.pathname.replace(/\/$/, "")}`;
  }
  if (!domain && !linkedin) refuse("snapshot_strong_company_identity_required");
  if (
    s.apollo_account_id !== null &&
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text(s.apollo_account_id, 128))
  ) refuse("snapshot_invalid_apollo_identity");
  return {
    domain,
    linkedin_url: linkedin,
    apollo_account_id: s.apollo_account_id as string | null,
  };
}
export function sameSubject(target: Subject, source: Subject): void {
  if (
    target.domain && source.domain && target.domain !== source.domain ||
    target.linkedin_url && source.linkedin_url &&
      target.linkedin_url !== source.linkedin_url ||
    target.apollo_account_id && source.apollo_account_id &&
      target.apollo_account_id !== source.apollo_account_id
  ) refuse("snapshot_company_identity_conflict");
  if (
    !(target.domain && target.domain === source.domain) &&
    !(target.linkedin_url && target.linkedin_url === source.linkedin_url)
  ) refuse("snapshot_company_identity_ambiguous");
}
export function companyIdentity(s: Subject, name: string): CompanyIdentity {
  return resolveCompanyIdentity({
    name,
    domain: s.domain,
    linkedin_url: s.linkedin_url,
  });
}
export interface SuppliedSource {
  id: string;
  workspace_id: string;
  client_binding_id: string;
  subject: Subject;
  role: "prospect";
  kind: "company_website" | "supplied_document";
  url: string | null;
  requested_url: string | null;
  redirect_chain: string[];
  locator: string;
  body: string;
  collected_at: string | null;
  updated_at: string | null;
  event_at: string | null;
  valid_until: string | null;
  quotes: { start: number; end: number; excerpt: string }[];
}
export function normalizeSuppliedSource(
  raw: unknown,
  scope: { workspace_id: string; client_binding_id: string },
  target: Subject,
  asOf: string,
): SuppliedSource {
  const r = object(raw);
  exactKeys(r, [
    "id",
    "workspace_id",
    "client_binding_id",
    "subject",
    "role",
    "kind",
    "url",
    "requested_url",
    "redirect_chain",
    "locator",
    "body",
    "collected_at",
    "updated_at",
    "event_at",
    "valid_until",
    "quotes",
  ]);
  if (
    r.workspace_id !== scope.workspace_id ||
    r.client_binding_id !== scope.client_binding_id
  ) refuse("snapshot_source_scope_mismatch");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(text(r.id, 64)) || r.id === "csv") {
    refuse("snapshot_invalid_source_id");
  }
  if (
    r.role !== "prospect" ||
    !["company_website", "supplied_document"].includes(String(r.kind))
  ) refuse("snapshot_seller_source_contamination");
  const sub = subject(r.subject);
  sameSubject(target, sub);
  if (
    !Array.isArray(r.redirect_chain) || r.redirect_chain.length ||
    r.requested_url !== r.url
  ) refuse("snapshot_redirect_not_authorized");
  const url = r.url === null ? null : publicSourceUrl(r.url);
  if (
    r.kind === "company_website" &&
    (!url || !target.domain ||
      !(new URL(url).hostname === target.domain ||
        new URL(url).hostname.endsWith(`.${target.domain}`)))
  ) refuse("snapshot_website_subject_mismatch");
  const body = text(r.body, 16000), locator = text(r.locator, 256);
  const collected_at = timestamp(r.collected_at, true),
    updated_at = timestamp(r.updated_at, true),
    event_at = timestamp(r.event_at, true),
    valid_until = timestamp(r.valid_until, true);
  if (collected_at && Date.parse(collected_at) > Date.parse(asOf)) {
    refuse("snapshot_future_collection");
  }
  if (!Array.isArray(r.quotes) || r.quotes.length > 8) {
    refuse("snapshot_invalid_quotes");
  }
  const quotes = r.quotes.map((v) => {
    const q = object(v);
    exactKeys(q, ["start", "end", "excerpt"]);
    if (
      !Number.isSafeInteger(q.start) || !Number.isSafeInteger(q.end) ||
      Number(q.start) < 0 || Number(q.end) <= Number(q.start) ||
      Number(q.end) > body.length ||
      body.slice(Number(q.start), Number(q.end)) !== text(q.excerpt)
    ) refuse("snapshot_excerpt_mismatch");
    return q as unknown as SuppliedSource["quotes"][number];
  });
  if (
    new Set(quotes.map((q) => `${q.start}:${q.end}`)).size !== quotes.length
  ) {
    refuse("snapshot_duplicate_quote");
  }
  return {
    workspace_id: scope.workspace_id,
    client_binding_id: scope.client_binding_id,
    id: r.id as string,
    subject: sub,
    role: "prospect",
    kind: r.kind as SuppliedSource["kind"],
    url: r.url as string | null,
    requested_url: r.requested_url as string | null,
    redirect_chain: [],
    locator,
    body,
    collected_at,
    updated_at,
    event_at,
    valid_until,
    quotes,
  };
}
