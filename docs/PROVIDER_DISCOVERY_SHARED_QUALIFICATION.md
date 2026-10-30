# Provider discovery and shared qualification: the interface

Status: built and tested offline. Flags are off, and no provider has been called.

## The rule

Agentory has **one** qualification engine: `candidateEligibility.evaluateEligibility`. It reads
`evidenceAuthority`'s judgement of each fact. Apollo and LeadOcean feed that engine. They don't
replace it.

```
Apollo / LeadOcean rows ─► normalize.mergeRecords ─► CanonicalCompany (per-field provenance)
                                                        │
                verify.ts ── provider checks (diagnostic: `providerStatus`, `checks`)
                                                        │
        sharedQualification.evidenceFromCompany ─► EvidenceItem[]   source = "<provider>_discovery"
        + canonicalEvidence(company)            ─► EvidenceItem[]   from the Apify engine (read-only)
                                                        │
        buildCompanyEvidenceGraph ─► evaluateEligibility(compiled criteria, graph, holds)
                                                        │
                                       lead.status / lead.shared / rejectionBasis
```

- **Every provider row is weighed by `authorityForEvidence`.** No rule in `AUTHORITY_RULES` names
  `apollo_discovery` or `leadocean_discovery`, so these rows are at most `plausible`. That is the
  existing "discovery stays discovery" policy, and Apify's own search rows are treated the same way.
  To let a provider prove something, add a reviewed rule to `AUTHORITY_RULES`. No code here changes.
- **Qualified** means the shared engine returns `eligible`, and for a people mission at least one
  contact also matches a role. `verification` is then always `evidence`.
- **Rejected:**
  - when the shared engine disproves a hard criterion: `rejectionBasis: "proven"`;
  - when a provider reports a contradiction while the engine is still pending:
    `rejectionBasis: "provider_reported"`. The lead is discarded, not disproven.
- **Proof outranks a discovery row in both directions.** If the evidence proves a company eligible,
  a provider report that contradicts it is recorded and not acted on.
- **Spend is unchanged.** Paging stops on `providerStatus`. More search pages can't prove what only
  canonical evidence can.
- **No compiled criteria means nothing qualifies** (fail closed).

## The boundary with the Apify engine

`VerifyOptions.canonicalEvidence(company) → EvidenceItem[]` receives
`{ key, domains[], linkedinUrls[] }`. It returns evidence the Apify engine **already holds** for
that company:

- the company-record read (`apify_linkedin_company_details`);
- the canonical funding pair;
- dated job postings.

It's read-only, and the provider layer never buys Apify evidence through it.

Guards:

- Evidence is admitted only when it includes a **proven `identity` item** that names one of the
  company's own domains or LinkedIn URLs. Anything else is refused and counted in
  `shared.canonical_refused` (the audit G04 rule). The provider layer never re-keys another
  company's facts onto a lead.
- Freshness comes from the shared `EVIDENCE_VALIDITY_DAYS` table: a size band expires after 90 days,
  while headquarters doesn't expire.
- `VerifyOptions.holds(company) → QualificationHold[]` passes the platform's existing holds through
  unchanged.

What the Apify session owns, and this layer does not touch: `missionCriteria.ts`,
`candidateEligibility.ts`, `evidenceAuthority.ts`, the actor registry, the canary scripts and its
budgets. If any of those change, this layer picks the change up automatically, because it imports
them rather than copying them.

`canonicalEvidence` isn't wired in production yet (`provider-discovery/index.ts` passes nothing).
Until it is, every provider lead is `needs_verification`, which is accurate.

## Compatibility

`requirements.ts` maps `disallowed_broadening` onto the compiler's canonical dimensions. It accepts
both the older pass-through form and the newer additive form (`canonicalDisallowedBroadening`).
Entries it can't read are kept in `forbidBroadeningUnread`.

Tests: 81/81 on this branch and on a throwaway merge with `demo/lead-discovery-e2e`.

```sh
deno test --allow-read --allow-env --no-check tests/edge-functions/_shared/discoveryProviders/ tests/frontend/providerDiscovery.test.ts
```
