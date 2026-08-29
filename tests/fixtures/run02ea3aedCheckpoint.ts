// THE CHECKPOINT THAT RESTORED FIFTY COMPANIES AND NONE OF THEIR EVIDENCE.
//
// Task 02ea3aed-1c3a-4756-a21b-4f68cc529691, 2026-08-29 09:41, re-run 09:48 on
// build 71d7fe5e. Continue worked: discovery was `skipped_resumed`, no Actor
// ran, nothing was charged, and all 50 companies came back with 21 shortlisted.
//
// And then:
//
//   company_identity_resolution  "0 resolved, 10 deferred; 10 of 21 targets"
//   hiring_verification          skipped_resumed
//   company_brain_qualification  "the eligible set was empty
//                                 (50 companies carried no hiring assessment)"
//
// while ELEVEN of these records carry a real `snapshot.identity` object with
// `status: "verified_match"`, and the parent had four companies verified from
// 148 paid job rows.
//
// ── WHAT THIS FIXTURE IS FOR ───────────────────────────────────────────────
//
// `restoreWorkingSet` rebuilt the companies and dropped their evidence:
// `snapshot.identity` had been WRITTEN since the fix whose comment explains
// exactly why it must be, and was never READ BACK. Every stage after identity
// selects on the object — `hiring_verification` filters
// `c.identity && identityIsActionable(c.identity)` — so a restore that returns
// companies with `identity: null` returns a pool no downstream stage can see.
//
// `hiring_assessment` was not even written. Same distinction, one stage later.
//
// ── WHAT IS PROJECTED ──────────────────────────────────────────────────────
//
// The state object is production's, byte for byte. Every record keeps the
// fields the resume path reads — the stage labels, `completed_operations`, the
// shortlist flag, triage, investigation state and rank, and the identity object
// itself. `snapshot.company` is narrowed to its six identity fields and
// `yc_open_jobs` emptied (it was empty on every row). Nothing invented.

/** `tasks.result.capability_execution_state`, as production wrote it. */
// deno-lint-ignore no-explicit-any
export const RUN_02EA3AED_STATE: any = {
  "triage": {
    "total": 50,
    "relevant": 1,
    "uncertain": 47,
    "irrelevant": 2,
    "batches_made": 2,
    "batches_available": 2
  },
  "version": "capability-execution-state-v1",
  "progress": {
    "stage": "qualified",
    "evaluated": 50,
    "in_progress": true,
    "shortlisted": 21,
    "accounts_found": 50,
    "hiring_verified": 0,
    "exclusion_reasons": {
      "employee_size": 29
    },
    "identity_resolved": 11,
    "companies_enriched": 11,
    "identity_unresolved": 0,
    "open_jobs_evaluated": 0,
    "qualified_companies": 0,
    "awaiting_external_run": true,
    "eligible_opportunities": 21,
    "decision_makers_verified": 0
  },
  "company_keys": [
    "https://www.linkedin.com/company/synergy-interactive-solutions",
    "https://www.linkedin.com/company/crossinghurdles",
    "https://www.linkedin.com/company/hirefeedd",
    "https://www.linkedin.com/company/storm4",
    "https://www.linkedin.com/company/weekdayworks",
    "https://www.linkedin.com/company/talentoma",
    "https://www.linkedin.com/company/othonconstrutora",
    "https://www.linkedin.com/company/confidentialcareers",
    "https://www.linkedin.com/company/csg-talent",
    "https://www.linkedin.com/company/cypress-hcm",
    "https://www.linkedin.com/company/storm2",
    "https://www.linkedin.com/company/empresa-confidencial",
    "https://www.linkedin.com/company/hacking-hr",
    "https://www.linkedin.com/company/pursuit-sales-solutions",
    "https://www.linkedin.com/company/hiremilitary-us",
    "https://www.linkedin.com/company/react-jobs",
    "https://www.linkedin.com/company/the-mom-project",
    "https://www.linkedin.com/company/somewhere",
    "https://www.linkedin.com/company/atlas-search",
    "https://www.linkedin.com/company/storm3",
    "https://www.linkedin.com/company/intelletec-ltd",
    "https://www.linkedin.com/company/optimhire",
    "https://www.linkedin.com/company/clarity-llc",
    "https://www.linkedin.com/company/sotalentjobs",
    "https://www.linkedin.com/company/revistaempleo",
    "https://www.linkedin.com/company/workling-jobs",
    "https://www.linkedin.com/company/onward-search",
    "https://www.linkedin.com/company/jcwgroup",
    "https://www.linkedin.com/company/odiin",
    "https://www.linkedin.com/company/swoopednetwork",
    "https://www.linkedin.com/company/coda-search",
    "https://www.linkedin.com/company/careerxperts-consulting",
    "https://www.linkedin.com/company/hrmcounselll",
    "https://www.linkedin.com/company/engtal",
    "https://www.linkedin.com/company/emploi-recrutement",
    "https://www.linkedin.com/company/blue-signal-search",
    "https://www.linkedin.com/company/calculated-hire",
    "https://www.linkedin.com/company/the-phoenix-group_3",
    "https://www.linkedin.com/company/inceed",
    "https://www.linkedin.com/company/the-atlantic-group",
    "https://www.linkedin.com/company/phaxis-consulting",
    "https://www.linkedin.com/company/hrci",
    "https://www.linkedin.com/company/letsremotivate",
    "https://www.linkedin.com/company/leveluphcs",
    "https://www.linkedin.com/company/careerup-inc.",
    "https://www.linkedin.com/company/career-group",
    "https://www.linkedin.com/company/ringside-talent",
    "https://www.linkedin.com/company/indi-staffing-services",
    "https://www.linkedin.com/company/arrow-search-partners",
    "https://www.linkedin.com/company/evona-space"
  ],
  "mission_hash": "d3d0dc967072423c36e037af80f51b8f14323049811726039fb88ec549b52d92",
  "pending_runs": [
    {
      "run_id": "1CPaI8ikFskPx4Fam",
      "provider": "apify_linkedin_job_search",
      "capability": null,
      "dataset_id": "8YGm7l5PTBSufjXRf",
      "started_at": "2026-08-29T09:05:08.016+00:00",
      "actor_build_id": null,
      "input_fingerprint": "e9986921",
      "recovered_from_ledger": true
    }
  ],
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
        "purpose": "Discover a broad candidate pool of companies labelled as Recruiting and Staffing/related industries, within the available small-company size bands. Do not use searchQuery because this mission is structured industry discovery and searchQuery is a name matcher.",
        "actor_key": "apify_linkedin_company_search",
        "capability": "general_company_discovery",
        "depends_on": []
      },
      {
        "step": 2,
        "input": {
          "companies": [
            "{{step_1.linkedinUrl}}"
          ]
        },
        "purpose": "Resolve and enrich the discovered LinkedIn company URLs, establishing canonical identity, exact employee count, authoritative industry hierarchy, company description, and other evidence needed for ICP qualification. Exact employee count is required because discovery companySize is known to be unreliable.",
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
            "{{step_2.linkedinUrl}}"
          ],
          "maxItems": 100,
          "jobTitles": [
            "sales",
            "account executive",
            "business development",
            "sales manager"
          ],
          "postedLimit": "month"
        },
        "purpose": "Verify current sales hiring inside the enriched candidate set. Search several sales-role terms over a recent one-month window, then retain only postings whose company identity matches the candidate and whose actual title/description is genuinely sales-related. The one-month bound operationalizes 'actively hiring' in the absence of a user-specified timeframe.",
        "actor_key": "apify_linkedin_job_search",
        "capability": "hiring_verification",
        "depends_on": [
          2
        ]
      },
      {
        "step": 4,
        "input": {},
        "purpose": "Qualify each enriched candidate against the explicit recruiting/staffing mission and the Company Brain: confirm the company is actually in the requested vertical, apply the exact employee bound and other ICP checks, reject mature or otherwise disqualified organizations, and require at least one verified current sales-role posting. Explicitly record the conflict between the user's request and the B",
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
        "purpose": "Persist the qualified company results and their supporting industry, employee-count, identity, and sales-job evidence to the Workbench.",
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
    "violations": []
  },
  "mission_output": {
    "people": [],
    "version": "mission-output-contract-v1",
    "companies": [
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/synergy-interactive-solutions",
        "company_name": "Synergy Interactive"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/crossinghurdles",
        "company_name": "Crossing Hurdles"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hirefeedd",
        "company_name": "Hire Feed"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/storm4",
        "company_name": "Storm4"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/weekdayworks",
        "company_name": "Weekday (YC W21)"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/talentoma",
        "company_name": "Talentoma"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/othonconstrutora",
        "company_name": "VAGAS DE EMPREGOS"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/confidentialcareers",
        "company_name": "Confidential Careers"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/csg-talent",
        "company_name": "CSG Talent"
      },
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
        "company_key": "https://www.linkedin.com/company/empresa-confidencial",
        "company_name": "Empresa Confidencial"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hacking-hr",
        "company_name": "Hacking HR"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "company_name": "Pursuit"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hiremilitary-us",
        "company_name": "Tenova LLC (HireMilitary)"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/react-jobs",
        "company_name": "React Jobs"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/the-mom-project",
        "company_name": "The Mom Project"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/somewhere",
        "company_name": "Somewhere"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/atlas-search",
        "company_name": "Atlas Search"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/storm3",
        "company_name": "Storm3"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/intelletec-ltd",
        "company_name": "Intelletec"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/optimhire",
        "company_name": "OptimHire"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/clarity-llc",
        "company_name": "Clarity Recruiting"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/sotalentjobs",
        "company_name": "SoTalent"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/revistaempleo",
        "company_name": "Revista Empleo"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/workling-jobs",
        "company_name": "Workling"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/onward-search",
        "company_name": "Onward Search"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/jcwgroup",
        "company_name": "JCW Group"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/odiin",
        "company_name": "Odiin."
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/swoopednetwork",
        "company_name": "Swooped"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/coda-search",
        "company_name": "Coda Search\u2502Staffing"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/careerxperts-consulting",
        "company_name": "CareerXperts Consulting"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hrmcounselll",
        "company_name": "HRM Counsel"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/engtal",
        "company_name": "Engtal"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/emploi-recrutement",
        "company_name": "EMPLOI & RECRUTEMENT"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/blue-signal-search",
        "company_name": "Blue Signal Search"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/calculated-hire",
        "company_name": "Calculated Hire"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/the-phoenix-group_3",
        "company_name": "The Phoenix Group"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/inceed",
        "company_name": "Inceed"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/the-atlantic-group",
        "company_name": "Atlantic Group"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/phaxis-consulting",
        "company_name": "Phaxis"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/hrci",
        "company_name": "HRCI"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/letsremotivate",
        "company_name": "Remotivate"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/leveluphcs",
        "company_name": "LevelUP HCS"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/careerup-inc.",
        "company_name": "CareerUp, Inc."
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/career-group",
        "company_name": "Career Group"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/ringside-talent",
        "company_name": "Ringside Talent"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/indi-staffing-services",
        "company_name": "INDI Staffing Services"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/arrow-search-partners",
        "company_name": "Arrow Search Partners"
      },
      {
        "qualified": false,
        "company_key": "https://www.linkedin.com/company/evona-space",
        "company_name": "EVONA"
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
          "exact headcount 14504 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "team_size": 14504,
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
      "rows": 3,
      "reason": null,
      "attempt": 1,
      "outcome": "ok",
      "provider": "apify_linkedin_company_details",
      "capability": "company_enrichment",
      "cost_units": 1,
      "input_fingerprint": "e0bb2772"
    },
    {
      "rows": 148,
      "reason": null,
      "attempt": 1,
      "outcome": "ok",
      "provider": "apify_linkedin_job_search",
      "capability": "hiring_verification",
      "cost_units": 1,
      "input_fingerprint": "bdd07ff6"
    },
    {
      "rows": 5,
      "reason": null,
      "attempt": 2,
      "outcome": "ok",
      "provider": "apify_linkedin_job_search",
      "capability": "hiring_verification",
      "cost_units": 1,
      "input_fingerprint": "f5f511e9"
    },
    {
      "rows": 10,
      "reason": null,
      "attempt": 2,
      "outcome": "ok",
      "provider": "apify_linkedin_company_details",
      "capability": "company_enrichment",
      "cost_units": 1,
      "input_fingerprint": "7c71b5e3"
    },
    {
      "rows": 1,
      "reason": null,
      "attempt": 3,
      "outcome": "ok",
      "provider": "apify_linkedin_company_details",
      "capability": "company_enrichment",
      "cost_units": 1,
      "input_fingerprint": "c57bb28f"
    },
    {
      "rows": 1,
      "reason": null,
      "attempt": 3,
      "outcome": "ok",
      "provider": "apify_linkedin_job_search",
      "capability": "hiring_verification",
      "cost_units": 1,
      "input_fingerprint": "174f5325"
    },
    {
      "rows": 22,
      "reason": null,
      "attempt": 4,
      "outcome": "ok",
      "provider": "apify_linkedin_job_search",
      "capability": "hiring_verification",
      "cost_units": 1,
      "input_fingerprint": "6aba8275"
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
        "rationale": "Discover a sufficiently broad candidate pool of companies classified under recruiting or staffing and within the ICP's approximate employee-size bands. Full mode also supplies candidate LinkedIn URLs and descriptions.",
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
      "relevant": 1,
      "selected": 21,
      "no_triage": 0,
      "uncertain": 20,
      "ineligible": 0,
      "irrelevant": 0,
      "hard_excluded": 29
    },
    "ranking": [
      "https://www.linkedin.com/company/pursuit-sales-solutions",
      "https://www.linkedin.com/company/blue-signal-search",
      "https://www.linkedin.com/company/careerxperts-consulting",
      "https://www.linkedin.com/company/engtal",
      "https://www.linkedin.com/company/letsremotivate",
      "https://www.linkedin.com/company/storm4",
      "https://www.linkedin.com/company/arrow-search-partners",
      "https://www.linkedin.com/company/calculated-hire",
      "https://www.linkedin.com/company/evona-space",
      "https://www.linkedin.com/company/indi-staffing-services",
      "https://www.linkedin.com/company/ringside-talent",
      "https://www.linkedin.com/company/atlas-search",
      "https://www.linkedin.com/company/coda-search",
      "https://www.linkedin.com/company/odiin",
      "https://www.linkedin.com/company/storm3",
      "https://www.linkedin.com/company/careerup-inc.",
      "https://www.linkedin.com/company/swoopednetwork",
      "https://www.linkedin.com/company/hirefeedd",
      "https://www.linkedin.com/company/intelletec-ltd",
      "https://www.linkedin.com/company/sotalentjobs",
      "https://www.linkedin.com/company/talentoma"
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
      "capacity": 9,
      "usable_ms": 105607,
      "reserve_ms": 18000,
      "concurrency": 4,
      "remaining_ms": 123607,
      "per_company_ms": 11200,
      "identity_call_ms": 12000,
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
    },
    {
      "pass": 1,
      "reason": "budget",
      "carried": 0,
      "excluded": 29,
      "selected": 10,
      "remaining": 1,
      "investigated": 0
    },
    {
      "pass": 1,
      "reason": "budget",
      "carried": 0,
      "excluded": 29,
      "selected": 10,
      "remaining": 1,
      "investigated": 0
    },
    {
      "pass": 1,
      "reason": "budget",
      "carried": 0,
      "excluded": 29,
      "selected": 1,
      "remaining": 0,
      "investigated": 20
    },
    {
      "pass": 1,
      "reason": "budget",
      "carried": 0,
      "excluded": 29,
      "selected": 1,
      "remaining": 0,
      "investigated": 20
    },
    {
      "pass": 1,
      "reason": "no_capacity",
      "carried": 0,
      "excluded": 29,
      "selected": 0,
      "remaining": 0,
      "investigated": 21
    },
    {
      "pass": 1,
      "reason": "no_capacity",
      "carried": 0,
      "excluded": 29,
      "selected": 0,
      "remaining": 0,
      "investigated": 21
    },
    {
      "pass": 1,
      "reason": "no_capacity",
      "carried": 0,
      "excluded": 29,
      "selected": 0,
      "remaining": 0,
      "investigated": 21
    },
    {
      "pass": 1,
      "reason": "no_capacity",
      "carried": 0,
      "excluded": 29,
      "selected": 0,
      "remaining": 0,
      "investigated": 21
    },
    {
      "pass": 1,
      "reason": "no_capacity",
      "carried": 0,
      "excluded": 29,
      "selected": 0,
      "remaining": 0,
      "investigated": 21
    },
    {
      "pass": 1,
      "reason": "no_capacity",
      "carried": 0,
      "excluded": 29,
      "selected": 0,
      "remaining": 0,
      "investigated": 21
    },
    {
      "pass": 1,
      "reason": "no_capacity",
      "carried": 0,
      "excluded": 29,
      "selected": 0,
      "remaining": 0,
      "investigated": 21
    }
  ],
  "pending_capabilities": [
    "company_identity_resolution",
    "company_brain_qualification",
    "persistence"
  ],
  "unknown_company_keys": [],
  "investigation_ranking": [
    "https://www.linkedin.com/company/pursuit-sales-solutions",
    "https://www.linkedin.com/company/blue-signal-search",
    "https://www.linkedin.com/company/careerxperts-consulting",
    "https://www.linkedin.com/company/engtal",
    "https://www.linkedin.com/company/letsremotivate",
    "https://www.linkedin.com/company/storm4",
    "https://www.linkedin.com/company/arrow-search-partners",
    "https://www.linkedin.com/company/calculated-hire",
    "https://www.linkedin.com/company/evona-space",
    "https://www.linkedin.com/company/indi-staffing-services",
    "https://www.linkedin.com/company/ringside-talent",
    "https://www.linkedin.com/company/atlas-search",
    "https://www.linkedin.com/company/coda-search",
    "https://www.linkedin.com/company/odiin",
    "https://www.linkedin.com/company/storm3",
    "https://www.linkedin.com/company/careerup-inc.",
    "https://www.linkedin.com/company/swoopednetwork",
    "https://www.linkedin.com/company/hirefeedd",
    "https://www.linkedin.com/company/intelletec-ltd",
    "https://www.linkedin.com/company/sotalentjobs",
    "https://www.linkedin.com/company/talentoma"
  ],
  "accumulated_cost_units": 8,
  "completed_capabilities": [
    "general_company_discovery",
    "company_enrichment",
    "hiring_verification"
  ],
  "investigation_capacity": {
    "capacity": 9,
    "usable_ms": 105605,
    "reserve_ms": 18000,
    "concurrency": 4,
    "remaining_ms": 123605,
    "per_company_ms": 11200,
    "identity_call_ms": 12000,
    "qualification_ms": 7000,
    "enrichment_call_ms": 12000,
    "enrichment_batch_size": 10
  },
  "investigation_selected": 32,
  "qualified_company_keys": []
};

/** 50 records: 21 shortlisted, 11 carrying a resolved identity object. */
// deno-lint-ignore no-explicit-any
export const RUN_02EA3AED_COMPANIES: any[] = [
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Clearly a staffing firm, but no open sales roles are shown; the mission specifically requires active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/synergy-interactive-solutions",
        "matched_roles": [],
        "signal_strength": 20
      },
      "identity": null
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Staffing and recruiting business that explicitly supports Growth, Marketing & Sales hiring, but no current open roles are shown."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/crossinghurdles",
        "matched_roles": [],
        "signal_strength": 25
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/hirefeedd",
    "company_name": "Hire Feed",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/hirefeedd",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/hirefeedd|hiring_verification|apify_linkedin_job_search|358504de"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "110266211"
        },
        "website": "www.hirefeed.co.in",
        "geography": null,
        "description": "HireFeed: A QuikHire product.\n\nEarn in dollars. On your hours. From wherever.\n\nHireFeed is the AI-curated feed of contract, gig, and AI training jobs that pay in USD, built for the people who actually want to work, not the ones writing job descriptions.\n\nWhy it exists: the highest-paying contract work in the world - RLHF, AI evaluation, domain-expert training, senior contract engineering, sits scattered across hundreds of ATS feeds and platform job boards. Most of it never makes it to Indeed or LinkedIn, and the roles that do are usually stale by the time you find them. The best opportunities are also the most ephemeral.\n\nHireFeed pulls from 500+ verified sources, including Outlier, Mercor, Surge AI, Micro1, Turing, Toloka, Appen, and Remotasks, and refreshes every 60 seconds. The moment a role closes at the source, it falls off the feed.\n\nWhat you'll find here:\n- AI training, RLHF, and evaluation: $20\u2013$80/hr\n- Domain experts: medical, legal, finance, math (PhD)\n- Senior contract engineering, paid weekly\n- Multilingual annotation, creative writing training, AI research\n\nWhat you won't find: pay-undisclosed listings, expired roles, \"still accepting applications\" lies, recruiter middlemen, or data resale. Pay is a hard requirement. Apply links 302-redirect to the source ATS. We never see your r\u00e9sum\u00e9.\n\nFree for candidates, forever. Funded by the partner side.\n\n\u2192 hirefeed.co.in",
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
        "company_name": "Hire Feed",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 87,
        "missing_fields": [
          "founded_year:frequently_null_from_actor",
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "hirefeed.co.in",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:110266211",
        "linkedin_company_url": "https://www.linkedin.com/company/hirefeedd",
        "employee_range_advisory": "51-200"
      },
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 17,
      "triage": {
        "reasons": [
          "Staffing-oriented job platform, but its description focuses on aggregating contract and AI-training jobs rather than hiring sales staff internally; no open roles are shown."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/hirefeedd",
        "matched_roles": [],
        "signal_strength": 15
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/hirefeedd",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/hirefeedd"
      }
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/storm4",
    "company_name": "Storm4",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/storm4",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/storm4|hiring_verification|apify_linkedin_job_search|de62e507"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 5,
      "triage": {
        "reasons": [
          "Clearly a staffing and executive search firm and lists Sales & Marketing as a function, but no active sales hiring is evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/storm4",
        "matched_roles": [],
        "signal_strength": 20
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/storm4",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/storm4"
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Recruiting company, but the description emphasizes outbound sourcing as its product and provides no evidence of active internal sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.85,
        "company_key": "https://www.linkedin.com/company/weekdayworks",
        "matched_roles": [],
        "signal_strength": 15
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/talentoma",
    "company_name": "Talentoma",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/talentoma",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 20,
      "triage": {
        "reasons": [
          "Staffing company with broad talent solutions, but no sales hiring signal or open roles are provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/talentoma",
        "matched_roles": [],
        "signal_strength": 15
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Industry is labeled staffing and recruiting, but the description is extremely thin and provides no evidence of active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.75,
        "company_key": "https://www.linkedin.com/company/othonconstrutora",
        "matched_roles": [],
        "signal_strength": 5
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Recruitment marketplace and executive search business, but no active internal sales roles are shown."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/confidentialcareers",
        "matched_roles": [],
        "signal_strength": 15
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Clearly a global staffing and executive search firm, but discovery data contains no evidence of current sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/csg-talent",
        "matched_roles": [],
        "signal_strength": 18
      },
      "identity": null
    }
  },
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Staffing company, but its description provides no sales-specific hiring indication and no open roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/cypress-hcm",
        "matched_roles": [],
        "signal_strength": 15
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Clearly a FinTech staffing and executive search firm and lists Sales & Marketing among functions, but no active sales roles are shown."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/storm2",
        "matched_roles": [],
        "signal_strength": 20
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
    "updated_at": "2026-08-29T09:48:10.927Z",
    "snapshot": {
      "company": {
        "company_name": "Empresa Confidencial",
        "linkedin_company_url": "https://www.linkedin.com/company/empresa-confidencial",
        "website": "https://empresaconfidencial.com",
        "employee_count": 14504,
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
          "exact headcount 14504 exceeds the maximum \u2014 excluded before identity resolution and enrichment, which is two paid calls this row already answered",
          "already carries a LinkedIn identity \u2014 no resolution to pay for",
          "carries a description \u2014 the field the ICP gate reasons from"
        ],
        "eligible": false,
        "size_fit": false,
        "best_tier": null,
        "exclusion": "employee_size",
        "locations": null,
        "one_liner": null,
        "team_size": 14504,
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
          "Industry suggests staffing, but the description is too vague to establish active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.72,
        "company_key": "https://www.linkedin.com/company/empresa-confidencial",
        "matched_roles": [],
        "signal_strength": 5
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "This is primarily an HR learning and community organization, not plainly a recruiting or staffing company, and no sales hiring signal is provided."
        ],
        "relevance": "irrelevant",
        "confidence": 0.93,
        "company_key": "https://www.linkedin.com/company/hacking-hr",
        "matched_roles": [],
        "signal_strength": 0
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
    "company_name": "Pursuit",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/pursuit-sales-solutions|hiring_verification|apify_linkedin_job_search|d6b9431c"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 0,
      "triage": {
        "reasons": [
          "Staffing and recruiting company explicitly focused on hiring marketing and sales representatives; strong direct alignment with sales hiring."
        ],
        "relevance": "relevant",
        "confidence": 0.95,
        "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "matched_roles": [
          "sales roles"
        ],
        "signal_strength": 70
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/pursuit-sales-solutions",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/pursuit-sales-solutions"
      }
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Employment and talent organization serving veterans and military spouses, but it is categorized as human resources services and provides no sales hiring evidence."
        ],
        "relevance": "uncertain",
        "confidence": 0.85,
        "company_key": "https://www.linkedin.com/company/hiremilitary-us",
        "matched_roles": [],
        "signal_strength": 10
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Recruiting/job platform, but its focus is React and software-development roles; no evidence of active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/react-jobs",
        "matched_roles": [],
        "signal_strength": 10
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Staffing and talent community organization, but no current sales hiring signal or open roles are shown."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/the-mom-project",
        "matched_roles": [],
        "signal_strength": 12
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Global hiring and staffing provider, but the description does not identify sales hiring or active internal sales roles."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/somewhere",
        "matched_roles": [],
        "signal_strength": 15
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/atlas-search",
    "company_name": "Atlas Search",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/atlas-search",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/atlas-search|hiring_verification|apify_linkedin_job_search|328e46b6"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 11,
      "triage": {
        "reasons": [
          "Clearly an executive recruiting and staffing firm, but no evidence of active sales-role hiring is provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/atlas-search",
        "matched_roles": [],
        "signal_strength": 18
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/atlas-search",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/atlas-search"
      }
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/storm3",
    "company_name": "Storm3",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/storm3",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/storm3|hiring_verification|apify_linkedin_job_search|b86ab926"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "70915780"
        },
        "website": "http://www.storm3.com",
        "geography": null,
        "description": "Storm3 is a specialist US HealthTech recruitment and executive search firm.\n\nThe strongest HealthTech leaders are rarely waiting for a job ad. We stay close to the people building the market, so your search starts with relationships and insight already in place.\n\nWhether you\u2019re building a founding team, scaling after investment or strengthening a public company, we connect you with the senior specialists and leaders who can move your business forward.\n\nHow we work:\n\nExecutive Search - critical leadership appointments, powered by our Future Leaders Network.\nPermanent Staffing - senior specialists to build your core team.\n\nOur executive searches bring together market mapping, ongoing leadership conversations and independent referencing. We look at what someone has built, how they lead and how their experience fits the business you\u2019re building.\n\nOur markets:\nConsumer & Digital Health | Hardware & Devices | Healthcare IT | Science & Research\n\nOur specialties include Mental Health, Metabolic Health, Digital Therapeutics, Family & Fertility, Telehealth, Wellness, Digital Health Insurance, AI Drug Discovery, BioTech, Clinical Trials Tech, Genomics, Medical Imaging and Real-World Evidence.\n\nOur functions:\nData & Analytics | Engineering | AI & Machine Learning | Product Management | Go-To-Market (GTM)\n\nBased in New York and London. Part of Levin.\n\nTell us who you need to hire at storm3.com.",
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
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 14,
      "triage": {
        "reasons": [
          "Clearly a HealthTech staffing and executive search firm, but no active sales roles are shown; GTM is mentioned as a client function, not internal hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/storm3",
        "matched_roles": [],
        "signal_strength": 18
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/storm3",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/storm3"
      }
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
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/intelletec-ltd|hiring_verification|apify_linkedin_job_search|55ad49b8"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "investigation_rank": 18,
      "triage": {
        "reasons": [
          "Staffing firm serving startups, but its description emphasizes technology recruiting and gives no sales hiring signal."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/intelletec-ltd",
        "matched_roles": [],
        "signal_strength": 15
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
    "company_key": "https://www.linkedin.com/company/optimhire",
    "company_name": "OptimHire",
    "identity": "not_started",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/optimhire",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Recruiting and AI-recruiter service, but no evidence of active internal sales hiring is shown."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/optimhire",
        "matched_roles": [],
        "signal_strength": 15
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Clearly a recruiting and staffing agency, but no current sales hiring or open sales roles are evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/clarity-llc",
        "matched_roles": [],
        "signal_strength": 18
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/sotalentjobs",
    "company_name": "SoTalent",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/sotalentjobs|hiring_verification|apify_linkedin_job_search|937c8156"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
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
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 19,
      "triage": {
        "reasons": [
          "Recruitment media and candidate acquisition agency, but no indication of active internal sales hiring is provided."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/sotalentjobs",
        "matched_roles": [],
        "signal_strength": 15
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/sotalentjobs",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/sotalentjobs"
      }
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Employment portal that publishes job advertisements, but the sparse data does not establish active internal sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.85,
        "company_key": "https://www.linkedin.com/company/revistaempleo",
        "matched_roles": [],
        "signal_strength": 8
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Clearly operates in staffing/recruiting, but no current open roles are provided, so active sales hiring cannot be established."
        ],
        "relevance": "uncertain",
        "confidence": 0.91,
        "company_key": "https://www.linkedin.com/company/workling-jobs",
        "matched_roles": [],
        "signal_strength": 18
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Staffing and recruiting company, but discovery data shows no open roles and therefore no evidence of active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/onward-search",
        "matched_roles": [],
        "signal_strength": 18
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Recruitment and talent-services business, but no open roles are listed to support the active sales-hiring requirement."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/jcwgroup",
        "matched_roles": [],
        "signal_strength": 18
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
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/odiin|hiring_verification|apify_linkedin_job_search|da2d6631"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "investigation_rank": 13,
      "triage": {
        "reasons": [
          "Specialist talent agency and staffing company, but there is no evidence in the supplied data of current sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/odiin",
        "matched_roles": [],
        "signal_strength": 18
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
    "company_key": "https://www.linkedin.com/company/swoopednetwork",
    "company_name": "Swooped",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/swoopednetwork",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/swoopednetwork|hiring_verification|apify_linkedin_job_search|23ab2449"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "90398003"
        },
        "website": "https://swooped.co",
        "geography": null,
        "description": "Top jobs at today's hottest companies. We're here to help you land your dream job five times faster.\n\nSign up for free today at swooped.co",
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
        "company_name": "Swooped",
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
          "founded_year:frequently_null_from_actor",
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "swooped.co",
        "startup_evidence": null,
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:90398003",
        "linkedin_company_url": "https://www.linkedin.com/company/swoopednetwork",
        "employee_range_advisory": "11-50"
      },
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 16,
      "triage": {
        "reasons": [
          "Appears to be a job platform or recruiting-related business, but no open roles are supplied and its staffing-company model is not fully clear."
        ],
        "relevance": "uncertain",
        "confidence": 0.92,
        "company_key": "https://www.linkedin.com/company/swoopednetwork",
        "matched_roles": [],
        "signal_strength": 15
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/swoopednetwork",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/swoopednetwork"
      }
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/coda-search",
    "company_name": "Coda Search\u2502Staffing",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/coda-search",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/coda-search|hiring_verification|apify_linkedin_job_search|74ded1f8"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "2254994"
        },
        "website": "http://www.codarecruitment.com",
        "geography": null,
        "description": "At Coda, we believe the best way to serve our clients is through an inclusive and personalized approach. We\u2019re not order-takers, we\u2019re consultants. Our clients and candidates receive \u201cwhite-glove\u201d treatment; in-depth interviews that explore, evaluate and evolve into solid solutions in order for them to find the perfect match for their career or staffing needs. \n\nWe have access to a large network of talented professionals and industry leaders that provide unlimited opportunities for our clients. \n\nSimply put, we match the most talented business professionals with nationally-recognized industry leaders, specialized boutique firms and international organizations. \n\nOur services are tailor-made and our primary focus is to bring talented people to talented organizations. We take the extra step. We build lasting relationships with our clients\u2013you\u2019re not a number in a database, you\u2019re the reason for our success.",
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
        "company_name": "Coda Search\u2502Staffing",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 119,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "codarecruitment.com",
        "startup_evidence": {
          "year_founded": 2011
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:2254994",
        "linkedin_company_url": "https://www.linkedin.com/company/coda-search",
        "employee_range_advisory": "51-200"
      },
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 12,
      "triage": {
        "reasons": [
          "Clearly provides staffing and recruiting services, but no open roles are listed to indicate active sales recruitment."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/coda-search",
        "matched_roles": [],
        "signal_strength": 18
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/coda-search",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/coda-search"
      }
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/careerxperts-consulting",
    "company_name": "CareerXperts Consulting",
    "identity": "resolved",
    "enrichment": "completed",
    "hiring": "not_verified",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/careerxperts-consulting",
    "completed_operations": [
      "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|9da530ae-e9e9-491d-a9a9-738eb3538ab6|https://www.linkedin.com/company/careerxperts-consulting|hiring_verification|apify_linkedin_job_search|5d669769"
    ],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "enriched": {
        "raw_ref": {
          "actor_key": "apify_linkedin_company_details",
          "source_id": "112642"
        },
        "website": "https://careerxperts.com",
        "geography": null,
        "description": "CareerXperts\u2122 is an AI-enabled Talent Intelligence, Research, and Hiring Solutions firm helping startups, scaling businesses, and enterprises bring greater clarity, intelligence, and precision to their talent decisions.\n\nSince 2006, we have partnered with founders, leadership teams, and scaling businesses to solve complex talent challenges. We help startups build the teams and talent foundations required for sustainable growth.\n\n\ud835\udde2\ud835\ude02\ud835\uddff \ud835\uddf2\ud835\ude05\ud835\uddfd\ud835\uddf2\ud835\uddff\ud835\ude01\ud835\uddf6\ud835\ude00\ud835\uddf2 \ud835\uddf6\ud835\uddfb\ud835\uddf0\ud835\uddf9\ud835\ude02\ud835\uddf1\ud835\uddf2s:\n\u2022 AI-Powered Talent Intelligence, Research & Workforce Insights \u2013 Talent mapping, ecosystem research, market/hiring intelligence, compensation trends, talent availability studies, and workforce forecasting.\n\u2022 RPO \u2013 Dedicated hiring teams supporting growth, expansion, and large-scale hiring initiatives.\n\u2022 Startup Hiring \u2013 Building founding, engineering, product, leadership, and GTM teams for high-growth startups.\n\u2022 C2H / EOR \u2013 Flexible workforce solutions that reduce hiring risk while enabling long-term talent acquisition.\n\u2022 Leadership Hiring & Executive Search \u2013 Senior executives, business leaders, and technology leadership talent.\n\u2022 Compensation & Hiring Intelligence \u2013 Salary benchmarking, compensation analytics, workforce insights, and data-driven intelligence that support smarter hiring and workforce planning decisions.\n\nSpecialized Hiring Across Industries \u2013 Aerospace, Agribusiness, AI, Automotive, Banking, Construction, Consumer Goods, Electronics, Embedded Engineering, Energy, Finance, Healthcare, Industrial Automation, Infrastructure, Logistics, Manufacturing, Metals, Mining, Oil & Gas, Pharma, Retail, Semiconductor, Software, Steel, Supply Chain, Telecom, Utilities, Water, and Wind.  \n\nWith over 10,000 successful placements and partnerships spanning 1,000+ organizations, we combine intelligence, research, and hiring execution to help businesses compete more effectively for talent.\n\nTalent for Nationhood is our belief that stronger teams build stronger nations.",
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
        "company_name": "CareerXperts Consulting",
        "company_type": "Privately Held",
        "industry_ids": [
          {
            "id": "104",
            "name": "Staffing and Recruiting",
            "hierarchy": "Administrative and Support Services > Staffing and Recruiting"
          }
        ],
        "hiring_status": null,
        "employee_count": 101,
        "missing_fields": [
          "employee_range_advisory:contradicts_exact_count_advisory_only"
        ],
        "canonical_domain": "careerxperts.com",
        "startup_evidence": {
          "year_founded": 2006
        },
        "provider_industry": "Staffing and Recruiting",
        "source_provenance": "harvestapi/linkedin-company",
        "external_source_id": "li_company:112642",
        "linkedin_company_url": "https://www.linkedin.com/company/careerxperts-consulting",
        "employee_range_advisory": "51-200"
      },
      "enrichment_outcome": "success",
      "investigation_state": "investigated",
      "investigation_rank": 2,
      "triage": {
        "reasons": [
          "Recruiting, RPO, and hiring-solutions firm with explicit GTM-related hiring expertise, but no evidence it is currently hiring sales roles itself."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/careerxperts-consulting",
        "matched_roles": [],
        "signal_strength": 20
      },
      "identity": {
        "status": "verified_match",
        "evidence": [
          "source_supplied_canonical_linkedin_url"
        ],
        "company_key": "https://www.linkedin.com/company/careerxperts-consulting",
        "ambiguous_candidates": [],
        "linkedin_company_url": "https://www.linkedin.com/company/careerxperts-consulting"
      }
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Description is HR and career-opportunity oriented, but the company\u2019s staffing fit and current sales hiring are unclear."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/hrmcounselll",
        "matched_roles": [],
        "signal_strength": 12
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/engtal",
    "company_name": "Engtal",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/engtal",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 3,
      "triage": {
        "reasons": [
          "Clearly a recruitment firm with a substantial staffing focus, but no open roles are provided and active sales hiring is unverified."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/engtal",
        "matched_roles": [],
        "signal_strength": 20
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Name suggests recruiting, but the Facebook domain and minimal description leave both company identity and current sales hiring unclear."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/emploi-recrutement",
        "matched_roles": [],
        "signal_strength": 10
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "investigation_rank": 1,
      "triage": {
        "reasons": [
          "Established recruiting, executive-search, and staffing firm, but no open roles are listed to confirm active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/blue-signal-search",
        "matched_roles": [],
        "signal_strength": 20
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "investigation_rank": 7,
      "triage": {
        "reasons": [
          "Staffing and professional-services company, but the supplied data contains no evidence of current sales-role hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/calculated-hire",
        "matched_roles": [],
        "signal_strength": 19
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Boutique staffing and workforce-solutions firm explicitly serving sales and marketing functions, but its own active sales hiring is not shown."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/the-phoenix-group_3",
        "matched_roles": [],
        "signal_strength": 20
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Clearly a recruiting and temporary-staffing company, but no current open roles are provided to verify sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/inceed",
        "matched_roles": [],
        "signal_strength": 20
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Executive search and staffing firm, but the discovery record has no open roles or sales-hiring signal."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/the-atlantic-group",
        "matched_roles": [],
        "signal_strength": 19
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Recruiting and consulting firm with broad staffing operations, but no evidence of active internal sales recruitment."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/phaxis-consulting",
        "matched_roles": [],
        "signal_strength": 19
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Primarily an HR certification and professional-development organization, not plainly a recruiting or staffing company; no sales-hiring signal is provided."
        ],
        "relevance": "irrelevant",
        "confidence": 0.94,
        "company_key": "https://www.linkedin.com/company/hrci",
        "matched_roles": [],
        "signal_strength": 8
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/letsremotivate",
    "company_name": "Remotivate",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/letsremotivate",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 4,
      "triage": {
        "reasons": [
          "Recruiting marketplace focused on remote hiring, but no open internal roles are supplied to establish active sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/letsremotivate",
        "matched_roles": [],
        "signal_strength": 20
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Talent-solutions and RPO provider, though categorized as human-resources services; no current sales roles are listed."
        ],
        "relevance": "uncertain",
        "confidence": 0.88,
        "company_key": "https://www.linkedin.com/company/leveluphcs",
        "matched_roles": [],
        "signal_strength": 17
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/careerup-inc.",
    "company_name": "CareerUp, Inc.",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/careerup-inc.",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 15,
      "triage": {
        "reasons": [
          "Combines specialized recruiters and career services, suggesting recruiting relevance, but active sales hiring is not evidenced."
        ],
        "relevance": "uncertain",
        "confidence": 0.89,
        "company_key": "https://www.linkedin.com/company/careerup-inc.",
        "matched_roles": [],
        "signal_strength": 17
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
          "Corporate and administrative recruitment firm, but no open roles are supplied to confirm current sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/career-group",
        "matched_roles": [],
        "signal_strength": 19
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/ringside-talent",
    "company_name": "Ringside Talent",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/ringside-talent",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 10,
      "triage": {
        "reasons": [
          "Clearly a recruitment and project-solutions company, but the provided data does not show active sales-role hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/ringside-talent",
        "matched_roles": [],
        "signal_strength": 19
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/indi-staffing-services",
    "company_name": "INDI Staffing Services",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/indi-staffing-services",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 9,
      "triage": {
        "reasons": [
          "Clearly a global staffing and recruiting provider, but no open roles are listed and sales hiring is unverified."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/indi-staffing-services",
        "matched_roles": [],
        "signal_strength": 19
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
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "investigation_rank": 6,
      "triage": {
        "reasons": [
          "Executive recruiting and temporary staffing firm, but no supplied evidence indicates it is actively hiring sales roles."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/arrow-search-partners",
        "matched_roles": [],
        "signal_strength": 19
      },
      "identity": null
    }
  },
  {
    "company_key": "https://www.linkedin.com/company/evona-space",
    "company_name": "EVONA",
    "identity": "deferred",
    "enrichment": "not_required",
    "hiring": "not_started",
    "brain": "not_started",
    "founder": "not_eligible",
    "linkedin_company_url": "https://www.linkedin.com/company/evona-space",
    "completed_operations": [],
    "updated_at": "2026-08-29T09:48:10.927Z",
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
      "shortlisted": true,
      "enriched": null,
      "enrichment_outcome": "not_attempted",
      "investigation_state": "investigated",
      "investigation_rank": 8,
      "triage": {
        "reasons": [
          "Specialist staffing and talent partner for the space industry, but no open roles are provided to verify current sales hiring."
        ],
        "relevance": "uncertain",
        "confidence": 0.9,
        "company_key": "https://www.linkedin.com/company/evona-space",
        "matched_roles": [],
        "signal_strength": 19
      },
      "identity": null
    }
  }
];

/** The two together, in the shape `tasks.result` holds them. */
// deno-lint-ignore no-explicit-any
export const RUN_02EA3AED_RESULT: Record<string, any> = {
  capability_execution_state: RUN_02EA3AED_STATE,
  lead_resume_checkpoint: {
    version: "lead-resume-state-v1",
    continuation_required: true,
    last_completed_capability: "hiring_verification",
    next_pending_capability: "company_identity_resolution",
    companies: RUN_02EA3AED_COMPANIES,
  },
  terminal_status: "continuation_required",
};
