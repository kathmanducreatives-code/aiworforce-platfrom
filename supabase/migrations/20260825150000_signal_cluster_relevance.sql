-- PHASE 7 — WHERE A GROUNDED "WHY THIS MATTERS" LIVES.
--
-- ── WHY A TABLE AND NOT A COLUMN ────────────────────────────────────────────
--
-- Relevance is a property of a CLUSTER, and a cluster is not a row: it is
-- computed from `signal_events` at read time, keyed by the subject the events
-- share. Hanging the verdict on an event would attach one situation's judgement
-- to one of its parts, and the moment a fourth event joined the cluster nobody
-- could say which event's copy was current.
--
-- ── IT IS A CACHE OF AN OPINION, NOT A FACT ─────────────────────────────────
--
-- Everything here came from a model reading evidence that lives elsewhere.
-- Deleting this table loses no intelligence: the events remain, the clusters
-- rebuild, and the feed falls back to the deterministic ranking — which is
-- exactly what happens when the model is unavailable.
--
-- `deterministic_priority` is stored beside the adjusted one so a reader can
-- see what the model changed without recomputing it, and so a verdict that
-- silently promoted would be visible in the data rather than only in code.

create table if not exists public.signal_cluster_relevance (
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  -- The cluster's own key: `subject:<type>:<key>` or `account:<id>`.
  cluster_key             text not null,
  relevance               text not null,
  why_now                 text,
  why_it_matters          text,
  -- Event ids the verdict cites. Every one was checked against the cluster
  -- before it was written; a claim citing nothing is never stored.
  evidence_event_ids      uuid[] not null default '{}',
  timely                  boolean not null default false,
  deterministic_priority  integer not null,
  adjusted_priority       integer not null,
  -- `model` when a verdict was believed, `deterministic` when it was refused
  -- or the provider was unavailable.
  source                  text not null,
  model                   text,
  judged_at               timestamptz not null default now(),
  primary key (workspace_id, cluster_key),
  constraint signal_cluster_relevance_band_valid
    check (relevance = any (array['high','medium','low','none'])),
  constraint signal_cluster_relevance_source_valid
    check (source = any (array['model','deterministic'])),
  -- ── THE BOUNDARY, ENFORCED BY THE DATABASE ───────────────────────────────
  --
  -- Relevance may demote and may hold. There is no verdict, and no bug, that
  -- can make a cluster outrank its own evidence — the row is simply refused.
  constraint signal_cluster_relevance_never_promotes
    check (adjusted_priority <= deterministic_priority),
  -- A believed verdict must cite something. This is the same rule the
  -- validator applies, restated where it cannot be bypassed by a caller.
  constraint signal_cluster_relevance_model_verdict_cites
    check (source <> 'model' or relevance = 'none' or array_length(evidence_event_ids, 1) >= 1)
);

alter table public.signal_cluster_relevance enable row level security;

create policy signal_cluster_relevance_select on public.signal_cluster_relevance
  for select using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = signal_cluster_relevance.workspace_id
        and m.user_id = auth.uid()
    )
  );
