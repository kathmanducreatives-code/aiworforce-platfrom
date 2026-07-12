# Scout Radar — provider setup (LinkedIn posts / comments / people)

Scout Radar's structured LinkedIn sources are **env-gated**. Until the actor env
vars below are set, those sources make **zero provider calls**, report
`not_configured` in Scan details, and the UI shows an honest setup empty state.
No actor IDs are hardcoded anywhere — they come only from these env vars.

Set the env var to an Apify actor id (e.g. `username~actor-name`) plus the existing
`APIFY_API_TOKEN`. The code path (`radarProviderAdapters.runApifyActor` →
`normalize*Row` → `linkedInSourceExecution.*ToSignalRows` → intelligence classifier
→ Company-Brain fit → persist) is already wired; it activates automatically once the
env var is present.

---

## 1. LinkedIn posts

- **Capability required:** search LinkedIn posts by topic (and/or by company/author
  URL), returning post text, author, author company, URL, published date and — when
  the actor supports it — reaction/comment/repost counts.
- **Env variable:** `RADAR_APIFY_LINKEDIN_POSTS_ACTOR`
- **Expected input (sent by the edge fn):**
  `{ searchTerms: string[]; maxItems: number }` (companyUrls/date-range optional if
  the actor supports them).
- **Expected normalized output** (`NormalizedPost`): `author, author_role,
  author_company, text, post_url, published_at, reactions, comments, reposts`.
  Engagement fields stay `null` when absent — a post is never labelled "viral"
  without real metrics.
- **Max item cap:** ≤ 25 items/scan (`maxItems: 25`, hard-capped at 50 in the adapter).
- **Cost control:** cap `maxItems`; prefer topic search over broad crawls; run at most
  once per scan.

## 2. LinkedIn comments

- **Capability required:** given parent post URLs, return public comments with the
  commenter's name, headline, company, profile URL, the comment text + URL, and the
  parent post text/URL/author.
- **Env variable:** `RADAR_APIFY_LINKEDIN_COMMENTS_ACTOR`
- **Expected input:** `{ postUrls: string[]; maxComments: number }`. The edge fn only
  passes **parent post URLs surfaced by the posts source** — comments never run
  standalone.
- **Expected normalized output** (`NormalizedComment`): `commenter, commenter_role,
  commenter_company, commenter_profile_url, comment_text, comment_url,
  parent_post_text, parent_post_url, parent_author, published_at`.
- **Max item cap:** ≤ 30 comments/post (`maxComments: 30`), ≤ 5 parent posts/scan.
- **Cost control:** only run for high-relevance parent posts; a generic "great post"
  comment is discarded by the intent classifier before any spend on enrichment.

## 3. Decision-makers (people)

- **Capability required:** given a company (name or URL) + target buyer roles, return
  matching people with name, headline/role, company, profile URL.
- **Env variable:** `RADAR_APIFY_LINKEDIN_PEOPLE_ACTOR`
- **Expected input:** `{ companyUrlOrName: string; roles: string[]; max: number }`.
- **Expected normalized output** (`NormalizedPerson`): `name, role, company,
  profile_url`.
- **Max item cap:** ≤ 10 people per company signal.
- **Cost control:** only look up people for **already-verified company signals**
  (hiring/funding/competitor). A person is never persisted as a standalone market
  signal — `peopleToDecisionMakerRows` attaches them to the parent signal, and an
  unattached person is flagged `is_person_only` and excluded from verified counts.

---

## Readiness semantics

`radarDiagnostics.resolveReadiness` reports the honest state — never "Ready" just
because a key exists:

`not_configured` (env var unset) · `configured_untested` · `healthy` ·
`degraded` · `returned_zero` / `query_no_match` (No matches) ·
`matches_rejected` (All results rejected) · `auth_failed` (Authentication failed) ·
`provider_error`.

## Safety guarantees (enforced in code + tests)

- Missing env var → **zero** provider calls (`postsAdapter.configured === false`).
- Engagement counts are never fabricated (null unless the actor returns them).
- Funding amount/round/date are never invented.
- A comment requires buying intent **and** parent-post evidence to persist.
- People attach to verified company signals; standalone people are not verified signals.
