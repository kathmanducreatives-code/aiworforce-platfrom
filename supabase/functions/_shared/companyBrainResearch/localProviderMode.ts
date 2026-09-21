// LOCAL DEVELOPMENT PROVIDERS — FIXTURES OR NOTHING, AND NEVER IN PRODUCTION.
//
// Onboarding's two research steps are provider calls: the founder step runs an
// Apify LinkedIn actor, the company step runs Firecrawl map + scrape. Local
// development deliberately holds no provider keys (see
// `supabase/functions/.env.local`), so both steps answer
// `apify_not_configured` / `firecrawl_not_configured` and the whole flow below
// them — normalization, the draft, the Company Brain write — cannot be
// exercised at all.
//
// This module supplies the SAME `ResearchDeps` the real providers satisfy,
// filled from fixtures. Nothing downstream knows the difference: the fixture
// rows go through `normalizeFounderProfile` and `buildCompanyUnderstanding`
// exactly as a provider's rows do, and the Company Brain writer sees the shape
// it always saw. That is the point — a mock that bypassed the normalizer would
// prove nothing about the code that runs in production.
//
// ── TWO GUARANTEES ───────────────────────────────────────────────────────────
//
// 1. LOCAL STACK ONLY. The mode is read only when `SUPABASE_URL` is an http
//    URL on the local topology — a hosted project is always https. A deployed
//    function that somehow carried this env var would serve invented company
//    data as though a provider had returned it, which is worse than any
//    outage — so a hosted Supabase URL ignores the flag, loudly.
//
// 2. `live` NEVER FALLS BACK TO `mock`. Asking for live providers without keys
//    is a configuration error and is reported as one. A silent downgrade to
//    fixtures is how fabricated data ends up in a real Brain.
//
//   AGENTORY_LOCAL_PROVIDER_MODE=mock   fixtures, $0, no network
//   AGENTORY_LOCAL_PROVIDER_MODE=live   real providers, real money, keys required
//   (unset)                             today's behaviour: keys if present, else refuse

import type { FirecrawlPage, ResearchDeps } from "./types.ts";

export const LOCAL_PROVIDER_MODE_ENV = "AGENTORY_LOCAL_PROVIDER_MODE";
export type LocalProviderMode = "unset" | "mock" | "live";

/** Marks every record a fixture produced, so provenance survives the write. */
export const FIXTURE_PROVIDER_MODE = "mock" as const;

/**
 * IS THIS SUPABASE A LOCAL ONE?
 *
 * Not simply "is it loopback". Inside the CLI's edge runtime the injected
 * `SUPABASE_URL` is `http://kong:8000` — the container's own gateway — so a
 * loopback-only test rejects every real local function, which is exactly what
 * the first version of this did.
 *
 * The test that actually separates the two worlds is the SCHEME. A hosted
 * Supabase project is always `https://<ref>.supabase.co`; nothing deployed is
 * ever served to its own functions over plain http. So: http, and a hostname
 * from the local topology. Both must hold.
 */
const LOCAL_HOSTS = new Set([
  "127.0.0.1", "localhost", "::1", "[::1]",
  "kong",                  // the CLI's gateway, as seen from inside the runtime
  "host.docker.internal",  // the host, as seen from a container
  "supabase_kong_ohsdatpvfdjdemstoiuj",
]);

function isPrivateHost(h: string): boolean {
  return /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    return LOCAL_HOSTS.has(u.hostname) || isPrivateHost(u.hostname);
  } catch { return false; }
}

/**
 * Which provider mode is in force, and whether the environment may have one.
 *
 * `reason` is carried so the caller can say WHY a flag was ignored rather than
 * behaving mysteriously.
 */
export function resolveLocalProviderMode(
  env: (k: string) => string | undefined,
): { mode: LocalProviderMode; ignored_reason: string | null } {
  const raw = (env(LOCAL_PROVIDER_MODE_ENV) ?? "").trim().toLowerCase();
  if (!raw) return { mode: "unset", ignored_reason: null };
  if (raw !== "mock" && raw !== "live") {
    return { mode: "unset", ignored_reason: `${LOCAL_PROVIDER_MODE_ENV}="${raw}" is not mock or live` };
  }
  if (!isLocalSupabaseUrl(env("SUPABASE_URL"))) {
    return {
      mode: "unset",
      ignored_reason: `${LOCAL_PROVIDER_MODE_ENV} is ignored: SUPABASE_URL is not a local stack`,
    };
  }
  return { mode: raw, ignored_reason: null };
}

// ── FIXTURES ─────────────────────────────────────────────────────────────────
//
// Realistic in SHAPE, and honest in CONTENT. Every fixture says what it is in a
// field a human will read, because a developer looking at a Brain built this
// way must never wonder whether the provider really said it.

const FIXTURE_NOTE = "[local fixture — no provider was called]";

/** The profile slug, which is the only real thing a mock can know. */
export function profileSlug(profileUrl: string): string {
  try {
    const p = new URL(profileUrl).pathname.replace(/\/+$/, "");
    return p.split("/").filter(Boolean).pop() ?? "founder";
  } catch { return "founder"; }
}

function titleCaseSlug(slug: string): string {
  return slug.replace(/-?\d[\w]*$/, "").split("-").filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Sample Founder";
}

/**
 * An Apify LinkedIn-profile row, in the shape `apimaestro/linkedin-profile-detail`
 * ACTUALLY SENDS — verified against live run 5HusFT12Zs4pSS1nd, not guessed:
 *
 *   * the profile nests under `basic_info`, which `unwrapActorRow` flattens;
 *   * `location` is an OBJECT, not a string;
 *   * the full name is `fullname`, all lowercase;
 *   * skills arrive as `top_skills`;
 *   * `email` is a real key on every row (null when LinkedIn exposes none) — it
 *     is here on purpose, so the fixture exercises the contact stripping that
 *     `stripContactFields` performs on the live path.
 *
 * The first version of this fixture used the shape the CODE expected, and so
 * agreed with a normalizer that silently dropped the location of every real
 * profile. A fixture is only worth developing against if it is wrong in the
 * same ways the provider is.
 */
export function mockLinkedInProfileRow(profileUrl: string): Record<string, unknown> {
  const name = titleCaseSlug(profileSlug(profileUrl));
  return {
    basic_info: {
      fullname: name,
      first_name: name.split(" ")[0] ?? name,
      last_name: name.split(" ").slice(1).join(" "),
      headline: "Founder & CEO — building an AI GTM product for early-stage B2B SaaS",
      location: {
        country: "Nepal", city: "Kathmandu, Bāgmatī",
        full: "Kathmandu, Bāgmatī, Nepal", postal_code: "", country_code: "NP",
      },
      current_company: "Agentory",
      email: null,
      top_skills: ["Go-to-market", "Outbound", "B2B SaaS", "Product", "Content"],
      profile_url: profileUrl,
      about:
        "Founder working on go-to-market automation for early-stage B2B SaaS teams. " +
        "Previously built and sold outbound tooling. Writes about founder-led sales and " +
        `does most of the company's own outreach. ${FIXTURE_NOTE}`,
    },
    experience: [
      { title: "Founder & CEO", company: "Agentory", dateRange: "2025 — Present",
        description: "AI teammates that draft outreach and content for founders to approve." },
      { title: "Growth Lead", company: "Earlier Startup", dateRange: "2023 — 2025",
        description: "Ran outbound and content for a seed-stage B2B SaaS product." },
    ],
    education: [{ school: "Islington College", degree: "BSc (Hons) Computing", dateRange: "2021 — 2025" }],
  };
}

/**
 * A site map, including links the selector is SUPPOSED to drop — an off-host
 * link, a login page and a legal page. A fixture that only contained good URLs
 * would let a broken `selectPages` pass.
 */
export function mockSiteMap(homepage: string): string[] {
  const origin = (() => { try { return new URL(homepage).origin; } catch { return homepage.replace(/\/+$/, ""); } })();
  return [
    origin, `${origin}/product`, `${origin}/pricing`, `${origin}/customers`,
    `${origin}/about`, `${origin}/docs`, `${origin}/blog/how-we-think-about-outbound`,
    `${origin}/careers`,
    // Dropped by EXCLUDED_PATHS / sameHost — deliberately present.
    `${origin}/login`, `${origin}/privacy`, "https://twitter.com/someone",
  ];
}

/** Pages keyed by path, so only URLs the selector actually chose are "fetched". */
export function mockSitePages(homepage: string): Map<string, FirecrawlPage> {
  const origin = (() => { try { return new URL(homepage).origin; } catch { return homepage.replace(/\/+$/, ""); } })();
  const host = (() => { try { return new URL(homepage).hostname.replace(/^www\./, ""); } catch { return "example.com"; } })();
  const brand = host.split(".")[0].replace(/^./, (c) => c.toUpperCase());
  const page = (url: string, title: string, markdown: string, description?: string): FirecrawlPage =>
    ({ url, title, markdown, description: description ?? null });

  const pages: FirecrawlPage[] = [
    page(origin, `${brand} | AI teammates for go-to-market`,
      `${brand} is a B2B SaaS platform that gives early-stage teams AI teammates ` +
      "for go-to-market work. It drafts outreach and content for a founder to approve, " +
      "rather than replacing the person doing it. Built for founders and early-stage " +
      `startups that need the marketing function before they can afford the hire. ${FIXTURE_NOTE}`,
      "AI teammates that draft your outreach and content for you to approve."),
    page(`${origin}/product`, "Product",
      "AI teammates that research accounts, draft personalised outreach and write " +
      "content in the founder's own voice. Every draft waits for human approval before " +
      "anything is sent. Built for founders running go-to-market themselves. Integrates " +
      `with the tools a small team already runs. ${FIXTURE_NOTE}`),
    page(`${origin}/pricing`, "Pricing",
      "Plans start at €99 per month for a single workspace, billed monthly. " +
      `A 14-day trial is available and no card is required to start. ${FIXTURE_NOTE}`),
    page(`${origin}/customers`, "Customers",
      "Early customers are founder-led B2B SaaS teams of under twenty people. " +
      "Teams cut outreach drafting time by 4x every week after switching. " +
      `Companies like Northwind and Acme replaced a part-time contractor. ${FIXTURE_NOTE}`),
    page(`${origin}/about`, "About",
      `${brand} was started in 2025 to give small teams the go-to-market function ` +
      "before they can afford to hire for it. We build AI teammates for founders. The " +
      `team is based in Kathmandu and sells to English-speaking markets. ${FIXTURE_NOTE}`),
    page(`${origin}/docs`, "Docs",
      "Getting started, connecting a workspace, approving drafts, and the " +
      `review queue. Written for the operator, not the developer. ${FIXTURE_NOTE}`),
    page(`${origin}/blog/how-we-think-about-outbound`, "How we think about outbound",
      "A blog post about outbound philosophy. It mentions recruiting software " +
      `in passing, which must NOT become the product category. ${FIXTURE_NOTE}`),
    page(`${origin}/careers`, "Careers",
      `We are hiring a growth marketer and a founding engineer. ${FIXTURE_NOTE}`),
  ];
  return new Map(pages.map((p) => [p.url, p]));
}


// ── THE DRAFT, WITHOUT A MODEL ───────────────────────────────────────────────
//
// The draft step is an LLM call. A fixture here must not invent a company: it
// reads the SAME `RESEARCH EVIDENCE` block the prompt carries and restates it
// in the JSON shape the prompt asks for. Every value below therefore traces to
// something the founder typed or a page said — there is no third source.
//
// It is a scaffold, not a strategist. The personas, triggers and angles a real
// model writes are left empty rather than guessed, so nobody mistakes a
// fixture-built Brain for a reasoned one.

/** Pull the first balanced JSON object out of the prompt. */
export function extractEvidenceJson(user: string): Record<string, unknown> | null {
  const start = user.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < user.length; i++) {
    const ch = user[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(user.slice(start, i + 1)) as Record<string, unknown>; } catch { return null; }
    }
  }
  return null;
}

type AnyRec = Record<string, unknown>;
const rec = (v: unknown): AnyRec => (v && typeof v === "object" ? v as AnyRec : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Restate the research as the draft shape. No new facts. */
export function mockDraftFromEvidence(user: string): AnyRec {
  const e = extractEvidenceJson(user) ?? {};
  const u = rec(e.company_understanding);
  const provided = rec(e.user_provided);
  const company = rec(provided.company);
  const founder = rec(provided.founder);
  const fr = rec(e.founder_research);

  const name = str(u.company_name) || str(company.name);
  const description = str(company.description) || str(u.one_line_summary);
  return {
    company: {
      name, website_url: str(u.website) || str(company.website_url), description,
      category: str(u.product_category), business_model: str(u.business_model),
      stage: "", team_size: "", location: str(fr.location),
    },
    founder: {
      name: str(founder.name) || str(fr.name),
      role: str(founder.role) || str(fr.current_role),
      background: str(fr.summary),
      gtm_relevance: arr(fr.gtm_relevance).filter((x) => typeof x === "string").slice(0, 4),
    },
    target_customer: {
      industries: [], business_models: [str(u.business_model)].filter(Boolean),
      company_size: { min: null, max: null, label: "" },
      funding_stage: [], geography: [],
      must_have: arr(u.primary_users).filter((x) => typeof x === "string").slice(0, 4),
      nice_to_have: [],
      disqualifiers: { industries: [], company_types: [], domains: [], keywords: [], titles: [] },
    },
    // A model writes these. A fixture does not pretend to.
    buyer_personas: [], buyer_persona_profiles: [], triggers: [], jobs_to_watch: [],
    competitors: [], tools: [], pain_points: [], positive_examples: [], negative_examples: [],
    content_angles: [],
    qualification_rules: { required_evidence: [], reject_if: [], manual_review_if: [] },
    brand_voice: { tone: "", tags: [], style_rules: [], avoid: [], example_message: "" },
    _fixture: FIXTURE_NOTE,
  };
}

/**
 * A LinkedIn COMPANY row, in the shape the configured company actors send —
 * `locations[{ headquarter, parsed.text }]`, `industries[{ name }]`,
 * `foundedOn{ year }` — as documented in `hiringActorCatalog`. Modelled on the
 * provider, not on the parser: reading this payload with `asStringArray` is
 * exactly the bug that lost every company's offices.
 */
export function mockLinkedInCompanyRow(companyUrl: string): Record<string, unknown> {
  const slug = profileSlug(companyUrl);
  const name = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Sample Company";
  return {
    name,
    universalName: slug,
    linkedinUrl: companyUrl,
    website: `https://${slug}.example`,
    description: `${name} is a B2B SaaS company. ${FIXTURE_NOTE}`,
    employeeCount: 18,
    employeeCountRange: "11-50",
    industries: [{ name: "Software Development" }, { name: "Technology, Information and Internet" }],
    foundedOn: { year: 2023, month: 6, day: 1 },
    specialties: ["Go-to-market", "AI agents"],
    followerCount: 1240,
    locations: [
      { country: "NP", city: "Kathmandu", headquarter: true,
        parsed: { text: "Kathmandu, Nepal", countryFull: "Nepal" } },
      { country: "GB", city: "London", headquarter: false,
        parsed: { text: "London, United Kingdom", countryFull: "United Kingdom" } },
    ],
  };
}

/**
 * The fixture-backed `ResearchDeps`. Same four functions the live adapter
 * builds in `generate-company-brain-draft`, same signatures, no network.
 */
export function mockResearchDeps(base: ResearchDeps = {}): ResearchDeps {
  return {
    ...base,
    runApifyActor: (actor: string, input: unknown) => {
      // The founder step and the company step call DIFFERENT actors through
      // the same dep. Returning a profile row for a company lookup would let
      // the company normalizer be "tested" against a shape it never sees.
      if (/company/i.test(actor)) {
        const i = (input ?? {}) as Record<string, unknown>;
        const url = String(
          (Array.isArray(i.companyUrls) ? i.companyUrls[0] : null) ??
          (Array.isArray(i.companies) ? i.companies[0] : null) ??
          i.companyUrl ?? i.url ?? "",
        );
        return Promise.resolve([mockLinkedInCompanyRow(url)]);
      }
      // `buildProfileActorInput` sends the same URL under several keys, because
      // different actors name it differently. Any of them will do here.
      const i = (input ?? {}) as Record<string, unknown>;
      const url = String(
        (Array.isArray(i.profileUrls) ? i.profileUrls[0] : null) ?? i.profileUrl ?? i.url ?? "",
      );
      return Promise.resolve([mockLinkedInProfileRow(url)]);
    },
    firecrawlMap: (url: string) => Promise.resolve(mockSiteMap(url)),
    generateJson: ({ user }: { system: string; user: string }) =>
      Promise.resolve({ ok: true, json: mockDraftFromEvidence(user) }),
    firecrawlScrape: (url: string) => {
      // The homepage arrives exactly as the user typed it — "https://x.com/"
      // and "https://x.com" are the same page, and a fixture that missed one
      // would silently drop the most important page of the set.
      const pages = mockSitePages(url);
      const stripped = url.replace(/\/+$/, "");
      return Promise.resolve(pages.get(url) ?? pages.get(stripped) ?? null);
    },
  };
}
