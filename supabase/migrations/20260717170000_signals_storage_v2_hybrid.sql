-- =========================================================
-- Signals Storage v2 — Phase 1: ADDITIVE hybrid schema
-- =========================================================
--
-- Implements the architecture accepted in docs/architecture/signals-storage-audit.md.
--
-- WHY THIS EXISTS
-- The existing public.signals table is a flat "signal memory" ledger that mixes three
-- semantically different families under one loose `signal_type text`:
--   * identity/provenance evidence  (people_profile)
--   * time-bound opportunity events (hiring_signal, future funding/launch/expansion)
--   * engagement events             (linkedin_engagement, competitor_engagement)
-- It has no event time (occurred_at), no dedupe key, no verification, and no lifecycle,
-- so it cannot store or enforce the canonical SignalEvent contract
-- (supabase/functions/_shared/signalEvent.ts).
--
-- THIS MIGRATION IS ADDITIVE AND NON-DESTRUCTIVE.
--   * It creates four new tables and ONE nullable column on lead_candidates.
--   * It does NOT alter, drop or rename public.signals or public.signal_reviews.
--   * It does NOT touch lead_candidates.signal_id or the existing lead dedupe index.
--   * It performs NO backfill: no INSERT/UPDATE against existing data.
--   * No existing writer or reader is changed. Applying this migration must leave
--     runtime behaviour byte-for-byte identical until a later cutover phase.
--
-- occurred_at vs observed_at (the load-bearing distinction):
--   occurred_at = when the real-world event happened. THIS controls freshness.
--   observed_at = when we discovered it. Audit only; it must never refresh an old
--   event (a funding round announced 8 months ago and scraped today is stale).
--
-- Raw provider payloads are FORBIDDEN in every table below. Only sanitized,
-- normalized values are stored. There are deliberately no email/phone columns.
--
-- Helpers reused (already exist):
--   public.has_workspace_access(_user_id uuid, _workspace_id uuid)
--   public.update_updated_at_column()

-- ---------------------------------------------------------
-- lead_evidence — durable identity / company / provenance facts
-- ---------------------------------------------------------
-- Target home for today's `people_profile` rows. Identity evidence is DURABLE: it has
-- no expiry and freshness is irrelevant, which is precisely why it does not belong in
-- an opportunity-signal table.
CREATE TABLE public.lead_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  evidence_kind text NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  lead_candidate_id uuid REFERENCES public.lead_candidates(id) ON DELETE SET NULL,

  provider text,
  actor_key text,
  actor_id text,
  source_url text,
  source_record_id text,

  observed_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  verification_status text NOT NULL DEFAULT 'unverified',
  confidence text,

  normalized_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active',
  sanitized boolean NOT NULL DEFAULT true,

  legacy_signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lead_evidence_kind_valid CHECK (evidence_kind IN (
    'person_identity', 'company_identity', 'person_role', 'person_geography',
    'company_geography', 'company_fit', 'provider_provenance'
  )),
  -- Canonical SignalVerification (signalEvent.ts).
  CONSTRAINT lead_evidence_verification_valid CHECK (verification_status IN (
    'provider_verified', 'self_reported', 'unverified'
  )),
  -- Canonical EvidenceConfidence (evidenceContract.ts).
  CONSTRAINT lead_evidence_confidence_valid CHECK (confidence IS NULL OR confidence IN (
    'low', 'medium', 'high'
  )),
  CONSTRAINT lead_evidence_lifecycle_valid CHECK (lifecycle_status IN (
    'active', 'stale', 'expired', 'contradicted', 'superseded', 'dismissed', 'archived', 'retracted'
  )),
  -- Evidence must be grounded in at least one real entity.
  CONSTRAINT lead_evidence_entity_present CHECK (
    contact_id IS NOT NULL OR account_id IS NOT NULL OR lead_candidate_id IS NOT NULL
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_evidence TO authenticated;
GRANT ALL ON public.lead_evidence TO service_role;
ALTER TABLE public.lead_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_evidence members read"   ON public.lead_evidence FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "lead_evidence members insert" ON public.lead_evidence FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "lead_evidence members update" ON public.lead_evidence FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id)) WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "lead_evidence members delete" ON public.lead_evidence FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE UNIQUE INDEX lead_evidence_workspace_dedupe_uniq ON public.lead_evidence (workspace_id, dedupe_key);
CREATE UNIQUE INDEX lead_evidence_legacy_signal_uniq ON public.lead_evidence (legacy_signal_id) WHERE legacy_signal_id IS NOT NULL;
CREATE INDEX lead_evidence_workspace_kind_idx ON public.lead_evidence (workspace_id, evidence_kind);
CREATE INDEX lead_evidence_workspace_lifecycle_idx ON public.lead_evidence (workspace_id, lifecycle_status);
CREATE INDEX lead_evidence_contact_idx ON public.lead_evidence (contact_id);
CREATE INDEX lead_evidence_account_idx ON public.lead_evidence (account_id);
CREATE INDEX lead_evidence_lead_candidate_idx ON public.lead_evidence (lead_candidate_id);
CREATE TRIGGER lead_evidence_set_updated_at BEFORE UPDATE ON public.lead_evidence FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.lead_evidence IS
  'Durable identity / company / provenance evidence. Separate from signal_events because identity facts do not expire and freshness is irrelevant to them. Future home for today''s signals.people_profile rows. No raw provider payload; no email/phone columns.';
COMMENT ON COLUMN public.lead_evidence.observed_at IS
  'When this evidence was discovered. Identity evidence has no occurred_at because it is durable, not an event.';
COMMENT ON COLUMN public.lead_evidence.normalized_value IS
  'Sanitized normalized evidence ONLY. Raw provider payloads are forbidden.';
COMMENT ON COLUMN public.lead_evidence.legacy_signal_id IS
  'Maps a future backfill back to the originating public.signals row for idempotency and rollback. ON DELETE SET NULL — legacy signals are never cascade-deleted by this table.';

-- ---------------------------------------------------------
-- signal_events — canonical time-bound opportunity events
-- ---------------------------------------------------------
-- Answers "why now?". signal_type / evidence_category / verification / listing_status
-- reuse the CANONICAL unions from signalEvent.ts, evidenceContract.ts and
-- timingFreshnessPolicy.ts — this migration deliberately does not invent a competing
-- taxonomy. Engagement types are excluded here: they live in engagement_events.
CREATE TABLE public.signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  lead_candidate_id uuid REFERENCES public.lead_candidates(id) ON DELETE SET NULL,

  signal_type text NOT NULL,
  signal_category text NOT NULL,
  evidence_category text,

  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  freshness text,

  confidence text,
  verification_status text NOT NULL DEFAULT 'unverified',
  listing_status text,

  normalized_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active',
  sanitized boolean NOT NULL DEFAULT true,

  provider text,
  actor_key text,
  actor_id text,
  source_url text,

  legacy_signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Canonical SignalType MINUS the six engagement types (those belong to
  -- engagement_events). Growth + GTM + Product + FounderIntent + Risk = 24.
  CONSTRAINT signal_events_type_valid CHECK (signal_type IN (
    'recent_funding', 'employee_growth', 'market_expansion', 'geographic_expansion',
    'sales_hiring', 'revops_hiring', 'growth_hiring', 'new_revenue_leader',
    'outbound_initiative', 'positioning_change',
    'product_launch', 'major_release', 'new_integration', 'category_expansion',
    'founder_pipeline_post', 'founder_outbound_post', 'founder_customer_acquisition_post',
    'founder_hiring_post', 'founder_problem_statement',
    'person_left_company', 'company_outside_icp', 'role_changed', 'company_inactive',
    'signal_became_stale'
  )),
  -- Canonical SignalCategory. 'engagement' is intentionally absent here.
  CONSTRAINT signal_events_category_valid CHECK (signal_category IN (
    'growth', 'gtm', 'product', 'founder_intent', 'risk'
  )),
  -- The six canonical timing EvidenceCategory values. NULL for risk signals, which
  -- contradict timing rather than proving it (evidenceCategoryForSignalType → null).
  CONSTRAINT signal_events_evidence_category_valid CHECK (evidence_category IS NULL OR evidence_category IN (
    'job_signal', 'funding_signal', 'launch_signal', 'expansion_signal',
    'founder_activity_signal', 'gtm_signal'
  )),
  CONSTRAINT signal_events_verification_valid CHECK (verification_status IN (
    'provider_verified', 'self_reported', 'unverified'
  )),
  CONSTRAINT signal_events_confidence_valid CHECK (confidence IS NULL OR confidence IN (
    'low', 'medium', 'high'
  )),
  -- Canonical TimingFreshnessBand (timingFreshnessPolicy.ts).
  CONSTRAINT signal_events_freshness_valid CHECK (freshness IS NULL OR freshness IN (
    'strong', 'medium', 'weak_supporting', 'stale'
  )),
  -- Canonical ListingStatus. 'unknown' is the honest default for job postings:
  -- the ABSENCE of a closing date is not evidence a listing is still open.
  CONSTRAINT signal_events_listing_status_valid CHECK (listing_status IS NULL OR listing_status IN (
    'active', 'closed', 'expired', 'unknown'
  )),
  -- Superset of the in-memory SignalStatus (active|superseded|stale|retracted): every
  -- canonical value persists unchanged, plus the four lifecycle states the audit
  -- recommended (expired, contradicted, dismissed, archived).
  CONSTRAINT signal_events_lifecycle_valid CHECK (lifecycle_status IN (
    'active', 'stale', 'expired', 'contradicted', 'superseded', 'dismissed', 'archived', 'retracted'
  )),
  CONSTRAINT signal_events_entity_present CHECK (
    contact_id IS NOT NULL OR account_id IS NOT NULL OR lead_candidate_id IS NOT NULL
  ),
  -- Enables the composite FK from signal_event_evidence that pins a child observation
  -- to its parent's workspace (prevents cross-workspace parent linkage in the DB, not
  -- merely in application code).
  CONSTRAINT signal_events_id_workspace_uniq UNIQUE (id, workspace_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_events TO authenticated;
GRANT ALL ON public.signal_events TO service_role;
ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signal_events members read"   ON public.signal_events FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signal_events members insert" ON public.signal_events FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signal_events members update" ON public.signal_events FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id)) WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signal_events members delete" ON public.signal_events FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE UNIQUE INDEX signal_events_workspace_dedupe_uniq ON public.signal_events (workspace_id, dedupe_key);
CREATE UNIQUE INDEX signal_events_legacy_signal_uniq ON public.signal_events (legacy_signal_id) WHERE legacy_signal_id IS NOT NULL;
CREATE INDEX signal_events_workspace_occurred_idx ON public.signal_events (workspace_id, occurred_at DESC);
CREATE INDEX signal_events_workspace_type_occurred_idx ON public.signal_events (workspace_id, signal_type, occurred_at DESC);
CREATE INDEX signal_events_workspace_lifecycle_occurred_idx ON public.signal_events (workspace_id, lifecycle_status, occurred_at DESC);
CREATE INDEX signal_events_account_occurred_idx ON public.signal_events (account_id, occurred_at DESC);
CREATE INDEX signal_events_contact_occurred_idx ON public.signal_events (contact_id, occurred_at DESC);
CREATE INDEX signal_events_lead_candidate_occurred_idx ON public.signal_events (lead_candidate_id, occurred_at DESC);
CREATE INDEX signal_events_expires_at_idx ON public.signal_events (expires_at) WHERE expires_at IS NOT NULL;
CREATE TRIGGER signal_events_set_updated_at BEFORE UPDATE ON public.signal_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.signal_events IS
  'Canonical time-bound opportunity events ("why now?"). Engagement interactions are deliberately excluded — see engagement_events. No raw provider payload; no email/phone columns.';
COMMENT ON COLUMN public.signal_events.occurred_at IS
  'When the real-world event HAPPENED. This — never observed_at — controls freshness. A round announced months ago but scraped today is stale.';
COMMENT ON COLUMN public.signal_events.observed_at IS
  'When Agentory discovered the event. Audit/provenance only; it must never refresh an old event.';
COMMENT ON COLUMN public.signal_events.freshness IS
  'Last computed TimingFreshnessBand. A materialized convenience: occurred_at plus the freshness policy remains authoritative.';
COMMENT ON COLUMN public.signal_events.dedupe_key IS
  'Deterministic event identity so the same real-world event found by several providers collapses to one row (unique per workspace).';
COMMENT ON COLUMN public.signal_events.legacy_signal_id IS
  'Maps a future backfill back to the originating public.signals row. ON DELETE SET NULL — legacy signals are never cascade-deleted.';

-- ---------------------------------------------------------
-- signal_event_evidence — many observations per canonical event
-- ---------------------------------------------------------
-- One real-world event may be evidenced by several providers/sources. Each observation
-- is appended here; it never silently changes the parent's occurred_at.
CREATE TABLE public.signal_event_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  signal_event_id uuid NOT NULL,

  provider text,
  actor_key text,
  actor_id text,
  source_url text,
  source_record_id text,
  evidence_fingerprint text NOT NULL,

  observed_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'unverified',
  confidence text,

  normalized_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  sanitized boolean NOT NULL DEFAULT true,

  legacy_signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT signal_event_evidence_verification_valid CHECK (verification_status IN (
    'provider_verified', 'self_reported', 'unverified'
  )),
  CONSTRAINT signal_event_evidence_confidence_valid CHECK (confidence IS NULL OR confidence IN (
    'low', 'medium', 'high'
  )),
  -- An observation must be grounded by at least one source identifier.
  CONSTRAINT signal_event_evidence_source_present CHECK (
    source_url IS NOT NULL OR source_record_id IS NOT NULL
  ),
  -- COMPOSITE FK: pins the child to the parent's workspace at the DATABASE boundary,
  -- so a cross-workspace parent link is impossible even if application code errs.
  -- Cascades ONLY with its own parent event.
  CONSTRAINT signal_event_evidence_parent_fk
    FOREIGN KEY (signal_event_id, workspace_id)
    REFERENCES public.signal_events (id, workspace_id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_event_evidence TO authenticated;
GRANT ALL ON public.signal_event_evidence TO service_role;
ALTER TABLE public.signal_event_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signal_event_evidence members read"   ON public.signal_event_evidence FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signal_event_evidence members insert" ON public.signal_event_evidence FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signal_event_evidence members update" ON public.signal_event_evidence FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id)) WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "signal_event_evidence members delete" ON public.signal_event_evidence FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE UNIQUE INDEX signal_event_evidence_fingerprint_uniq ON public.signal_event_evidence (workspace_id, signal_event_id, evidence_fingerprint);
CREATE INDEX signal_event_evidence_event_idx ON public.signal_event_evidence (signal_event_id);
CREATE INDEX signal_event_evidence_workspace_provider_idx ON public.signal_event_evidence (workspace_id, provider);
CREATE INDEX signal_event_evidence_source_record_idx ON public.signal_event_evidence (source_record_id) WHERE source_record_id IS NOT NULL;
CREATE INDEX signal_event_evidence_legacy_signal_idx ON public.signal_event_evidence (legacy_signal_id) WHERE legacy_signal_id IS NOT NULL;
CREATE TRIGGER signal_event_evidence_set_updated_at BEFORE UPDATE ON public.signal_event_evidence FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.signal_event_evidence IS
  'Per-source observations supporting one canonical signal_event. Several providers may evidence the same event; a new observation never rewrites the parent occurred_at. No raw provider payload.';
COMMENT ON CONSTRAINT signal_event_evidence_parent_fk ON public.signal_event_evidence IS
  'Composite FK (signal_event_id, workspace_id) guarantees an observation cannot attach to a parent event in another workspace.';
COMMENT ON COLUMN public.signal_event_evidence.legacy_signal_id IS
  'A single legacy signals row may map to BOTH a signal_events row and one signal_event_evidence row (event + the observation that produced it). Uniqueness is therefore per-table, not global, and this column is intentionally non-unique here.';

-- ---------------------------------------------------------
-- engagement_events — user / content interactions
-- ---------------------------------------------------------
-- Kept separate from signal_events on purpose: an interaction is NOT proof of buying
-- timing. Promoting engagement into candidate timing evidence requires a separate,
-- reviewed policy (linked entity + authorization + freshness) that this phase does not
-- grant.
CREATE TABLE public.engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  lead_candidate_id uuid REFERENCES public.lead_candidates(id) ON DELETE SET NULL,

  channel text NOT NULL,
  event_type text NOT NULL,

  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),

  provider text,
  actor_key text,
  actor_id text,
  source_url text,
  source_record_id text,

  verification_status text NOT NULL DEFAULT 'unverified',
  confidence text,

  normalized_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active',
  sanitized boolean NOT NULL DEFAULT true,

  legacy_signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Narrow, documented initial vocabulary rather than a free-form field.
  CONSTRAINT engagement_events_channel_valid CHECK (channel IN (
    'linkedin', 'email', 'website', 'other'
  )),
  -- Canonical EngagementSignalType (signalEvent.ts) — the six engagement members
  -- deliberately excluded from signal_events.
  CONSTRAINT engagement_events_type_valid CHECK (event_type IN (
    'linkedin_connection_accepted', 'linkedin_post_like', 'linkedin_post_comment',
    'linkedin_post_reply', 'direct_reply', 'content_engagement'
  )),
  CONSTRAINT engagement_events_verification_valid CHECK (verification_status IN (
    'provider_verified', 'self_reported', 'unverified'
  )),
  CONSTRAINT engagement_events_confidence_valid CHECK (confidence IS NULL OR confidence IN (
    'low', 'medium', 'high'
  )),
  CONSTRAINT engagement_events_lifecycle_valid CHECK (lifecycle_status IN (
    'active', 'stale', 'expired', 'contradicted', 'superseded', 'dismissed', 'archived', 'retracted'
  )),
  CONSTRAINT engagement_events_entity_present CHECK (
    contact_id IS NOT NULL OR account_id IS NOT NULL OR lead_candidate_id IS NOT NULL
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_events TO authenticated;
GRANT ALL ON public.engagement_events TO service_role;
ALTER TABLE public.engagement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "engagement_events members read"   ON public.engagement_events FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "engagement_events members insert" ON public.engagement_events FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "engagement_events members update" ON public.engagement_events FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id)) WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "engagement_events members delete" ON public.engagement_events FOR DELETE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));

CREATE UNIQUE INDEX engagement_events_workspace_dedupe_uniq ON public.engagement_events (workspace_id, dedupe_key);
CREATE UNIQUE INDEX engagement_events_legacy_signal_uniq ON public.engagement_events (legacy_signal_id) WHERE legacy_signal_id IS NOT NULL;
CREATE INDEX engagement_events_workspace_occurred_idx ON public.engagement_events (workspace_id, occurred_at DESC);
CREATE INDEX engagement_events_contact_occurred_idx ON public.engagement_events (contact_id, occurred_at DESC);
CREATE INDEX engagement_events_account_occurred_idx ON public.engagement_events (account_id, occurred_at DESC);
CREATE INDEX engagement_events_channel_type_idx ON public.engagement_events (workspace_id, channel, event_type);
CREATE TRIGGER engagement_events_set_updated_at BEFORE UPDATE ON public.engagement_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.engagement_events IS
  'User/content interaction events. An engagement does NOT automatically satisfy an individual candidate timing requirement — promotion into timing evidence requires a separate reviewed policy (known entity, authorized, source-backed, fresh). No raw provider payload; no email/phone columns.';
COMMENT ON COLUMN public.engagement_events.occurred_at IS
  'When the interaction happened. Engagement decays fastest of all families; observed_at never refreshes it.';

-- ---------------------------------------------------------
-- lead_candidates.evidence_id — FUTURE identity anchor (inert in this phase)
-- ---------------------------------------------------------
-- Today a people-sourced lead is anchored by lead_candidates.signal_id → signals(id),
-- and signal_id participates in the existing lead dedupe unique index
-- (lc_dedupe_uniq). That column and that index are NOT touched here.
--
-- evidence_id is added nullable and UNPOPULATED so a later cutover phase can move the
-- identity anchor to lead_evidence without a lock-step schema change. The future
-- dedupe equivalent — replacing coalesce(signal_id,…) with coalesce(evidence_id,…) —
-- is documented in docs/architecture/signals-storage-schema-v2.md and deliberately NOT
-- created here: adding a second unique index over the same tuple space while both
-- columns exist could reject legitimate legacy rows during dual-write.
ALTER TABLE public.lead_candidates
  ADD COLUMN evidence_id uuid REFERENCES public.lead_evidence(id) ON DELETE SET NULL;

CREATE INDEX lead_candidates_evidence_idx ON public.lead_candidates (evidence_id) WHERE evidence_id IS NOT NULL;

COMMENT ON COLUMN public.lead_candidates.evidence_id IS
  'FUTURE identity/provenance anchor (lead_evidence). Nullable and intentionally unpopulated in Phase 1: signal_id remains the live anchor and keeps its place in the existing dedupe index until the writer-cutover phase.';
