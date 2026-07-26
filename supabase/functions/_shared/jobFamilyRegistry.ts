// CANONICAL JOB-FAMILY REGISTRY — the single place profession knowledge lives.
//
// Broadening used to be a Sales-Operations constant inside the controller, so any
// other request ("hiring software engineers") had no safe expansion at all. Titles
// now come from here, keyed by the family the user actually asked for.
//
// An UNKNOWN family stays deliberately conservative: exact requested title only,
// no invented synonyms, and honest search exhaustion when nothing safe remains.

import { compileJobIntent, type JobIntent } from "./jobIntentTaxonomy.ts";

export interface JobFamilyDefinition {
  key: string;
  label: string;
  /** Canonical titles — always searched first. */
  exact: string[];
  /** Same-role wording variants. Safe at round 2. */
  synonyms: string[];
  /** Genuinely adjacent roles in the same discipline. Approved at round 2+. */
  adjacent: string[];
  /** Never acceptable for this family, even if a planner proposes them. */
  excluded: string[];
}

export const JOB_FAMILY_REGISTRY: Record<string, JobFamilyDefinition> = {
  sales_operations: {
    key: "sales_operations", label: "Sales / Revenue Operations",
    exact: ["Sales Operations", "Revenue Operations", "GTM Operations"],
    synonyms: ["Revenue Strategy and Operations", "Sales Strategy and Operations", "Growth Operations"],
    adjacent: ["Deal Desk", "Sales Planning and Operations"],
    excluded: ["Account Executive", "Account Manager", "SDR", "BDR", "Sales Development Representative",
      "Business Development Representative", "Sales Representative", "Customer Success", "Sales Manager"],
  },
  software_engineering: {
    key: "software_engineering", label: "Software Engineering",
    exact: ["Software Engineer", "Software Developer", "Software Development Engineer"],
    synonyms: ["Backend Engineer", "Frontend Engineer", "Full Stack Engineer", "Platform Engineer"],
    adjacent: ["Senior Software Engineer", "Staff Software Engineer", "Infrastructure Engineer"],
    excluded: ["Product Manager", "Program Manager", "Project Manager", "Designer", "Recruiter",
      "Sales Operations", "Account Executive", "Data Entry"],
  },
  ai_engineering: {
    key: "ai_engineering", label: "AI / ML Engineering",
    exact: ["AI Engineer", "Machine Learning Engineer", "ML Engineer"],
    synonyms: ["Applied AI Engineer", "Generative AI Engineer", "LLM Engineer", "Applied Scientist"],
    adjacent: ["Research Engineer", "MLOps Engineer", "Data Scientist"],
    excluded: ["Product Manager", "Sales Operations", "Account Executive", "Recruiter", "AI Trainer", "Data Annotator"],
  },
  controls_engineering: {
    key: "controls_engineering", label: "Controls / Automation Engineering",
    exact: ["Controls Engineer", "Control Systems Engineer", "Automation Engineer"],
    synonyms: ["PLC Engineer", "SCADA Engineer", "PLC Programmer"],
    adjacent: ["Instrumentation Engineer", "Robotics Engineer", "Systems Integration Engineer"],
    excluded: ["Software Engineer", "Account Executive", "Sales Operations", "Recruiter", "Quality Inspector"],
  },
  manufacturing_sales: {
    key: "manufacturing_sales", label: "Manufacturing Sales",
    exact: ["Sales Representative", "Account Manager", "Territory Sales Manager"],
    synonyms: ["Regional Sales Manager", "Inside Sales Representative", "Technical Sales Representative"],
    adjacent: ["Business Development Manager", "Application Engineer"],
    excluded: ["Sales Operations", "Software Engineer", "Recruiter", "Customer Service Representative"],
  },
  finance_operations: {
    key: "finance_operations", label: "FP&A / Finance Operations",
    exact: ["FP&A Analyst", "Financial Planning and Analysis", "FP&A Manager"],
    synonyms: ["Finance Manager", "Senior Financial Analyst", "Director of FP&A"],
    adjacent: ["Finance Business Partner", "Strategic Finance"],
    excluded: ["Accounts Payable", "Accounts Receivable", "Bookkeeper", "Staff Accountant",
      "Payroll Specialist", "Customer Support", "Sales Operations"],
  },
  cybersecurity_sales: {
    key: "cybersecurity_sales", label: "Security Sales Leadership",
    exact: ["VP Sales", "Head of Sales", "Sales Director"],
    synonyms: ["Vice President of Sales", "VP of Revenue", "Chief Revenue Officer"],
    adjacent: ["Regional Sales Director", "Enterprise Sales Director"],
    excluded: ["SDR", "BDR", "Sales Development Representative", "Business Development Representative",
      "Account Executive", "Sales Operations", "Customer Success"],
  },
  // Vertical-neutral sales leadership. `cybersecurity_sales` stays as the security
  // specialisation so established MSSP broadening behaviour is unchanged; every
  // other vertical asking for "sales leadership" lands here instead of falling
  // through to quota-carrying IC aliases.
  sales_leadership: {
    key: "sales_leadership", label: "Sales Leadership",
    exact: ["VP Sales", "Head of Sales", "Sales Director"],
    synonyms: ["Vice President of Sales", "Chief Revenue Officer", "VP of Revenue", "Regional Sales Director"],
    adjacent: ["Enterprise Sales Director", "Area Sales Manager", "Commercial Director"],
    excluded: ["SDR", "BDR", "Sales Development Representative", "Business Development Representative",
      "Account Executive", "Sales Operations", "Revenue Operations", "Customer Success", "Recruiter"],
  },
  // Quota-carrying individual contributors — deliberately SEPARATE from both
  // leadership and Sales Operations.
  sales_ic: {
    key: "sales_ic", label: "Sales (Individual Contributor)",
    exact: ["Account Executive", "Sales Development Representative", "Business Development Representative"],
    synonyms: ["SDR", "BDR", "Enterprise Account Executive", "Mid-Market Account Executive"],
    adjacent: ["Inside Sales Representative", "Sales Associate"],
    excluded: ["Sales Operations", "Revenue Operations", "VP Sales", "Head of Sales", "Sales Director",
      "Recruiter", "Customer Success Manager"],
  },
  clinical_operations: {
    key: "clinical_operations", label: "Clinical Operations",
    exact: ["Clinical Operations Manager", "Director of Clinical Operations", "Head of Clinical Operations"],
    synonyms: ["VP Clinical Operations", "Clinical Trial Manager", "Clinical Program Manager"],
    adjacent: ["Clinical Research Manager", "Clinical Project Manager"],
    excluded: ["Registered Nurse", "Medical Assistant", "Sales Operations", "Account Executive",
      "Software Engineer", "Recruiter"],
  },
  energy_engineering: {
    key: "energy_engineering", label: "Power / Grid Engineering",
    exact: ["Grid Engineer", "Power Systems Engineer", "Transmission Engineer"],
    synonyms: ["Distribution Engineer", "Substation Engineer", "Interconnection Engineer"],
    adjacent: ["Electrical Engineer", "Renewable Energy Engineer"],
    excluded: ["Software Engineer", "Sales Operations", "Account Executive", "Recruiter", "Field Technician"],
  },
  operations: {
    key: "operations", label: "Business Operations",
    exact: ["Operations Manager", "Head of Operations", "Director of Operations"],
    synonyms: ["Business Operations Manager", "Operations Lead", "VP Operations"],
    adjacent: ["Program Manager", "Supply Chain Manager"],
    excluded: ["Sales Operations", "Revenue Operations", "Account Executive", "Software Engineer", "Recruiter"],
  },
  marketing: {
    key: "marketing", label: "Marketing",
    exact: ["Marketing Manager", "Head of Marketing", "Demand Generation Manager"],
    synonyms: ["Product Marketing Manager", "Growth Marketing Manager", "Content Marketing Manager"],
    adjacent: ["Brand Manager", "Lifecycle Marketing Manager"],
    excluded: ["Sales Operations", "SDR", "BDR", "Account Executive", "Recruiter"],
  },
  partnerships: {
    key: "partnerships", label: "Partnerships / Alliances",
    exact: ["Head of Partnerships", "Director of Partnerships", "Partnerships Manager"],
    synonyms: ["Partner Manager", "Alliances Manager", "Channel Partnerships Manager"],
    adjacent: ["Strategic Partnerships Lead", "Business Development Manager"],
    excluded: ["SDR", "BDR", "Sales Operations", "Account Executive", "Recruiter", "Customer Success Manager"],
  },
  executive: {
    key: "executive", label: "Executive",
    exact: ["Chief Executive Officer", "Chief Operating Officer", "President"],
    synonyms: ["CEO", "COO", "Managing Director"],
    adjacent: ["General Manager", "Chief of Staff"],
    excluded: ["SDR", "BDR", "Account Executive", "Sales Operations", "Intern", "Recruiter"],
  },
};

export function getJobFamily(key: string | null | undefined): JobFamilyDefinition | null {
  if (!key) return null;
  return JOB_FAMILY_REGISTRY[key.toLowerCase().trim()] ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9&+ ]+/g, " ").replace(/\s+/g, " ").trim();

/** All titles this family may ever legitimately search. */
export function approvedTitlesFor(def: JobFamilyDefinition): string[] {
  return [...def.exact, ...def.synonyms, ...def.adjacent];
}

export type TitleVerdict = "approved" | "excluded" | "not_in_family";

/**
 * Deterministic per-family title validator. This is what makes an AI proposal
 * safe: a title is only usable when the REQUESTED family already contains it.
 */
export function validateTitleForFamily(familyKey: string | null, title: string): { verdict: TitleVerdict; reason: string } {
  const def = getJobFamily(familyKey);
  const t = norm(title);
  if (!t) return { verdict: "not_in_family", reason: "empty title" };

  // Unknown family → conservative: nothing can be approved beyond the exact ask.
  if (!def) return { verdict: "not_in_family", reason: `no registry definition for family "${familyKey ?? "unknown"}" — exact title only` };

  if (def.excluded.some((x) => norm(x) === t || t.includes(norm(x)))) {
    return { verdict: "excluded", reason: `"${title}" is explicitly excluded from ${def.label}` };
  }
  if (approvedTitlesFor(def).some((a) => norm(a) === t)) {
    return { verdict: "approved", reason: `"${title}" is an approved ${def.label} title` };
  }
  return { verdict: "not_in_family", reason: `"${title}" is not an approved ${def.label} title` };
}

/**
 * Infer the registry family from the compiled intent's own job families/keywords.
 *
 * This used to be an ordered regex ladder over the flattened keyword string,
 * which could not represent seniority or vertical — so "sales leadership"
 * matched nothing and fell through to quota-carrying IC aliases. It now defers
 * to the composable taxonomy, which decides function from the role signal PLUS
 * the seniority and team-stage it derived independently.
 *
 * The explicit `job_families` hint still wins: a caller that already knows the
 * discipline is more authoritative than any inference over keywords.
 */
export function inferFamilyKey(
  jobFamilies: string[],
  keywords: string[],
  /**
   * The ORIGINAL request, when the caller has it. Compiled keyword queries carry
   * the role but drop the industry, and the industry is what decides whether a
   * sales title strategy is AE/SDR or Sales Representative — so passing this is
   * what keeps "MSSPs hiring VP Sales" a SECURITY leadership search.
   */
  context?: string | null,
): string | null {
  const jf = jobFamilies.map((f) => f.toLowerCase());
  if (jf.some((f) => ["sales_ops", "rev_ops", "gtm_ops"].includes(f))) return "sales_operations";
  const text = [...keywords, context ?? ""].filter(Boolean).join(" ");
  if (!text.trim()) return null;
  return compileJobIntent(text).family_key;   // null stays conservative
}

/**
 * The full job intent for a request, with the family's titles resolved.
 *
 * `compileJobIntent` deliberately owns no title data (so it can stay
 * import-free); this is where the two halves meet.
 */
export interface ResolvedJobIntent extends JobIntent {
  family_label: string | null;
  /** Canonical titles to search. Empty when no family could be inferred. */
  titles: string[];
  /** Titles that must never be searched for this request. */
  excluded_titles: string[];
}

export function resolveJobIntent(query: string | null | undefined): ResolvedJobIntent {
  const intent = compileJobIntent(query);
  const def = getJobFamily(intent.family_key);
  return {
    ...intent,
    family_label: def?.label ?? null,
    // EXACT titles only. Synonyms and adjacent titles are what broadening is
    // allowed to add later, after deterministic validation — never up front.
    titles: def ? [...def.exact] : [],
    excluded_titles: def ? [...def.excluded] : [],
  };
}
