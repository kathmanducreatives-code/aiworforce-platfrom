// THE CHECKPOINT CONTINUE REFUSED.
//
// Task 43355471-f0ca-4e12-aec4-f3dcf586ef90, 2026-08-29 08:42. The run hit its
// wall clock during identity resolution and saved a checkpoint. The user
// pressed Continue and got:
//
//     no_resumable_provider_run
//     "That run has no stored company dataset to continue from."
//
// It had one. This is it — `tasks.result`, verbatim in structure:
//
//     capability_execution_state.completed_capabilities  ["general_company_discovery"]
//     capability_execution_state.pending_runs            []
//     lead_resume_checkpoint.companies                   50, every one with a snapshot
//     of those, shortlisted                              10
//     next pending capability                            company_identity_resolution
//
// The discovery Actor run (aox0htYw4mhCwb05c, dataset zcUtxYhdVdsticQQU, 50
// rows, $0.153) had already completed and its rows were already IN the
// checkpoint as company snapshots. Nothing needed adopting, because nothing
// needed calling: `restoreWorkingSet` rebuilds the pool and the engine skips a
// completed capability.
//
// ── WHAT IS PROJECTED, AND WHAT IS NOT ─────────────────────────────────────
//
// The state object is byte-for-byte production's. The 50 company records keep
// every field the resume path reads — the stage states, `completed_operations`,
// the shortlist flag, the triage verdict, the investigation state and rank, the
// resolved identity — and `snapshot.company` is narrowed to the six identity
// fields, with `yc_open_jobs` emptied (it was empty on every row). Nothing is
// invented and no field the decision reads is altered.

/** `tasks.result.capability_execution_state`, as production wrote it. */
// deno-lint-ignore no-explicit-any
export const RUN_43355471_STATE: any = {
  "triage": {
    "total": 50,
    "relevant": 0,
    "uncertain": 48,
    "irrelevant": 2,
    "batches_made": 2,
    "batches_available": 2
  },
  "version": "capability-execution-state-v1",
  "progress": {
    "stage": "qualified",
    "evaluated": 50,
    "in_progress": true,
    "shortlisted": 10,
    "accounts_found": 50,
    "hiring_verified": 0,
    "exclusion_reasons": {
      "employee_size": 29
    },
    "identity_resolved": 2,
    "companies_enriched": 2,
    "identity_unresolved": 0,
    "open_jobs_evaluated": 0,
    "qualified_companies": 0,
    "awaiting_external_run": false,
    "eligible_opportunities": 21,
    "decision_makers_verified": 0
  },
  "company_keys": [
    "https://www.linkedin.com/company/cypress-hcm",
    "https://www.linkedin.com/company/storm2",
    "https://www.linkedin.com/company/sotalentjobs",
    "https://www.linkedin.com/company/talentoma",
    "https://www.linkedin.com/company/synergy-interactive-solutions",
    "https://www.linkedin.com/company/othonconstrutora",
    "https://www.linkedin.com/company/odiin",
    "https://www.linkedin.com/company/weekdayworks",
    "https://www.linkedin.com/company/intelletec-ltd",
    "https://www.linkedin.com/company/crossinghurdles",
    "https://www.linkedin.com/company/csg-talent",
    "https://www.linkedin.com/company/the-mom-project",
    "https://www.linkedin.com/company/hacking-hr",
    "https://www.linkedin.com/company/clarity-llc",
    "https://www.linkedin.com/company/react-jobs",
    "https://www.linkedin.com/company/somewhere",
    "https://www.linkedin.com/company/revistaempleo",
    "https://www.linkedin.com/company/jcwgroup",
    "https://www.linkedin.com/company/workling-jobs",
    "https://www.linkedin.com/company/confidentialcareers",
    "https://www.linkedin.com/company/storm4",
    "https://www.linkedin.com/company/atlas-search",
    "https://www.linkedin.com/company/careerxperts-consulting",
    "https://www.linkedin.com/company/optimhire",
    "https://www.linkedin.com/company/empresa-confidencial",
    "https://www.linkedin.com/company/hiremilitary-us",
    "https://www.linkedin.com/company/engtal",
    "https://www.linkedin.com/company/career-group",
    "https://www.linkedin.com/company/careerup-inc.",
    "https://www.linkedin.com/company/blue-signal-search",
    "https://www.linkedin.com/company/pursuit-sales-solutions",
    "https://www.linkedin.com/company/indi-staffing-services",
    "https://www.linkedin.com/company/letsremotivate",
    "https://www.linkedin.com/company/hrmcounselll",
    "https://www.linkedin.com/company/calculated-hire",
    "https://www.linkedin.com/company/leveluphcs",
    "https://www.linkedin.com/company/arrow-search-partners",
    "https://www.linkedin.com/company/the-phoenix-group_3",
    "https://www.linkedin.com/company/hrci",
    "https://www.linkedin.com/company/phaxis-consulting",
    "https://www.linkedin.com/company/onward-search",
    "https://www.linkedin.com/company/ringside-talent",
    "https://www.linkedin.com/company/evona-space",
    "https://www.linkedin.com/company/storm3",
    "https://www.linkedin.com/company/emploi-recrutement",
    "https://www.linkedin.com/company/hirefeedd",
    "https://www.linkedin.com/company/inceed",
    "https://www.linkedin.com/company/coda-search",
    "https://www.linkedin.com/company/swoopednetwork",
    "https://www.linkedin.com/company/the-atlantic-group"
  ],
  "mission_hash": "d3d0dc967072423c36e037af80f51b8f14323049811726039fb88ec549b52d92",
  "pending_runs": [],
  "execution_plan": {
    "steps": [
      {
        "step": 1,
        "input": {
          "maxItems": 100,
          "companySize": [
            "1-10",
            "11-50",
            "51-200"
          ],
          "industryIds": [
            "104",
            "137"
          ],
          "scraperMode": "full"
        },
        "purpose": "Discover a sufficiently broad candidate pool of companies classified under Recruiting and Staffing, while returning LinkedIn company URLs for downstream verification. Avoid searchQuery because it is a company-name matcher rather than a concept search.",
        "actor_key": "apify_linkedin_company_search",
        "capability": "general_company_discovery",
        "depends_on": []
      },
      {
        "step": 2,
        "input": {
          "companies": [
            "{{step1.linkedinUrl}}"
          ]
        },
        "purpose": "Resolve and enrich each discovered company using its LinkedIn URL. Establish exact employee count, authoritative industry hierarchy, canonical identity, description, and other evidence needed for ICP qualification.",
        "actor_key": "apify_linkedin_company_details",
        "capability": "company_enrichment",
        "depends_on": [
          1
        ]
      },
      {
        "step": 3,
        "input": {
          "sortBy": "date",
          "company": [
            "{{step2.linkedinUrl}}"
          ],
          "maxItems": 20,
          "jobTitles": [
            "sales",
            "account executive",
            "business development",
            "sales manager"
          ],
          "postedLimit": "month"
        },
        "purpose": "Verify that each enriched company currently advertises a sales role. Search several sales-role terms to improve recall, then require the returned job's company LinkedIn URL to match the enriched target and manually validate the title and description as a genuine sales position.",
        "actor_key": "apify_linkedin_job_search",
        "capability": "hiring_verification",
        "depends_on": [
          2
        ]
      },
      {
        "step": 4,
        "input": {},
        "purpose": "Judge each enriched company and verified job against the explicit request and Company Brain: recruiting/staffing industry fit, acceptable size and maturity, absence of stated disqualifiers, and genuine current sales hiring. Retain and rank the strongest five only when all required facts are supported.",
        "actor_key": null,
        "capability": "company_brain_qualification",
        "depends_on": [
          2,
          3
        ]
      },
      {
        "step": 5,
        "input": {},
        "purpose": "Persist the qualified company records, including canonical LinkedIn URL, ICP evidence, exact employee count, verified sales-job evidence, qualification rationale, and ranking.",
        "actor_key": null,
        "capability": "persistence",
        "depends_on": [
          4
        ]
      }
    ],
    "source": "model_validated",
    "version": "lead-execution-plan-v1",
    "reasoning": "",
    "violations": [],
    "amended_after_discovery": false,
    "amendment_considered_no_change": true
  },
  "mission_output": {
    "people": [],
    "version": "mission-output-contract-v1",
    "companies": [
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/cypress-hcm",
        "company_name": "Cypress HCM"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/storm2",
        "company_name": "Storm2"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/sotalentjobs",
        "company_name": "SoTalent"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/talentoma",
        "company_name": "Talentoma"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/synergy-interactive-solutions",
        "company_name": "Synergy Interactive"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/othonconstrutora",
        "company_name": "VAGAS DE EMPREGOS"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/odiin",
        "company_name": "Odiin."
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/weekdayworks",
        "company_name": "Weekday (YC W21)"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/intelletec-ltd",
        "company_name": "Intelletec"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/crossinghurdles",
        "company_name": "Crossing Hurdles"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/csg-talent",
        "company_name": "CSG Talent"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/the-mom-project",
        "company_name": "The Mom Project"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hacking-hr",
        "company_name": "Hacking HR"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/clarity-llc",
        "company_name": "Clarity Recruiting"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/react-jobs",
        "company_name": "React Jobs"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/somewhere",
        "company_name": "Somewhere"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/revistaempleo",
        "company_name": "Revista Empleo"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/jcwgroup",
        "company_name": "JCW Group"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/workling-jobs",
        "company_name": "Workling"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/confidentialcareers",
        "company_name": "Confidential Careers"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/storm4",
        "company_name": "Storm4"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/atlas-search",
        "company_name": "Atlas Search"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/careerxperts-consulting",
        "company_name": "CareerXperts Consulting"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/optimhire",
        "company_name": "OptimHire"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/empresa-confidencial",
        "company_name": "Empresa Confidencial"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hiremilitary-us",
        "company_name": "Tenova LLC (HireMilitary)"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/engtal",
        "company_name": "Engtal"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/career-group",
        "company_name": "Career Group"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/careerup-inc.",
        "company_name": "CareerUp, Inc."
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/blue-signal-search",
        "company_name": "Blue Signal Search"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "company_name": "Pursuit"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/indi-staffing-services",
        "company_name": "INDI Staffing Services"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/letsremotivate",
        "company_name": "Remotivate"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hrmcounselll",
        "company_name": "HRM Counsel"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/calculated-hire",
        "company_name": "Calculated Hire"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/leveluphcs",
        "company_name": "LevelUP HCS"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/arrow-search-partners",
        "company_name": "Arrow Search Partners"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/the-phoenix-group_3",
        "company_name": "The Phoenix Group"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hrci",
        "company_name": "HRCI"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/phaxis-consulting",
        "company_name": "Phaxis"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/onward-search",
        "company_name": "Onward Search"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/ringside-talent",
        "company_name": "Ringside Talent"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/evona-space",
        "company_name": "EVONA"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/storm3",
        "company_name": "Storm3"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/emploi-recrutement",
        "company_name": "EMPLOI & RECRUTEMENT"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hirefeedd",
        "company_name": "Hire Feed"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/inceed",
        "company_name": "Inceed"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/coda-search",
        "company_name": "Coda Search\u2502Staffing"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/swoopednetwork",
        "company_name": "Swooped"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/the-atlantic-group",
        "company_name": "Atlantic Group"
      }
    ],
    "substitution": {
      "reason": null,
      "message": null,
      "occurred": false,
      "unlock_credits": null,
      "accounts_pending": 0,
      "unlock_capability": null
    },
    "returned_entity": "company",
    "requested_entity": "company",
    "rows_are_the_answer": true
  },
  "fallback_reason": null,
  "signal_coverage": {
    "signals": [
      {
        "actors": [
          "apify_yc_companies_memo23",
          "apify_linkedin_job_search"
        ],
        "signal": "hiring",
        "status": "covered",
        "scenarios": [
          "hiring_engineers"
        ]
      }
    ],
    "fully_covered": true,
    "required_actors": [
      "apify_yc_companies_memo23",
      "apify_linkedin_job_search"
    ],
    "runnable_actors": [
      "apify_yc_companies_memo23",
      "apify_linkedin_company_search",
      "apify_linkedin_job_search"
    ]
  },
  "terminal_reason": "execution_deadline_checkpoint",
  "entry_capability": "general_company_discovery",
  "prequalification": {
    "version": "commercial-prequalification-v1",
    "companies": [
      {
        "name": "Arrow Search Partners",
        "score": 75,
        "reasons": [
          "exact headcount 95 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 95,
        "company_key": "arrowsearchpartners.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "arrowsearchpartners.com",
        "strongest_signal": null
      },
      {
        "name": "Atlas Search",
        "score": 75,
        "reasons": [
          "exact headcount 146 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 146,
        "company_key": "atlassearchllc.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "atlassearchllc.com",
        "strongest_signal": null
      },
      {
        "name": "Blue Signal Search",
        "score": 75,
        "reasons": [
          "exact headcount 106 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 106,
        "company_key": "bluesignal.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "bluesignal.com",
        "strongest_signal": null
      },
      {
        "name": "Calculated Hire",
        "score": 75,
        "reasons": [
          "exact headcount 145 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 145,
        "company_key": "calculatedhire.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "calculatedhire.com",
        "strongest_signal": null
      },
      {
        "name": "CareerUp, Inc.",
        "score": 75,
        "reasons": [
          "exact headcount 110 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 110,
        "company_key": "careerup.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "careerup.com",
        "strongest_signal": null
      },
      {
        "name": "CareerXperts Consulting",
        "score": 75,
        "reasons": [
          "exact headcount 101 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 101,
        "company_key": "careerxperts.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "careerxperts.com",
        "strongest_signal": null
      },
      {
        "name": "Coda Search\u2502Staffing",
        "score": 75,
        "reasons": [
          "exact headcount 119 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 119,
        "company_key": "codarecruitment.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "codarecruitment.com",
        "strongest_signal": null
      },
      {
        "name": "Engtal",
        "score": 75,
        "reasons": [
          "exact headcount 42 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 42,
        "company_key": "engtal.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "engtal.com",
        "strongest_signal": null
      },
      {
        "name": "EVONA",
        "score": 75,
        "reasons": [
          "exact headcount 122 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 122,
        "company_key": "evona.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "evona.com",
        "strongest_signal": null
      },
      {
        "name": "Hire Feed",
        "score": 75,
        "reasons": [
          "exact headcount 87 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 87,
        "company_key": "hirefeed.co.in",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "hirefeed.co.in",
        "strongest_signal": null
      },
      {
        "name": "INDI Staffing Services",
        "score": 75,
        "reasons": [
          "exact headcount 116 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 116,
        "company_key": "indistaffingservices.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "indistaffingservices.com",
        "strongest_signal": null
      },
      {
        "name": "Intelletec",
        "score": 75,
        "reasons": [
          "exact headcount 54 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 54,
        "company_key": "intelletec.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "intelletec.com",
        "strongest_signal": null
      },
      {
        "name": "Odiin.",
        "score": 75,
        "reasons": [
          "exact headcount 31 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 31,
        "company_key": "odiin.tech",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "odiin.tech",
        "strongest_signal": null
      },
      {
        "name": "Pursuit",
        "score": 75,
        "reasons": [
          "exact headcount 104 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 104,
        "company_key": "pursuitsalessolutions.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "pursuitsalessolutions.com",
        "strongest_signal": null
      },
      {
        "name": "Remotivate",
        "score": 75,
        "reasons": [
          "exact headcount 19 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 19,
        "company_key": "remotivatejobs.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "remotivatejobs.com",
        "strongest_signal": null
      },
      {
        "name": "Ringside Talent",
        "score": 75,
        "reasons": [
          "exact headcount 72 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 72,
        "company_key": "ringsidetalent.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "ringsidetalent.com",
        "strongest_signal": null
      },
      {
        "name": "SoTalent",
        "score": 75,
        "reasons": [
          "exact headcount 24 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 24,
        "company_key": "sotalent.us",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "sotalent.us",
        "strongest_signal": null
      },
      {
        "name": "Storm3",
        "score": 75,
        "reasons": [
          "exact headcount 83 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 83,
        "company_key": "storm3.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "storm3.com",
        "strongest_signal": null
      },
      {
        "name": "Storm4",
        "score": 75,
        "reasons": [
          "exact headcount 53 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 53,
        "company_key": "storm4.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "storm4.com",
        "strongest_signal": null
      },
      {
        "name": "Swooped",
        "score": 75,
        "reasons": [
          "exact headcount 24 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 24,
        "company_key": "swooped.co",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "swooped.co",
        "strongest_signal": null
      },
      {
        "name": "Talentoma",
        "score": 75,
        "reasons": [
          "exact headcount 10 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "best_tier": null,
        "exclusion": null,
        "team_size": 10,
        "company_key": "talentoma.com",
        "size_status": "in_range",
        "commercial_jobs": [],
        "canonical_domain": "talentoma.com",
        "strongest_signal": null
      },
      {
        "name": "Atlantic Group",
        "score": 45,
        "reasons": [
          "exact headcount 294 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 294,
        "company_key": "atlanticrecruiters.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "atlanticrecruiters.com",
        "strongest_signal": null
      },
      {
        "name": "Career Group",
        "score": 45,
        "reasons": [
          "exact headcount 362 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 362,
        "company_key": "careergroupcompanies.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "careergroupcompanies.com",
        "strongest_signal": null
      },
      {
        "name": "Clarity Recruiting",
        "score": 45,
        "reasons": [
          "exact headcount 185 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 185,
        "company_key": "clarityrecruiting.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "clarityrecruiting.com",
        "strongest_signal": null
      },
      {
        "name": "Confidential Careers",
        "score": 45,
        "reasons": [
          "exact headcount 29939 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 29939,
        "company_key": "confidential.careers",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "confidential.careers",
        "strongest_signal": null
      },
      {
        "name": "Crossing Hurdles",
        "score": 45,
        "reasons": [
          "exact headcount 302 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 302,
        "company_key": "crossinghurdles.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "crossinghurdles.com",
        "strongest_signal": null
      },
      {
        "name": "CSG Talent",
        "score": 45,
        "reasons": [
          "exact headcount 260 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 260,
        "company_key": "csgtalent.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "csgtalent.com",
        "strongest_signal": null
      },
      {
        "name": "Cypress HCM",
        "score": 45,
        "reasons": [
          "exact headcount 157 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 157,
        "company_key": "cypresshcm.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "cypresshcm.com",
        "strongest_signal": null
      },
      {
        "name": "EMPLOI & RECRUTEMENT",
        "score": 45,
        "reasons": [
          "exact headcount 2418 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 2418,
        "company_key": "facebook.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "facebook.com",
        "strongest_signal": null
      },
      {
        "name": "Empresa Confidencial",
        "score": 45,
        "reasons": [
          "exact headcount 14503 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 14503,
        "company_key": "empresaconfidencial.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "empresaconfidencial.com",
        "strongest_signal": null
      },
      {
        "name": "Hacking HR",
        "score": 45,
        "reasons": [
          "exact headcount 1250 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 1250,
        "company_key": "hackinghrlab.io",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "hackinghrlab.io",
        "strongest_signal": null
      },
      {
        "name": "HRCI",
        "score": 45,
        "reasons": [
          "exact headcount 974 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 974,
        "company_key": "hrci.org",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "hrci.org",
        "strongest_signal": null
      },
      {
        "name": "HRM Counsel",
        "score": 45,
        "reasons": [
          "exact headcount 280 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 280,
        "company_key": "hrmcounsel.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "hrmcounsel.com",
        "strongest_signal": null
      },
      {
        "name": "Inceed",
        "score": 45,
        "reasons": [
          "exact headcount 184 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 184,
        "company_key": "inceed.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "inceed.com",
        "strongest_signal": null
      },
      {
        "name": "JCW Group",
        "score": 45,
        "reasons": [
          "exact headcount 413 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 413,
        "company_key": "jcwgroup.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "jcwgroup.com",
        "strongest_signal": null
      },
      {
        "name": "LevelUP HCS",
        "score": 45,
        "reasons": [
          "exact headcount 380 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 380,
        "company_key": "leveluphcs.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "leveluphcs.com",
        "strongest_signal": null
      },
      {
        "name": "Onward Search",
        "score": 45,
        "reasons": [
          "exact headcount 339 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 339,
        "company_key": "onwardsearch.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "onwardsearch.com",
        "strongest_signal": null
      },
      {
        "name": "OptimHire",
        "score": 45,
        "reasons": [
          "exact headcount 1654 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 1654,
        "company_key": "optimhire.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "optimhire.com",
        "strongest_signal": null
      },
      {
        "name": "Phaxis",
        "score": 45,
        "reasons": [
          "exact headcount 209 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 209,
        "company_key": "phaxis.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "phaxis.com",
        "strongest_signal": null
      },
      {
        "name": "React Jobs",
        "score": 45,
        "reasons": [
          "exact headcount 222 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 222,
        "company_key": "reactjobs.us",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "reactjobs.us",
        "strongest_signal": null
      },
      {
        "name": "Revista Empleo",
        "score": 45,
        "reasons": [
          "exact headcount 172 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 172,
        "company_key": "revistaempleo.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "revistaempleo.com",
        "strongest_signal": null
      },
      {
        "name": "Somewhere",
        "score": 45,
        "reasons": [
          "exact headcount 2215 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 2215,
        "company_key": "somewhere.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "somewhere.com",
        "strongest_signal": null
      },
      {
        "name": "Storm2",
        "score": 45,
        "reasons": [
          "exact headcount 163 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 163,
        "company_key": "storm2.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "storm2.com",
        "strongest_signal": null
      },
      {
        "name": "Synergy Interactive",
        "score": 45,
        "reasons": [
          "exact headcount 166 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 166,
        "company_key": "sinyc.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "sinyc.com",
        "strongest_signal": null
      },
      {
        "name": "Tenova LLC (HireMilitary)",
        "score": 45,
        "reasons": [
          "exact headcount 153 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 153,
        "company_key": "hiremilitary.us",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "hiremilitary.us",
        "strongest_signal": null
      },
      {
        "name": "The Mom Project",
        "score": 45,
        "reasons": [
          "exact headcount 1251 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 1251,
        "company_key": "themomproject.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "themomproject.com",
        "strongest_signal": null
      },
      {
        "name": "The Phoenix Group",
        "score": 45,
        "reasons": [
          "exact headcount 413 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 413,
        "company_key": "tpgnyc.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "tpgnyc.com",
        "strongest_signal": null
      },
      {
        "name": "VAGAS DE EMPREGOS",
        "score": 45,
        "reasons": [
          "exact headcount 7771 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 7771,
        "company_key": "tiktok.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "tiktok.com",
        "strongest_signal": null
      },
      {
        "name": "Weekday (YC W21)",
        "score": 45,
        "reasons": [
          "exact headcount 250 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 250,
        "company_key": "weekday.works",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "weekday.works",
        "strongest_signal": null
      },
      {
        "name": "Workling",
        "score": 45,
        "reasons": [
          "exact headcount 417 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 417,
        "company_key": "workling.com",
        "size_status": "above_max",
        "commercial_jobs": [],
        "canonical_domain": "workling.com",
        "strongest_signal": null
      }
    ],
    "total_rows": 50,
    "generic_scored": 50,
    "generic_version": "generic-prequalification-v1",
    "unique_companies": 50,
    "artifacts_excluded": 0,
    "eligible_companies": 21,
    "open_jobs_evaluated": 0,
    "employee_size_excluded": 29,
    "generic_with_description": 50,
    "technical_only_companies": 0,
    "companies_with_open_roles": 0,
    "generic_with_trusted_size": 50,
    "any_open_role_satisfies_signal": true,
    "companies_with_technical_roles": 0,
    "technical_roles_satisfy_signal": false,
    "companies_with_commercial_roles": 0
  },
  "provider_attempts": [
    {
      "rows": 50,
      "reason": null,
      "attempt": 1,
      "outcome": "ok",
      "provider": "apify_linkedin_company_search",
      "capability": "general_company_discovery",
      "cost_units": 1,
      "input_fingerprint": "c2d701f6"
    },
    {
      "rows": 2,
      "reason": null,
      "attempt": 1,
      "outcome": "ok",
      "provider": "apify_linkedin_company_details",
      "capability": "company_enrichment",
      "cost_units": 1,
      "input_fingerprint": "90c2398f"
    },
    {
      "rows": 0,
      "reason": null,
      "attempt": 1,
      "outcome": "empty",
      "provider": "apify_linkedin_job_search",
      "capability": "hiring_verification",
      "cost_units": 1,
      "input_fingerprint": "f5ce703d"
    }
  ],
  "contact_identities": [],
  "current_capability": null,
  "discovery_strategy": {
    "actors": [
      {
        "role": "primary",
        "input": {
          "maxItems": 50,
          "companySize": [
            "1-10",
            "11-50",
            "51-200"
          ],
          "industryIds": [
            "104",
            "137"
          ],
          "scraperMode": "full"
        },
        "actor_key": "apify_linkedin_company_search",
        "rationale": "Generate a broad candidate pool of companies classified under Recruiting and Staffing, with LinkedIn identity URLs and an initial small-company size filter. The size and industry fields are only discovery constraints and are not treated as proof.",
        "input_fields": [
          "companySize",
          "industryIds",
          "maxItems",
          "scraperMode"
        ],
        "dropped_filters": [
          {
            "field": "maxItems",
            "reason": "apify_linkedin_company_search has no such input; its schema accepts searchQuery, locations, industryIds, companySize, scraperMode"
          }
        ],
        "requires_enrichment": true
      }
    ],
    "source": "model_repaired",
    "blocked": 0,
    "version": "lead-discovery-strategy-v1",
    "repaired": 1,
    "violations": [
      {
        "code": "filter_dropped",
        "message": "maxItems: apify_linkedin_company_search has no such input; its schema accepts searchQuery, locations, industryIds, companySize, scraperMode",
        "severity": "repair",
        "actor_key": "apify_linkedin_company_search"
      }
    ],
    "model_chosen": true,
    "all_require_enrichment": true
  },
  "shortlist_decision": {
    "budget": {
      "cap": 100,
      "budget": 10,
      "source": "default",
      "version": "lead-investigation-budget-v1",
      "pool_size": 50,
      "requested_count": 5
    },
    "counts": {
      "ranked": 21,
      "relevant": 0,
      "selected": 21,
      "no_triage": 0,
      "uncertain": 21,
      "ineligible": 0,
      "irrelevant": 0,
      "hard_excluded": 29
    },
    "ranking": [
      "https://www.linkedin.com/company/pursuit-sales-solutions",
      "https://www.linkedin.com/company/careerxperts-consulting",
      "https://www.linkedin.com/company/storm4",
      "https://www.linkedin.com/company/hirefeedd",
      "https://www.linkedin.com/company/atlas-search",
      "https://www.linkedin.com/company/intelletec-ltd",
      "https://www.linkedin.com/company/odiin",
      "https://www.linkedin.com/company/arrow-search-partners",
      "https://www.linkedin.com/company/blue-signal-search",
      "https://www.linkedin.com/company/calculated-hire",
      "https://www.linkedin.com/company/careerup-inc.",
      "https://www.linkedin.com/company/coda-search",
      "https://www.linkedin.com/company/engtal",
      "https://www.linkedin.com/company/evona-space",
      "https://www.linkedin.com/company/indi-staffing-services",
      "https://www.linkedin.com/company/letsremotivate",
      "https://www.linkedin.com/company/ringside-talent",
      "https://www.linkedin.com/company/storm3",
      "https://www.linkedin.com/company/sotalentjobs",
      "https://www.linkedin.com/company/talentoma",
      "https://www.linkedin.com/company/swoopednetwork"
    ],
    "gpt_budget": {
      "cap": 500,
      "source": "pool_bound",
      "version": "lead-investigation-budget-v1",
      "pool_size": 50,
      "read_budget": 50,
      "evaluation_budget": 10
    },
    "time_capacity": {
      "capacity": 4,
      "usable_ms": 57600,
      "reserve_ms": 18000,
      "concurrency": 4,
      "remaining_ms": 75600,
      "per_company_ms": 14078,
      "identity_call_ms": 23513,
      "qualification_ms": 7000,
      "enrichment_call_ms": 12000,
      "enrichment_batch_size": 10
    },
    "untriaged_policy": "rank"
  },
  "binding_fingerprint": null,
  "investigation_slices": [
    {
      "pass": 1,
      "reason": "budget",
      "carried": 0,
      "excluded": 29,
      "selected": 10,
      "remaining": 11,
      "investigated": 0
    }
  ],
  "pending_capabilities": [
    "company_identity_resolution",
    "hiring_verification",
    "company_brain_qualification",
    "persistence",
    "company_enrichment"
  ],
  "unknown_company_keys": [],
  "investigation_ranking": [
    "https://www.linkedin.com/company/pursuit-sales-solutions",
    "https://www.linkedin.com/company/careerxperts-consulting",
    "https://www.linkedin.com/company/storm4",
    "https://www.linkedin.com/company/hirefeedd",
    "https://www.linkedin.com/company/atlas-search",
    "https://www.linkedin.com/company/intelletec-ltd",
    "https://www.linkedin.com/company/odiin",
    "https://www.linkedin.com/company/arrow-search-partners",
    "https://www.linkedin.com/company/blue-signal-search",
    "https://www.linkedin.com/company/calculated-hire",
    "https://www.linkedin.com/company/careerup-inc.",
    "https://www.linkedin.com/company/coda-search",
    "https://www.linkedin.com/company/engtal",
    "https://www.linkedin.com/company/evona-space",
    "https://www.linkedin.com/company/indi-staffing-services",
    "https://www.linkedin.com/company/letsremotivate",
    "https://www.linkedin.com/company/ringside-talent",
    "https://www.linkedin.com/company/storm3",
    "https://www.linkedin.com/company/sotalentjobs",
    "https://www.linkedin.com/company/talentoma",
    "https://www.linkedin.com/company/swoopednetwork"
  ],
  "accumulated_cost_units": 3,
  "completed_capabilities": [
    "general_company_discovery"
  ],
  "investigation_capacity": {
    "capacity": 3,
    "usable_ms": 45100,
    "reserve_ms": 18000,
    "concurrency": 4,
    "remaining_ms": 63100,
    "per_company_ms": 14078,
    "identity_call_ms": 23513,
    "qualification_ms": 7000,
    "enrichment_call_ms": 12000,
    "enrichment_batch_size": 10
  },
  "investigation_selected": 10,
  "qualified_company_keys": []
};

/** `tasks.result.lead_resume_checkpoint.companies` — 50 records, 10 shortlisted. */
// deno-lint-ignore no-explicit-any
export const RUN_43355471_COMPANIES: any[] = [
  {
    "company_key": "https://www.linkedin.com/company/cypress-hcm",
    "company_name": "Cypress HCM",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/cypress-hcm",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Cypress HCM",
        "linkedin_company_url": "https://www.linkedin.com/company/cypress-hcm",
        "website": "https://www.cypresshcm.com",
        "employee_count": 157,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Cypress HCM",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 157 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 157,
        "technical": 0,
        "company_key": "cypresshcm.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "cypresshcm.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a staffing and recruiting company, but no open roles are provided, so active sales hiring cannot be established."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/cypress-hcm",
        "matched_roles": [],
        "signal_strength": 10
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/storm2",
    "company_name": "Storm2",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/storm2",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Storm2",
        "linkedin_company_url": "https://www.linkedin.com/company/storm2",
        "website": "https://www.storm2.com",
        "employee_count": 163,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Storm2",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 163 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 163,
        "technical": 0,
        "company_key": "storm2.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "storm2.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a recruiting and staffing firm with a sales and marketing practice, but no open roles are provided to indicate active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/storm2",
        "matched_roles": [],
        "signal_strength": 12
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/sotalentjobs",
    "company_name": "SoTalent",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "SoTalent",
        "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs",
        "website": "https://sotalent.us",
        "employee_count": 24,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
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
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
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
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 18,
      "triage": {
        "reasons": [
          "Recruitment media and candidate acquisition agency fits the vertical, but there is no evidence of active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/sotalentjobs",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/talentoma",
    "company_name": "Talentoma",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/talentoma",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Talentoma",
        "linkedin_company_url": "https://www.linkedin.com/company/talentoma",
        "website": "https://talentoma.com",
        "employee_count": 10,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Talentoma",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 10 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 10,
        "technical": 0,
        "company_key": "talentoma.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "talentoma.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 19,
      "triage": {
        "reasons": [
          "Describes end-to-end staffing and recruitment services, but no open roles or sales-hiring signal is available."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/talentoma",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/synergy-interactive-solutions",
    "company_name": "Synergy Interactive",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/synergy-interactive-solutions",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Synergy Interactive",
        "linkedin_company_url": "https://www.linkedin.com/company/synergy-interactive-solutions",
        "website": "http://www.sinyc.com",
        "employee_count": 166,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Synergy Interactive",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 166 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 166,
        "technical": 0,
        "company_key": "sinyc.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "sinyc.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a staffing firm, and its services include client services and sales-related functions, but no current sales openings are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/synergy-interactive-solutions",
        "matched_roles": [],
        "signal_strength": 10
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/othonconstrutora",
    "company_name": "VAGAS DE EMPREGOS",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/othonconstrutora",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "VAGAS DE EMPREGOS",
        "linkedin_company_url": "https://www.linkedin.com/company/othonconstrutora",
        "website": "https://www.tiktok.com/@silrafelli",
        "employee_count": 7771,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "VAGAS DE EMPREGOS",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 7771 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 7771,
        "technical": 0,
        "company_key": "tiktok.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "tiktok.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Industry is labeled staffing and recruiting, but the mismatched company identity, TikTok domain, Portuguese description, and absent roles make both identity and sales hiring unclear."
        ],
        "relevance": "uncertain",
        "confidence": 0.68,
        "company_key": "https://www.linkedin.com/company/othonconstrutora",
        "matched_roles": [],
        "signal_strength": 4
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/odiin",
    "company_name": "Odiin.",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/odiin",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|43355471-f0ca-4e12-aec4-f3dcf586ef90|https://www.linkedin.com/company/odiin|hiring_verification|apify_linkedin_job_search|da2d6631"
    ],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Odiin.",
        "linkedin_company_url": "https://www.linkedin.com/company/odiin",
        "website": "http://www.odiin.tech",
        "employee_count": 31,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Odiin.",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 31 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 31,
        "technical": 0,
        "company_key": "odiin.tech",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "odiin.tech",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": true,
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "28447827"
        },
        "website": "http://www.odiin.tech",
        "geography": null,
        "description": "\ud835\udc0e\ud835\udc1d\ud835\udc22\ud835\udc22\ud835\udc27 - \ud835\udc13\ud835\udc21\ud835\udc1e \ud835\udc07\ud835\udc28\ud835\udc26\ud835\udc1e \ud835\udc28\ud835\udc1f \ud835\udc13\ud835\udc1e\ud835\udc1c\ud835\udc21 \ud835\udc13\ud835\udc1a\ud835\udc25\ud835\udc1e\ud835\udc27\ud835\udc2d\n\nWe are Odiin, the leading talent agency connecting innovative companies across Web3, AI and Trading with the people they need to build and scale.\n\n\ud835\udc16\ud835\udc21\ud835\udc32 \ud835\udc0e\ud835\udc1d\ud835\udc22\ud835\udc22\ud835\udc27?\n\n\ud835\udc04\ud835\udc31\ud835\udc29\ud835\udc1e\ud835\udc2b\ud835\udc2d\ud835\udc22\ud835\udc2c\ud835\udc1e: Our specialist teams recruit across Web3, AI and Trading - covering everything from Core Infrastructure, Protocols, Wallets and Exchanges, to AI Research, Machine Learning and Data, through to Quantitative Trading, Market Making, Trading Technology and leadership hires.\n\n\ud835\udc0d\ud835\udc28\ud835\udc2d \ud835\udc23\ud835\udc2e\ud835\udc2c\ud835\udc2d \u201c\ud835\udc11\ud835\udc1e\ud835\udc1c\ud835\udc2b\ud835\udc2e\ud835\udc22\ud835\udc2d\ud835\udc1e\ud835\udc2b\ud835\udc2c\u201d: We\u2019re passionate about the markets we recruit in. Whether you\u2019re building a protocol, training AI models, scaling a trading platform or growing your leadership team, we take the time to understand your business, your market and the people who drive it.\n\n\ud835\udc06\ud835\udc25\ud835\udc28\ud835\udc1b\ud835\udc1a\ud835\udc25 \ud835\udc11\ud835\udc1e\ud835\udc1a\ud835\udc1c\ud835\udc21: Odiin\u2019s global network connects companies with exceptional talent, creating opportunities across Web3, AI and Trading, wherever you\u2019re based.\n\n\ud835\udc11\ud835\udc1e\ud835\udc2c\ud835\udc1e\ud835\udc1a\ud835\udc2b\ud835\udc1c\ud835\udc21 & \ud835\udc08\ud835\udc27\ud835\udc2c\ud835\udc22\ud835\udc20\ud835\udc21\ud835\udc2d\ud835\udc2c: We regularly share hiring trends, market insights and industry research to help businesses and professionals stay ahead as Web3, AI and Trading continue to evolve. \n\nReady to build your new team or your next career move? Drop us a message!",
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
        "company_name": "Odiin.",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 31,
        "missing_fields": [
          "founded_year:frequently_null_from_actor",
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "odiin.tech",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:28447827",
        "linkedin_company_url": "https://www.linkedin.com/company/odiin",
        "employee_range_advisory": "11-50"
      },
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 6,
      "triage": {
        "reasons": [
          "Clearly a talent agency and recruiter, but the description does not establish that it is actively hiring sales roles and no open roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/odiin",
        "matched_roles": [],
        "signal_strength": 9
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/odiin",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/odiin"
      }
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/weekdayworks",
    "company_name": "Weekday (YC W21)",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/weekdayworks",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Weekday (YC W21)",
        "linkedin_company_url": "https://www.linkedin.com/company/weekdayworks",
        "website": "http://weekday.works/companies",
        "employee_count": 250,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Weekday (YC W21)",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 250 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 250,
        "technical": 0,
        "company_key": "weekday.works",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "weekday.works",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Recruiting technology company fits the broader recruiting vertical, but its description focuses on sourcing services and provides no evidence of active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.86,
        "company_key": "https://www.linkedin.com/company/weekdayworks",
        "matched_roles": [],
        "signal_strength": 7
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/intelletec-ltd",
    "company_name": "Intelletec",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/intelletec-ltd",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|43355471-f0ca-4e12-aec4-f3dcf586ef90|https://www.linkedin.com/company/intelletec-ltd|hiring_verification|apify_linkedin_job_search|55ad49b8"
    ],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Intelletec",
        "linkedin_company_url": "https://www.linkedin.com/company/intelletec-ltd",
        "website": "http://www.intelletec.com",
        "employee_count": 54,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Intelletec",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 54 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 54,
        "technical": 0,
        "company_key": "intelletec.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "intelletec.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": true,
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "3295320"
        },
        "website": "http://www.intelletec.com",
        "geography": null,
        "description": "Intelletec helps startups grow to their full potential, without having to worry about their hiring needs.  So what makes us different? \n\n1. Being right at the forefront of the industry and keeping abreast of new industries and technologies makes us stand out from the crowd.\n\n2.  Intelletec works with VC, Angels and other industry leaders and has formed close relationships that are based on trust. 80% of our business comes from referrals!\n\n3. All of our consultants were brought up in the new era of technology and social media, therefore we are all passionate in what we do\n\n4. We get a real buzz helping to shape engineering teams from scratch and knowing that we can make a big difference to the success of any company we help out.\n\n5. Being small has its pro's, most importantly being FLEXIBLE which is crucial (in the startup world). Large recruitment agencies tend to fall short of this. \n\n6. We now have an office in Los Angeles and a team in New York allowing us to cover more of the globe.  With two dedicated USA based teams we are still able to give all our clients a personal and bespoke service. \n\nTo find out more about the exciting journey Intelletec are going on visit our website www.intelletec.com",
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
        "company_name": "Intelletec",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 54,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "intelletec.com",
        "startup_evidence": {
          "year_founded": 2013
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:3295320",
        "linkedin_company_url": "https://www.linkedin.com/company/intelletec-ltd",
        "employee_range_advisory": "11-50"
      },
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 5,
      "triage": {
        "reasons": [
          "Clearly a recruitment firm, but no open roles or specific sales-hiring evidence is provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/intelletec-ltd",
        "matched_roles": [],
        "signal_strength": 9
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/intelletec-ltd",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/intelletec-ltd"
      }
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/crossinghurdles",
    "company_name": "Crossing Hurdles",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/crossinghurdles",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Crossing Hurdles",
        "linkedin_company_url": "https://www.linkedin.com/company/crossinghurdles",
        "website": "https://www.crossinghurdles.com",
        "employee_count": 302,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Crossing Hurdles",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 302 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 302,
        "technical": 0,
        "company_key": "crossinghurdles.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "crossinghurdles.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Provides talent discovery and explicitly mentions Growth, Marketing and Sales as supported functions, but does not show that it is actively hiring sales roles."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/crossinghurdles",
        "matched_roles": [],
        "signal_strength": 12
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/csg-talent",
    "company_name": "CSG Talent",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/csg-talent",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "CSG Talent",
        "linkedin_company_url": "https://www.linkedin.com/company/csg-talent",
        "website": "https://www.csgtalent.com",
        "employee_count": 260,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "CSG Talent",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 260 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 260,
        "technical": 0,
        "company_key": "csgtalent.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "csgtalent.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a global recruitment and talent-services company, but no current sales role or other active hiring evidence is available."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/csg-talent",
        "matched_roles": [],
        "signal_strength": 9
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/the-mom-project",
    "company_name": "The Mom Project",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/the-mom-project",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "The Mom Project",
        "linkedin_company_url": "https://www.linkedin.com/company/the-mom-project",
        "website": "http://themomproject.com",
        "employee_count": 1251,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "The Mom Project",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 1251 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 1251,
        "technical": 0,
        "company_key": "themomproject.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "themomproject.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Staffing and talent marketplace business fits the vertical, but no open roles or sales-hiring evidence is provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/the-mom-project",
        "matched_roles": [],
        "signal_strength": 7
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/hacking-hr",
    "company_name": "Hacking HR",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/hacking-hr",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Hacking HR",
        "linkedin_company_url": "https://www.linkedin.com/company/hacking-hr",
        "website": "https://www.hackinghrlab.io",
        "employee_count": 1250,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Hacking HR",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 1250 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 1250,
        "technical": 0,
        "company_key": "hackinghrlab.io",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "hackinghrlab.io",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "The description presents Hacking HR as a learning and professional community rather than a recruiting or staffing company, and no sales hiring signal is present."
        ],
        "relevance": "irrelevant",
        "confidence": 0.91,
        "company_key": "https://www.linkedin.com/company/hacking-hr",
        "matched_roles": [],
        "signal_strength": 3
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/clarity-llc",
    "company_name": "Clarity Recruiting",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/clarity-llc",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Clarity Recruiting",
        "linkedin_company_url": "https://www.linkedin.com/company/clarity-llc",
        "website": "http://www.clarityrecruiting.com",
        "employee_count": 185,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Clarity Recruiting",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 185 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 185,
        "technical": 0,
        "company_key": "clarityrecruiting.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "clarityrecruiting.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a recruiting and staffing agency, but no open roles or evidence of active sales hiring is provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/clarity-llc",
        "matched_roles": [],
        "signal_strength": 9
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/react-jobs",
    "company_name": "React Jobs",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/react-jobs",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "React Jobs",
        "linkedin_company_url": "https://www.linkedin.com/company/react-jobs",
        "website": "https://reactjobs.us",
        "employee_count": 222,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "React Jobs",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 222 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 222,
        "technical": 0,
        "company_key": "reactjobs.us",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "reactjobs.us",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Recruitment/job platform fits the broad vertical, but the description focuses on React talent and gives no evidence of the company hiring sales roles."
        ],
        "relevance": "uncertain",
        "confidence": 0.86,
        "company_key": "https://www.linkedin.com/company/react-jobs",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/somewhere",
    "company_name": "Somewhere",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/somewhere",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Somewhere",
        "linkedin_company_url": "https://www.linkedin.com/company/somewhere",
        "website": "https://somewhere.com",
        "employee_count": 2215,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Somewhere",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 2215 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 2215,
        "technical": 0,
        "company_key": "somewhere.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "somewhere.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly provides global talent acquisition and staffing services, but no open roles or active sales-hiring signal is listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/somewhere",
        "matched_roles": [],
        "signal_strength": 10
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/revistaempleo",
    "company_name": "Revista Empleo",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/revistaempleo",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Revista Empleo",
        "linkedin_company_url": "https://www.linkedin.com/company/revistaempleo",
        "website": "http://www.revistaempleo.com",
        "employee_count": 172,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Revista Empleo",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 172 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 172,
        "technical": 0,
        "company_key": "revistaempleo.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "revistaempleo.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "A job-offer publication and staffing-related service fits the broad vertical, but there is no evidence of active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/revistaempleo",
        "matched_roles": [],
        "signal_strength": 7
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/jcwgroup",
    "company_name": "JCW Group",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/jcwgroup",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "JCW Group",
        "linkedin_company_url": "https://www.linkedin.com/company/jcwgroup",
        "website": "http://www.jcwgroup.com",
        "employee_count": 413,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "JCW Group",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 413 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 413,
        "technical": 0,
        "company_key": "jcwgroup.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "jcwgroup.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a talent-services and recruitment company, but no open roles or specific active sales hiring signal is provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/jcwgroup",
        "matched_roles": [],
        "signal_strength": 10
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/workling-jobs",
    "company_name": "Workling",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/workling-jobs",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Workling",
        "linkedin_company_url": "https://www.linkedin.com/company/workling-jobs",
        "website": "http://www.workling.com",
        "employee_count": 417,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Workling",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 417 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 417,
        "technical": 0,
        "company_key": "workling.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "workling.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly operates as a recruiting and staffing intermediary, but the description does not indicate that Workling itself is actively hiring sales roles."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/workling-jobs",
        "matched_roles": [],
        "signal_strength": 10
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/confidentialcareers",
    "company_name": "Confidential Careers",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/confidentialcareers",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Confidential Careers",
        "linkedin_company_url": "https://www.linkedin.com/company/confidentialcareers",
        "website": "https://confidential.careers",
        "employee_count": 29939,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Confidential Careers",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 29939 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 29939,
        "technical": 0,
        "company_key": "confidential.careers",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "confidential.careers",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Recruitment marketplace and executive search positioning fits the vertical, but the unusually large self-reported headcount and lack of open roles make active sales hiring unclear."
        ],
        "relevance": "uncertain",
        "confidence": 0.84,
        "company_key": "https://www.linkedin.com/company/confidentialcareers",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/storm4",
    "company_name": "Storm4",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/storm4",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Storm4",
        "linkedin_company_url": "https://www.linkedin.com/company/storm4",
        "website": "http://www.storm4.com",
        "employee_count": 53,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
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
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
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
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 2,
      "triage": {
        "reasons": [
          "Clearly a specialist recruitment firm with Sales and Marketing listed among supported functions, but no open roles establish active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/storm4",
        "matched_roles": [],
        "signal_strength": 12
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/atlas-search",
    "company_name": "Atlas Search",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/atlas-search",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Atlas Search",
        "linkedin_company_url": "https://www.linkedin.com/company/atlas-search",
        "website": "http://atlassearchllc.com",
        "employee_count": 146,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
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
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
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
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 4,
      "triage": {
        "reasons": [
          "Clearly an executive recruiting and workforce solutions firm, but no current sales hiring evidence is provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/atlas-search",
        "matched_roles": [],
        "signal_strength": 9
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/careerxperts-consulting",
    "company_name": "CareerXperts Consulting",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/careerxperts-consulting",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "CareerXperts Consulting",
        "linkedin_company_url": "https://www.linkedin.com/company/careerxperts-consulting",
        "website": "https://careerxperts.com",
        "employee_count": 101,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "CareerXperts Consulting",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 101 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 101,
        "technical": 0,
        "company_key": "careerxperts.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "careerxperts.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 1,
      "triage": {
        "reasons": [
          "Clearly a hiring solutions and recruiting firm that explicitly supports GTM teams, but no open roles indicate that it is actively hiring sales."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/careerxperts-consulting",
        "matched_roles": [],
        "signal_strength": 13
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/optimhire",
    "company_name": "OptimHire",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/optimhire",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "OptimHire",
        "linkedin_company_url": "https://www.linkedin.com/company/optimhire",
        "website": "https://optimhire.com",
        "employee_count": 1654,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "OptimHire",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 1654 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 1654,
        "technical": 0,
        "company_key": "optimhire.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "optimhire.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "AI recruiting service fits the recruiting vertical, but its description provides no evidence of active internal sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.86,
        "company_key": "https://www.linkedin.com/company/optimhire",
        "matched_roles": [],
        "signal_strength": 9
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/empresa-confidencial",
    "company_name": "Empresa Confidencial",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/empresa-confidencial",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Empresa Confidencial",
        "linkedin_company_url": "https://www.linkedin.com/company/empresa-confidencial",
        "website": "https://empresaconfidencial.com",
        "employee_count": 14503,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Empresa Confidencial",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 14503 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 14503,
        "technical": 0,
        "company_key": "empresaconfidencial.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "empresaconfidencial.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Industry is labeled staffing and recruiting, but the description is too sparse to confirm the business or determine whether it is actively hiring sales roles."
        ],
        "relevance": "uncertain",
        "confidence": 0.7,
        "company_key": "https://www.linkedin.com/company/empresa-confidencial",
        "matched_roles": [],
        "signal_strength": 3
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/hiremilitary-us",
    "company_name": "Tenova LLC (HireMilitary)",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/hiremilitary-us",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Tenova LLC (HireMilitary)",
        "linkedin_company_url": "https://www.linkedin.com/company/hiremilitary-us",
        "website": "https://www.hiremilitary.us",
        "employee_count": 153,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Tenova LLC (HireMilitary)",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 153 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 153,
        "technical": 0,
        "company_key": "hiremilitary.us",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "hiremilitary.us",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly operates in recruiting and staffing, but no open roles are listed, so active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/hiremilitary-us",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/engtal",
    "company_name": "Engtal",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/engtal",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Engtal",
        "linkedin_company_url": "https://www.linkedin.com/company/engtal",
        "website": "https://engtal.com",
        "employee_count": 42,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Engtal",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 42 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 42,
        "technical": 0,
        "company_key": "engtal.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "engtal.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 12,
      "triage": {
        "reasons": [
          "Clearly a recruitment firm, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/engtal",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/career-group",
    "company_name": "Career Group",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/career-group",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Career Group",
        "linkedin_company_url": "https://www.linkedin.com/company/career-group",
        "website": "https://careergroupcompanies.com/career-group",
        "employee_count": 362,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Career Group",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 362 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 362,
        "technical": 0,
        "company_key": "careergroupcompanies.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "careergroupcompanies.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly operates in corporate recruitment, but no open roles are listed, so active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/career-group",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/careerup-inc.",
    "company_name": "CareerUp, Inc.",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/careerup-inc.",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "CareerUp, Inc.",
        "linkedin_company_url": "https://www.linkedin.com/company/careerup-inc.",
        "website": "https://careerup.com",
        "employee_count": 110,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "CareerUp, Inc.",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 110 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 110,
        "technical": 0,
        "company_key": "careerup.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "careerup.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 10,
      "triage": {
        "reasons": [
          "Identifies as a recruiter and career-services company, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/careerup-inc.",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/blue-signal-search",
    "company_name": "Blue Signal Search",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/blue-signal-search",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Blue Signal Search",
        "linkedin_company_url": "https://www.linkedin.com/company/blue-signal-search",
        "website": "http://www.bluesignal.com",
        "employee_count": 106,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Blue Signal Search",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 106 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 106,
        "technical": 0,
        "company_key": "bluesignal.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "bluesignal.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 8,
      "triage": {
        "reasons": [
          "Clearly a recruiting and staffing firm, but no open roles are listed, so active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/blue-signal-search",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
    "company_name": "Pursuit",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Pursuit",
        "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "website": "http://www.pursuitsalessolutions.com",
        "employee_count": 104,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
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
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
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
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 0,
      "triage": {
        "reasons": [
          "Staffing company focused on hiring sales and marketing representatives, but the data does not show that it is actively hiring its own sales roles."
        ],
        "relevance": "uncertain",
        "confidence": 0.94,
        "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "matched_roles": [],
        "signal_strength": 18
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/indi-staffing-services",
    "company_name": "INDI Staffing Services",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/indi-staffing-services",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "INDI Staffing Services",
        "linkedin_company_url": "https://www.linkedin.com/company/indi-staffing-services",
        "website": "indistaffingservices.com",
        "employee_count": 116,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "INDI Staffing Services",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 116 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 116,
        "technical": 0,
        "company_key": "indistaffingservices.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "indistaffingservices.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 14,
      "triage": {
        "reasons": [
          "Clearly operates in staffing and recruiting, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/indi-staffing-services",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/letsremotivate",
    "company_name": "Remotivate",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/letsremotivate",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Remotivate",
        "linkedin_company_url": "https://www.linkedin.com/company/letsremotivate",
        "website": "http://remotivatejobs.com",
        "employee_count": 19,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Remotivate",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 19 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 19,
        "technical": 0,
        "company_key": "remotivatejobs.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "remotivatejobs.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 15,
      "triage": {
        "reasons": [
          "Clearly operates as a recruiting company, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/letsremotivate",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/hrmcounselll",
    "company_name": "HRM Counsel",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/hrmcounselll",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "HRM Counsel",
        "linkedin_company_url": "https://www.linkedin.com/company/hrmcounselll",
        "website": "http://www.hrmcounsel.com",
        "employee_count": 280,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "HRM Counsel",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 280 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 280,
        "technical": 0,
        "company_key": "hrmcounsel.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "hrmcounsel.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Description suggests career guidance and HR-related services, but the recruiting or staffing model is not clearly established and no open roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/hrmcounselll",
        "matched_roles": [],
        "signal_strength": 5
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/calculated-hire",
    "company_name": "Calculated Hire",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/calculated-hire",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Calculated Hire",
        "linkedin_company_url": "https://www.linkedin.com/company/calculated-hire",
        "website": "http://www.calculatedhire.com",
        "employee_count": 145,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Calculated Hire",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 145 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 145,
        "technical": 0,
        "company_key": "calculatedhire.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "calculatedhire.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 9,
      "triage": {
        "reasons": [
          "Clearly operates in staffing and professional services, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/calculated-hire",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/leveluphcs",
    "company_name": "LevelUP HCS",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/leveluphcs",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "LevelUP HCS",
        "linkedin_company_url": "https://www.linkedin.com/company/leveluphcs",
        "website": "http://www.leveluphcs.com",
        "employee_count": 380,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "LevelUP HCS",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 380 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 380,
        "technical": 0,
        "company_key": "leveluphcs.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "leveluphcs.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly provides RPO, search, and workforce solutions, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/leveluphcs",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/arrow-search-partners",
    "company_name": "Arrow Search Partners",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/arrow-search-partners",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Arrow Search Partners",
        "linkedin_company_url": "https://www.linkedin.com/company/arrow-search-partners",
        "website": "http://www.arrowsearchpartners.com",
        "employee_count": 95,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Arrow Search Partners",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 95 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 95,
        "technical": 0,
        "company_key": "arrowsearchpartners.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "arrowsearchpartners.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 7,
      "triage": {
        "reasons": [
          "Clearly an executive recruiting and staffing firm, but no open roles are listed, so active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/arrow-search-partners",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/the-phoenix-group_3",
    "company_name": "The Phoenix Group",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/the-phoenix-group_3",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "The Phoenix Group",
        "linkedin_company_url": "https://www.linkedin.com/company/the-phoenix-group_3",
        "website": "https://www.tpgnyc.com",
        "employee_count": 413,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "The Phoenix Group",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 413 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 413,
        "technical": 0,
        "company_key": "tpgnyc.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "tpgnyc.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a staffing and workforce-solutions company that includes sales and marketing recruiting, but no open roles are listed and internal sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/the-phoenix-group_3",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/hrci",
    "company_name": "HRCI",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/hrci",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "HRCI",
        "linkedin_company_url": "https://www.linkedin.com/company/hrci",
        "website": "http://www.hrci.org",
        "employee_count": 974,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "HRCI",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 974 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 974,
        "technical": 0,
        "company_key": "hrci.org",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "hrci.org",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "HRCI is an HR professional certification and learning organization, not plainly a recruiting or staffing company; no relevant hiring signal is present."
        ],
        "relevance": "irrelevant",
        "confidence": 0.98,
        "company_key": "https://www.linkedin.com/company/hrci",
        "matched_roles": [],
        "signal_strength": 2
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/phaxis-consulting",
    "company_name": "Phaxis",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/phaxis-consulting",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Phaxis",
        "linkedin_company_url": "https://www.linkedin.com/company/phaxis-consulting",
        "website": "https://phaxis.com",
        "employee_count": 209,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Phaxis",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 209 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 209,
        "technical": 0,
        "company_key": "phaxis.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "phaxis.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a recruiting and consulting firm, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/phaxis-consulting",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/onward-search",
    "company_name": "Onward Search",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/onward-search",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Onward Search",
        "linkedin_company_url": "https://www.linkedin.com/company/onward-search",
        "website": "https://www.onwardsearch.com",
        "employee_count": 339,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Onward Search",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 339 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 339,
        "technical": 0,
        "company_key": "onwardsearch.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "onwardsearch.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly provides staffing and talent solutions, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/onward-search",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/ringside-talent",
    "company_name": "Ringside Talent",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/ringside-talent",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Ringside Talent",
        "linkedin_company_url": "https://www.linkedin.com/company/ringside-talent",
        "website": "ringsidetalent.com",
        "employee_count": 72,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Ringside Talent",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 72 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 72,
        "technical": 0,
        "company_key": "ringsidetalent.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "ringsidetalent.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 16,
      "triage": {
        "reasons": [
          "Clearly a recruitment and staffing company, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/ringside-talent",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/evona-space",
    "company_name": "EVONA",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/evona-space",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "EVONA",
        "linkedin_company_url": "https://www.linkedin.com/company/evona-space",
        "website": "http://www.evona.com",
        "employee_count": 122,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "EVONA",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 122 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 122,
        "technical": 0,
        "company_key": "evona.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "evona.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 13,
      "triage": {
        "reasons": [
          "Clearly a specialist staffing and talent partner, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/evona-space",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/storm3",
    "company_name": "Storm3",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/storm3",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Storm3",
        "linkedin_company_url": "https://www.linkedin.com/company/storm3",
        "website": "http://www.storm3.com",
        "employee_count": 83,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
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
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
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
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 17,
      "triage": {
        "reasons": [
          "Clearly a specialist recruiting and staffing firm, including GTM functions in its client coverage, but no open roles are listed and internal sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/storm3",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/emploi-recrutement",
    "company_name": "EMPLOI & RECRUTEMENT",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/emploi-recrutement",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "EMPLOI & RECRUTEMENT",
        "linkedin_company_url": "https://www.linkedin.com/company/emploi-recrutement",
        "website": "https://www.facebook.com/RECRUTEM",
        "employee_count": 2418,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "EMPLOI & RECRUTEMENT",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 2418 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 2418,
        "technical": 0,
        "company_key": "facebook.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "facebook.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Name and industry suggest recruiting, but the description is extremely thin, the domain is Facebook, and no open roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.86,
        "company_key": "https://www.linkedin.com/company/emploi-recrutement",
        "matched_roles": [],
        "signal_strength": 4
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/hirefeedd",
    "company_name": "Hire Feed",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/hirefeedd",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Hire Feed",
        "linkedin_company_url": "https://www.linkedin.com/company/hirefeedd",
        "website": "www.hirefeed.co.in",
        "employee_count": 87,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Hire Feed",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 87 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 87,
        "technical": 0,
        "company_key": "hirefeed.co.in",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "hirefeed.co.in",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 3,
      "triage": {
        "reasons": [
          "Appears to aggregate contract and gig job opportunities rather than operate as a conventional staffing employer; no active internal sales roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.93,
        "company_key": "https://www.linkedin.com/company/hirefeedd",
        "matched_roles": [],
        "signal_strength": 10
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/inceed",
    "company_name": "Inceed",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/inceed",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Inceed",
        "linkedin_company_url": "https://www.linkedin.com/company/inceed",
        "website": "http://www.inceed.com",
        "employee_count": 184,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Inceed",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 184 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 184,
        "technical": 0,
        "company_key": "inceed.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "inceed.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly a staffing and recruiting company, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/inceed",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/coda-search",
    "company_name": "Coda Search\u2502Staffing",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/coda-search",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Coda Search\u2502Staffing",
        "linkedin_company_url": "https://www.linkedin.com/company/coda-search",
        "website": "http://www.codarecruitment.com",
        "employee_count": 119,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Coda Search\u2502Staffing",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 119 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 119,
        "technical": 0,
        "company_key": "codarecruitment.com",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "codarecruitment.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 11,
      "triage": {
        "reasons": [
          "Clearly a staffing and search firm, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/coda-search",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/swoopednetwork",
    "company_name": "Swooped",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/swoopednetwork",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Swooped",
        "linkedin_company_url": "https://www.linkedin.com/company/swoopednetwork",
        "website": "https://swooped.co",
        "employee_count": 24,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Swooped",
        "batch": null,
        "score": 75,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 24 is inside the target range",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": true,
        "size_fit": true,
        "best_tier": null,
        "exclusion": null,
        "locations": null,
        "one_liner": null,
        "team_size": 24,
        "technical": 0,
        "company_key": "swooped.co",
        "size_status": "in_range",
        "has_open_roles": false,
        "canonical_domain": "swooped.co",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "pending_investigation",
      "investigation_rank": 20,
      "triage": {
        "reasons": [
          "Appears to be a job-discovery platform rather than clearly a recruiting or staffing company, and no open roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.93,
        "company_key": "https://www.linkedin.com/company/swoopednetwork",
        "matched_roles": [],
        "signal_strength": 6
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/the-atlantic-group",
    "company_name": "Atlantic Group",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/the-atlantic-group",
    "completed_operations": [],
    "updated_at": "2026-08-29T08:45:24.486Z",
    "snapshot": {
      "company": {
        "company_name": "Atlantic Group",
        "linkedin_company_url": "https://www.linkedin.com/company/the-atlantic-group",
        "website": "http://atlanticrecruiters.com",
        "employee_count": 294,
        "source_provenance": "harvestapi/linkedin-company-search"
      },
      "yc_open_jobs": [],
      "prequalified": {
        "jobs": [],
        "name": "Atlantic Group",
        "batch": null,
        "score": 45,
        "yc_id": null,
        "tier_a": 0,
        "tier_b": 0,
        "tier_c": 0,
        "yc_url": null,
        "reasons": [
          "exact headcount 294 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 294,
        "technical": 0,
        "company_key": "atlanticrecruiters.com",
        "size_status": "above_max",
        "has_open_roles": false,
        "canonical_domain": "atlanticrecruiters.com",
        "strongest_signal": null,
        "identity_confidence": "domain_exact",
        "linkedin_identity_status": "unresolved"
      },
      "prequal_key": null,
      "shortlisted": false,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "excluded_permanently",
      "investigation_rank": 9007199254740991,
      "triage": {
        "reasons": [
          "Clearly operates in executive search and staffing, but no open roles are listed and active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.97,
        "company_key": "https://www.linkedin.com/company/the-atlantic-group",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  }
];

/** The two together, in the shape `tasks.result` holds them. */
// deno-lint-ignore no-explicit-any
export const RUN_43355471_RESULT: Record<string, any> = {
  capability_execution_state: RUN_43355471_STATE,
  lead_resume_checkpoint: {
    version: "lead-resume-state-v1",
    continuation_required: true,
    last_completed_capability: "general_company_discovery",
    next_pending_capability: "company_identity_resolution",
    companies: RUN_43355471_COMPANIES,
  },
  original_user_query:
    "Find 5 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.",
  terminal_status: "continuation_required",
};

/**
 * The task's `tool_calls`, as `selectResumableRun` sees them.
 *
 * The discovery call SUCCEEDED and carries its run id, dataset id and 50 rows.
 * `RESUMABLE_DISCOVERY_PROVIDERS` holds only the two YC scrapers, so the legacy
 * path finds nothing here — which is the refusal the user hit.
 */
export const RUN_43355471_TOOL_CALLS = [
  {
    status: "succeeded",
    input_json: { selected_actor_key: "apify_linkedin_company_search",
      capability_key: "apify_linkedin_company_search" },
    output_json: { run_id: "aox0htYw4mhCwb05c", dataset_id: "zcUtxYhdVdsticQQU", total: 50 },
  },
  {
    status: "succeeded",
    input_json: { selected_actor_key: "apify_linkedin_company_details",
      capability_key: "apify_linkedin_company_details" },
    output_json: { run_id: "9zG5bEUIjjeCjGyla", dataset_id: "IEqeK9WUEKPKNLE3e", total: 2 },
  },
  {
    status: "succeeded",
    input_json: { selected_actor_key: "apify_linkedin_job_search",
      capability_key: "apify_linkedin_job_search" },
    output_json: { run_id: "4dPyW8Q7YfzI5gkVR", dataset_id: "9vc9eKfZKWg5RxCID", total: 0 },
  },
];
