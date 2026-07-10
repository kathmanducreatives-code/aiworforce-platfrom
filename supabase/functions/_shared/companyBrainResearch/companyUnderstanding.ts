// "What is this company?" — the understanding pass (Research Quality v2).
//
// Runs BEFORE any ICP inference. Getting the product wrong poisons every
// downstream field, so this stage is deliberately conservative:
//
//   * only PRODUCT-DEFINING pages (homepage/features/pricing/use_cases/about)
//     may set the summary, category, business model and features;
//   * customer stories and case studies may contribute proof and segments, but
//     never the category — they are about someone else's business;
//   * blog posts inform content angles and nothing else;
//   * careers pages yield hiring signals only, never the ICP;
//   * a category claim needs REPEATED support across product-defining pages,
//     which is what stops one hiring article turning a SaaS into "Recruiting";
//   * conflicting or thin evidence sets `ambiguous` and caps confidence.
//
// Pure. No network.

import {
  type ClaimTag, type CompanyUnderstanding, type FirecrawlPage, type SourceEvidence,
  type PageType, type TaggedClaim,
  asString, uniq, gradeConfidence, capConfidence, cleanChips, cleanChip,
} from "./types.ts";
import { classifyPage, isProductDefining, ALLOWED_USES, ignoredUses, rankPages, strongPageCount } from "./pageClassifier.ts";

// A category is only claimed when its terms recur across product-defining pages.
// Most specific first: "lead intelligence" must win over the generic "AI SaaS".
const CATEGORY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "lead intelligence software", re: /\b(lead (?:intelligence|scoring|qualification|sourcing|research)|signal[- ]based (?:selling|prospecting|leads?)|buying signals?|intent (?:data|signals?)|gtm (?:intelligence|engine)|pipeline (?:intelligence|generation))\b/i },
  { label: "AI workforce platform", re: /\b(ai (?:workforce|employees?|teammates?)|digital (?:workforce|employees?)|autonomous (?:agents?|workforce)|agentic (?:workforce|platform))\b/i },
  { label: "recruiting software", re: /\b(applicant tracking|ats\b|recruiting (?:software|platform|crm)|hiring platform|candidate sourcing|talent acquisition software)\b/i },
  { label: "staffing services", re: /\b(staffing (?:agency|firm|services)|recruitment agency|we place candidates|contract placement)\b/i },
  { label: "sales software", re: /\b(sales (?:engagement|automation|platform)|outbound (?:platform|automation)|prospecting (?:tool|platform))\b/i },
  { label: "revenue operations software", re: /\b(revenue operations|revops platform|pipeline (?:automation|management))\b/i },
  { label: "CRM", re: /\b(crm\b|customer relationship management)\b/i },
  { label: "data enrichment", re: /\b(data enrichment|contact data|lead enrichment|firmographic)\b/i },
  { label: "marketing software", re: /\b(marketing (?:automation|platform)|email marketing|campaign management)\b/i },
  { label: "analytics software", re: /\b(analytics (?:platform|software)|business intelligence|dashboards? for)\b/i },
  { label: "developer tools", re: /\b(developer (?:tool|platform)|sdk\b|ci\/cd|api platform)\b/i },
  { label: "AI SaaS", re: /\b(ai (?:platform|agent|assistant)|llm|machine learning platform)\b/i },
];

// Rule 7 heuristic: user says "AI workforce OS / for founders" AND the site
// talks GTM (leads/signals/outreach/pipeline/founders) → the category lives in
// lead-intelligence territory, tagged as an inference to confirm — NOT
// recruiting, even when recruiting examples appear on the site.
const GTM_SITE_RE = /\b(leads?|signals?|outreach|pipeline|founders?|gtm|go-?to-?market|prospect)\b/i;
const WORKFORCE_DESC_RE = /\b(ai (?:workforce|employees?|teammates?)|workforce os|ai (?:for|built for) (?:b2b )?founders?|founder-?led)\b/i;

const BUSINESS_MODEL_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "B2B SaaS", re: /\b(b2b saas|saas for (?:teams|companies|businesses)|per seat|per user\/month)\b/i },
  { label: "SaaS", re: /\bsaas\b/i },
  { label: "marketplace", re: /\bmarketplace\b/i },
  { label: "agency/services", re: /\b(our agency|we provide services|consulting services|done-for-you)\b/i },
  { label: "self-serve", re: /\b(free trial|start free|sign up free|self-serve)\b/i },
  { label: "enterprise", re: /\b(enterprise plan|contact sales|book a demo|sso and saml)\b/i },
];

// Proof must be a claim WITH a number. "Trusted by teams" is not proof.
const PROOF_RE = /\b\d+(?:[.,]\d+)?\s?(?:x\b|%|hours?|days?|weeks?|customers?|users?|teams?|companies|leads?|meetings?)\b/i;
const INTEGRATION_RE = /\bintegrat(?:es|ion)s?\s+with\s+([A-Z][\w .-]{1,40})/i;
const PRICING_RE = /\$\s?\d|\b\d+\s?(?:usd|eur)\b|\bper (?:month|seat|user)\b|\/mo\b|\bstarts at\b|\bfree trial\b/i;
const HIRING_RE = /\b(we'?re hiring|open roles?|join (?:the|our) team)\b/i;
const USER_RE = /\bfor\s+(founders?|sales teams?|revops|marketers?|recruiters?|developers?|startups?|agencies)\b/i;

// An "example" sentence illustrates the product; it is never proof about a
// customer. Demo signals ("52 signals found", "e.g. Series A fintech hiring
// SDRs") were the exact live-QA failure this quarantines.
const EXAMPLE_RE = /\b(for example|for instance|e\.?g\.?|imagine|suppose|let'?s say|say you|sample|demo|such as|like a)\b/i;
const SIGNAL_EXAMPLE_RE = /\b(signals? (?:found|detected|like|such as)|example (?:signals?|leads?)|sample (?:signals?|leads?)|leads? (?:found|surfaced) (?:this week|today))\b/i;
// Real customer proof names an outcome for someone: helped/saved/booked/closed…
const PROOF_VERB_RE = /\b(trusted by|helped|saved?|booked|closed|grew|increased|reduced|cut|generated|serving)\b/i;

// Workflows the site walks through — informative, but never the ICP alone.
const WORKFLOW_RE = /\b(step \d|first[, ]+then|workflow|automatically (?:finds?|drafts?|scores?|watches?|surfaces?)|from [\w\s]{3,30} to )\b/i;

// Tools/competitors commonly named on GTM sites. Mentions are hypotheses.
const KNOWN_TOOLS_RE = /\b(hubspot|salesforce|apollo|clay|zoominfo|outreach|salesloft|instantly|smartlead|lemlist|sales navigator|pipedrive|attio|lusha)\b/gi;

/** True when a sentence is an illustrative example rather than a claim. */
export function isExampleSentence(s: string): boolean {
  return EXAMPLE_RE.test(s) || SIGNAL_EXAMPLE_RE.test(s);
}

function sentences(md: string): string[] {
  return asString(md)
    .replace(/```[\s\S]*?```/g, " ")           // drop code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // drop images
    .replace(/[#*>`|]/g, " ")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 25 && s.length <= 260);
}

/** Count how many product-defining pages support each category label. */
function categoryVotes(pages: Array<{ type: PageType; text: string }>): Map<string, number> {
  const votes = new Map<string, number>();
  for (const p of pages) {
    if (!isProductDefining(p.type)) continue;
    for (const { label, re } of CATEGORY_PATTERNS) {
      if (re.test(p.text)) votes.set(label, (votes.get(label) ?? 0) + 1);
    }
  }
  return votes;
}

export interface UnderstandingInput {
  websiteUrl: string;
  nameHint?: string;
  /** The user's own description — a first-class signal, not a fallback. */
  descriptionHint?: string;
  linkedinDescription?: string;
}

/** Build a conservative company understanding from classified pages. Pure. */
export function buildCompanyUnderstanding(
  rawPages: FirecrawlPage[],
  input: UnderstandingInput,
): CompanyUnderstanding {
  const home = input.websiteUrl;
  const classified = rawPages.map((p) => ({
    page: p,
    type: classifyPage(p, home),
    text: `${asString(p.title)} ${asString(p.description)} ${asString(p.markdown)}`,
  }));

  const productPages = classified.filter((c) => isProductDefining(c.type));
  const productText = productPages.map((c) => c.text).join("\n");
  const types = classified.map((c) => c.type);
  const strongPages = strongPageCount(types);
  const onlyHomepage = strongPages <= 1 && types.filter(isProductDefining).every((t) => t === "homepage");

  const userDesc = cleanChip(input.descriptionHint);
  const hasUserInput = userDesc.length > 0;

  // ---- product category: needs REPEATED support, else it stays a hypothesis --
  const votes = categoryVotes(classified.map((c) => ({ type: c.type, text: c.text })));
  // The user's own words vote too — they know their product better than a blog.
  if (hasUserInput) {
    for (const { label, re } of CATEGORY_PATTERNS) if (re.test(userDesc)) votes.set(label, (votes.get(label) ?? 0) + 2);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const topVote = ranked[0];
  const runnerUp = ranked[1];

  // Two categories tied ⇒ the site is ambiguous; commit to neither.
  const conflicts = !!(topVote && runnerUp && topVote[1] === runnerUp[1]);
  // A category claim requires ≥2 supporting product-defining pages (or 1 page +
  // the user's description). This is the guard that stops a single recruiting
  // article from defining a B2B SaaS company as "Recruiting".
  const categorySupported = !!topVote && (topVote[1] >= 2 || (topVote[1] >= 1 && hasUserInput));
  let product_category = !conflicts && categorySupported ? topVote[0] : "";

  // Rule-7 fallback: when the votes could not commit but the user describes an
  // AI-workforce/founder product and the site speaks GTM, hypothesise a
  // lead-intelligence category instead of leaving the Brain empty. This is an
  // INFERENCE — it is tagged, confirmed by the user, and never "high" confidence.
  let categoryInferred = false;
  const allText = classified.map((c) => c.text).join("\n");
  if (!product_category && hasUserInput && WORKFORCE_DESC_RE.test(userDesc) && GTM_SITE_RE.test(allText)) {
    product_category = "AI-powered lead intelligence";
    categoryInferred = true;
  }

  // ---- business model ------------------------------------------------------
  const bmSource = `${productText} ${userDesc}`;
  const business_model = BUSINESS_MODEL_PATTERNS.find((b) => b.re.test(bmSource))?.label ?? "";

  // ---- summary / promise: product-defining pages + the user's description ----
  const homePage = classified.find((c) => c.type === "homepage");
  const homeSentences = sentences(asString(homePage?.page.markdown));
  const one_line_summary = userDesc || cleanChip(homePage?.page.description) || homeSentences[0] || "";
  const main_promise = cleanChip(homePage?.page.description) || homeSentences[0] || userDesc;

  // ---- features / use cases: never from blog or customer stories -------------
  const key_features = cleanChips(
    classified.filter((c) => c.type === "features" || c.type === "homepage")
      .flatMap((c) => sentences(c.text).slice(0, 5)),
  ).slice(0, 8);

  const primary_use_cases = cleanChips(
    classified.filter((c) => c.type === "use_cases")
      .flatMap((c) => sentences(c.text).slice(0, 4)),
  ).slice(0, 6);

  const primary_users = uniq([
    ...classified.filter((c) => c.type === "use_cases" || c.type === "about" || c.type === "homepage")
      .flatMap((c) => [...c.text.matchAll(new RegExp(USER_RE, "gi"))].map((m) => cleanChip(m[1]))),
    ...(hasUserInput ? [...userDesc.matchAll(new RegExp(USER_RE, "gi"))].map((m) => cleanChip(m[1])) : []),
  ]).filter(Boolean).slice(0, 6);

  // ---- pricing: only from the pricing page ---------------------------------
  const pricingPage = classified.find((c) => c.type === "pricing");
  const pricing_signal = pricingPage
    ? (sentences(pricingPage.text).find((s) => PRICING_RE.test(s)) ?? "pricing page present")
    : "";

  // ---- proof vs examples ----------------------------------------------------
  // A blog post saying "companies grow 3x" is not proof about this company, and
  // neither is a demo signal ("52 signals found this week"). Numeric sentences
  // that read as examples are quarantined into `examples_detected`; homepage
  // numbers additionally need a proof verb (helped/saved/trusted by/…) because
  // homepages are full of illustrative product UI copy.
  const proofPages = classified.filter((c) => c.type === "homepage" || c.type === "customers" || c.type === "case_study");
  const numericSentences = proofPages.flatMap((c) =>
    sentences(c.text).filter((s) => PROOF_RE.test(s)).map((s) => ({ s, type: c.type })));

  const proof_points = cleanChips(
    numericSentences
      .filter(({ s, type }) => !isExampleSentence(s) && (type !== "homepage" || PROOF_VERB_RE.test(s)))
      .map(({ s }) => s),
  ).slice(0, 6);

  const examples_detected = cleanChips([
    ...numericSentences.filter(({ s, type }) => isExampleSentence(s) || (type === "homepage" && !PROOF_VERB_RE.test(s))).map(({ s }) => s),
    ...classified.filter((c) => isProductDefining(c.type))
      .flatMap((c) => sentences(c.text).filter((s) => SIGNAL_EXAMPLE_RE.test(s))),
  ]).slice(0, 6);

  // ---- workflows: illustrative, never the ICP alone ---------------------------
  const workflows = cleanChips(
    classified.filter((c) => c.type === "use_cases" || c.type === "features" || c.type === "homepage")
      .flatMap((c) => sentences(c.text).filter((s) => WORKFLOW_RE.test(s))),
  ).slice(0, 5);

  // ---- targeting hints + tool mentions (hypotheses, not facts) ----------------
  const target_customer_hints = uniq([
    ...primary_users,
    ...(hasUserInput ? [...userDesc.matchAll(/\bfor\s+((?:b2b\s+)?[a-z][\w\s-]{2,30}?)(?=[,.]|$)/gi)].map((m) => cleanChip(m[1])) : []),
    ...cleanChips(asString(input.linkedinDescription)).slice(0, 2),
  ]).filter(Boolean).slice(0, 8);

  const competitors_or_tools_mentioned = uniq(
    [...allText.matchAll(KNOWN_TOOLS_RE)].map((m) => cleanChip(m[0])),
  ).slice(0, 8);

  // ---- integrations: must be an explicit "integrates with X" statement -------
  const integrations = cleanChips(
    classified.filter((c) => c.type === "features" || c.type === "docs" || c.type === "homepage")
      .flatMap((c) => [...c.text.matchAll(new RegExp(INTEGRATION_RE, "gi"))].map((m) => m[1])),
  ).slice(0, 8);

  // ---- evidence cards -------------------------------------------------------
  const evidence: SourceEvidence[] = rankPages(
    classified.map((c) => ({ ...c, page_type: c.type })),
  ).map((c) => {
    const facts = extractedFactsFor(c.type, c.text);
    return {
      source_url: c.page.url,
      page_type: c.type,
      title: cleanChip(c.page.title) || c.type,
      extracted_facts: facts,
      used_for: ALLOWED_USES[c.type] ?? [],
      ignored_for: ignoredUses(c.type),
      confidence: isProductDefining(c.type) ? "medium" : "low",
      reason: reasonFor(c.type),
    };
  });

  // ---- honesty layer --------------------------------------------------------
  const missing_evidence: string[] = [];
  if (!pricingPage) missing_evidence.push("pricing page");
  if (!classified.some((c) => c.type === "customers" || c.type === "case_study")) missing_evidence.push("customer / case-study proof");
  if (!classified.some((c) => c.type === "about")) missing_evidence.push("about page");
  if (!product_category) missing_evidence.push("product category");
  if (!business_model) missing_evidence.push("business model");
  if (!one_line_summary) missing_evidence.push("company description");

  const ambiguous = conflicts || !product_category || categoryInferred || strongPages < 2;

  const ambiguity_reasons: string[] = [];
  if (conflicts && topVote && runnerUp) ambiguity_reasons.push(`Conflicting category signals: "${topVote[0]}" vs "${runnerUp[0]}".`);
  if (!product_category) ambiguity_reasons.push("No product category earned repeated support from product-defining pages.");
  if (categoryInferred) ambiguity_reasons.push("Product category was inferred from the founder's description plus GTM language on the site — confirm it.");
  if (strongPages < 2) ambiguity_reasons.push(onlyHomepage ? "Only the homepage was readable." : "Fewer than two product-defining pages were readable.");

  const needs_confirmation: string[] = [];
  if (!product_category) needs_confirmation.push("product_category");
  if (categoryInferred) needs_confirmation.push("product_category:inferred_from_user_description");
  if (!business_model) needs_confirmation.push("business_model");
  if (conflicts) needs_confirmation.push("product_category:conflicting_signals");
  if (!proof_points.length) needs_confirmation.push("proof_points");

  let confidence = gradeConfidence({
    strongPages, hasUserInput, conflicts,
    missingEvidence: missing_evidence.length,
    onlyHomepage,
    noSourceProof: rawPages.length === 0,
  });
  // An ambiguous read can never be "high", regardless of page count; an
  // inferred category can never carry more than "medium".
  if (ambiguous) confidence = capConfidence(confidence, "medium");
  if (!product_category) confidence = capConfidence(confidence, "low");

  // ---- tagged claims: every extracted string carries its origin --------------
  const claims: TaggedClaim[] = [
    ...(hasUserInput ? [{ text: userDesc, tag: "user_input" as ClaimTag, confidence: "high" as const }] : []),
    ...(product_category ? [{
      text: `Product category: ${product_category}`,
      tag: (categoryInferred ? "ai_inference" : "source_fact") as ClaimTag,
      confidence: categoryInferred ? "low" as const : confidence,
    }] : []),
    ...(main_promise ? [{ text: main_promise, tag: "product_claim" as ClaimTag, source_url: homePage?.page.url, confidence }] : []),
    ...key_features.map((text) => ({ text, tag: "feature" as ClaimTag, confidence })),
    ...primary_use_cases.map((text) => ({ text, tag: "use_case" as ClaimTag, confidence })),
    ...workflows.map((text) => ({ text, tag: "workflow_example" as ClaimTag, confidence: "low" as const })),
    ...examples_detected.map((text) => ({ text, tag: "signal_example" as ClaimTag, confidence: "low" as const })),
    ...proof_points.map((text) => ({ text, tag: "customer_proof" as ClaimTag, confidence })),
    ...(pricing_signal ? [{ text: pricing_signal, tag: "pricing" as ClaimTag, source_url: pricingPage?.page.url, confidence }] : []),
    ...integrations.map((text) => ({ text, tag: "integration" as ClaimTag, confidence })),
    ...competitors_or_tools_mentioned.map((text) => ({ text, tag: "ai_inference" as ClaimTag, confidence: "low" as const })),
  ];

  return {
    company_name: cleanChip(input.nameHint) || cleanChip(asString(homePage?.page.title).split(/[|\-–—]/)[0]),
    website: home,
    one_line_summary,
    product_category,
    business_model,
    primary_users,
    primary_use_cases,
    key_features,
    main_promise,
    pricing_signal,
    proof_points,
    integrations,
    evidence,
    confidence,
    missing_evidence,
    ambiguous,
    needs_confirmation,
    workflows,
    examples_detected,
    target_customer_hints,
    competitors_or_tools_mentioned,
    ambiguity_reasons,
    claims,
  };
}

function extractedFactsFor(type: PageType, text: string): string[] {
  const s = sentences(text);
  switch (type) {
    case "pricing": return cleanChips(s.filter((x) => PRICING_RE.test(x)).slice(0, 3));
    case "customers":
    case "case_study": return cleanChips(s.filter((x) => PROOF_RE.test(x)).slice(0, 3));
    case "careers": return cleanChips(s.filter((x) => HIRING_RE.test(x)).slice(0, 3));
    case "blog": return cleanChips(s.slice(0, 2));
    default: return cleanChips(s.slice(0, 3));
  }
}

function reasonFor(type: PageType): string {
  switch (type) {
    case "homepage": return "Homepage hero and meta describe the core product — highest-trust source.";
    case "features": return "Feature page states what the product does.";
    case "pricing": return "Pricing page is the only source trusted for pricing and packaging.";
    case "use_cases": return "Use-case page describes who the product is for.";
    case "about": return "About page describes the company, not the product surface.";
    case "customers": return "Customer page contributes proof and segments — never the product category.";
    case "case_study": return "Case study describes a customer's business, not this company's category.";
    case "blog": return "Blog content is a topic the company writes about — ignored for product and ICP.";
    case "careers": return "Careers page is used only for hiring signals, never for the ICP.";
    case "docs": return "Docs contribute integrations only.";
    default: return "Page could not be classified — ignored for all fields.";
  }
}
