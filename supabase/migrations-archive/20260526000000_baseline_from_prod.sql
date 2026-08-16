-- ============================================================================
-- BASELINE SNAPSHOT — INFORMATIONAL ONLY
-- ============================================================================
-- Pulled from live project zbwsbnqqpkvdhqwavjke on 2026-05-26 via MCP
-- introspection (information_schema). This file documents the schema that
-- exists in production today. It is NOT meant to be applied by `supabase
-- db push` — production is the source of truth, this is the snapshot.
--
-- What this captures:
--   * CREATE TABLE statements for every public table (83 tables)
--   * Column types, NOT NULL, DEFAULT clauses, PRIMARY KEY definitions
--
-- What this does NOT capture (yet — verify in Day 2+ if you need them):
--   * Foreign key constraints
--   * Indexes (other than primary keys)
--   * RLS policies
--   * Triggers and trigger functions
--   * Custom types (enums like screening_session_status, slot_status, etc.)
--     are referenced but not defined here. They exist in the live DB.
--   * Sequences (other than the gen_random_uuid() / uuid_generate_v4() defaults)
--
-- Why an informational baseline and not a real db pull:
--   * `supabase db pull` requires either Docker (not available) or a clean
--     migration-history match between local and remote, which we don't have
--     (~39 entries off, with timestamps drifting by 2 seconds between local
--     repo files and remote tracking).
--   * Repairing the migration history would write to remote metadata for
--     entries we don't fully understand. Cheaper to snapshot via SQL and
--     plan a proper db pull (with Docker) in Week 2.
--
-- Why this file matters:
--   * Until now, the repo had no record of organizations, departments,
--     organization_members, jobs, job_steps, job_transition_rules,
--     dialer_leads, dialer_status, secret_connections, tools — they
--     existed only on production. This file checks them into git so
--     future audits can diff against them.
--   * It also confirms the live shape of agents, tasks, task_plans, etc.
--     which does NOT match what the existing supabase/functions/run-agent/
--     and supabase/functions/orchestrate/ source code assumes.
-- ============================================================================

-- ============================================================================
-- Custom types (declared here as references; they already exist on remote).
-- Listed for completeness; do NOT recreate.
-- ============================================================================
-- activity_log_severity (used by activity_logs)
-- behavioral_risk_level (used by screening_behavioral_analysis)
-- candidate_source (used by collaboration_*, interviews)
-- interview_location_type, interview_status (used by interview_types, interviews)
-- job_status, job_step_status (used by jobs, job_steps)
-- lead_status, lead_tier, activity_status, sequence_status (used by outreach_*)
-- organization_member_role, organization_member_status
-- reminder_type
-- scenario_category
-- screening_session_status
-- secret_connection_status
-- slot_status

-- ============================================================================
-- Tables (alphabetical)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.activity_feed (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid,
  agent_id uuid,
  task_plan_id uuid,
  event_type text NOT NULL,
  title text,
  body text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  agent_id uuid,
  job_id uuid,
  job_step_id uuid,
  actor_type text NOT NULL DEFAULT 'system'::text,
  actor_user_id uuid,
  event_type text NOT NULL,
  severity activity_log_severity NOT NULL DEFAULT 'info'::activity_log_severity,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.adaptive_screening_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_id uuid,
  session_status screening_session_status NOT NULL DEFAULT 'invited'::screening_session_status,
  access_token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'::text),
  invited_at timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
  scenario_count integer DEFAULT 3,
  current_scenario_index integer DEFAULT 0,
  candidate_consent_given boolean DEFAULT false,
  consent_given_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  template_id uuid,
  role_briefing jsonb,
  scenario_config jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.agent_capabilities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid,
  capability text NOT NULL,
  input_type text NOT NULL,
  output_type text NOT NULL,
  priority integer DEFAULT 1,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.agents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid,
  name text NOT NULL,
  role_prompt text NOT NULL,
  model text NOT NULL DEFAULT 'claude-haiku-4-5'::text,
  department text NOT NULL,
  tools jsonb DEFAULT '[]'::jsonb,
  trigger_type text DEFAULT 'manual'::text,
  trigger_config jsonb DEFAULT '{}'::jsonb,
  avatar_color text DEFAULT '#7F77DD'::text,
  avatar_icon text DEFAULT 'user'::text,
  status text DEFAULT 'idle'::text,
  is_default boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid,
  task_id uuid,
  task_plan_id uuid,
  agent_id uuid,
  title text,
  summary text,
  payload jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending'::text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text,
  candidate_id text,
  action text NOT NULL,
  route text,
  request_data jsonb,
  response_data jsonb,
  ip_address text,
  user_agent text,
  status text,
  error_message text,
  execution_time_ms integer,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.candidate_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_id uuid,
  content text NOT NULL,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.candidate_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text,
  linkedin_url text NOT NULL,
  name text,
  photo_url text,
  headline text,
  current_title text,
  current_company text,
  location text,
  seniority_level text,
  years_experience integer,
  top_skills jsonb DEFAULT '[]'::jsonb,
  education jsonb DEFAULT '[]'::jsonb,
  work_history jsonb DEFAULT '[]'::jsonb,
  profile_completeness integer,
  similarity_score integer,
  match_quality text,
  match_reasons jsonb DEFAULT '{}'::jsonb,
  profile_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  tier_source integer,
  batch_number integer DEFAULT 1,
  scrape_run_id text,
  inserted_at timestamp with time zone DEFAULT now(),
  email text,
  email_confidence text,
  email_found_at timestamp with time zone,
  score_breakdown jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_active_positions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid,
  position_title text NOT NULL,
  position_level text,
  posted_date date NOT NULL,
  status text DEFAULT 'open'::text,
  required_skills text[],
  budget_range text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.client_placements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid,
  candidate_id uuid,
  position_title text NOT NULL,
  placement_date date NOT NULL,
  time_to_fill_days integer,
  cost_per_hire numeric,
  position_opened_date date,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  contact_email text,
  contact_name text,
  industry text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  logo_url text,
  primary_color text DEFAULT '#0EA5E9'::text,
  secondary_color text DEFAULT '#06B6D4'::text,
  accent_color text DEFAULT '#14B8A6'::text,
  company_display_name text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.closely_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  raw_payload jsonb NOT NULL,
  linkedin_url text,
  matched_lead_id uuid,
  processed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.codex_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  first_name text,
  last_name text,
  company text NOT NULL,
  title text,
  channel text NOT NULL DEFAULT 'linkedin_dm'::text,
  source_type text,
  source_url text NOT NULL,
  funding_stage text,
  funding_amount text,
  round_date timestamp with time zone,
  open_roles_count integer,
  job_title text,
  job_description text,
  salary_range text,
  applicant_count integer,
  company_description text,
  signal_used text,
  pain_angle text,
  role_type text,
  subject_line text,
  personalized_message text NOT NULL,
  word_count integer,
  lead_score integer,
  lead_tier text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_candidate_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  candidate_source candidate_source NOT NULL,
  candidate_id uuid NOT NULL,
  attached_by uuid,
  attached_at timestamp with time zone DEFAULT now(),
  fit_score integer,
  custom_notes text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_candidate_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL,
  user_id uuid,
  comment text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_candidate_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL,
  tag text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_contact_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_source candidate_source NOT NULL,
  candidate_id uuid NOT NULL,
  contacted_by uuid,
  contacted_at timestamp with time zone DEFAULT now(),
  contact_method text,
  notes text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  user_id uuid,
  content text NOT NULL,
  mentions uuid[] DEFAULT ARRAY[]::uuid[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_room_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone DEFAULT now(),
  last_seen_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_rooms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_archived boolean DEFAULT false,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.competitor_companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_name text NOT NULL,
  website_url text,
  careers_url text,
  crawl_status text DEFAULT 'pending'::text,
  last_crawled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.competitor_intel_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  competitor_id uuid,
  competitor_name text,
  signal_type text NOT NULL,
  signal_title text NOT NULL,
  signal_summary text,
  signal_data jsonb,
  signal_source_url text,
  signal_date timestamp with time zone,
  importance text,
  is_read boolean DEFAULT false,
  is_dismissed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.competitor_job_postings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  competitor_id uuid,
  user_id uuid NOT NULL,
  job_title text NOT NULL,
  department text,
  location text,
  job_url text,
  scraped_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.competitor_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  competitor_id uuid,
  tagline text,
  value_proposition text,
  target_market text,
  key_differentiators jsonb,
  pricing_model text,
  pricing_tiers jsonb,
  last_pricing_change_at timestamp with time zone,
  pricing_change_summary text,
  key_features jsonb,
  recent_launches jsonb,
  total_employees_estimate integer,
  engineering_headcount_estimate integer,
  recent_executive_changes jsonb,
  g2_rating numeric,
  g2_review_count integer,
  top_praise jsonb,
  top_complaints jsonb,
  last_full_scan_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.deep_search_analysis (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_name text,
  current_role_and_company text,
  experience_summary text,
  key_skills jsonb,
  certifications jsonb,
  education jsonb,
  languages jsonb,
  soft_skills_and_traits text,
  recruiter_insight text,
  overall_fit_rating integer,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.deep_search_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_id uuid,
  candidate_name text NOT NULL,
  linkedin_url text,
  company text,
  fit_score integer,
  ai_summary text,
  strengths text[],
  weaknesses text[],
  ideal_roles text[],
  company_match_notes text,
  ai_confidence_level integer,
  raw_analysis jsonb,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  education json,
  certifications json,
  profile_picture_url text,
  email text,
  languages jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active'::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.dialer_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id text NOT NULL,
  full_name text NOT NULL,
  company text,
  phone text,
  timezone text DEFAULT 'America/New_York'::text,
  notes text,
  status text NOT NULL DEFAULT 'pending'::text,
  call_result text,
  called_at timestamp with time zone,
  attempts integer NOT NULL DEFAULT 0,
  score integer DEFAULT 0,
  signals text[],
  session_tag text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  score_tier text,
  open_roles integer,
  funding_stage text,
  website text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.dialer_status (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default'::text,
  status text NOT NULL DEFAULT 'stopped'::text,
  current_call jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.email_tracking (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scheduled_email_id uuid,
  event_type text NOT NULL,
  link_url text,
  tracked_at timestamp with time zone NOT NULL DEFAULT now(),
  user_agent text,
  ip_address text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.error_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text,
  route text,
  node_name text,
  error_type text,
  error_message text,
  stack_trace text,
  request_payload jsonb,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamp with time zone NOT NULL,
  calendar_id text DEFAULT 'primary'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.growth_signal_companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  industry text,
  funding_round text,
  funding_amount numeric,
  funding_date date,
  investors jsonb DEFAULT '[]'::jsonb,
  open_roles_count integer NOT NULL DEFAULT 0,
  engineering_roles_count integer NOT NULL DEFAULT 0,
  sample_job_titles jsonb DEFAULT '[]'::jsonb,
  growth_score integer NOT NULL DEFAULT 0,
  is_hot_lead boolean NOT NULL DEFAULT false,
  source_url text,
  last_updated timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.handoffs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid,
  from_agent_id uuid,
  to_agent_id uuid,
  task_id uuid,
  task_plan_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.icp_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  draft_name text,
  current_step integer DEFAULT 1,
  form_data jsonb DEFAULT '{}'::jsonb,
  is_completed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.icp_lookalike_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text,
  profile_url text,
  profile_data jsonb,
  match_score integer,
  match_reasons jsonb,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.icp_lookalike_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id text,
  target_industry text,
  target_industry_name text,
  company_size jsonb,
  company_location jsonb,
  hiring_intensity text,
  lookalike_url text,
  lookalike_profile_data jsonb,
  feature_weights jsonb,
  ai_strategy text,
  scrape_status text DEFAULT 'pending'::text,
  apify_run_id text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  profile_name text,
  persona_description text,
  industry_names jsonb DEFAULT '[]'::jsonb,
  firmographic_constraints jsonb DEFAULT '{}'::jsonb,
  search_logic_dna text,
  technical_execution jsonb DEFAULT '{}'::jsonb,
  current_step integer DEFAULT 1,
  is_draft boolean DEFAULT true,
  role_family text,
  mandatory_signals jsonb,
  excluded_signals jsonb,
  search_results_count integer,
  strong_matches_count integer,
  target_results_count integer DEFAULT 50,
  current_phase text,
  status text,
  results_count integer,
  lookalike_results text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.icp_saved_searches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  draft_id uuid,
  search_name text,
  backend_session_id text,
  status text DEFAULT 'running'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.icp_search_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  search_id uuid,
  profile_url text,
  profile_data jsonb,
  similarity_score integer,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.interview_availability (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC'::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.interview_reminders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL,
  reminder_type reminder_type NOT NULL,
  sent_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'sent'::text,
  error_message text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.interview_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  interview_type_id uuid NOT NULL,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone NOT NULL,
  status slot_status NOT NULL DEFAULT 'available'::slot_status,
  booking_token text DEFAULT encode(gen_random_bytes(16), 'hex'::text),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.interview_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  description text,
  location_type interview_location_type NOT NULL DEFAULT 'video'::interview_location_type,
  meeting_link_template text,
  buffer_minutes integer DEFAULT 15,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.interviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slot_id uuid,
  candidate_id uuid,
  candidate_source candidate_source,
  candidate_name text NOT NULL,
  candidate_email text NOT NULL,
  interview_type_id uuid,
  recruiter_id uuid,
  scheduled_at timestamp with time zone NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status interview_status NOT NULL DEFAULT 'scheduled'::interview_status,
  meeting_link text,
  location text,
  notes text,
  feedback text,
  reminder_24h_sent boolean DEFAULT false,
  reminder_1h_sent boolean DEFAULT false,
  reminder_15min_sent boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.job_distribution_status (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  external_job_id text,
  posted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  feed_url text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.job_postings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  company_name text NOT NULL,
  location text NOT NULL,
  job_type text NOT NULL DEFAULT 'full-time'::text,
  salary_min integer,
  salary_max integer,
  salary_currency text DEFAULT 'USD'::text,
  description text NOT NULL,
  requirements text[] DEFAULT '{}'::text[],
  benefits text[] DEFAULT '{}'::text[],
  remote_option text DEFAULT 'no'::text,
  experience_level text,
  posted_boards jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'draft'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.job_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  job_id uuid NOT NULL,
  step_key text NOT NULL,
  step_order integer NOT NULL DEFAULT 0,
  tool_id uuid,
  capability_type text NOT NULL,
  action text NOT NULL,
  status job_step_status NOT NULL DEFAULT 'queued'::job_step_status,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.job_transition_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  from_agent_id uuid,
  from_job_type text NOT NULL,
  from_status job_status NOT NULL DEFAULT 'completed'::job_status,
  to_department_id uuid NOT NULL,
  to_agent_id uuid NOT NULL,
  to_workflow_type text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  workflow_type text NOT NULL,
  workflow_version text,
  status job_status NOT NULL DEFAULT 'queued'::job_status,
  priority integer NOT NULL DEFAULT 0,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error jsonb,
  idempotency_key text,
  parent_job_id uuid,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  queued_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  waiting_at timestamp with time zone,
  completed_at timestamp with time zone,
  failed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.linkedin_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_name text NOT NULL,
  job_title text,
  company text,
  location text,
  linkedin_url text,
  contact_email text,
  keywords text[],
  experience_level text,
  search_criteria jsonb,
  scraped_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  session_id uuid,
  profile_picture varchar(255),
  search_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.linkedin_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  day text NOT NULL,
  content_format text,
  post_caption text,
  image_prompt text,
  video_idea text,
  status text DEFAULT 'Planned'::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.marketing_videos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  feature_name text NOT NULL,
  feature_description text,
  target_audience text,
  problem_solved text,
  key_benefits jsonb DEFAULT '[]'::jsonb,
  demo_steps jsonb DEFAULT '[]'::jsonb,
  video_intent text,
  video_style text,
  video_length integer DEFAULT 60,
  cta_message text,
  avatar_id text,
  voice_id text,
  ai_script jsonb,
  ai_script_raw_response text,
  ai_motion_graphics jsonb,
  ai_motion_raw_response text,
  script_word_count integer,
  script_estimated_duration integer,
  heygen_video_id text,
  heygen_status text DEFAULT 'pending'::text,
  video_url text,
  thumbnail_url text,
  generation_status text DEFAULT 'generating_script'::text,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role organization_member_role NOT NULL DEFAULT 'viewer'::organization_member_role,
  status organization_member_status NOT NULL DEFAULT 'active'::organization_member_status,
  invited_by uuid,
  joined_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.outreach_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  sequence_id uuid,
  step_number integer,
  channel text NOT NULL,
  action_type text NOT NULL,
  subject text,
  body text,
  scheduled_date timestamp with time zone,
  executed_date timestamp with time zone,
  status activity_status DEFAULT 'pending'::activity_status,
  response_received boolean DEFAULT false,
  response_text text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  response_type text,
  message_id text,
  source text DEFAULT 'app'::text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.outreach_daily_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  queue_date date NOT NULL DEFAULT CURRENT_DATE,
  lead_id uuid,
  activity_id uuid,
  action_type text NOT NULL,
  channel text NOT NULL,
  priority integer DEFAULT 0,
  status text DEFAULT 'pending'::text,
  snooze_until date,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.outreach_error_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid,
  lead_id uuid,
  workflow text NOT NULL,
  error_type text,
  error_message text,
  payload jsonb,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.outreach_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company text NOT NULL,
  contact_name text NOT NULL,
  title text,
  email text,
  linkedin_url text,
  industry text,
  company_size text,
  notes text,
  tier lead_tier DEFAULT 'unassigned'::lead_tier,
  status lead_status DEFAULT 'not_started'::lead_status,
  signals jsonb DEFAULT '[]'::jsonb,
  sequence_id uuid,
  current_sequence_step integer DEFAULT 0,
  last_touch_date timestamp with time zone,
  next_action_date timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  closely_synced boolean DEFAULT false,
  closely_connection_status text DEFAULT 'none'::text,
  closely_last_event text,
  closely_last_event_at timestamp with time zone,
  linkedin_slug text,
  scrape_status text,
  scrape_url text,
  scraped_homepage text,
  scraped_careers text,
  generated_connection_note text,
  generated_dm_step2 text,
  generated_dm_step3 text,
  generated_dm_step4 text,
  scraped_at timestamp with time zone,
  hiring_detected boolean DEFAULT false,
  open_roles text,
  salary_range text,
  uses_agency boolean,
  agency_name text,
  hiring_source text,
  recent_news text,
  founder_about text,
  discovery_source text DEFAULT 'manual'::text,
  role_count integer DEFAULT 0,
  source_post_url text,
  source_post_author text,
  original_comment text,
  pain_point_detected text,
  commenter_score integer DEFAULT 0,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.outreach_sequences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status sequence_status DEFAULT 'draft'::sequence_status,
  steps jsonb DEFAULT '[]'::jsonb,
  leads_enrolled integer DEFAULT 0,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.outreach_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  product_context text,
  email_signature text,
  default_cta text,
  linkedin_daily_connect_limit integer DEFAULT 20,
  linkedin_daily_dm_limit integer DEFAULT 40,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.pricing_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  competitor_id uuid,
  scraped_at timestamp with time zone DEFAULT now(),
  pricing_data jsonb,
  change_detected boolean DEFAULT false,
  change_summary text,
  previous_entry_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id uuid,
  full_name text,
  role text DEFAULT 'user'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  logo_url text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.resume_analyses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resume text,
  candidate_name text NOT NULL,
  email text,
  strengths text,
  weaknesses text,
  risk_factor jsonb,
  reward_factor jsonb,
  fit_score jsonb,
  overall_factor jsonb,
  justification text,
  recruitment_name text,
  screening_type text DEFAULT 'auto'::text,
  processing_time_minutes integer DEFAULT 2,
  email_opened boolean DEFAULT false,
  email_clicked boolean DEFAULT false,
  nurturing_stage text,
  current_stage text DEFAULT 'initial_screening'::text,
  status text DEFAULT 'new'::text,
  status_updated_at timestamp with time zone,
  status_updated_by uuid,
  screening_status text DEFAULT 'not_invited'::text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.scheduled_emails (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  candidate_name text NOT NULL,
  candidate_email text NOT NULL,
  fit_score integer,
  step_number integer NOT NULL,
  subject text,
  content text,
  company_name text,
  sender_name text,
  send_time_utc timestamp with time zone NOT NULL,
  send_time text,
  timezone text,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  candidate_id uuid,
  scheduled_send_time timestamp with time zone,
  send_time_end text,
  delay_days integer,
  sequence_name text,
  folder_name text,
  recruitment_name text,
  sequence_created_at timestamp with time zone,
  user_timezone text,
  window_start text,
  window_end text,
  user_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.scraping_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  search_criteria jsonb NOT NULL,
  total_leads integer DEFAULT 0,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  name text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.screening_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  access_token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'::text),
  status text NOT NULL DEFAULT 'started'::text,
  resume_url text,
  extracted_data jsonb,
  candidate_edits jsonb,
  screening_answers jsonb DEFAULT '[]'::jsonb,
  tab_switches integer NOT NULL DEFAULT 0,
  total_time_seconds integer NOT NULL DEFAULT 0,
  match_score integer,
  match_category text,
  strengths jsonb DEFAULT '[]'::jsonb,
  red_flags jsonb DEFAULT '[]'::jsonb,
  interview_questions jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  recruiter_status text DEFAULT 'new'::text,
  recruiter_notes text,
  is_archived boolean DEFAULT false,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.screening_behavioral_analysis (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  ownership_score integer,
  ownership_evidence jsonb DEFAULT '[]'::jsonb,
  clarity_score integer,
  clarity_evidence jsonb DEFAULT '[]'::jsonb,
  emotional_regulation_score integer,
  emotional_evidence jsonb DEFAULT '[]'::jsonb,
  consistency_score integer,
  consistency_evidence jsonb DEFAULT '[]'::jsonb,
  overall_risk_level behavioral_risk_level,
  risk_summary text,
  red_flags jsonb DEFAULT '[]'::jsonb,
  green_flags jsonb DEFAULT '[]'::jsonb,
  ai_confidence_score integer,
  analysis_completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.screening_conversation_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  message_index integer NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  scenario_id uuid,
  behavioral_signals_detected jsonb DEFAULT '{}'::jsonb,
  response_time_seconds integer,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.screening_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  company_name text NOT NULL DEFAULT ''::text,
  description text NOT NULL DEFAULT ''::text,
  required_years integer NOT NULL DEFAULT 0,
  required_skills text[] NOT NULL DEFAULT '{}'::text[],
  education_requirement text NOT NULL DEFAULT 'None'::text,
  salary_min integer,
  salary_max integer,
  custom_questions jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.screening_scenarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category scenario_category NOT NULL,
  scenario_prompt text NOT NULL,
  follow_up_prompts jsonb DEFAULT '[]'::jsonb,
  difficulty_level integer DEFAULT 1,
  target_signals jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.screening_template_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid,
  scenario_id uuid,
  category text NOT NULL,
  question_text text NOT NULL,
  follow_up_prompts jsonb DEFAULT '[]'::jsonb,
  difficulty_level integer DEFAULT 1,
  sort_order integer DEFAULT 0,
  is_custom boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.screening_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  role_focus text,
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.secret_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tool_id uuid,
  provider_slug text NOT NULL,
  name text NOT NULL,
  secret_ref text NOT NULL,
  secret_scope text NOT NULL DEFAULT 'organization'::text,
  status secret_connection_status NOT NULL DEFAULT 'active'::secret_connection_status,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.sp_outreach_leads_scored (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company text,
  headline text,
  tier text NOT NULL,
  score integer NOT NULL,
  signals text,
  linkedin_url text NOT NULL,
  dm_text text,
  status text NOT NULL DEFAULT 'pending'::text,
  source text NOT NULL DEFAULT 'apify_linkedin_search'::text,
  scraped_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  company_website text,
  company_description text,
  company_size text,
  funding_stage text,
  open_roles text,
  tech_stack text,
  enriched_at timestamp with time zone,
  company_phone text,
  company_email text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.sp_wellfound_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  job_title text,
  company_name text,
  company_url text,
  company_website text,
  location text,
  remote boolean,
  salary_range text,
  date_posted text,
  applicant_count integer,
  company_description text,
  team_size text,
  funding_stage text,
  funding_amount text,
  tech_stack text[],
  open_roles_count integer,
  enrichment_source text,
  decision_maker_name text,
  decision_maker_title text,
  decision_maker_linkedin text,
  score integer,
  tier text,
  score_breakdown jsonb,
  personalized_dm text,
  dm_sent boolean DEFAULT false,
  dm_sent_at timestamp with time zone,
  reply_received boolean DEFAULT false,
  reply_text text,
  source text DEFAULT 'wellfound_scrape'::text,
  scrape_date date DEFAULT CURRENT_DATE,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.talent_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  candidate_name text,
  candidate_linkedin_url text,
  candidate_email text,
  candidate_title text,
  candidate_company text,
  candidate_location text,
  candidate_photo_url text,
  signal_type text NOT NULL,
  signal_title text NOT NULL,
  signal_summary text,
  signal_source_url text,
  signal_detected_at timestamp with time zone DEFAULT now(),
  signal_score integer DEFAULT 0,
  tier text,
  is_actioned boolean DEFAULT false,
  action_type text,
  actioned_at timestamp with time zone,
  is_dismissed boolean DEFAULT false,
  matched_job_id uuid,
  role_match_score integer,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.task_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid,
  user_instruction text NOT NULL,
  plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text DEFAULT 'pending'::text,
  current_step integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid,
  workspace_id uuid,
  task_plan_id uuid,
  step_index integer DEFAULT 0,
  input text,
  output text,
  tokens_in integer DEFAULT 0,
  tokens_out integer DEFAULT 0,
  status text DEFAULT 'running'::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.tools (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  capability_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  supported_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  config_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL,
  workspace_id uuid,
  email text,
  full_name text,
  role text DEFAULT 'owner'::text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_brain text DEFAULT ''::text,
  plan text DEFAULT 'free'::text,
  daily_run_limit integer DEFAULT 100,
  tokens_used_today integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

-- ============================================================================
-- End of baseline (83 tables captured).
-- ============================================================================
