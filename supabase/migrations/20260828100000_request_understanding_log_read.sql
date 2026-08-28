-- THE TABLE BUILT TO ANSWER "WHAT DID CHAT BRAIN DECIDE?" COULD NOT BE READ.
--
-- ── WHAT DENY-BY-DEFAULT COST ───────────────────────────────────────────────
--
-- `request_understanding_log` was created with RLS enabled and no policy, on the
-- reasoning that only the service role writes it and nothing in the product
-- reads it — so a deny-by-default table cannot leak one workspace's phrasing to
-- another workspace's client. That reasoning is sound and the outcome was not.
--
-- Two production audits needed exactly one thing: the `RequestV1` Chat Brain
-- produced for a given message. Both got 403. The objective, the entity, the
-- reference kinds and the output shape had to be RECONSTRUCTED from the route
-- recorded on the message — real data, but a projection of the decision rather
-- than the decision. A table whose entire purpose is answering a question nobody
-- can ask it is a table that is not doing its job.
--
-- ── WHY A SELECT POLICY IS SAFE HERE ────────────────────────────────────────
--
-- The leak this guarded against was cross-workspace: one workspace reading
-- another's utterances. `workspace_members` already answers who may see a
-- workspace, and every other workspace-scoped table in this schema is gated the
-- same way. Scoping the read to membership closes the leak without closing the
-- table.
--
-- SELECT ONLY, and deliberately. Writes stay service-role: a client that could
-- insert here could fabricate a record of what the system understood, which is
-- worse than not being able to read one.
--
-- The redaction that made this data safe to hold is unchanged —
-- `redactUtterance` strips emails, phone-shaped digit runs and long numbers
-- before the write, and `utterance_hash` is the join key. A member reading their
-- own workspace's redacted phrasings sees what they typed.

alter table public.request_understanding_log enable row level security;

drop policy if exists request_understanding_log_select_members
  on public.request_understanding_log;

create policy request_understanding_log_select_members
  on public.request_understanding_log
  for select
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = request_understanding_log.workspace_id
        and wm.user_id = auth.uid()
    )
  );
