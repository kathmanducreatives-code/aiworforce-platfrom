# Raw and normalized outputs are intentionally not committed

`raw_outputs/` and `normalized_outputs/` from the 2026-08-01 benchmark contain
real people's names, LinkedIn member ids, profile photo URLs and locations, plus
full third-party job descriptions.

Committing them would republish personal data into the repository for an
indefinite period, and nothing in this PR needs them: the shapes the adapters
are tested against live in
`supabase/functions/_shared/hiringActorFixtures.ts`, where person identities are
replaced with structurally identical placeholders and descriptions are truncated.

Everything required to re-derive them is committed — `schemas/`,
`sample_inputs/`, `actor_inventory.json` and `scripts/`. Re-running costs about
$0.43 at the BRONZE tier.
