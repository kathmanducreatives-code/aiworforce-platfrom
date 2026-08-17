-- ============================================================================
-- signal_feed and lead_results — VIEWS, not tables
-- ============================================================================
--
-- The MCP server's `list_signals` and `list_leads` tools read two relations
-- that have never existed in any database this project has had. I left them
-- unbuilt rather than invent a schema, because a `select("*")` tells you
-- nothing about the columns a table should have.
--
-- Reading the callers properly settles it: they are not new data. They are
-- presentation names for data that already exists.
--
--   list_signals selects id, signal_type, title, summary, source_url, verified,
--   created_at — and `public.signals` already carries every one of those except
--   `summary` (it is `description`) and `verified` (it is computed).
--
--   list_leads selects `*` from lead_results, and `public.lead_candidates` is
--   the table the entire lead pipeline actually writes.
--
-- So creating tables would have been the wrong fix twice over: it would have
-- produced two permanently empty relations beside the populated ones, and the
-- MCP tools would have kept returning nothing while looking healthy.
--
-- ── `verified` IS COMPUTED IN TYPESCRIPT, AND IS MIRRORED HERE ──────────────
--
-- `classifySignalQuality` in src/lib/signalFeedModel.ts decides what the feed
-- shows by default. Its branches are involved, but the VERIFIED outcome reduces
-- to two persisted markers: `raw.signal_quality = 'verified'`, or a scorer's
-- `raw.verification_status = 'verified'`. Anything else — needs_verification,
-- legacy, or a row with no verdict at all — is not verified.
--
-- This duplicates a rule that lives in TypeScript, which is a real cost. It is
-- accepted because the alternative is worse: an MCP tool that cannot express
-- "verified" would either omit the field its caller selects, or return every
-- unverified signal as though it were confirmed. The narrow reading — only the
-- two explicit markers count — fails CLOSED, so a signal is never reported as
-- verified because SQL and TypeScript disagreed.
--
-- ── SECURITY INVOKER ───────────────────────────────────────────────────────
--
-- Both views run as the CALLER, so they inherit the underlying tables' RLS
-- rather than bypassing it. Without this a view owned by postgres would hand
-- every workspace's signals to any authenticated user — the exact inversion of
-- the membership fix that preceded this migration.

create or replace view public.signal_feed
with (security_invoker = true) as
select
  s.id,
  s.workspace_id,
  s.signal_type,
  s.title,
  -- The tool asks for `summary`; the column is `description`.
  s.description as summary,
  s.source_url,
  -- See the header: only an explicit persisted verdict counts as verified.
  (
    coalesce(s.raw ->> 'signal_quality', '') = 'verified'
    or coalesce(s.raw ->> 'verification_status', '') = 'verified'
  ) as verified,
  s.confidence,
  s.created_at
from public.signals s;

comment on view public.signal_feed is
  'Read model for the MCP list_signals tool. Wraps public.signals; `summary` is '
  'description and `verified` mirrors classifySignalQuality''s verified branch. '
  'security_invoker, so the caller''s RLS applies.';

create or replace view public.lead_results
with (security_invoker = true) as
select
  lc.id,
  lc.workspace_id,
  lc.conversation_id,
  lc.plan_id,
  lc.account_id,
  lc.contact_id,
  lc.signal_id,
  lc.lead_type,
  lc.status,
  lc.fit_score,
  lc.priority,
  lc.reason,
  lc.next_action,
  lc.created_at,
  lc.updated_at
from public.lead_candidates lc;

-- `raw` and `evidence_id` are deliberately NOT exposed. `list_leads` does
-- `select("*")`, and `raw` on a lead candidate carries the full provider
-- payload — up to megabytes of scraped detail per row. An MCP tool returning
-- ten of those would ship the entire evidence trail to a chat client that
-- displays a name and a status.
comment on view public.lead_results is
  'Read model for the MCP list_leads tool. Wraps public.lead_candidates without '
  'the raw provider payload. security_invoker, so the caller''s RLS applies.';

grant select on public.signal_feed to authenticated;
grant select on public.lead_results to authenticated;
