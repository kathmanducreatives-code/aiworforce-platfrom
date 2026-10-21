import { CsvRefusal, parsePilotCsv } from "./pilotCsv.ts";
import { digest } from "./pilotScope.ts";
export const IMPORT_FIELDS = [
  "company_name",
  "company_domain",
  "company_linkedin_url",
  "first_name",
  "last_name",
  "contact_name",
  "contact_title",
  "contact_email",
  "contact_linkedin_url",
  "apollo_contact_id",
  "apollo_account_id",
  "source_list_id",
  "source_updated_at",
] as const;
export type ImportField = typeof IMPORT_FIELDS[number];
export type ImportMapping = Record<string, ImportField | null>;
export type NormalizedLead = Partial<Record<ImportField, string>> & {
  company_name: string;
};
const fail = (code: string): never => {
  throw new CsvRefusal(code);
};
function publicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return fail("csv_invalid_url");
  }
  const host = url.hostname.toLowerCase();
  // Conservative public DNS only; no IPs, local names, ports, credentials or query data.
  if (
    !["https:", "http:"].includes(url.protocol) || url.username ||
    url.password || url.port || url.search || url.hash || host.length > 253 ||
    !host.includes(".") || !/^[a-z0-9.-]+$/.test(host) ||
    !/\.[a-z]{2,}$/.test(host) ||
    host.split(".").some((p) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p)) ||
    /\.(localhost|local|internal|invalid|test|example)$/.test(host)
  ) fail("csv_invalid_url");
  return url;
}
function linkedin(value: string, type: "company" | "in"): string {
  const url = publicUrl(value);
  if (
    !["linkedin.com", "www.linkedin.com"].includes(url.hostname) ||
    !new RegExp(`^/${type}/[a-zA-Z0-9_-]+/?$`).test(url.pathname)
  ) fail("csv_invalid_linkedin");
  return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
}
function normalize(raw: Partial<Record<ImportField, string>>): NormalizedLead {
  const v = { ...raw };
  if (!v.company_name || (!v.company_domain && !v.company_linkedin_url)) {
    fail("csv_company_identity_required");
  }
  for (const [key, value] of Object.entries(v)) {
    if (
      value.length > (key.endsWith("_url") ? 512 : 256) ||
      /[\r\n\t]/.test(value)
    ) fail("csv_invalid_field");
  }
  if (v.company_domain) {
    const url = publicUrl(v.company_domain);
    if (url.pathname !== "/") fail("csv_domain_requires_homepage");
    v.company_domain = url.hostname.replace(/^www\./, "");
  }
  if (v.company_linkedin_url) {
    v.company_linkedin_url = linkedin(v.company_linkedin_url, "company");
  }
  if (v.contact_linkedin_url) {
    v.contact_linkedin_url = linkedin(v.contact_linkedin_url, "in");
  }
  if (v.contact_email) {
    if (
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/
        .test(v.contact_email)
    ) fail("csv_invalid_email");
    v.contact_email = v.contact_email.toLowerCase();
  }
  if (v.contact_name && (v.first_name || v.last_name)) {
    fail("csv_ambiguous_contact_name");
  }
  for (
    const key of [
      "apollo_contact_id",
      "apollo_account_id",
      "source_list_id",
    ] as const
  ) {
    if (v[key] && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v[key]!)) {
      fail("csv_invalid_source_id");
    }
  }
  if (
    v.apollo_contact_id &&
    !(v.contact_name || v.first_name || v.last_name || v.contact_email ||
      v.contact_linkedin_url)
  ) fail("csv_contact_identity_required");
  if (v.source_updated_at) {
    // An explicit event timestamp, never synthesized from upload time. UTC seconds only.
    const date = new Date(v.source_updated_at);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v.source_updated_at) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().replace(".000Z", "Z") !== v.source_updated_at
    ) fail("csv_invalid_timestamp");
  }
  return v as NormalizedLead;
}
export async function previewCsv(csv: string, mapping: unknown) {
  const parsed = parsePilotCsv(csv);
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    fail("csv_invalid_mapping");
  }
  const map = mapping as Record<string, unknown>, used = new Set<string>();
  if (
    Object.keys(map).length !== parsed.headers.length ||
    Object.keys(map).some((k) => !parsed.headers.includes(k))
  ) fail("csv_invalid_mapping");
  for (const h of parsed.headers) {
    const field = map[h];
    if (field === null) continue;
    if (
      typeof field !== "string" ||
      !(IMPORT_FIELDS as readonly string[]).includes(field) || used.has(field)
    ) fail("csv_unsafe_mapping");
    used.add(field as string);
  }
  if (
    !used.has("company_name") ||
    (!used.has("company_domain") && !used.has("company_linkedin_url"))
  ) fail("csv_company_identity_required");
  const rows: {
    normalized: NormalizedLead;
    normalized_hash: string;
    source_rows: number[];
    warnings: string[];
  }[] = [];
  const exact = new Map<string, number>(),
    identities = new Map<string, string>(),
    employers = new Map<string, string>();
  for (let i = 0; i < parsed.rows.length; i++) {
    const raw: Partial<Record<ImportField, string>> = {};
    parsed.headers.forEach((h, j) => {
      if (typeof map[h] === "string" && parsed.rows[i][j].trim()) {
        raw[map[h] as ImportField] = parsed.rows[i][j].trim();
      }
    });
    const normalized = normalize(raw), hash = await digest(normalized);
    // Same source/account/name or employer anchor with conflicting identity is held, never merged by name.
    const employer = await digest({
      name: normalized.company_name.toLowerCase(),
      domain: normalized.company_domain ?? null,
      linkedin: normalized.company_linkedin_url ?? null,
    });
    for (
      const key of [
        normalized.apollo_account_id && `id:${normalized.apollo_account_id}`,
        normalized.company_domain && `domain:${normalized.company_domain}`,
        normalized.company_linkedin_url &&
        `linkedin:${normalized.company_linkedin_url}`,
      ].filter(Boolean) as string[]
    ) {
      if (employers.has(key) && employers.get(key) !== employer) {
        fail("csv_conflicting_employer");
      }
      employers.set(key, employer);
    }
    const contactKeys = [
      normalized.apollo_contact_id && `id:${normalized.apollo_contact_id}`,
      normalized.contact_email && `email:${normalized.contact_email}`,
      normalized.contact_linkedin_url &&
      `linkedin:${normalized.contact_linkedin_url}`,
    ].filter(Boolean) as string[];
    for (const key of contactKeys) {
      if (identities.has(key) && identities.get(key) !== hash) {
        fail("csv_conflicting_duplicate");
      }
      identities.set(key, hash);
    }
    if (exact.has(hash)) {
      rows[exact.get(hash)!].source_rows.push(i + 2);
      continue;
    }
    exact.set(hash, rows.length);
    rows.push({
      normalized,
      normalized_hash: hash,
      source_rows: [i + 2],
      warnings: [
        "source_claims_unverified",
        "employer_association_unverified",
        normalized.source_updated_at
          ? "source_date_unverified_no_recency_claim"
          : "source_timestamp_missing",
        ...(!normalized.apollo_contact_id
          ? ["no_apollo_contact_writeback_identity"]
          : []),
        ...(!normalized.apollo_account_id
          ? ["no_apollo_account_writeback_identity"]
          : []),
      ],
    });
  }
  return {
    headers: parsed.headers,
    mapping: map,
    omitted_headers: parsed.headers.filter((h) => map[h] === null),
    input_rows: parsed.rows.length,
    duplicate_rows: parsed.rows.length - rows.length,
    rows,
  };
}
