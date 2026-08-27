-- THE BASELINE THE CHAT BRAIN MIGRATION IS MEASURED AGAINST.
--
-- Three classifiers route every Pilot message today -- `workflowClassifier`,
-- `leadIntent`, `leadIntentModel` -- and none of them leaves a durable trace of
-- its verdict. The safety argument for replacing them is equivalence: the new
-- semantic path must decide what the old one decided, except where it decides
-- better. That claim is unprovable without a record of what the old one
-- actually decides on real traffic.
--
-- Phase 8 was lost to exactly this shape of problem -- fixes shipped against
-- behaviour nobody had measured. One insert per message is the cheapest
-- possible defence.
--
-- OBSERVATION ONLY. Nothing branches on a row here and every write is
-- best-effort; a logger that can fail a request is worse than no logger.
--
-- This table was created ahead of its migration while Phase 0 was being built.
-- The DDL below is written IF NOT EXISTS so that re-applying it against the
-- environment that already carries it is inert, and a fresh environment gets
-- the same shape rather than a table pilot-chat writes to and nobody declared.

create table if not exists public.request_understanding_log (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  workspace_id       uuid not null,
  conversation_id    uuid,
  message_id         uuid,

  -- Which decider produced this verdict: workflow_classifier | lead_intent |
  -- lead_intent_model | chat_brain_shadow. Deliberately NOT an enum -- the
  -- vocabulary grows once per migration phase and a text column costs nothing.
  source             text not null,

  -- THE UTTERANCE IS STORED TWICE, ON PURPOSE. The hash is the join key --
  -- stable, non-reversible, safe to group by. The redacted text is what a human
  -- reads at a checkpoint when deciding whether the objective set covers the
  -- product. Hash alone makes the corpus unreadable; text alone makes it unsafe
  -- to aggregate. Redaction of anything contact-shaped happens before the write.
  utterance_hash     text not null,
  utterance_redacted text not null,

  -- The old vocabulary (a pilot-chat category) and the new one (a
  -- RequestObjective) sit side by side so a single query can compare them.
  category           text,
  objective          text,
  confidence         numeric,

  -- Set once a mission compiled, so a decision joins to the run it caused.
  mission_hash       text,
  task_id            uuid,
  stage0_grades      jsonb,
  metadata           jsonb
);

create index if not exists idx_rul_workspace_created
  on public.request_understanding_log (workspace_id, created_at desc);

-- The corpus is read by utterance: "what did each decider say about this
-- phrasing", across sources.
create index if not exists idx_rul_hash
  on public.request_understanding_log (utterance_hash);

-- And by decider over time, which is how shadow agreement is measured.
create index if not exists idx_rul_source_created
  on public.request_understanding_log (source, created_at desc);

-- RLS ON WITH NO POLICY, WHICH IS THE POINT. Only the service role writes here
-- and nothing in the product reads it; a deny-by-default table cannot leak a
-- workspace's phrasing to another workspace's client. Grant a policy when a
-- surface actually needs to read it, not before.
alter table public.request_understanding_log enable row level security;
