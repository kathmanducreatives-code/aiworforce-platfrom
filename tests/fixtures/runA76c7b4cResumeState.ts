// THE PERSISTED STATE OF TASK a76c7b4c, AT THE MOMENT HIRING VERIFICATION RAN.
//
// `tasks.result.lead_resume_checkpoint.companies`, verbatim, filtered to the
// five companies whose identity resolved — the exact five the two paid job
// searches asked about. Every field is production's: the discovery row, the
// resolved identity object, the enriched company record, the triage verdict,
// the investigation state.
//
// ── THE ONE DEPARTURE, AND WHY ────────────────────────────────────────────
//
// `completed_operations` is emptied. The persisted records carry the hiring
// operation key, because the two calls DID complete — so replaying them as
// stored would make `shouldSkipProviderCall` skip the stage as already bought,
// which is the state AFTER the calls, not before. Emptying it puts the working
// set back at the instant the stage began. Nothing else is touched.
//
// The mission below is `tasks.result.lead_mission`, verbatim, minus
// `planner_runtime` (a git sha and a build timestamp, which would make this
// fixture change on every deploy).

import type { CompanyResumeRecord } from "../../supabase/functions/_shared/leadResumeState.ts";

/** The compiled Mission this run executed. */
// deno-lint-ignore no-explicit-any
export const RUN_A76C7B4C_MISSION: any = {
  "version": "lead-mission-v1",
  "confidence": 0.99,
  "directives": {
    "source_strategy": [],
    "adjacent_signals": [],
    "excluded_signals": [],
    "preferred_signals": [
      "hiring"
    ],
    "required_evidence": [],
    "allowed_broadening": {
      "geographies": [],
      "company_types": [],
      "role_families": [],
      "employee_range": {
        "max": null,
        "min": null
      }
    },
    "execution_preference": "balanced",
    "disallowed_broadening": [],
    "evaluation_instructions": "",
    "founder_unlock_recommended": false,
    "requested_contact_ready_count": null
  },
  "mission_type": "company_research",
  "target_entity": "company",
  "company_profile": {
    "stages": [],
    "locations": [],
    "verticals": [
      "recruiting",
      "staffing"
    ],
    "business_models": []
  },
  "decision_makers": {
    "roles": [],
    "current_employment_required": false
  },
  "requested_count": 5,
  "field_provenance": {
    "target_entity": "explicit_user_request",
    "requested_count": "explicit_user_request",
    "requested_output": "explicit_user_request",
    "required_signals": "explicit_user_request",
    "decision_makers.roles": "gpt_inference",
    "company_profile.stages": "gpt_inference",
    "company_profile.locations": "gpt_inference",
    "company_profile.verticals": "gpt_inference",
    "company_profile.business_models": "gpt_inference"
  },
  "hard_constraints": {},
  "requested_output": "qualified_companies",
  "required_signals": [
    {
      "type": "hiring",
      "event": "hiring",
      "phrase": "hiring sales roles",
      "subject": "company",
      "qualifier": {
        "role_terms": [
          "sales roles"
        ]
      }
    }
  ],
  "soft_preferences": {},
  "original_user_query": "Find 5 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.",
  "required_capabilities": [],
  "required_signal_terms": [
    "sales roles"
  ],
  "prohibited_capabilities": [
    "founder_discovery",
    "employer_verification",
    "contact_enrichment"
  ],
  "lead_intelligence_contract_version": "v1"
};

/** The five companies that reached hiring verification, as production stored them. */
export const RUN_A76C7B4C_RESUME_RECORDS: readonly CompanyResumeRecord[] = [
  {
    "brain": "not_started",
    "hiring": "not_verified",
    "founder": "not_eligible",
    "identity": "resolved",
    "snapshot": {
      "triage": {
        "reasons": [
          "Clearly operates in recruitment and staffing, but no active sales hiring signal is present in the discovery data."
        ],
        "relevance": "uncertain",
        "confidence": 0.72,
        "company_key": "https://www.linkedin.com/company/sotalentjobs",
        "matched_roles": [],
        "signal_strength": 35
      },
      "company": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_search",
          "source_id": "106203357"
        },
        "website": "https://sotalent.us",
        "geography": null,
        "description": "A recruitment media and candidate acquisition agency helping employers and hiring partners connect with relevant talent at scale.\n\nWe promote live job opportunities across social, professional and digital channels, then screen and evaluate candidates to discover relevant opportunities while supporting employers with quality applicant flow.\n\nFocused on high-volume hiring sectors including healthcare, logistics, technology, engineering and skilled professions.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "employee_count": "direct",
          "provider_industry": "unsafe",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "SoTalent",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "candidate_only": true,
        "employee_count": 24,
        "missing_fields": [
          "provider_industry:filter_returned_wrong_industries_use_enrichment",
          "employee_range_advisory:contradicts_exact_count_use_enrichment"
        ],
        "canonical_domain": "sotalent.us",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company-search",
        "external_source_id": "li_company:106203357",
        "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs",
        "employee_range_advisory": "2-10"
      },
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "106203357"
        },
        "website": "https://sotalent.us",
        "geography": null,
        "description": "A recruitment media and candidate acquisition agency helping employers and hiring partners connect with relevant talent at scale.\n\nWe promote live job opportunities across social, professional and digital channels, then screen and evaluate candidates to discover relevant opportunities while supporting employers with quality applicant flow.\n\nFocused on high-volume hiring sectors including healthcare, logistics, technology, engineering and skilled professions.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "industry_ids": "direct",
          "employee_count": "direct",
          "provider_industry": "direct",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "SoTalent",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 24,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "sotalent.us",
        "startup_evidence": {
          "year_founded": 2020
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:106203357",
        "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs",
        "employee_range_advisory": "2-10"
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/sotalentjobs",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs"
      },
      "prequal_key": null,
      "shortlisted": true,
      "prequalified": {
        "jobs": [],
        "name": "SoTalent",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 24 is inside the target range",
          "already carries a LinkedIn identity — no resolution to pay for",
          "carries a description — the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 24,
        "technical": 0,
        "company_key": "sotalent.us",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "sotalent.us",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "yc_open_jobs": [],
      "enrichment_outcome": "success",
      "investigation_rank": 4,
      "investigation_state": "investigated"
    },
    "enrichment": "completed",
    "updated_at": "2026-08-29T07:55:51.069Z",
    "company_key": "https://www.linkedin.com/company/sotalentjobs",
    "company_name": "SoTalent",
    "completed_operations": [],
    "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs"
  },
  {
    "brain": "not_started",
    "hiring": "not_verified",
    "founder": "not_eligible",
    "identity": "resolved",
    "snapshot": {
      "triage": {
        "reasons": [
          "Clearly a specialist staffing and executive search firm with a Sales & Marketing function, but no specific open sales roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.68,
        "company_key": "https://www.linkedin.com/company/storm4",
        "matched_roles": [],
        "signal_strength": 35
      },
      "company": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_search",
          "source_id": "71303127"
        },
        "website": "http://www.storm4.com",
        "geography": null,
        "description": "Storm4 is a specialist US Energy & Infrastructure recruitment and executive search firm.\n\nThe people who secure power, deliver capacity and run critical infrastructure are rarely on the open market. We build relationships with them long before a search begins.\n\nWe deliver Executive Search for critical leadership appointments and Permanent Staffing for senior specialists, helping you build the teams behind your next stage of growth.\n\nFor leadership appointments, our Future Leaders Network brings existing relationships, current market insight and independent referencing to your search. We assess experience, reputation and fit so you can hire with confidence.\n\nData Centers are a core part of our market. We support operators, developers, design partners and cooling specialists across the full lifecycle - from land and power through development, construction, leasing and live operations.\n\nOur markets:\nEnergy Storage & Battery Tech | Energy Trading & Markets | Energy Optimization & Grid Management | Nuclear & Next-Gen Energy | Renewable Energy | Data Center Infrastructure | Smart Buildings & HVAC | Smart Grid & Grid Tech | Construction | Power Management | Power Infrastructure Equipment\n\nOur functions:\nAI, Data & Analytics | Hardware Engineering | Software Engineering | Finance & Operations | Product Management | Sales & Marketing\n\nBased in New York and London. Part of Levin.\n\nTell us who you need to hire at storm4.com.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "employee_count": "direct",
          "provider_industry": "unsafe",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Storm4",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "candidate_only": true,
        "employee_count": 53,
        "missing_fields": [
          "provider_industry:filter_returned_wrong_industries_use_enrichment",
          "employee_range_advisory:contradicts_exact_count_use_enrichment"
        ],
        "canonical_domain": "storm4.com",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company-search",
        "external_source_id": "li_company:71303127",
        "linkedin_company_url": "https://www.linkedin.com/company/storm4",
        "employee_range_advisory": "51-200"
      },
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "71303127"
        },
        "website": "http://www.storm4.com",
        "geography": null,
        "description": "Storm4 is a specialist US Energy & Infrastructure recruitment and executive search firm.\n\nThe people who secure power, deliver capacity and run critical infrastructure are rarely on the open market. We build relationships with them long before a search begins.\n\nWe deliver Executive Search for critical leadership appointments and Permanent Staffing for senior specialists, helping you build the teams behind your next stage of growth.\n\nFor leadership appointments, our Future Leaders Network brings existing relationships, current market insight and independent referencing to your search. We assess experience, reputation and fit so you can hire with confidence.\n\nData Centers are a core part of our market. We support operators, developers, design partners and cooling specialists across the full lifecycle - from land and power through development, construction, leasing and live operations.\n\nOur markets:\nEnergy Storage & Battery Tech | Energy Trading & Markets | Energy Optimization & Grid Management | Nuclear & Next-Gen Energy | Renewable Energy | Data Center Infrastructure | Smart Buildings & HVAC | Smart Grid & Grid Tech | Construction | Power Management | Power Infrastructure Equipment\n\nOur functions:\nAI, Data & Analytics | Hardware Engineering | Software Engineering | Finance & Operations | Product Management | Sales & Marketing\n\nBased in New York and London. Part of Levin.\n\nTell us who you need to hire at storm4.com.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "industry_ids": "direct",
          "employee_count": "direct",
          "provider_industry": "direct",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Storm4",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 53,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "storm4.com",
        "startup_evidence": {
          "year_founded": 2020
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:71303127",
        "linkedin_company_url": "https://www.linkedin.com/company/storm4",
        "employee_range_advisory": "51-200"
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/storm4",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/storm4"
      },
      "prequal_key": null,
      "shortlisted": true,
      "prequalified": {
        "jobs": [],
        "name": "Storm4",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 53 is inside the target range",
          "already carries a LinkedIn identity — no resolution to pay for",
          "carries a description — the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 53,
        "technical": 0,
        "company_key": "storm4.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "storm4.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "yc_open_jobs": [],
      "enrichment_outcome": "success",
      "investigation_rank": 7,
      "investigation_state": "investigated"
    },
    "enrichment": "completed",
    "updated_at": "2026-08-29T07:55:51.069Z",
    "company_key": "https://www.linkedin.com/company/storm4",
    "company_name": "Storm4",
    "completed_operations": [],
    "linkedin_company_url": "https://www.linkedin.com/company/storm4"
  },
  {
    "brain": "not_started",
    "hiring": "not_verified",
    "founder": "not_eligible",
    "identity": "resolved",
    "snapshot": {
      "triage": {
        "reasons": [
          "Clearly an executive recruiting and contingent workforce firm, but no active sales-role openings are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.7,
        "company_key": "https://www.linkedin.com/company/atlas-search",
        "matched_roles": [],
        "signal_strength": 35
      },
      "company": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_search",
          "source_id": "4872007"
        },
        "website": "http://atlassearchllc.com",
        "geography": null,
        "description": "Atlas Search is an executive recruiting firm dedicated to placing accounting, finance, front office, middle office, technology, healthcare, clinical research, human resources, and business operations professionals. Our clients range from Fortune 500 companies to start-ups, and we service all industries from Financial Services to Media & Entertainment. Atlas Search was founded on the principle of relationships. Our firm has been built on partnering with candidates and clients with a focus on their long-term interests. We provide permanent recruitment, contingent workforce solutions, professional services, and retained search.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "employee_count": "direct",
          "provider_industry": "unsafe",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Atlas Search",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "candidate_only": true,
        "employee_count": 146,
        "missing_fields": [
          "provider_industry:filter_returned_wrong_industries_use_enrichment",
          "employee_range_advisory:contradicts_exact_count_use_enrichment"
        ],
        "canonical_domain": "atlassearchllc.com",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company-search",
        "external_source_id": "li_company:4872007",
        "linkedin_company_url": "https://www.linkedin.com/company/atlas-search",
        "employee_range_advisory": "51-200"
      },
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "4872007"
        },
        "website": "http://atlassearchllc.com",
        "geography": null,
        "description": "Atlas Search is an executive recruiting firm dedicated to placing accounting, finance, front office, middle office, technology, healthcare, clinical research, human resources, and business operations professionals. Our clients range from Fortune 500 companies to start-ups, and we service all industries from Financial Services to Media & Entertainment. Atlas Search was founded on the principle of relationships. Our firm has been built on partnering with candidates and clients with a focus on their long-term interests. We provide permanent recruitment, contingent workforce solutions, professional services, and retained search.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "industry_ids": "direct",
          "employee_count": "direct",
          "provider_industry": "direct",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Atlas Search",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 146,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "atlassearchllc.com",
        "startup_evidence": {
          "year_founded": 2015
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:4872007",
        "linkedin_company_url": "https://www.linkedin.com/company/atlas-search",
        "employee_range_advisory": "51-200"
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/atlas-search",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/atlas-search"
      },
      "prequal_key": null,
      "shortlisted": true,
      "prequalified": {
        "jobs": [],
        "name": "Atlas Search",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 146 is inside the target range",
          "already carries a LinkedIn identity — no resolution to pay for",
          "carries a description — the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 146,
        "technical": 0,
        "company_key": "atlassearchllc.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "atlassearchllc.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "yc_open_jobs": [],
      "enrichment_outcome": "success",
      "investigation_rank": 5,
      "investigation_state": "investigated"
    },
    "enrichment": "completed",
    "updated_at": "2026-08-29T07:55:51.069Z",
    "company_key": "https://www.linkedin.com/company/atlas-search",
    "company_name": "Atlas Search",
    "completed_operations": [],
    "linkedin_company_url": "https://www.linkedin.com/company/atlas-search"
  },
  {
    "brain": "not_started",
    "hiring": "not_verified",
    "founder": "not_eligible",
    "identity": "resolved",
    "snapshot": {
      "triage": {
        "reasons": [
          "Clearly a specialist staffing and executive search firm with a Go-To-Market function, but no specific active sales roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.68,
        "company_key": "https://www.linkedin.com/company/storm3",
        "matched_roles": [],
        "signal_strength": 35
      },
      "company": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_search",
          "source_id": "70915780"
        },
        "website": "http://www.storm3.com",
        "geography": null,
        "description": "Storm3 is a specialist US HealthTech recruitment and executive search firm.\n\nThe strongest HealthTech leaders are rarely waiting for a job ad. We stay close to the people building the market, so your search starts with relationships and insight already in place.\n\nWhether you’re building a founding team, scaling after investment or strengthening a public company, we connect you with the senior specialists and leaders who can move your business forward.\n\nHow we work:\n\nExecutive Search - critical leadership appointments, powered by our Future Leaders Network.\nPermanent Staffing - senior specialists to build your core team.\n\nOur executive searches bring together market mapping, ongoing leadership conversations and independent referencing. We look at what someone has built, how they lead and how their experience fits the business you’re building.\n\nOur markets:\nConsumer & Digital Health | Hardware & Devices | Healthcare IT | Science & Research\n\nOur specialties include Mental Health, Metabolic Health, Digital Therapeutics, Family & Fertility, Telehealth, Wellness, Digital Health Insurance, AI Drug Discovery, BioTech, Clinical Trials Tech, Genomics, Medical Imaging and Real-World Evidence.\n\nOur functions:\nData & Analytics | Engineering | AI & Machine Learning | Product Management | Go-To-Market (GTM)\n\nBased in New York and London. Part of Levin.\n\nTell us who you need to hire at storm3.com.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "employee_count": "direct",
          "provider_industry": "unsafe",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Storm3",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "candidate_only": true,
        "employee_count": 83,
        "missing_fields": [
          "provider_industry:filter_returned_wrong_industries_use_enrichment",
          "employee_range_advisory:contradicts_exact_count_use_enrichment"
        ],
        "canonical_domain": "storm3.com",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company-search",
        "external_source_id": "li_company:70915780",
        "linkedin_company_url": "https://www.linkedin.com/company/storm3",
        "employee_range_advisory": "51-200"
      },
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "70915780"
        },
        "website": "http://www.storm3.com",
        "geography": null,
        "description": "Storm3 is a specialist US HealthTech recruitment and executive search firm.\n\nThe strongest HealthTech leaders are rarely waiting for a job ad. We stay close to the people building the market, so your search starts with relationships and insight already in place.\n\nWhether you’re building a founding team, scaling after investment or strengthening a public company, we connect you with the senior specialists and leaders who can move your business forward.\n\nHow we work:\n\nExecutive Search - critical leadership appointments, powered by our Future Leaders Network.\nPermanent Staffing - senior specialists to build your core team.\n\nOur executive searches bring together market mapping, ongoing leadership conversations and independent referencing. We look at what someone has built, how they lead and how their experience fits the business you’re building.\n\nOur markets:\nConsumer & Digital Health | Hardware & Devices | Healthcare IT | Science & Research\n\nOur specialties include Mental Health, Metabolic Health, Digital Therapeutics, Family & Fertility, Telehealth, Wellness, Digital Health Insurance, AI Drug Discovery, BioTech, Clinical Trials Tech, Genomics, Medical Imaging and Real-World Evidence.\n\nOur functions:\nData & Analytics | Engineering | AI & Machine Learning | Product Management | Go-To-Market (GTM)\n\nBased in New York and London. Part of Levin.\n\nTell us who you need to hire at storm3.com.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "industry_ids": "direct",
          "employee_count": "direct",
          "provider_industry": "direct",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Storm3",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 83,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "storm3.com",
        "startup_evidence": {
          "year_founded": 2020
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:70915780",
        "linkedin_company_url": "https://www.linkedin.com/company/storm3",
        "employee_range_advisory": "51-200"
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/storm3",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/storm3"
      },
      "prequal_key": null,
      "shortlisted": true,
      "prequalified": {
        "jobs": [],
        "name": "Storm3",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 83 is inside the target range",
          "already carries a LinkedIn identity — no resolution to pay for",
          "carries a description — the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 83,
        "technical": 0,
        "company_key": "storm3.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "storm3.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "yc_open_jobs": [],
      "enrichment_outcome": "success",
      "investigation_rank": 6,
      "investigation_state": "investigated"
    },
    "enrichment": "completed",
    "updated_at": "2026-08-29T07:55:51.069Z",
    "company_key": "https://www.linkedin.com/company/storm3",
    "company_name": "Storm3",
    "completed_operations": [],
    "linkedin_company_url": "https://www.linkedin.com/company/storm3"
  },
  {
    "brain": "not_started",
    "hiring": "not_verified",
    "founder": "not_eligible",
    "identity": "resolved",
    "snapshot": {
      "triage": {
        "reasons": [
          "Clearly a staffing and recruiting company focused specifically on hiring marketing and sales representatives, making active internal sales hiring plausible and highly mission-aligned."
        ],
        "relevance": "relevant",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "matched_roles": [
          "sales representatives"
        ],
        "signal_strength": 88
      },
      "company": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_search",
          "source_id": "6592912"
        },
        "website": "http://www.pursuitsalessolutions.com",
        "geography": null,
        "description": "Hiring top performers for your organization is tough - top talent often snatched up before their resume even hits the market.\n\nWe help you find + hire top marketing and sales reps to help you scale your company.\n\nTo get in contact with our team, please reach out to info@pursuitsalessolutions.com.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "employee_count": "direct",
          "provider_industry": "unsafe",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Pursuit",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "candidate_only": true,
        "employee_count": 104,
        "missing_fields": [
          "provider_industry:filter_returned_wrong_industries_use_enrichment",
          "employee_range_advisory:contradicts_exact_count_use_enrichment"
        ],
        "canonical_domain": "pursuitsalessolutions.com",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company-search",
        "external_source_id": "li_company:6592912",
        "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "employee_range_advisory": "51-200"
      },
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "6592912"
        },
        "website": "http://www.pursuitsalessolutions.com",
        "geography": null,
        "description": "Hiring top performers for your organization is tough - top talent often snatched up before their resume even hits the market.\n\nWe help you find + hire top marketing and sales reps to help you scale your company.\n\nTo get in contact with our team, please reach out to info@pursuitsalessolutions.com.",
        "field_trust": {
          "website": "direct",
          "geography": "transformed",
          "description": "direct",
          "company_name": "direct",
          "company_type": "semantic",
          "industry_ids": "direct",
          "employee_count": "direct",
          "provider_industry": "direct",
          "linkedin_company_url": "direct",
          "employee_range_advisory": "unsafe"
        },
        "company_name": "Pursuit",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 104,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "pursuitsalessolutions.com",
        "startup_evidence": {
          "year_founded": 2015
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:6592912",
        "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "employee_range_advisory": "51-200"
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions"
      },
      "prequal_key": null,
      "shortlisted": true,
      "prequalified": {
        "jobs": [],
        "name": "Pursuit",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 104 is inside the target range",
          "already carries a LinkedIn identity — no resolution to pay for",
          "carries a description — the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 104,
        "technical": 0,
        "company_key": "pursuitsalessolutions.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "pursuitsalessolutions.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "yc_open_jobs": [],
      "enrichment_outcome": "success",
      "investigation_rank": 0,
      "investigation_state": "investigated"
    },
    "enrichment": "completed",
    "updated_at": "2026-08-29T07:55:51.069Z",
    "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
    "company_name": "Pursuit",
    "completed_operations": [],
    "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions"
  }
] as unknown as CompanyResumeRecord[];
