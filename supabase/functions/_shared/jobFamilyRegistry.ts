// CANONICAL JOB-FAMILY REGISTRY — the single place profession knowledge lives.
//
// Broadening used to be a Sales-Operations constant inside the controller, so any
// other request ("hiring software engineers") had no safe expansion at all. Titles
// now come from here, keyed by the family the user actually asked for.
//
// An UNKNOWN family stays deliberately conservative: exact requested title only,
// no invented synonyms, and honest search exhaustion when nothing safe remains.

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

/** Infer the registry family from the compiled intent's own job families/keywords. */
export function inferFamilyKey(jobFamilies: string[], keywords: string[]): string | null {
  const jf = jobFamilies.map((f) => f.toLowerCase());
  if (jf.some((f) => ["sales_ops", "rev_ops", "gtm_ops"].includes(f))) return "sales_operations";
  const hay = norm(keywords.join(" "));
  if (/\b(ai|machine learning|ml|llm|generative)\b/.test(hay)) return "ai_engineering";
  if (/\b(software|backend|frontend|full stack)\b/.test(hay)) return "software_engineering";
  if (/\b(controls|plc|scada|automation)\b/.test(hay)) return "controls_engineering";
  if (/\bfp&a|financial planning\b/.test(hay)) return "finance_operations";
  if (/\b(vp sales|head of sales|sales director)\b/.test(hay)) return "cybersecurity_sales";
  // A company's FIRST revenue-carrying hire is commercial sales, not Sales Ops.
  // `manufacturing_sales` is the registry's early/commercial sales family, and its
  // `excluded` list already blocks Sales Operations titles from leaking in.
  if (/\b(sales ?(?:person|people)|first sales hire|founding sales)\b/.test(hay)) return "manufacturing_sales";
  if (/\b(sales representative|territory sales|account manager)\b/.test(hay)) return "manufacturing_sales";
  return null;   // conservative: unknown family
}
