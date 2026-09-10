export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          description: string | null
          domain: string | null
          employee_count: string | null
          id: string
          industry: string | null
          linkedin_url: string | null
          location: string | null
          name: string
          raw: Json
          source: string | null
          stage: string | null
          updated_at: string
          website_url: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          domain?: string | null
          employee_count?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          location?: string | null
          name: string
          raw?: Json
          source?: string | null
          stage?: string | null
          updated_at?: string
          website_url?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          domain?: string | null
          employee_count?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          location?: string | null
          name?: string
          raw?: Json
          source?: string | null
          stage?: string | null
          updated_at?: string
          website_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_feed: {
        Row: {
          agent_id: string | null
          body: string | null
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          plan_id: string | null
          task_id: string | null
          task_plan_id: string | null
          title: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          body?: string | null
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          plan_id?: string | null
          task_id?: string | null
          task_plan_id?: string | null
          title?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          body?: string | null
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          plan_id?: string | null
          task_id?: string | null
          task_plan_id?: string | null
          title?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_feed_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_task_plan_id_fkey"
            columns: ["task_plan_id"]
            isOneToOne: false
            referencedRelation: "task_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          agent_id: string | null
          created_at: string
          department_id: string | null
          event_type: string
          id: string
          job_id: string | null
          job_step_id: string | null
          message: string
          metadata: Json
          organization_id: string
          severity: Database["public"]["Enums"]["activity_log_severity"]
        }
        Insert: {
          actor_type?: string
          actor_user_id?: string | null
          agent_id?: string | null
          created_at?: string
          department_id?: string | null
          event_type: string
          id?: string
          job_id?: string | null
          job_step_id?: string | null
          message: string
          metadata?: Json
          organization_id: string
          severity?: Database["public"]["Enums"]["activity_log_severity"]
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          agent_id?: string | null
          created_at?: string
          department_id?: string | null
          event_type?: string
          id?: string
          job_id?: string | null
          job_step_id?: string | null
          message?: string
          metadata?: Json
          organization_id?: string
          severity?: Database["public"]["Enums"]["activity_log_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_department_same_org"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "activity_logs_job_same_org"
            columns: ["job_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_step_same_org"
            columns: ["job_step_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "job_steps"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      adaptive_screening_sessions: {
        Row: {
          access_token: string
          candidate_consent_given: boolean | null
          candidate_id: string | null
          completed_at: string | null
          consent_given_at: string | null
          created_at: string | null
          current_scenario_index: number | null
          expires_at: string | null
          id: string
          invited_at: string | null
          role_briefing: Json | null
          scenario_config: Json | null
          scenario_count: number | null
          session_status: Database["public"]["Enums"]["screening_session_status"]
          started_at: string | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_token?: string
          candidate_consent_given?: boolean | null
          candidate_id?: string | null
          completed_at?: string | null
          consent_given_at?: string | null
          created_at?: string | null
          current_scenario_index?: number | null
          expires_at?: string | null
          id?: string
          invited_at?: string | null
          role_briefing?: Json | null
          scenario_config?: Json | null
          scenario_count?: number | null
          session_status?: Database["public"]["Enums"]["screening_session_status"]
          started_at?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          candidate_consent_given?: boolean | null
          candidate_id?: string | null
          completed_at?: string | null
          consent_given_at?: string | null
          created_at?: string | null
          current_scenario_index?: number | null
          expires_at?: string | null
          id?: string
          invited_at?: string | null
          role_briefing?: Json | null
          scenario_config?: Json | null
          scenario_count?: number | null
          session_status?: Database["public"]["Enums"]["screening_session_status"]
          started_at?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "adaptive_screening_sessions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "resume_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adaptive_screening_sessions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "screening_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_capabilities: {
        Row: {
          agent_id: string | null
          capability: string
          id: string
          input_type: string
          output_type: string
          priority: number | null
        }
        Insert: {
          agent_id?: string | null
          capability: string
          id?: string
          input_type: string
          output_type: string
          priority?: number | null
        }
        Update: {
          agent_id?: string | null
          capability?: string
          id?: string
          input_type?: string
          output_type?: string
          priority?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_capabilities_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_presence: {
        Row: {
          agent_id: string
          last_seen_at: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          last_seen_at?: string
          status: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          last_seen_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          avatar_color: string | null
          avatar_icon: string | null
          created_at: string | null
          department: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          model: string
          name: string
          role_prompt: string
          slug: string | null
          status: string | null
          tools: Json | null
          trigger_config: Json | null
          trigger_type: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          avatar_color?: string | null
          avatar_icon?: string | null
          created_at?: string | null
          department: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          model?: string
          name: string
          role_prompt: string
          slug?: string | null
          status?: string | null
          tools?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          avatar_color?: string | null
          avatar_icon?: string | null
          created_at?: string | null
          department?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          model?: string
          name?: string
          role_prompt?: string
          slug?: string | null
          status?: string | null
          tools?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          agent_id: string | null
          agent_slug: string | null
          body: string | null
          created_at: string | null
          description: string | null
          id: string
          metadata: Json
          payload: Json | null
          plan_id: string | null
          resolved_at: string | null
          status: string | null
          summary: string | null
          task_id: string | null
          task_plan_id: string | null
          title: string | null
          type: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_slug?: string | null
          body?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          payload?: Json | null
          plan_id?: string | null
          resolved_at?: string | null
          status?: string | null
          summary?: string | null
          task_id?: string | null
          task_plan_id?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_slug?: string | null
          body?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          payload?: Json | null
          plan_id?: string | null
          resolved_at?: string | null
          status?: string | null
          summary?: string | null
          task_id?: string | null
          task_plan_id?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_task_plan_id_fkey"
            columns: ["task_plan_id"]
            isOneToOne: false
            referencedRelation: "task_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          candidate_id: string | null
          created_at: string | null
          error_message: string | null
          execution_time_ms: number | null
          id: string
          ip_address: string | null
          request_data: Json | null
          response_data: Json | null
          route: string | null
          session_id: string | null
          status: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          candidate_id?: string | null
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          ip_address?: string | null
          request_data?: Json | null
          response_data?: Json | null
          route?: string | null
          session_id?: string | null
          status?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          candidate_id?: string | null
          created_at?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          ip_address?: string | null
          request_data?: Json | null
          response_data?: Json | null
          route?: string | null
          session_id?: string | null
          status?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      call_attempts: {
        Row: {
          actual_cost: number | null
          amd_result: string | null
          attempt_id: string
          billable_seconds: number | null
          call_control_id: string | null
          call_leg_id: string | null
          call_session_id: string | null
          cost_status: string | null
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          estimated_cost: number | null
          from_number: string | null
          id: string
          lead_id: string
          line_number: number | null
          outcome: string | null
          session_id: string | null
          started_at: string
          status: string
          to_number: string | null
          updated_at: string
        }
        Insert: {
          actual_cost?: number | null
          amd_result?: string | null
          attempt_id: string
          billable_seconds?: number | null
          call_control_id?: string | null
          call_leg_id?: string | null
          call_session_id?: string | null
          cost_status?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          estimated_cost?: number | null
          from_number?: string | null
          id?: string
          lead_id: string
          line_number?: number | null
          outcome?: string | null
          session_id?: string | null
          started_at?: string
          status: string
          to_number?: string | null
          updated_at?: string
        }
        Update: {
          actual_cost?: number | null
          amd_result?: string | null
          attempt_id?: string
          billable_seconds?: number | null
          call_control_id?: string | null
          call_leg_id?: string | null
          call_session_id?: string | null
          cost_status?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          estimated_cost?: number | null
          from_number?: string | null
          id?: string
          lead_id?: string
          line_number?: number | null
          outcome?: string | null
          session_id?: string | null
          started_at?: string
          status?: string
          to_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dialer_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_notes: {
        Row: {
          candidate_id: string | null
          content: string
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          candidate_id?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          candidate_id?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_notes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "resume_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profiles: {
        Row: {
          batch_number: number | null
          created_at: string | null
          current_company: string | null
          current_title: string | null
          education: Json | null
          email: string | null
          email_confidence: string | null
          email_found_at: string | null
          headline: string | null
          id: string
          inserted_at: string | null
          linkedin_url: string
          location: string | null
          match_quality: string | null
          match_reasons: Json | null
          name: string | null
          photo_url: string | null
          profile_completeness: number | null
          profile_data: Json | null
          score_breakdown: Json | null
          scrape_run_id: string | null
          seniority_level: string | null
          session_id: string | null
          similarity_score: number | null
          tier_source: number | null
          top_skills: Json | null
          work_history: Json | null
          years_experience: number | null
        }
        Insert: {
          batch_number?: number | null
          created_at?: string | null
          current_company?: string | null
          current_title?: string | null
          education?: Json | null
          email?: string | null
          email_confidence?: string | null
          email_found_at?: string | null
          headline?: string | null
          id?: string
          inserted_at?: string | null
          linkedin_url: string
          location?: string | null
          match_quality?: string | null
          match_reasons?: Json | null
          name?: string | null
          photo_url?: string | null
          profile_completeness?: number | null
          profile_data?: Json | null
          score_breakdown?: Json | null
          scrape_run_id?: string | null
          seniority_level?: string | null
          session_id?: string | null
          similarity_score?: number | null
          tier_source?: number | null
          top_skills?: Json | null
          work_history?: Json | null
          years_experience?: number | null
        }
        Update: {
          batch_number?: number | null
          created_at?: string | null
          current_company?: string | null
          current_title?: string | null
          education?: Json | null
          email?: string | null
          email_confidence?: string | null
          email_found_at?: string | null
          headline?: string | null
          id?: string
          inserted_at?: string | null
          linkedin_url?: string
          location?: string | null
          match_quality?: string | null
          match_reasons?: Json | null
          name?: string | null
          photo_url?: string | null
          profile_completeness?: number | null
          profile_data?: Json | null
          score_breakdown?: Json | null
          scrape_run_id?: string | null
          seniority_level?: string | null
          session_id?: string | null
          similarity_score?: number | null
          tier_source?: number | null
          top_skills?: Json | null
          work_history?: Json | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profiles_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "icp_lookalike_sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      client_active_positions: {
        Row: {
          budget_range: string | null
          client_id: string | null
          created_at: string | null
          id: string
          position_level: string | null
          position_title: string
          posted_date: string
          required_skills: string[] | null
          status: string | null
        }
        Insert: {
          budget_range?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          position_level?: string | null
          position_title: string
          posted_date: string
          required_skills?: string[] | null
          status?: string | null
        }
        Update: {
          budget_range?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          position_level?: string | null
          position_title?: string
          posted_date?: string
          required_skills?: string[] | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_active_positions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_placements: {
        Row: {
          candidate_id: string | null
          client_id: string | null
          cost_per_hire: number | null
          created_at: string | null
          id: string
          placement_date: string
          position_opened_date: string | null
          position_title: string
          time_to_fill_days: number | null
        }
        Insert: {
          candidate_id?: string | null
          client_id?: string | null
          cost_per_hire?: number | null
          created_at?: string | null
          id?: string
          placement_date: string
          position_opened_date?: string | null
          position_title: string
          time_to_fill_days?: number | null
        }
        Update: {
          candidate_id?: string | null
          client_id?: string | null
          cost_per_hire?: number | null
          created_at?: string | null
          id?: string
          placement_date?: string
          position_opened_date?: string | null
          position_title?: string
          time_to_fill_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_placements_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "resume_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_placements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          accent_color: string | null
          client_name: string
          company_display_name: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string | null
          id: string
          industry: string | null
          logo_url: string | null
          primary_color: string | null
          secondary_color: string | null
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          client_name: string
          company_display_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          client_name?: string
          company_display_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      closely_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          linkedin_url: string | null
          matched_lead_id: string | null
          processed: boolean | null
          raw_payload: Json
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          linkedin_url?: string | null
          matched_lead_id?: string | null
          processed?: boolean | null
          raw_payload: Json
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          linkedin_url?: string | null
          matched_lead_id?: string | null
          processed?: boolean | null
          raw_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "closely_events_matched_lead_id_fkey"
            columns: ["matched_lead_id"]
            isOneToOne: false
            referencedRelation: "outreach_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      codex_leads: {
        Row: {
          applicant_count: number | null
          channel: string
          company: string
          company_description: string | null
          created_at: string
          data: Json
          first_name: string | null
          funding_amount: string | null
          funding_stage: string | null
          id: string
          job_description: string | null
          job_title: string | null
          last_name: string | null
          lead_score: number | null
          lead_tier: string | null
          open_roles_count: number | null
          pain_angle: string | null
          personalized_message: string
          role_type: string | null
          round_date: string | null
          salary_range: string | null
          signal_used: string | null
          source_type: string | null
          source_url: string
          subject_line: string | null
          title: string | null
          updated_at: string
          word_count: number | null
        }
        Insert: {
          applicant_count?: number | null
          channel?: string
          company: string
          company_description?: string | null
          created_at?: string
          data?: Json
          first_name?: string | null
          funding_amount?: string | null
          funding_stage?: string | null
          id?: string
          job_description?: string | null
          job_title?: string | null
          last_name?: string | null
          lead_score?: number | null
          lead_tier?: string | null
          open_roles_count?: number | null
          pain_angle?: string | null
          personalized_message: string
          role_type?: string | null
          round_date?: string | null
          salary_range?: string | null
          signal_used?: string | null
          source_type?: string | null
          source_url: string
          subject_line?: string | null
          title?: string | null
          updated_at?: string
          word_count?: number | null
        }
        Update: {
          applicant_count?: number | null
          channel?: string
          company?: string
          company_description?: string | null
          created_at?: string
          data?: Json
          first_name?: string | null
          funding_amount?: string | null
          funding_stage?: string | null
          id?: string
          job_description?: string | null
          job_title?: string | null
          last_name?: string | null
          lead_score?: number | null
          lead_tier?: string | null
          open_roles_count?: number | null
          pain_angle?: string | null
          personalized_message?: string
          role_type?: string | null
          round_date?: string | null
          salary_range?: string | null
          signal_used?: string | null
          source_type?: string | null
          source_url?: string
          subject_line?: string | null
          title?: string | null
          updated_at?: string
          word_count?: number | null
        }
        Relationships: []
      }
      collaboration_candidate_attachments: {
        Row: {
          attached_at: string | null
          attached_by: string | null
          candidate_id: string
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          custom_notes: string | null
          fit_score: number | null
          id: string
          room_id: string
        }
        Insert: {
          attached_at?: string | null
          attached_by?: string | null
          candidate_id: string
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          custom_notes?: string | null
          fit_score?: number | null
          id?: string
          room_id: string
        }
        Update: {
          attached_at?: string | null
          attached_by?: string | null
          candidate_id?: string
          candidate_source?: Database["public"]["Enums"]["candidate_source"]
          custom_notes?: string | null
          fit_score?: number | null
          id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_candidate_attachments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "collaboration_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_candidate_comments: {
        Row: {
          attachment_id: string
          comment: string
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          attachment_id: string
          comment: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          attachment_id?: string
          comment?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_candidate_comments_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "collaboration_candidate_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_candidate_tags: {
        Row: {
          attachment_id: string
          created_at: string | null
          created_by: string | null
          id: string
          tag: string
        }
        Insert: {
          attachment_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          tag: string
        }
        Update: {
          attachment_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_candidate_tags_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "collaboration_candidate_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_contact_history: {
        Row: {
          candidate_id: string
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          contact_method: string | null
          contacted_at: string | null
          contacted_by: string | null
          id: string
          notes: string | null
        }
        Insert: {
          candidate_id: string
          candidate_source: Database["public"]["Enums"]["candidate_source"]
          contact_method?: string | null
          contacted_at?: string | null
          contacted_by?: string | null
          id?: string
          notes?: string | null
        }
        Update: {
          candidate_id?: string
          candidate_source?: Database["public"]["Enums"]["candidate_source"]
          contact_method?: string | null
          contacted_at?: string | null
          contacted_by?: string | null
          id?: string
          notes?: string | null
        }
        Relationships: []
      }
      collaboration_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_deleted: boolean | null
          mentions: string[] | null
          room_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          mentions?: string[] | null
          room_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          mentions?: string[] | null
          room_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "collaboration_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_room_members: {
        Row: {
          id: string
          joined_at: string | null
          last_seen_at: string | null
          room_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string | null
          last_seen_at?: string | null
          room_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string | null
          last_seen_at?: string | null
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "collaboration_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_rooms: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      company_brain: {
        Row: {
          company_name: string | null
          created_at: string | null
          do_not_say: Json
          examples: Json
          id: string | null
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          profile: Json
          updated_at: string
          updated_by: string | null
          voice_and_tone: string | null
          what_we_do: string | null
          who_we_sell_to: string | null
          workspace_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string | null
          do_not_say?: Json
          examples?: Json
          id?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          profile?: Json
          updated_at?: string
          updated_by?: string | null
          voice_and_tone?: string | null
          what_we_do?: string | null
          who_we_sell_to?: string | null
          workspace_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string | null
          do_not_say?: Json
          examples?: Json
          id?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          profile?: Json
          updated_at?: string
          updated_by?: string | null
          voice_and_tone?: string | null
          what_we_do?: string | null
          who_we_sell_to?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_brain_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      company_brain_research_runs: {
        Row: {
          created_at: string
          error_message: string | null
          evidence: Json
          id: string
          input: Json
          output: Json
          provider: string
          source_type: string
          source_url: string | null
          status: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          evidence?: Json
          id?: string
          input?: Json
          output?: Json
          provider: string
          source_type: string
          source_url?: string | null
          status: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          evidence?: Json
          id?: string
          input?: Json
          output?: Json
          provider?: string
          source_type?: string
          source_url?: string | null
          status?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_brain_research_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      company_headcount_snapshots: {
        Row: {
          canonical_domain: string | null
          company_key: string
          company_name: string | null
          created_at: string
          employee_count: number
          id: string
          linkedin_company_url: string | null
          observed_at: string
          observed_on: string | null
          provider_run_id: string | null
          source: string
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          canonical_domain?: string | null
          company_key: string
          company_name?: string | null
          created_at?: string
          employee_count: number
          id?: string
          linkedin_company_url?: string | null
          observed_at: string
          observed_on?: string | null
          provider_run_id?: string | null
          source: string
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          canonical_domain?: string | null
          company_key?: string
          company_name?: string | null
          created_at?: string
          employee_count?: number
          id?: string
          linkedin_company_url?: string | null
          observed_at?: string
          observed_on?: string | null
          provider_run_id?: string | null
          source?: string
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      company_web_evidence: {
        Row: {
          company_key: string
          content_hash: string
          created_at: string
          domain: string
          fetched_at: string
          id: string
          page_intent: string
          provider: string
          provider_run_id: string | null
          requirement_id: string | null
          source_text: string
          source_url: string
          status: string
          workspace_id: string
        }
        Insert: {
          company_key: string
          content_hash: string
          created_at?: string
          domain: string
          fetched_at?: string
          id?: string
          page_intent: string
          provider?: string
          provider_run_id?: string | null
          requirement_id?: string | null
          source_text: string
          source_url: string
          status: string
          workspace_id: string
        }
        Update: {
          company_key?: string
          content_hash?: string
          created_at?: string
          domain?: string
          fetched_at?: string
          id?: string
          page_intent?: string
          provider?: string
          provider_run_id?: string | null
          requirement_id?: string | null
          source_text?: string
          source_url?: string
          status?: string
          workspace_id?: string
        }
        Relationships: []
      }
      competitor_companies: {
        Row: {
          careers_url: string | null
          company_name: string
          crawl_status: string | null
          created_at: string | null
          id: string
          last_crawled_at: string | null
          user_id: string
          website_url: string | null
        }
        Insert: {
          careers_url?: string | null
          company_name: string
          crawl_status?: string | null
          created_at?: string | null
          id?: string
          last_crawled_at?: string | null
          user_id: string
          website_url?: string | null
        }
        Update: {
          careers_url?: string | null
          company_name?: string
          crawl_status?: string | null
          created_at?: string | null
          id?: string
          last_crawled_at?: string | null
          user_id?: string
          website_url?: string | null
        }
        Relationships: []
      }
      competitor_intel_signals: {
        Row: {
          competitor_id: string | null
          competitor_name: string | null
          created_at: string | null
          id: string
          importance: string | null
          is_dismissed: boolean | null
          is_read: boolean | null
          signal_data: Json | null
          signal_date: string | null
          signal_source_url: string | null
          signal_summary: string | null
          signal_title: string
          signal_type: string
          user_id: string
        }
        Insert: {
          competitor_id?: string | null
          competitor_name?: string | null
          created_at?: string | null
          id?: string
          importance?: string | null
          is_dismissed?: boolean | null
          is_read?: boolean | null
          signal_data?: Json | null
          signal_date?: string | null
          signal_source_url?: string | null
          signal_summary?: string | null
          signal_title: string
          signal_type: string
          user_id: string
        }
        Update: {
          competitor_id?: string | null
          competitor_name?: string | null
          created_at?: string | null
          id?: string
          importance?: string | null
          is_dismissed?: boolean | null
          is_read?: boolean | null
          signal_data?: Json | null
          signal_date?: string | null
          signal_source_url?: string | null
          signal_summary?: string | null
          signal_title?: string
          signal_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_intel_signals_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_job_postings: {
        Row: {
          competitor_id: string | null
          created_at: string | null
          department: string | null
          id: string
          job_title: string
          job_url: string | null
          location: string | null
          scraped_at: string | null
          user_id: string
        }
        Insert: {
          competitor_id?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          job_title: string
          job_url?: string | null
          location?: string | null
          scraped_at?: string | null
          user_id: string
        }
        Update: {
          competitor_id?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          job_title?: string
          job_url?: string | null
          location?: string | null
          scraped_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_job_postings_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_profiles: {
        Row: {
          competitor_id: string | null
          engineering_headcount_estimate: number | null
          g2_rating: number | null
          g2_review_count: number | null
          id: string
          key_differentiators: Json | null
          key_features: Json | null
          last_full_scan_at: string | null
          last_pricing_change_at: string | null
          pricing_change_summary: string | null
          pricing_model: string | null
          pricing_tiers: Json | null
          recent_executive_changes: Json | null
          recent_launches: Json | null
          tagline: string | null
          target_market: string | null
          top_complaints: Json | null
          top_praise: Json | null
          total_employees_estimate: number | null
          updated_at: string | null
          user_id: string
          value_proposition: string | null
        }
        Insert: {
          competitor_id?: string | null
          engineering_headcount_estimate?: number | null
          g2_rating?: number | null
          g2_review_count?: number | null
          id?: string
          key_differentiators?: Json | null
          key_features?: Json | null
          last_full_scan_at?: string | null
          last_pricing_change_at?: string | null
          pricing_change_summary?: string | null
          pricing_model?: string | null
          pricing_tiers?: Json | null
          recent_executive_changes?: Json | null
          recent_launches?: Json | null
          tagline?: string | null
          target_market?: string | null
          top_complaints?: Json | null
          top_praise?: Json | null
          total_employees_estimate?: number | null
          updated_at?: string | null
          user_id: string
          value_proposition?: string | null
        }
        Update: {
          competitor_id?: string | null
          engineering_headcount_estimate?: number | null
          g2_rating?: number | null
          g2_review_count?: number | null
          id?: string
          key_differentiators?: Json | null
          key_features?: Json | null
          last_full_scan_at?: string | null
          last_pricing_change_at?: string | null
          pricing_change_summary?: string | null
          pricing_model?: string | null
          pricing_tiers?: Json | null
          recent_executive_changes?: Json | null
          recent_launches?: Json | null
          tagline?: string | null
          target_market?: string | null
          top_complaints?: Json | null
          top_praise?: Json | null
          total_employees_estimate?: number | null
          updated_at?: string | null
          user_id?: string
          value_proposition?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_profiles_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string | null
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          headline: string | null
          id: string
          linkedin_url: string | null
          location: string | null
          phone: string | null
          raw: Json
          source: string | null
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          raw?: Json
          source?: string | null
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          raw?: Json
          source?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_item: {
        Row: {
          agent_slug: string | null
          body: string
          created_at: string
          created_by: string | null
          format: string
          id: string
          metadata: Json
          source: string | null
          source_signal_id: string | null
          status: string
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_slug?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          format?: string
          id?: string
          metadata?: Json
          source?: string | null
          source_signal_id?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_slug?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          format?: string
          id?: string
          metadata?: Json
          source?: string | null
          source_signal_id?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_item_source_signal_id_fkey"
            columns: ["source_signal_id"]
            isOneToOne: false
            referencedRelation: "signal_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_item_version: {
        Row: {
          body: string
          content_item_id: string
          created_at: string
          created_by: string | null
          id: string
          title: string | null
          version: number
          workspace_id: string
        }
        Insert: {
          body?: string
          content_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string | null
          version: number
          workspace_id: string
        }
        Update: {
          body?: string
          content_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_item_version_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_version_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_slug: string | null
          channel: string | null
          created_at: string
          id: string
          status: string
          title: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          agent_slug?: string | null
          channel?: string | null
          created_at?: string
          id?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          agent_slug?: string | null
          channel?: string | null
          created_at?: string
          id?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          actual_credits: number
          company_key: string | null
          created_at: string
          estimated_credits: number
          finalized_at: string | null
          id: string
          idempotency_key: string
          kind: string
          reason: string | null
          refunded_credits: number
          reserved_credits: number
          status: string
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          actual_credits?: number
          company_key?: string | null
          created_at?: string
          estimated_credits?: number
          finalized_at?: string | null
          id?: string
          idempotency_key: string
          kind: string
          reason?: string | null
          refunded_credits?: number
          reserved_credits?: number
          status: string
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          actual_credits?: number
          company_key?: string | null
          created_at?: string
          estimated_credits?: number
          finalized_at?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          reason?: string | null
          refunded_credits?: number
          reserved_credits?: number
          status?: string
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deep_search_analysis: {
        Row: {
          candidate_name: string | null
          certifications: Json | null
          created_at: string | null
          current_role_and_company: string | null
          education: Json | null
          experience_summary: string | null
          id: string
          key_skills: Json | null
          languages: Json | null
          overall_fit_rating: number | null
          recruiter_insight: string | null
          soft_skills_and_traits: string | null
        }
        Insert: {
          candidate_name?: string | null
          certifications?: Json | null
          created_at?: string | null
          current_role_and_company?: string | null
          education?: Json | null
          experience_summary?: string | null
          id?: string
          key_skills?: Json | null
          languages?: Json | null
          overall_fit_rating?: number | null
          recruiter_insight?: string | null
          soft_skills_and_traits?: string | null
        }
        Update: {
          candidate_name?: string | null
          certifications?: Json | null
          created_at?: string | null
          current_role_and_company?: string | null
          education?: Json | null
          experience_summary?: string | null
          id?: string
          key_skills?: Json | null
          languages?: Json | null
          overall_fit_rating?: number | null
          recruiter_insight?: string | null
          soft_skills_and_traits?: string | null
        }
        Relationships: []
      }
      deep_search_results: {
        Row: {
          ai_confidence_level: number | null
          ai_summary: string | null
          candidate_id: string | null
          candidate_name: string
          certifications: Json | null
          company: string | null
          company_match_notes: string | null
          created_at: string | null
          education: Json | null
          email: string | null
          fit_score: number | null
          id: string
          ideal_roles: string[] | null
          languages: Json | null
          linkedin_url: string | null
          profile_picture_url: string | null
          raw_analysis: Json | null
          status: string | null
          strengths: string[] | null
          updated_at: string | null
          weaknesses: string[] | null
        }
        Insert: {
          ai_confidence_level?: number | null
          ai_summary?: string | null
          candidate_id?: string | null
          candidate_name: string
          certifications?: Json | null
          company?: string | null
          company_match_notes?: string | null
          created_at?: string | null
          education?: Json | null
          email?: string | null
          fit_score?: number | null
          id?: string
          ideal_roles?: string[] | null
          languages?: Json | null
          linkedin_url?: string | null
          profile_picture_url?: string | null
          raw_analysis?: Json | null
          status?: string | null
          strengths?: string[] | null
          updated_at?: string | null
          weaknesses?: string[] | null
        }
        Update: {
          ai_confidence_level?: number | null
          ai_summary?: string | null
          candidate_id?: string | null
          candidate_name?: string
          certifications?: Json | null
          company?: string | null
          company_match_notes?: string | null
          created_at?: string | null
          education?: Json | null
          email?: string | null
          fit_score?: number | null
          id?: string
          ideal_roles?: string[] | null
          languages?: Json | null
          linkedin_url?: string | null
          profile_picture_url?: string | null
          raw_analysis?: Json | null
          status?: string | null
          strengths?: string[] | null
          updated_at?: string | null
          weaknesses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "deep_search_results_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "linkedin_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          metadata: Json
          name: string
          organization_id: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          name: string
          organization_id: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          name?: string
          organization_id?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_campaigns: {
        Row: {
          amd_enabled: boolean | null
          budget_status: string | null
          calling_hours: Json | null
          campaign_budget: number | null
          campaign_spend: number | null
          cost_per_attempt: number | null
          created_at: string | null
          desc_text: string | null
          description: string | null
          dialing_mode: string | null
          from_number: string | null
          id: string
          leads: string | null
          max_attempts_per_lead: number | null
          name: string
          rate: string | null
          receiver_agent_id: string | null
          retry_delay_busy_minutes: number | null
          retry_delay_failed_minutes: number | null
          retry_delay_minutes: number | null
          retry_delay_no_answer_minutes: number | null
          retry_delay_voicemail_minutes: number | null
          session_budget: number | null
          spend_updated_at: string | null
          stats: Json | null
          status: string | null
          timezone: string | null
          transfer_not_sure: boolean | null
          type: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          amd_enabled?: boolean | null
          budget_status?: string | null
          calling_hours?: Json | null
          campaign_budget?: number | null
          campaign_spend?: number | null
          cost_per_attempt?: number | null
          created_at?: string | null
          desc_text?: string | null
          description?: string | null
          dialing_mode?: string | null
          from_number?: string | null
          id: string
          leads?: string | null
          max_attempts_per_lead?: number | null
          name: string
          rate?: string | null
          receiver_agent_id?: string | null
          retry_delay_busy_minutes?: number | null
          retry_delay_failed_minutes?: number | null
          retry_delay_minutes?: number | null
          retry_delay_no_answer_minutes?: number | null
          retry_delay_voicemail_minutes?: number | null
          session_budget?: number | null
          spend_updated_at?: string | null
          stats?: Json | null
          status?: string | null
          timezone?: string | null
          transfer_not_sure?: boolean | null
          type?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Update: {
          amd_enabled?: boolean | null
          budget_status?: string | null
          calling_hours?: Json | null
          campaign_budget?: number | null
          campaign_spend?: number | null
          cost_per_attempt?: number | null
          created_at?: string | null
          desc_text?: string | null
          description?: string | null
          dialing_mode?: string | null
          from_number?: string | null
          id?: string
          leads?: string | null
          max_attempts_per_lead?: number | null
          name?: string
          rate?: string | null
          receiver_agent_id?: string | null
          retry_delay_busy_minutes?: number | null
          retry_delay_failed_minutes?: number | null
          retry_delay_minutes?: number | null
          retry_delay_no_answer_minutes?: number | null
          retry_delay_voicemail_minutes?: number | null
          session_budget?: number | null
          spend_updated_at?: string | null
          stats?: Json | null
          status?: string | null
          timezone?: string | null
          transfer_not_sure?: boolean | null
          type?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      dialer_leads: {
        Row: {
          attempts: number
          call_result: string | null
          call_status: string | null
          called_at: string | null
          campaign_id: string | null
          company: string | null
          company_name: string | null
          compliance_status: string | null
          contact_name: string | null
          created_at: string
          custom_fields: Json | null
          email: string | null
          email_status: string | null
          full_name: string
          funding_stage: string | null
          id: string
          last_called_at: string | null
          last_outcome: string | null
          lead_id: string
          max_attempts: number | null
          next_eligible_at: string | null
          notes: string | null
          open_roles: number | null
          phone: string | null
          score: number | null
          score_tier: string | null
          session_tag: string | null
          signals: string[] | null
          source: string | null
          status: string
          tags: string[] | null
          timezone: string | null
          title: string | null
          updated_at: string
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          attempts?: number
          call_result?: string | null
          call_status?: string | null
          called_at?: string | null
          campaign_id?: string | null
          company?: string | null
          company_name?: string | null
          compliance_status?: string | null
          contact_name?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          email_status?: string | null
          full_name: string
          funding_stage?: string | null
          id?: string
          last_called_at?: string | null
          last_outcome?: string | null
          lead_id: string
          max_attempts?: number | null
          next_eligible_at?: string | null
          notes?: string | null
          open_roles?: number | null
          phone?: string | null
          score?: number | null
          score_tier?: string | null
          session_tag?: string | null
          signals?: string[] | null
          source?: string | null
          status?: string
          tags?: string[] | null
          timezone?: string | null
          title?: string | null
          updated_at?: string
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          attempts?: number
          call_result?: string | null
          call_status?: string | null
          called_at?: string | null
          campaign_id?: string | null
          company?: string | null
          company_name?: string | null
          compliance_status?: string | null
          contact_name?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          email_status?: string | null
          full_name?: string
          funding_stage?: string | null
          id?: string
          last_called_at?: string | null
          last_outcome?: string | null
          lead_id?: string
          max_attempts?: number | null
          next_eligible_at?: string | null
          notes?: string | null
          open_roles?: number | null
          phone?: string | null
          score?: number | null
          score_tier?: string | null
          session_tag?: string | null
          signals?: string[] | null
          source?: string | null
          status?: string
          tags?: string[] | null
          timezone?: string | null
          title?: string | null
          updated_at?: string
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dialer_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dialer_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_locks: {
        Row: {
          acquired_at: string
          acquired_by: string
          expires_at: string
          lock_key: string
        }
        Insert: {
          acquired_at?: string
          acquired_by: string
          expires_at: string
          lock_key?: string
        }
        Update: {
          acquired_at?: string
          acquired_by?: string
          expires_at?: string
          lock_key?: string
        }
        Relationships: []
      }
      dialer_sessions: {
        Row: {
          agent_id: string
          budget_stop_reason: string | null
          calls_attempted: number | null
          calls_connected: number | null
          campaign_budget: number | null
          campaign_id: string | null
          created_at: string
          estimated_cost_per_attempt: number | null
          id: string
          max_budget: number | null
          max_calls: number | null
          min_balance_threshold: number | null
          parallel_lines: number
          session_spend: number
          started_at: string
          status: string
          stopped_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string
          budget_stop_reason?: string | null
          calls_attempted?: number | null
          calls_connected?: number | null
          campaign_budget?: number | null
          campaign_id?: string | null
          created_at?: string
          estimated_cost_per_attempt?: number | null
          id?: string
          max_budget?: number | null
          max_calls?: number | null
          min_balance_threshold?: number | null
          parallel_lines?: number
          session_spend?: number
          started_at?: string
          status: string
          stopped_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string
          budget_stop_reason?: string | null
          calls_attempted?: number | null
          calls_connected?: number | null
          campaign_budget?: number | null
          campaign_id?: string | null
          created_at?: string
          estimated_cost_per_attempt?: number | null
          id?: string
          max_budget?: number | null
          max_calls?: number | null
          min_balance_threshold?: number | null
          parallel_lines?: number
          session_spend?: number
          started_at?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      dialer_status: {
        Row: {
          current_call: Json | null
          id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          current_call?: Json | null
          id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          current_call?: Json | null
          id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      email_tracking: {
        Row: {
          event_type: string
          id: string
          ip_address: string | null
          link_url: string | null
          scheduled_email_id: string | null
          tracked_at: string
          user_agent: string | null
        }
        Insert: {
          event_type: string
          id?: string
          ip_address?: string | null
          link_url?: string | null
          scheduled_email_id?: string | null
          tracked_at?: string
          user_agent?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          ip_address?: string | null
          link_url?: string | null
          scheduled_email_id?: string | null
          tracked_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_tracking_scheduled_email_id_fkey"
            columns: ["scheduled_email_id"]
            isOneToOne: false
            referencedRelation: "scheduled_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_events: {
        Row: {
          account_id: string | null
          actor_id: string | null
          actor_key: string | null
          channel: string
          confidence: string | null
          contact_id: string | null
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          lead_candidate_id: string | null
          legacy_signal_id: string | null
          lifecycle_status: string
          normalized_value: Json
          observed_at: string
          occurred_at: string
          provider: string | null
          sanitized: boolean
          source_record_id: string | null
          source_url: string | null
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          actor_id?: string | null
          actor_key?: string | null
          channel: string
          confidence?: string | null
          contact_id?: string | null
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          lead_candidate_id?: string | null
          legacy_signal_id?: string | null
          lifecycle_status?: string
          normalized_value?: Json
          observed_at?: string
          occurred_at: string
          provider?: string | null
          sanitized?: boolean
          source_record_id?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          actor_id?: string | null
          actor_key?: string | null
          channel?: string
          confidence?: string | null
          contact_id?: string | null
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          lead_candidate_id?: string | null
          legacy_signal_id?: string | null
          lifecycle_status?: string
          normalized_value?: Json
          observed_at?: string
          occurred_at?: string
          provider?: string | null
          sanitized?: boolean
          source_record_id?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signal_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      error_log: {
        Row: {
          created_at: string | null
          error_message: string | null
          error_type: string | null
          id: string
          node_name: string | null
          request_payload: Json | null
          route: string | null
          session_id: string | null
          stack_trace: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          error_type?: string | null
          id?: string
          node_name?: string | null
          request_payload?: Json | null
          route?: string | null
          session_id?: string | null
          stack_trace?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          error_type?: string | null
          id?: string
          node_name?: string | null
          request_payload?: Json | null
          route?: string | null
          session_id?: string | null
          stack_trace?: string | null
        }
        Relationships: []
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          calendar_id: string | null
          created_at: string | null
          id: string
          refresh_token: string
          token_expiry: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_id?: string | null
          created_at?: string | null
          id?: string
          refresh_token: string
          token_expiry: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_id?: string | null
          created_at?: string | null
          id?: string
          refresh_token?: string
          token_expiry?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      growth_signal_companies: {
        Row: {
          company_name: string
          created_at: string
          engineering_roles_count: number
          funding_amount: number | null
          funding_date: string | null
          funding_round: string | null
          growth_score: number
          id: string
          industry: string | null
          investors: Json | null
          is_hot_lead: boolean
          last_updated: string
          open_roles_count: number
          sample_job_titles: Json | null
          source_url: string | null
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          engineering_roles_count?: number
          funding_amount?: number | null
          funding_date?: string | null
          funding_round?: string | null
          growth_score?: number
          id?: string
          industry?: string | null
          investors?: Json | null
          is_hot_lead?: boolean
          last_updated?: string
          open_roles_count?: number
          sample_job_titles?: Json | null
          source_url?: string | null
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          engineering_roles_count?: number
          funding_amount?: number | null
          funding_date?: string | null
          funding_round?: string | null
          growth_score?: number
          id?: string
          industry?: string | null
          investors?: Json | null
          is_hot_lead?: boolean
          last_updated?: string
          open_roles_count?: number
          sample_job_titles?: Json | null
          source_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      handoffs: {
        Row: {
          created_at: string | null
          from_agent_id: string | null
          id: string
          task_id: string | null
          task_plan_id: string | null
          to_agent_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          from_agent_id?: string | null
          id?: string
          task_id?: string | null
          task_plan_id?: string | null
          to_agent_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          from_agent_id?: string | null
          id?: string
          task_id?: string | null
          task_plan_id?: string | null
          to_agent_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handoffs_from_agent_id_fkey"
            columns: ["from_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoffs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoffs_task_plan_id_fkey"
            columns: ["task_plan_id"]
            isOneToOne: false
            referencedRelation: "task_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoffs_to_agent_id_fkey"
            columns: ["to_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoffs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      icp_drafts: {
        Row: {
          created_at: string | null
          current_step: number | null
          draft_name: string | null
          form_data: Json | null
          id: string
          is_completed: boolean | null
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          current_step?: number | null
          draft_name?: string | null
          form_data?: Json | null
          id?: string
          is_completed?: boolean | null
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          current_step?: number | null
          draft_name?: string | null
          form_data?: Json | null
          id?: string
          is_completed?: boolean | null
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      icp_lookalike_results: {
        Row: {
          created_at: string | null
          id: string
          match_reasons: Json | null
          match_score: number | null
          profile_data: Json | null
          profile_url: string | null
          session_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          profile_data?: Json | null
          profile_url?: string | null
          session_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          profile_data?: Json | null
          profile_url?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "icp_lookalike_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "icp_lookalike_sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      icp_lookalike_sessions: {
        Row: {
          ai_strategy: string | null
          apify_run_id: string | null
          company_location: Json | null
          company_size: Json | null
          created_at: string | null
          current_phase: string | null
          current_step: number | null
          excluded_signals: Json | null
          feature_weights: Json | null
          firmographic_constraints: Json | null
          hiring_intensity: string | null
          id: string
          industry_names: Json | null
          is_draft: boolean | null
          lookalike_profile_data: Json | null
          lookalike_results: string | null
          lookalike_url: string | null
          mandatory_signals: Json | null
          persona_description: string | null
          profile_name: string | null
          results_count: number | null
          role_family: string | null
          scrape_status: string | null
          search_logic_dna: string | null
          search_results_count: number | null
          session_id: string
          status: string | null
          strong_matches_count: number | null
          target_industry: string | null
          target_industry_name: string | null
          target_results_count: number | null
          technical_execution: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          ai_strategy?: string | null
          apify_run_id?: string | null
          company_location?: Json | null
          company_size?: Json | null
          created_at?: string | null
          current_phase?: string | null
          current_step?: number | null
          excluded_signals?: Json | null
          feature_weights?: Json | null
          firmographic_constraints?: Json | null
          hiring_intensity?: string | null
          id?: string
          industry_names?: Json | null
          is_draft?: boolean | null
          lookalike_profile_data?: Json | null
          lookalike_results?: string | null
          lookalike_url?: string | null
          mandatory_signals?: Json | null
          persona_description?: string | null
          profile_name?: string | null
          results_count?: number | null
          role_family?: string | null
          scrape_status?: string | null
          search_logic_dna?: string | null
          search_results_count?: number | null
          session_id: string
          status?: string | null
          strong_matches_count?: number | null
          target_industry?: string | null
          target_industry_name?: string | null
          target_results_count?: number | null
          technical_execution?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          ai_strategy?: string | null
          apify_run_id?: string | null
          company_location?: Json | null
          company_size?: Json | null
          created_at?: string | null
          current_phase?: string | null
          current_step?: number | null
          excluded_signals?: Json | null
          feature_weights?: Json | null
          firmographic_constraints?: Json | null
          hiring_intensity?: string | null
          id?: string
          industry_names?: Json | null
          is_draft?: boolean | null
          lookalike_profile_data?: Json | null
          lookalike_results?: string | null
          lookalike_url?: string | null
          mandatory_signals?: Json | null
          persona_description?: string | null
          profile_name?: string | null
          results_count?: number | null
          role_family?: string | null
          scrape_status?: string | null
          search_logic_dna?: string | null
          search_results_count?: number | null
          session_id?: string
          status?: string | null
          strong_matches_count?: number | null
          target_industry?: string | null
          target_industry_name?: string | null
          target_results_count?: number | null
          technical_execution?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      icp_saved_searches: {
        Row: {
          backend_session_id: string | null
          created_at: string | null
          draft_id: string | null
          id: string
          search_name: string | null
          status: string | null
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          backend_session_id?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          search_name?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          backend_session_id?: string | null
          created_at?: string | null
          draft_id?: string | null
          id?: string
          search_name?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "icp_saved_searches_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "icp_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      icp_search_results: {
        Row: {
          created_at: string | null
          id: string
          profile_data: Json | null
          profile_url: string | null
          search_id: string | null
          similarity_score: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          profile_data?: Json | null
          profile_url?: string | null
          search_id?: string | null
          similarity_score?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          profile_data?: Json | null
          profile_url?: string | null
          search_id?: string | null
          similarity_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "icp_search_results_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "icp_saved_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_availability: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean | null
          start_time: string
          timezone: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean | null
          start_time: string
          timezone?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean | null
          start_time?: string
          timezone?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      interview_reminders: {
        Row: {
          error_message: string | null
          id: string
          interview_id: string
          reminder_type: Database["public"]["Enums"]["reminder_type"]
          sent_at: string | null
          status: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          interview_id: string
          reminder_type: Database["public"]["Enums"]["reminder_type"]
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          interview_id?: string
          reminder_type?: Database["public"]["Enums"]["reminder_type"]
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_reminders_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_slots: {
        Row: {
          booking_token: string | null
          created_at: string | null
          end_time: string
          id: string
          interview_type_id: string
          recruiter_id: string
          start_time: string
          status: Database["public"]["Enums"]["slot_status"]
          updated_at: string | null
        }
        Insert: {
          booking_token?: string | null
          created_at?: string | null
          end_time: string
          id?: string
          interview_type_id: string
          recruiter_id: string
          start_time: string
          status?: Database["public"]["Enums"]["slot_status"]
          updated_at?: string | null
        }
        Update: {
          booking_token?: string | null
          created_at?: string | null
          end_time?: string
          id?: string
          interview_type_id?: string
          recruiter_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["slot_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_slots_interview_type_id_fkey"
            columns: ["interview_type_id"]
            isOneToOne: false
            referencedRelation: "interview_types"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_types: {
        Row: {
          buffer_minutes: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean | null
          location_type: Database["public"]["Enums"]["interview_location_type"]
          meeting_link_template: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          buffer_minutes?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          location_type?: Database["public"]["Enums"]["interview_location_type"]
          meeting_link_template?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          buffer_minutes?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          location_type?: Database["public"]["Enums"]["interview_location_type"]
          meeting_link_template?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      interviews: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          candidate_email: string
          candidate_id: string | null
          candidate_name: string
          candidate_source:
            | Database["public"]["Enums"]["candidate_source"]
            | null
          created_at: string | null
          duration_minutes: number
          feedback: string | null
          id: string
          interview_type_id: string | null
          location: string | null
          meeting_link: string | null
          notes: string | null
          recruiter_id: string | null
          reminder_15min_sent: boolean | null
          reminder_1h_sent: boolean | null
          reminder_24h_sent: boolean | null
          scheduled_at: string
          slot_id: string | null
          status: Database["public"]["Enums"]["interview_status"]
          updated_at: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          candidate_email: string
          candidate_id?: string | null
          candidate_name: string
          candidate_source?:
            | Database["public"]["Enums"]["candidate_source"]
            | null
          created_at?: string | null
          duration_minutes?: number
          feedback?: string | null
          id?: string
          interview_type_id?: string | null
          location?: string | null
          meeting_link?: string | null
          notes?: string | null
          recruiter_id?: string | null
          reminder_15min_sent?: boolean | null
          reminder_1h_sent?: boolean | null
          reminder_24h_sent?: boolean | null
          scheduled_at: string
          slot_id?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          updated_at?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          candidate_email?: string
          candidate_id?: string | null
          candidate_name?: string
          candidate_source?:
            | Database["public"]["Enums"]["candidate_source"]
            | null
          created_at?: string | null
          duration_minutes?: number
          feedback?: string | null
          id?: string
          interview_type_id?: string | null
          location?: string | null
          meeting_link?: string | null
          notes?: string | null
          recruiter_id?: string | null
          reminder_15min_sent?: boolean | null
          reminder_1h_sent?: boolean | null
          reminder_24h_sent?: boolean | null
          scheduled_at?: string
          slot_id?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interviews_interview_type_id_fkey"
            columns: ["interview_type_id"]
            isOneToOne: false
            referencedRelation: "interview_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "interview_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      job_distribution_status: {
        Row: {
          created_at: string
          error_message: string | null
          external_job_id: string | null
          feed_url: string | null
          id: string
          job_id: string
          last_synced_at: string | null
          platform: string
          posted_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          external_job_id?: string | null
          feed_url?: string | null
          id?: string
          job_id: string
          last_synced_at?: string | null
          platform: string
          posted_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          external_job_id?: string | null
          feed_url?: string | null
          id?: string
          job_id?: string
          last_synced_at?: string | null
          platform?: string
          posted_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_distribution_status_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "screening_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_postings: {
        Row: {
          benefits: string[] | null
          company_name: string
          created_at: string | null
          description: string
          experience_level: string | null
          id: string
          job_type: string
          location: string
          posted_boards: Json | null
          remote_option: string | null
          requirements: string[] | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          benefits?: string[] | null
          company_name: string
          created_at?: string | null
          description: string
          experience_level?: string | null
          id?: string
          job_type?: string
          location: string
          posted_boards?: Json | null
          remote_option?: string | null
          requirements?: string[] | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          benefits?: string[] | null
          company_name?: string
          created_at?: string | null
          description?: string
          experience_level?: string | null
          id?: string
          job_type?: string
          location?: string
          posted_boards?: Json | null
          remote_option?: string | null
          requirements?: string[] | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      job_steps: {
        Row: {
          action: string
          agent_id: string
          attempt_count: number
          capability_type: string
          completed_at: string | null
          created_at: string
          department_id: string
          error: Json | null
          id: string
          input: Json
          job_id: string
          max_attempts: number
          organization_id: string
          output: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_step_status"]
          step_key: string
          step_order: number
          tool_id: string | null
          updated_at: string
        }
        Insert: {
          action: string
          agent_id: string
          attempt_count?: number
          capability_type: string
          completed_at?: string | null
          created_at?: string
          department_id: string
          error?: Json | null
          id?: string
          input?: Json
          job_id: string
          max_attempts?: number
          organization_id: string
          output?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_step_status"]
          step_key: string
          step_order?: number
          tool_id?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          agent_id?: string
          attempt_count?: number
          capability_type?: string
          completed_at?: string | null
          created_at?: string
          department_id?: string
          error?: Json | null
          id?: string
          input?: Json
          job_id?: string
          max_attempts?: number
          organization_id?: string
          output?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_step_status"]
          step_key?: string
          step_order?: number
          tool_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_steps_department_same_org"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "job_steps_job_same_org"
            columns: ["job_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "job_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_steps_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      job_transition_rules: {
        Row: {
          condition: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          from_agent_id: string | null
          from_job_type: string
          from_status: Database["public"]["Enums"]["job_status"]
          id: string
          input_mapping: Json
          organization_id: string
          priority: number
          to_agent_id: string
          to_department_id: string
          to_workflow_type: string
          updated_at: string
        }
        Insert: {
          condition?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          from_agent_id?: string | null
          from_job_type: string
          from_status?: Database["public"]["Enums"]["job_status"]
          id?: string
          input_mapping?: Json
          organization_id: string
          priority?: number
          to_agent_id: string
          to_department_id: string
          to_workflow_type: string
          updated_at?: string
        }
        Update: {
          condition?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          from_agent_id?: string | null
          from_job_type?: string
          from_status?: Database["public"]["Enums"]["job_status"]
          id?: string
          input_mapping?: Json
          organization_id?: string
          priority?: number
          to_agent_id?: string
          to_department_id?: string
          to_workflow_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_transition_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_transition_rules_to_department_same_org"
            columns: ["to_department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      jobs: {
        Row: {
          agent_id: string
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          department_id: string
          error: Json | null
          failed_at: string | null
          id: string
          idempotency_key: string | null
          input: Json
          max_retries: number
          organization_id: string
          output: Json | null
          parent_job_id: string | null
          priority: number
          queued_at: string
          retry_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
          waiting_at: string | null
          workflow_type: string
          workflow_version: string | null
        }
        Insert: {
          agent_id: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          department_id: string
          error?: Json | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          input?: Json
          max_retries?: number
          organization_id: string
          output?: Json | null
          parent_job_id?: string | null
          priority?: number
          queued_at?: string
          retry_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          waiting_at?: string | null
          workflow_type: string
          workflow_version?: string | null
        }
        Update: {
          agent_id?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          error?: Json | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          input?: Json
          max_retries?: number
          organization_id?: string
          output?: Json | null
          parent_job_id?: string | null
          priority?: number
          queued_at?: string
          retry_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
          waiting_at?: string | null
          workflow_type?: string
          workflow_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_department_same_org"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_candidates: {
        Row: {
          account_id: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          evidence_id: string | null
          fit_score: number | null
          id: string
          lead_type: string | null
          next_action: string | null
          plan_id: string | null
          priority: string | null
          raw: Json
          reason: string | null
          signal_id: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          evidence_id?: string | null
          fit_score?: number | null
          id?: string
          lead_type?: string | null
          next_action?: string | null
          plan_id?: string | null
          priority?: string | null
          raw?: Json
          reason?: string | null
          signal_id?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          evidence_id?: string | null
          fit_score?: number | null
          id?: string
          lead_type?: string | null
          next_action?: string | null
          plan_id?: string | null
          priority?: string | null
          raw?: Json
          reason?: string | null
          signal_id?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_candidates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "lead_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signal_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_enrichments: {
        Row: {
          account_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          lead_candidate_id: string | null
          outreach_angle: string | null
          pain_hypothesis: string | null
          raw: Json
          source_url: string | null
          summary: string | null
          trigger: string | null
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          lead_candidate_id?: string | null
          outreach_angle?: string | null
          pain_hypothesis?: string | null
          raw?: Json
          source_url?: string | null
          summary?: string | null
          trigger?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          lead_candidate_id?: string | null
          outreach_angle?: string | null
          pain_hypothesis?: string | null
          raw?: Json
          source_url?: string | null
          summary?: string | null
          trigger?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_enrichments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_enrichments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_enrichments_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_enrichments_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_enrichments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_evidence: {
        Row: {
          account_id: string | null
          actor_id: string | null
          actor_key: string | null
          confidence: string | null
          contact_id: string | null
          created_at: string
          dedupe_key: string
          evidence_kind: string
          id: string
          lead_candidate_id: string | null
          legacy_signal_id: string | null
          lifecycle_status: string
          normalized_value: Json
          observed_at: string
          provider: string | null
          sanitized: boolean
          source_record_id: string | null
          source_url: string | null
          updated_at: string
          verification_status: string
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          actor_id?: string | null
          actor_key?: string | null
          confidence?: string | null
          contact_id?: string | null
          created_at?: string
          dedupe_key: string
          evidence_kind: string
          id?: string
          lead_candidate_id?: string | null
          legacy_signal_id?: string | null
          lifecycle_status?: string
          normalized_value?: Json
          observed_at?: string
          provider?: string | null
          sanitized?: boolean
          source_record_id?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          actor_id?: string | null
          actor_key?: string | null
          confidence?: string | null
          contact_id?: string | null
          created_at?: string
          dedupe_key?: string
          evidence_kind?: string
          id?: string
          lead_candidate_id?: string | null
          legacy_signal_id?: string | null
          lifecycle_status?: string
          normalized_value?: Json
          observed_at?: string
          provider?: string | null
          sanitized?: boolean
          source_record_id?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_evidence_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_evidence_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_evidence_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_evidence_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_evidence_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signal_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_evidence_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_evidence_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_execution_calls: {
        Row: {
          accepted_count: number | null
          actor_id: string | null
          actual_cost_usd: number | null
          attempt_number: number
          capability: string | null
          cost_source: string
          created_at: string
          dataset_id: string | null
          duration_ms: number | null
          estimated_cost_usd: number | null
          execution_owner: string | null
          failure_code: string | null
          failure_message: string | null
          finished_at: string | null
          id: string
          logical_call_key: string
          metadata: Json | null
          next_decision: string | null
          normalized_count: number | null
          plan_id: string | null
          planner_adapter: string | null
          planner_fallback_reason: string | null
          planner_outcome: string | null
          planner_owner: string | null
          provider_id: string
          provider_run_id: string | null
          raw_count: number | null
          reason: string
          record_kind: string
          rejected_count: number | null
          request_input: Json | null
          stage: string
          started_at: string
          status: string
          task_id: string | null
          unique_count: number | null
          workspace_id: string
        }
        Insert: {
          accepted_count?: number | null
          actor_id?: string | null
          actual_cost_usd?: number | null
          attempt_number?: number
          capability?: string | null
          cost_source?: string
          created_at?: string
          dataset_id?: string | null
          duration_ms?: number | null
          estimated_cost_usd?: number | null
          execution_owner?: string | null
          failure_code?: string | null
          failure_message?: string | null
          finished_at?: string | null
          id?: string
          logical_call_key: string
          metadata?: Json | null
          next_decision?: string | null
          normalized_count?: number | null
          plan_id?: string | null
          planner_adapter?: string | null
          planner_fallback_reason?: string | null
          planner_outcome?: string | null
          planner_owner?: string | null
          provider_id: string
          provider_run_id?: string | null
          raw_count?: number | null
          reason: string
          record_kind?: string
          rejected_count?: number | null
          request_input?: Json | null
          stage: string
          started_at?: string
          status?: string
          task_id?: string | null
          unique_count?: number | null
          workspace_id: string
        }
        Update: {
          accepted_count?: number | null
          actor_id?: string | null
          actual_cost_usd?: number | null
          attempt_number?: number
          capability?: string | null
          cost_source?: string
          created_at?: string
          dataset_id?: string | null
          duration_ms?: number | null
          estimated_cost_usd?: number | null
          execution_owner?: string | null
          failure_code?: string | null
          failure_message?: string | null
          finished_at?: string | null
          id?: string
          logical_call_key?: string
          metadata?: Json | null
          next_decision?: string | null
          normalized_count?: number | null
          plan_id?: string | null
          planner_adapter?: string | null
          planner_fallback_reason?: string | null
          planner_outcome?: string | null
          planner_owner?: string | null
          provider_id?: string
          provider_run_id?: string | null
          raw_count?: number | null
          reason?: string
          record_kind?: string
          rejected_count?: number | null
          request_input?: Json | null
          stage?: string
          started_at?: string
          status?: string
          task_id?: string | null
          unique_count?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_execution_calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_imports: {
        Row: {
          campaign_id: string | null
          created_at: string | null
          dnc_rows: number | null
          duplicate_rows: number | null
          errors: Json | null
          filename: string | null
          id: string
          imported_rows: number | null
          invalid_rows: number | null
          skipped_rows: number | null
          status: string | null
          total_rows: number | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string | null
          dnc_rows?: number | null
          duplicate_rows?: number | null
          errors?: Json | null
          filename?: string | null
          id?: string
          imported_rows?: number | null
          invalid_rows?: number | null
          skipped_rows?: number | null
          status?: string | null
          total_rows?: number | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string | null
          dnc_rows?: number | null
          duplicate_rows?: number | null
          errors?: Json | null
          filename?: string | null
          id?: string
          imported_rows?: number | null
          invalid_rows?: number | null
          skipped_rows?: number | null
          status?: string | null
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_imports_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dialer_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_lineages: {
        Row: {
          created_at: string
          current_state: Json | null
          generation: number
          last_progress_at: string | null
          lease_expires_at: string | null
          lease_holder: string | null
          lineage_id: string
          mission_hash: string | null
          state_version: number
          status: string
          terminal_reason: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_state?: Json | null
          generation?: number
          last_progress_at?: string | null
          lease_expires_at?: string | null
          lease_holder?: string | null
          lineage_id: string
          mission_hash?: string | null
          state_version?: number
          status?: string
          terminal_reason?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          current_state?: Json | null
          generation?: number
          last_progress_at?: string | null
          lease_expires_at?: string | null
          lease_holder?: string | null
          lineage_id?: string
          mission_hash?: string | null
          state_version?: number
          status?: string
          terminal_reason?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_lineages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_leads: {
        Row: {
          candidate_name: string
          company: string | null
          contact_email: string | null
          created_at: string
          experience_level: string | null
          id: string
          job_title: string | null
          keywords: string[] | null
          linkedin_url: string | null
          location: string | null
          profile_picture: string | null
          scraped_at: string
          search_criteria: Json | null
          search_id: string | null
          session_id: string | null
          updated_at: string
        }
        Insert: {
          candidate_name: string
          company?: string | null
          contact_email?: string | null
          created_at?: string
          experience_level?: string | null
          id?: string
          job_title?: string | null
          keywords?: string[] | null
          linkedin_url?: string | null
          location?: string | null
          profile_picture?: string | null
          scraped_at?: string
          search_criteria?: Json | null
          search_id?: string | null
          session_id?: string | null
          updated_at?: string
        }
        Update: {
          candidate_name?: string
          company?: string | null
          contact_email?: string | null
          created_at?: string
          experience_level?: string | null
          id?: string
          job_title?: string | null
          keywords?: string[] | null
          linkedin_url?: string | null
          location?: string | null
          profile_picture?: string | null
          scraped_at?: string
          search_criteria?: Json | null
          search_id?: string | null
          session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_leads_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "scraping_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_posts: {
        Row: {
          content_format: string | null
          created_at: string | null
          day: string
          id: string
          image_prompt: string | null
          post_caption: string | null
          status: string | null
          video_idea: string | null
        }
        Insert: {
          content_format?: string | null
          created_at?: string | null
          day: string
          id?: string
          image_prompt?: string | null
          post_caption?: string | null
          status?: string | null
          video_idea?: string | null
        }
        Update: {
          content_format?: string | null
          created_at?: string | null
          day?: string
          id?: string
          image_prompt?: string | null
          post_caption?: string | null
          status?: string | null
          video_idea?: string | null
        }
        Relationships: []
      }
      marketing_videos: {
        Row: {
          ai_motion_graphics: Json | null
          ai_motion_raw_response: string | null
          ai_script: Json | null
          ai_script_raw_response: string | null
          avatar_id: string | null
          completed_at: string | null
          created_at: string | null
          cta_message: string | null
          demo_steps: Json | null
          error_message: string | null
          feature_description: string | null
          feature_name: string
          generation_status: string | null
          heygen_status: string | null
          heygen_video_id: string | null
          id: string
          key_benefits: Json | null
          problem_solved: string | null
          script_estimated_duration: number | null
          script_word_count: number | null
          target_audience: string | null
          thumbnail_url: string | null
          updated_at: string | null
          video_intent: string | null
          video_length: number | null
          video_style: string | null
          video_url: string | null
          voice_id: string | null
        }
        Insert: {
          ai_motion_graphics?: Json | null
          ai_motion_raw_response?: string | null
          ai_script?: Json | null
          ai_script_raw_response?: string | null
          avatar_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          cta_message?: string | null
          demo_steps?: Json | null
          error_message?: string | null
          feature_description?: string | null
          feature_name: string
          generation_status?: string | null
          heygen_status?: string | null
          heygen_video_id?: string | null
          id?: string
          key_benefits?: Json | null
          problem_solved?: string | null
          script_estimated_duration?: number | null
          script_word_count?: number | null
          target_audience?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_intent?: string | null
          video_length?: number | null
          video_style?: string | null
          video_url?: string | null
          voice_id?: string | null
        }
        Update: {
          ai_motion_graphics?: Json | null
          ai_motion_raw_response?: string | null
          ai_script?: Json | null
          ai_script_raw_response?: string | null
          avatar_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          cta_message?: string | null
          demo_steps?: Json | null
          error_message?: string | null
          feature_description?: string | null
          feature_name?: string
          generation_status?: string | null
          heygen_status?: string | null
          heygen_video_id?: string | null
          id?: string
          key_benefits?: Json | null
          problem_solved?: string | null
          script_estimated_duration?: number | null
          script_word_count?: number | null
          target_audience?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_intent?: string | null
          video_length?: number | null
          video_style?: string | null
          video_url?: string | null
          voice_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          agent_slug: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_error: boolean
          metadata: Json
          model_used: string | null
          role: string
          tokens_used: number | null
        }
        Insert: {
          agent_slug?: string | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_error?: boolean
          metadata?: Json
          model_used?: string | null
          role: string
          tokens_used?: number | null
        }
        Update: {
          agent_slug?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_error?: boolean
          metadata?: Json
          model_used?: string | null
          role?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_budgets: {
        Row: {
          created_at: string
          period_ceiling: number
          period_days: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          period_ceiling?: number
          period_days?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          period_ceiling?: number
          period_days?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_runs: {
        Row: {
          created_at: string
          mission_hash: string
          pending_runs: number
          state: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          mission_hash: string
          pending_runs?: number
          state: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          mission_hash?: string
          pending_runs?: number
          state?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_subjects: {
        Row: {
          cadence_minutes: number | null
          claimed_at: string | null
          created_at: string
          enabled: boolean
          id: string
          identifier: string | null
          label: string | null
          last_run_at: string | null
          signals: Json
          subject_kind: string
          timeframe_days: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cadence_minutes?: number | null
          claimed_at?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          identifier?: string | null
          label?: string | null
          last_run_at?: string | null
          signals?: Json
          subject_kind: string
          timeframe_days?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cadence_minutes?: number | null
          claimed_at?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          identifier?: string | null
          label?: string | null
          last_run_at?: string | null
          signals?: Json
          subject_kind?: string
          timeframe_days?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_subjects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_stuck_run_archive: {
        Row: {
          archived_at: string
          id: string
          kind: string
          snapshot: Json
        }
        Insert: {
          archived_at?: string
          id: string
          kind: string
          snapshot: Json
        }
        Update: {
          archived_at?: string
          id?: string
          kind?: string
          snapshot?: Json
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      outreach_activities: {
        Row: {
          action_type: string
          body: string | null
          channel: string
          created_at: string
          executed_date: string | null
          id: string
          lead_id: string
          message_id: string | null
          response_received: boolean | null
          response_text: string | null
          response_type: string | null
          scheduled_date: string | null
          sequence_id: string | null
          source: string | null
          status: Database["public"]["Enums"]["activity_status"] | null
          step_number: number | null
          subject: string | null
        }
        Insert: {
          action_type: string
          body?: string | null
          channel: string
          created_at?: string
          executed_date?: string | null
          id?: string
          lead_id: string
          message_id?: string | null
          response_received?: boolean | null
          response_text?: string | null
          response_type?: string | null
          scheduled_date?: string | null
          sequence_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["activity_status"] | null
          step_number?: number | null
          subject?: string | null
        }
        Update: {
          action_type?: string
          body?: string | null
          channel?: string
          created_at?: string
          executed_date?: string | null
          id?: string
          lead_id?: string
          message_id?: string | null
          response_received?: boolean | null
          response_text?: string | null
          response_type?: string | null
          scheduled_date?: string | null
          sequence_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["activity_status"] | null
          step_number?: number | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "outreach_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_activities_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_daily_queue: {
        Row: {
          action_type: string
          activity_id: string | null
          channel: string
          created_at: string | null
          id: string
          lead_id: string | null
          priority: number | null
          queue_date: string
          snooze_until: string | null
          status: string | null
        }
        Insert: {
          action_type: string
          activity_id?: string | null
          channel: string
          created_at?: string | null
          id?: string
          lead_id?: string | null
          priority?: number | null
          queue_date?: string
          snooze_until?: string | null
          status?: string | null
        }
        Update: {
          action_type?: string
          activity_id?: string | null
          channel?: string
          created_at?: string | null
          id?: string
          lead_id?: string | null
          priority?: number | null
          queue_date?: string
          snooze_until?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_daily_queue_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "outreach_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_daily_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "outreach_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_drafts: {
        Row: {
          account_id: string | null
          approval_id: string | null
          body: string
          channel: string | null
          contact_id: string | null
          created_at: string
          id: string
          lead_candidate_id: string | null
          personalization_notes: string | null
          raw: Json
          status: string
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          approval_id?: string | null
          body: string
          channel?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          lead_candidate_id?: string | null
          personalization_notes?: string | null
          raw?: Json
          status?: string
          subject?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          approval_id?: string | null
          body?: string
          channel?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          lead_candidate_id?: string | null
          personalization_notes?: string | null
          raw?: Json
          status?: string
          subject?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_drafts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_drafts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_drafts_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_drafts_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_error_log: {
        Row: {
          activity_id: string | null
          created_at: string | null
          error_message: string | null
          error_type: string | null
          id: string
          lead_id: string | null
          payload: Json | null
          workflow: string
        }
        Insert: {
          activity_id?: string | null
          created_at?: string | null
          error_message?: string | null
          error_type?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json | null
          workflow: string
        }
        Update: {
          activity_id?: string | null
          created_at?: string | null
          error_message?: string | null
          error_type?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json | null
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_error_log_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "outreach_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_error_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "outreach_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_leads: {
        Row: {
          agency_name: string | null
          closely_connection_status: string | null
          closely_last_event: string | null
          closely_last_event_at: string | null
          closely_synced: boolean | null
          commenter_score: number | null
          company: string
          company_size: string | null
          contact_name: string
          created_at: string
          current_sequence_step: number | null
          discovery_source: string | null
          email: string | null
          founder_about: string | null
          generated_connection_note: string | null
          generated_dm_step2: string | null
          generated_dm_step3: string | null
          generated_dm_step4: string | null
          hiring_detected: boolean | null
          hiring_source: string | null
          id: string
          industry: string | null
          last_touch_date: string | null
          linkedin_slug: string | null
          linkedin_url: string | null
          next_action_date: string | null
          notes: string | null
          open_roles: string | null
          original_comment: string | null
          pain_point_detected: string | null
          recent_news: string | null
          role_count: number | null
          salary_range: string | null
          scrape_status: string | null
          scrape_url: string | null
          scraped_at: string | null
          scraped_careers: string | null
          scraped_homepage: string | null
          sequence_id: string | null
          signals: Json | null
          source_post_author: string | null
          source_post_url: string | null
          status: Database["public"]["Enums"]["lead_status"] | null
          tier: Database["public"]["Enums"]["lead_tier"] | null
          title: string | null
          updated_at: string
          uses_agency: boolean | null
        }
        Insert: {
          agency_name?: string | null
          closely_connection_status?: string | null
          closely_last_event?: string | null
          closely_last_event_at?: string | null
          closely_synced?: boolean | null
          commenter_score?: number | null
          company: string
          company_size?: string | null
          contact_name: string
          created_at?: string
          current_sequence_step?: number | null
          discovery_source?: string | null
          email?: string | null
          founder_about?: string | null
          generated_connection_note?: string | null
          generated_dm_step2?: string | null
          generated_dm_step3?: string | null
          generated_dm_step4?: string | null
          hiring_detected?: boolean | null
          hiring_source?: string | null
          id?: string
          industry?: string | null
          last_touch_date?: string | null
          linkedin_slug?: string | null
          linkedin_url?: string | null
          next_action_date?: string | null
          notes?: string | null
          open_roles?: string | null
          original_comment?: string | null
          pain_point_detected?: string | null
          recent_news?: string | null
          role_count?: number | null
          salary_range?: string | null
          scrape_status?: string | null
          scrape_url?: string | null
          scraped_at?: string | null
          scraped_careers?: string | null
          scraped_homepage?: string | null
          sequence_id?: string | null
          signals?: Json | null
          source_post_author?: string | null
          source_post_url?: string | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tier?: Database["public"]["Enums"]["lead_tier"] | null
          title?: string | null
          updated_at?: string
          uses_agency?: boolean | null
        }
        Update: {
          agency_name?: string | null
          closely_connection_status?: string | null
          closely_last_event?: string | null
          closely_last_event_at?: string | null
          closely_synced?: boolean | null
          commenter_score?: number | null
          company?: string
          company_size?: string | null
          contact_name?: string
          created_at?: string
          current_sequence_step?: number | null
          discovery_source?: string | null
          email?: string | null
          founder_about?: string | null
          generated_connection_note?: string | null
          generated_dm_step2?: string | null
          generated_dm_step3?: string | null
          generated_dm_step4?: string | null
          hiring_detected?: boolean | null
          hiring_source?: string | null
          id?: string
          industry?: string | null
          last_touch_date?: string | null
          linkedin_slug?: string | null
          linkedin_url?: string | null
          next_action_date?: string | null
          notes?: string | null
          open_roles?: string | null
          original_comment?: string | null
          pain_point_detected?: string | null
          recent_news?: string | null
          role_count?: number | null
          salary_range?: string | null
          scrape_status?: string | null
          scrape_url?: string | null
          scraped_at?: string | null
          scraped_careers?: string | null
          scraped_homepage?: string | null
          sequence_id?: string | null
          signals?: Json | null
          source_post_author?: string | null
          source_post_url?: string | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tier?: Database["public"]["Enums"]["lead_tier"] | null
          title?: string | null
          updated_at?: string
          uses_agency?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_leads_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_sequences: {
        Row: {
          created_at: string
          description: string | null
          id: string
          leads_enrolled: number | null
          name: string
          settings: Json | null
          status: Database["public"]["Enums"]["sequence_status"] | null
          steps: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          leads_enrolled?: number | null
          name: string
          settings?: Json | null
          status?: Database["public"]["Enums"]["sequence_status"] | null
          steps?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          leads_enrolled?: number | null
          name?: string
          settings?: Json | null
          status?: Database["public"]["Enums"]["sequence_status"] | null
          steps?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      outreach_settings: {
        Row: {
          created_at: string
          default_cta: string | null
          email_signature: string | null
          id: string
          linkedin_daily_connect_limit: number | null
          linkedin_daily_dm_limit: number | null
          product_context: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          default_cta?: string | null
          email_signature?: string | null
          id?: string
          linkedin_daily_connect_limit?: number | null
          linkedin_daily_dm_limit?: number | null
          product_context?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          default_cta?: string | null
          email_signature?: string | null
          id?: string
          linkedin_daily_connect_limit?: number | null
          linkedin_daily_dm_limit?: number | null
          product_context?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      pricing_history: {
        Row: {
          change_detected: boolean | null
          change_summary: string | null
          competitor_id: string | null
          id: string
          previous_entry_id: string | null
          pricing_data: Json | null
          scraped_at: string | null
          user_id: string
        }
        Insert: {
          change_detected?: boolean | null
          change_summary?: string | null
          competitor_id?: string | null
          id?: string
          previous_entry_id?: string | null
          pricing_data?: Json | null
          scraped_at?: string | null
          user_id: string
        }
        Update: {
          change_detected?: boolean | null
          change_summary?: string | null
          competitor_id?: string | null
          id?: string
          previous_entry_id?: string | null
          pricing_data?: Json | null
          scraped_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_history_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          client_id: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          logo_url: string | null
          role: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          logo_url?: string | null
          role?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          logo_url?: string | null
          role?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      request_understanding_log: {
        Row: {
          category: string | null
          confidence: number | null
          conversation_id: string | null
          created_at: string
          id: string
          message_id: string | null
          metadata: Json | null
          mission_hash: string | null
          objective: string | null
          source: string
          stage0_grades: Json | null
          task_id: string | null
          utterance_hash: string
          utterance_redacted: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          metadata?: Json | null
          mission_hash?: string | null
          objective?: string | null
          source: string
          stage0_grades?: Json | null
          task_id?: string | null
          utterance_hash: string
          utterance_redacted: string
          workspace_id: string
        }
        Update: {
          category?: string | null
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          metadata?: Json | null
          mission_hash?: string | null
          objective?: string | null
          source?: string
          stage0_grades?: Json | null
          task_id?: string | null
          utterance_hash?: string
          utterance_redacted?: string
          workspace_id?: string
        }
        Relationships: []
      }
      resume_analyses: {
        Row: {
          candidate_name: string
          created_at: string
          current_stage: string | null
          email: string | null
          email_clicked: boolean | null
          email_opened: boolean | null
          fit_score: Json | null
          id: string
          justification: string | null
          nurturing_stage: string | null
          overall_factor: Json | null
          processing_time_minutes: number | null
          recruitment_name: string | null
          resume: string | null
          reward_factor: Json | null
          risk_factor: Json | null
          screening_status: string | null
          screening_type: string | null
          status: string | null
          status_updated_at: string | null
          status_updated_by: string | null
          strengths: string | null
          weaknesses: string | null
        }
        Insert: {
          candidate_name: string
          created_at?: string
          current_stage?: string | null
          email?: string | null
          email_clicked?: boolean | null
          email_opened?: boolean | null
          fit_score?: Json | null
          id?: string
          justification?: string | null
          nurturing_stage?: string | null
          overall_factor?: Json | null
          processing_time_minutes?: number | null
          recruitment_name?: string | null
          resume?: string | null
          reward_factor?: Json | null
          risk_factor?: Json | null
          screening_status?: string | null
          screening_type?: string | null
          status?: string | null
          status_updated_at?: string | null
          status_updated_by?: string | null
          strengths?: string | null
          weaknesses?: string | null
        }
        Update: {
          candidate_name?: string
          created_at?: string
          current_stage?: string | null
          email?: string | null
          email_clicked?: boolean | null
          email_opened?: boolean | null
          fit_score?: Json | null
          id?: string
          justification?: string | null
          nurturing_stage?: string | null
          overall_factor?: Json | null
          processing_time_minutes?: number | null
          recruitment_name?: string | null
          resume?: string | null
          reward_factor?: Json | null
          risk_factor?: Json | null
          screening_status?: string | null
          screening_type?: string | null
          status?: string | null
          status_updated_at?: string | null
          status_updated_by?: string | null
          strengths?: string | null
          weaknesses?: string | null
        }
        Relationships: []
      }
      saved_outputs: {
        Row: {
          body: string | null
          conversation_id: string | null
          created_at: string
          id: string
          plan_id: string | null
          raw: Json
          task_id: string | null
          title: string | null
          type: string | null
          workspace_id: string
        }
        Insert: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          plan_id?: string | null
          raw?: Json
          task_id?: string | null
          title?: string | null
          type?: string | null
          workspace_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          plan_id?: string | null
          raw?: Json
          task_id?: string | null
          title?: string | null
          type?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_outputs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_emails: {
        Row: {
          candidate_email: string
          candidate_id: string | null
          candidate_name: string
          company_name: string | null
          content: string | null
          created_at: string | null
          delay_days: number | null
          fit_score: number | null
          folder_name: string | null
          id: string
          recruitment_name: string | null
          scheduled_send_time: string | null
          send_time: string | null
          send_time_end: string | null
          send_time_utc: string
          sender_name: string | null
          sequence_created_at: string | null
          sequence_name: string | null
          status: string | null
          step_number: number
          subject: string | null
          timezone: string | null
          user_id: string | null
          user_timezone: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          candidate_email: string
          candidate_id?: string | null
          candidate_name: string
          company_name?: string | null
          content?: string | null
          created_at?: string | null
          delay_days?: number | null
          fit_score?: number | null
          folder_name?: string | null
          id?: string
          recruitment_name?: string | null
          scheduled_send_time?: string | null
          send_time?: string | null
          send_time_end?: string | null
          send_time_utc: string
          sender_name?: string | null
          sequence_created_at?: string | null
          sequence_name?: string | null
          status?: string | null
          step_number: number
          subject?: string | null
          timezone?: string | null
          user_id?: string | null
          user_timezone?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          candidate_email?: string
          candidate_id?: string | null
          candidate_name?: string
          company_name?: string | null
          content?: string | null
          created_at?: string | null
          delay_days?: number | null
          fit_score?: number | null
          folder_name?: string | null
          id?: string
          recruitment_name?: string | null
          scheduled_send_time?: string | null
          send_time?: string | null
          send_time_end?: string | null
          send_time_utc?: string
          sender_name?: string | null
          sequence_created_at?: string | null
          sequence_name?: string | null
          status?: string | null
          step_number?: number
          subject?: string | null
          timezone?: string | null
          user_id?: string | null
          user_timezone?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      scraping_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          name: string | null
          search_criteria: Json
          status: string | null
          total_leads: number | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          search_criteria: Json
          status?: string | null
          total_leads?: number | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          search_criteria?: Json
          status?: string | null
          total_leads?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      screening_applications: {
        Row: {
          access_token: string
          candidate_edits: Json | null
          completed_at: string | null
          created_at: string
          extracted_data: Json | null
          id: string
          interview_questions: Json | null
          is_archived: boolean | null
          job_id: string
          match_category: string | null
          match_score: number | null
          recruiter_notes: string | null
          recruiter_status: string | null
          red_flags: Json | null
          resume_url: string | null
          screening_answers: Json | null
          status: string
          strengths: Json | null
          tab_switches: number
          total_time_seconds: number
        }
        Insert: {
          access_token?: string
          candidate_edits?: Json | null
          completed_at?: string | null
          created_at?: string
          extracted_data?: Json | null
          id?: string
          interview_questions?: Json | null
          is_archived?: boolean | null
          job_id: string
          match_category?: string | null
          match_score?: number | null
          recruiter_notes?: string | null
          recruiter_status?: string | null
          red_flags?: Json | null
          resume_url?: string | null
          screening_answers?: Json | null
          status?: string
          strengths?: Json | null
          tab_switches?: number
          total_time_seconds?: number
        }
        Update: {
          access_token?: string
          candidate_edits?: Json | null
          completed_at?: string | null
          created_at?: string
          extracted_data?: Json | null
          id?: string
          interview_questions?: Json | null
          is_archived?: boolean | null
          job_id?: string
          match_category?: string | null
          match_score?: number | null
          recruiter_notes?: string | null
          recruiter_status?: string | null
          red_flags?: Json | null
          resume_url?: string | null
          screening_answers?: Json | null
          status?: string
          strengths?: Json | null
          tab_switches?: number
          total_time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "screening_applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "screening_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_behavioral_analysis: {
        Row: {
          ai_confidence_score: number | null
          analysis_completed_at: string | null
          candidate_id: string
          clarity_evidence: Json | null
          clarity_score: number | null
          consistency_evidence: Json | null
          consistency_score: number | null
          created_at: string | null
          emotional_evidence: Json | null
          emotional_regulation_score: number | null
          green_flags: Json | null
          id: string
          overall_risk_level:
            | Database["public"]["Enums"]["behavioral_risk_level"]
            | null
          ownership_evidence: Json | null
          ownership_score: number | null
          red_flags: Json | null
          risk_summary: string | null
          session_id: string
          updated_at: string | null
        }
        Insert: {
          ai_confidence_score?: number | null
          analysis_completed_at?: string | null
          candidate_id: string
          clarity_evidence?: Json | null
          clarity_score?: number | null
          consistency_evidence?: Json | null
          consistency_score?: number | null
          created_at?: string | null
          emotional_evidence?: Json | null
          emotional_regulation_score?: number | null
          green_flags?: Json | null
          id?: string
          overall_risk_level?:
            | Database["public"]["Enums"]["behavioral_risk_level"]
            | null
          ownership_evidence?: Json | null
          ownership_score?: number | null
          red_flags?: Json | null
          risk_summary?: string | null
          session_id: string
          updated_at?: string | null
        }
        Update: {
          ai_confidence_score?: number | null
          analysis_completed_at?: string | null
          candidate_id?: string
          clarity_evidence?: Json | null
          clarity_score?: number | null
          consistency_evidence?: Json | null
          consistency_score?: number | null
          created_at?: string | null
          emotional_evidence?: Json | null
          emotional_regulation_score?: number | null
          green_flags?: Json | null
          id?: string
          overall_risk_level?:
            | Database["public"]["Enums"]["behavioral_risk_level"]
            | null
          ownership_evidence?: Json | null
          ownership_score?: number | null
          red_flags?: Json | null
          risk_summary?: string | null
          session_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "screening_behavioral_analysis_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "resume_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_behavioral_analysis_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "adaptive_screening_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_conversation_logs: {
        Row: {
          behavioral_signals_detected: Json | null
          content: string
          created_at: string | null
          id: string
          message_index: number
          response_time_seconds: number | null
          role: string
          scenario_id: string | null
          session_id: string
        }
        Insert: {
          behavioral_signals_detected?: Json | null
          content: string
          created_at?: string | null
          id?: string
          message_index: number
          response_time_seconds?: number | null
          role: string
          scenario_id?: string | null
          session_id: string
        }
        Update: {
          behavioral_signals_detected?: Json | null
          content?: string
          created_at?: string | null
          id?: string
          message_index?: number
          response_time_seconds?: number | null
          role?: string
          scenario_id?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_conversation_logs_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "screening_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_conversation_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "adaptive_screening_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_jobs: {
        Row: {
          company_name: string
          created_at: string
          custom_questions: Json | null
          description: string
          education_requirement: string
          id: string
          required_skills: string[]
          required_years: number
          salary_max: number | null
          salary_min: number | null
          slug: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name?: string
          created_at?: string
          custom_questions?: Json | null
          description?: string
          education_requirement?: string
          id?: string
          required_skills?: string[]
          required_years?: number
          salary_max?: number | null
          salary_min?: number | null
          slug: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          custom_questions?: Json | null
          description?: string
          education_requirement?: string
          id?: string
          required_skills?: string[]
          required_years?: number
          salary_max?: number | null
          salary_min?: number | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      screening_scenarios: {
        Row: {
          category: Database["public"]["Enums"]["scenario_category"]
          created_at: string | null
          difficulty_level: number | null
          follow_up_prompts: Json | null
          id: string
          is_active: boolean | null
          name: string
          scenario_prompt: string
          target_signals: Json | null
          updated_at: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["scenario_category"]
          created_at?: string | null
          difficulty_level?: number | null
          follow_up_prompts?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          scenario_prompt: string
          target_signals?: Json | null
          updated_at?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["scenario_category"]
          created_at?: string | null
          difficulty_level?: number | null
          follow_up_prompts?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          scenario_prompt?: string
          target_signals?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      screening_template_questions: {
        Row: {
          category: string
          created_at: string | null
          difficulty_level: number | null
          follow_up_prompts: Json | null
          id: string
          is_custom: boolean | null
          question_text: string
          scenario_id: string | null
          sort_order: number | null
          template_id: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          difficulty_level?: number | null
          follow_up_prompts?: Json | null
          id?: string
          is_custom?: boolean | null
          question_text: string
          scenario_id?: string | null
          sort_order?: number | null
          template_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          difficulty_level?: number | null
          follow_up_prompts?: Json | null
          id?: string
          is_custom?: boolean | null
          question_text?: string
          scenario_id?: string | null
          sort_order?: number | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "screening_template_questions_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "screening_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_template_questions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "screening_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          role_focus: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          role_focus?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          role_focus?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      secret_connections: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          name: string
          organization_id: string
          provider_slug: string
          secret_ref: string
          secret_scope: string
          status: Database["public"]["Enums"]["secret_connection_status"]
          tool_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          name: string
          organization_id: string
          provider_slug: string
          secret_ref: string
          secret_scope?: string
          status?: Database["public"]["Enums"]["secret_connection_status"]
          tool_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          name?: string
          organization_id?: string
          provider_slug?: string
          secret_ref?: string
          secret_scope?: string
          status?: Database["public"]["Enums"]["secret_connection_status"]
          tool_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "secret_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secret_connections_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_cluster_relevance: {
        Row: {
          adjusted_priority: number
          cluster_key: string
          deterministic_priority: number
          evidence_event_ids: string[]
          judged_at: string
          model: string | null
          relevance: string
          source: string
          timely: boolean
          why_it_matters: string | null
          why_now: string | null
          workspace_id: string
        }
        Insert: {
          adjusted_priority: number
          cluster_key: string
          deterministic_priority: number
          evidence_event_ids?: string[]
          judged_at?: string
          model?: string | null
          relevance: string
          source: string
          timely?: boolean
          why_it_matters?: string | null
          why_now?: string | null
          workspace_id: string
        }
        Update: {
          adjusted_priority?: number
          cluster_key?: string
          deterministic_priority?: number
          evidence_event_ids?: string[]
          judged_at?: string
          model?: string | null
          relevance?: string
          source?: string
          timely?: boolean
          why_it_matters?: string | null
          why_now?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_cluster_relevance_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_event_evidence: {
        Row: {
          actor_id: string | null
          actor_key: string | null
          confidence: string | null
          created_at: string
          evidence_fingerprint: string
          id: string
          legacy_signal_id: string | null
          normalized_value: Json
          observed_at: string
          provider: string | null
          sanitized: boolean
          signal_event_id: string
          source_record_id: string | null
          source_url: string | null
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_key?: string | null
          confidence?: string | null
          created_at?: string
          evidence_fingerprint: string
          id?: string
          legacy_signal_id?: string | null
          normalized_value?: Json
          observed_at?: string
          provider?: string | null
          sanitized?: boolean
          signal_event_id: string
          source_record_id?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          actor_key?: string | null
          confidence?: string | null
          created_at?: string
          evidence_fingerprint?: string
          id?: string
          legacy_signal_id?: string | null
          normalized_value?: Json
          observed_at?: string
          provider?: string | null
          sanitized?: boolean
          signal_event_id?: string
          source_record_id?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_event_evidence_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signal_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_event_evidence_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_event_evidence_parent_fk"
            columns: ["signal_event_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "signal_events"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "signal_event_evidence_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_events: {
        Row: {
          account_id: string | null
          actor_id: string | null
          actor_key: string | null
          confidence: string | null
          contact_id: string | null
          created_at: string
          dedupe_key: string
          evidence_category: string | null
          expires_at: string | null
          freshness: string | null
          id: string
          lead_candidate_id: string | null
          legacy_signal_id: string | null
          lifecycle_status: string
          listing_status: string | null
          normalized_value: Json
          observed_at: string
          occurred_at: string | null
          occurred_at_basis: string
          origin: string
          provider: string | null
          sanitized: boolean
          signal_category: string
          signal_type: string
          source_url: string | null
          subject_key: string | null
          subject_type: string | null
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          actor_id?: string | null
          actor_key?: string | null
          confidence?: string | null
          contact_id?: string | null
          created_at?: string
          dedupe_key: string
          evidence_category?: string | null
          expires_at?: string | null
          freshness?: string | null
          id?: string
          lead_candidate_id?: string | null
          legacy_signal_id?: string | null
          lifecycle_status?: string
          listing_status?: string | null
          normalized_value?: Json
          observed_at?: string
          occurred_at?: string | null
          occurred_at_basis?: string
          origin: string
          provider?: string | null
          sanitized?: boolean
          signal_category: string
          signal_type: string
          source_url?: string | null
          subject_key?: string | null
          subject_type?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          actor_id?: string | null
          actor_key?: string | null
          confidence?: string | null
          contact_id?: string | null
          created_at?: string
          dedupe_key?: string
          evidence_category?: string | null
          expires_at?: string | null
          freshness?: string | null
          id?: string
          lead_candidate_id?: string | null
          legacy_signal_id?: string | null
          lifecycle_status?: string
          listing_status?: string | null
          normalized_value?: Json
          observed_at?: string
          occurred_at?: string | null
          occurred_at_basis?: string
          origin?: string
          provider?: string | null
          sanitized?: boolean
          signal_category?: string
          signal_type?: string
          source_url?: string | null
          subject_key?: string | null
          subject_type?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signal_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_legacy_signal_id_fkey"
            columns: ["legacy_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_reviews: {
        Row: {
          created_at: string
          id: string
          ignored_at: string | null
          lead_candidate_id: string | null
          note: string | null
          reviewed_at: string | null
          saved_at: string | null
          signal_id: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ignored_at?: string | null
          lead_candidate_id?: string | null
          note?: string | null
          reviewed_at?: string | null
          saved_at?: string | null
          signal_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ignored_at?: string | null
          lead_candidate_id?: string | null
          note?: string | null
          reviewed_at?: string | null
          saved_at?: string | null
          signal_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_reviews_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_reviews_lead_candidate_id_fkey"
            columns: ["lead_candidate_id"]
            isOneToOne: false
            referencedRelation: "lead_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_reviews_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signal_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_reviews_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_reviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          confidence: number | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          plan_id: string | null
          raw: Json
          signal_label: string | null
          signal_type: string | null
          source: string | null
          source_url: string | null
          task_id: string | null
          title: string | null
          tool_call_id: string | null
          workspace_id: string
        }
        Insert: {
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          plan_id?: string | null
          raw?: Json
          signal_label?: string | null
          signal_type?: string | null
          source?: string | null
          source_url?: string | null
          task_id?: string | null
          title?: string | null
          tool_call_id?: string | null
          workspace_id: string
        }
        Update: {
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          plan_id?: string | null
          raw?: Json
          signal_label?: string | null
          signal_type?: string | null
          source?: string | null
          source_url?: string | null
          task_id?: string | null
          title?: string | null
          tool_call_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sp_outreach_leads_scored: {
        Row: {
          company: string | null
          company_description: string | null
          company_email: string | null
          company_phone: string | null
          company_size: string | null
          company_website: string | null
          created_at: string
          dm_text: string | null
          enriched_at: string | null
          funding_stage: string | null
          headline: string | null
          id: string
          linkedin_url: string
          name: string
          open_roles: string | null
          score: number
          scraped_at: string
          signals: string | null
          source: string
          status: string
          tech_stack: string | null
          tier: string
        }
        Insert: {
          company?: string | null
          company_description?: string | null
          company_email?: string | null
          company_phone?: string | null
          company_size?: string | null
          company_website?: string | null
          created_at?: string
          dm_text?: string | null
          enriched_at?: string | null
          funding_stage?: string | null
          headline?: string | null
          id?: string
          linkedin_url: string
          name: string
          open_roles?: string | null
          score: number
          scraped_at?: string
          signals?: string | null
          source?: string
          status?: string
          tech_stack?: string | null
          tier: string
        }
        Update: {
          company?: string | null
          company_description?: string | null
          company_email?: string | null
          company_phone?: string | null
          company_size?: string | null
          company_website?: string | null
          created_at?: string
          dm_text?: string | null
          enriched_at?: string | null
          funding_stage?: string | null
          headline?: string | null
          id?: string
          linkedin_url?: string
          name?: string
          open_roles?: string | null
          score?: number
          scraped_at?: string
          signals?: string | null
          source?: string
          status?: string
          tech_stack?: string | null
          tier?: string
        }
        Relationships: []
      }
      sp_wellfound_leads: {
        Row: {
          applicant_count: number | null
          company_description: string | null
          company_name: string | null
          company_url: string | null
          company_website: string | null
          created_at: string | null
          date_posted: string | null
          decision_maker_linkedin: string | null
          decision_maker_name: string | null
          decision_maker_title: string | null
          dm_sent: boolean | null
          dm_sent_at: string | null
          enrichment_source: string | null
          funding_amount: string | null
          funding_stage: string | null
          id: string
          job_title: string | null
          location: string | null
          open_roles_count: number | null
          personalized_dm: string | null
          remote: boolean | null
          reply_received: boolean | null
          reply_text: string | null
          salary_range: string | null
          score: number | null
          score_breakdown: Json | null
          scrape_date: string | null
          source: string | null
          team_size: string | null
          tech_stack: string[] | null
          tier: string | null
        }
        Insert: {
          applicant_count?: number | null
          company_description?: string | null
          company_name?: string | null
          company_url?: string | null
          company_website?: string | null
          created_at?: string | null
          date_posted?: string | null
          decision_maker_linkedin?: string | null
          decision_maker_name?: string | null
          decision_maker_title?: string | null
          dm_sent?: boolean | null
          dm_sent_at?: string | null
          enrichment_source?: string | null
          funding_amount?: string | null
          funding_stage?: string | null
          id?: string
          job_title?: string | null
          location?: string | null
          open_roles_count?: number | null
          personalized_dm?: string | null
          remote?: boolean | null
          reply_received?: boolean | null
          reply_text?: string | null
          salary_range?: string | null
          score?: number | null
          score_breakdown?: Json | null
          scrape_date?: string | null
          source?: string | null
          team_size?: string | null
          tech_stack?: string[] | null
          tier?: string | null
        }
        Update: {
          applicant_count?: number | null
          company_description?: string | null
          company_name?: string | null
          company_url?: string | null
          company_website?: string | null
          created_at?: string | null
          date_posted?: string | null
          decision_maker_linkedin?: string | null
          decision_maker_name?: string | null
          decision_maker_title?: string | null
          dm_sent?: boolean | null
          dm_sent_at?: string | null
          enrichment_source?: string | null
          funding_amount?: string | null
          funding_stage?: string | null
          id?: string
          job_title?: string | null
          location?: string | null
          open_roles_count?: number | null
          personalized_dm?: string | null
          remote?: boolean | null
          reply_received?: boolean | null
          reply_text?: string | null
          salary_range?: string | null
          score?: number | null
          score_breakdown?: Json | null
          scrape_date?: string | null
          source?: string | null
          team_size?: string | null
          tech_stack?: string[] | null
          tier?: string | null
        }
        Relationships: []
      }
      talent_signals: {
        Row: {
          action_type: string | null
          actioned_at: string | null
          candidate_company: string | null
          candidate_email: string | null
          candidate_linkedin_url: string | null
          candidate_location: string | null
          candidate_name: string | null
          candidate_photo_url: string | null
          candidate_title: string | null
          created_at: string | null
          id: string
          is_actioned: boolean | null
          is_dismissed: boolean | null
          matched_job_id: string | null
          role_match_score: number | null
          signal_detected_at: string | null
          signal_score: number | null
          signal_source_url: string | null
          signal_summary: string | null
          signal_title: string
          signal_type: string
          tier: string | null
          user_id: string
        }
        Insert: {
          action_type?: string | null
          actioned_at?: string | null
          candidate_company?: string | null
          candidate_email?: string | null
          candidate_linkedin_url?: string | null
          candidate_location?: string | null
          candidate_name?: string | null
          candidate_photo_url?: string | null
          candidate_title?: string | null
          created_at?: string | null
          id?: string
          is_actioned?: boolean | null
          is_dismissed?: boolean | null
          matched_job_id?: string | null
          role_match_score?: number | null
          signal_detected_at?: string | null
          signal_score?: number | null
          signal_source_url?: string | null
          signal_summary?: string | null
          signal_title: string
          signal_type: string
          tier?: string | null
          user_id: string
        }
        Update: {
          action_type?: string | null
          actioned_at?: string | null
          candidate_company?: string | null
          candidate_email?: string | null
          candidate_linkedin_url?: string | null
          candidate_location?: string | null
          candidate_name?: string | null
          candidate_photo_url?: string | null
          candidate_title?: string | null
          created_at?: string | null
          id?: string
          is_actioned?: boolean | null
          is_dismissed?: boolean | null
          matched_job_id?: string | null
          role_match_score?: number | null
          signal_detected_at?: string | null
          signal_score?: number | null
          signal_source_url?: string | null
          signal_summary?: string | null
          signal_title?: string
          signal_type?: string
          tier?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_signals_matched_job_id_fkey"
            columns: ["matched_job_id"]
            isOneToOne: false
            referencedRelation: "screening_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      task_plans: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          current_step: number | null
          goal: string | null
          id: string
          idempotency_key: string | null
          plan: Json | null
          plan_summary: string | null
          status: string | null
          steps: Json | null
          updated_at: string | null
          user_id: string | null
          user_instruction: string
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_step?: number | null
          goal?: string | null
          id?: string
          idempotency_key?: string | null
          plan?: Json | null
          plan_summary?: string | null
          status?: string | null
          steps?: Json | null
          updated_at?: string | null
          user_id?: string | null
          user_instruction: string
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_step?: number | null
          goal?: string | null
          id?: string
          idempotency_key?: string | null
          plan?: Json | null
          plan_summary?: string | null
          status?: string | null
          steps?: Json | null
          updated_at?: string | null
          user_id?: string | null
          user_instruction?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          agent_id: string | null
          agent_slug: string | null
          checkpoint_version: number
          completed_at: string | null
          continuation_claim_expires_at: string | null
          continuation_claim_id: string | null
          continuation_claimed_at: string | null
          created_at: string | null
          depends_on: string[]
          description: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          input: string | null
          lineage_id: string | null
          output: string | null
          parent_task_id: string | null
          payload: Json
          plan_id: string | null
          result: Json
          started_at: string | null
          status: string | null
          step_index: number | null
          task_plan_id: string | null
          tokens_in: number | null
          tokens_out: number | null
          updated_at: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_slug?: string | null
          checkpoint_version?: number
          completed_at?: string | null
          continuation_claim_expires_at?: string | null
          continuation_claim_id?: string | null
          continuation_claimed_at?: string | null
          created_at?: string | null
          depends_on?: string[]
          description?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: string | null
          lineage_id?: string | null
          output?: string | null
          parent_task_id?: string | null
          payload?: Json
          plan_id?: string | null
          result?: Json
          started_at?: string | null
          status?: string | null
          step_index?: number | null
          task_plan_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_slug?: string | null
          checkpoint_version?: number
          completed_at?: string | null
          continuation_claim_expires_at?: string | null
          continuation_claim_id?: string | null
          continuation_claimed_at?: string | null
          created_at?: string | null
          depends_on?: string[]
          description?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: string | null
          lineage_id?: string | null
          output?: string | null
          parent_task_id?: string | null
          payload?: Json
          plan_id?: string | null
          result?: Json
          started_at?: string | null
          status?: string | null
          step_index?: number | null
          task_plan_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lineage_id_fkey"
            columns: ["lineage_id"]
            isOneToOne: false
            referencedRelation: "lead_lineages"
            referencedColumns: ["lineage_id"]
          },
          {
            foreignKeyName: "tasks_task_plan_id_fkey"
            columns: ["task_plan_id"]
            isOneToOne: false
            referencedRelation: "task_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      telnyx_events: {
        Row: {
          call_control_id: string | null
          client_state: string | null
          created_at: string
          event_id: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          call_control_id?: string | null
          client_state?: string | null
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          payload: Json
        }
        Update: {
          call_control_id?: string | null
          client_state?: string | null
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      tool_calls: {
        Row: {
          agent_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          input_json: Json | null
          output_json: Json | null
          plan_id: string | null
          provider: string
          started_at: string | null
          status: string
          task_id: string | null
          tool_name: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          input_json?: Json | null
          output_json?: Json | null
          plan_id?: string | null
          provider: string
          started_at?: string | null
          status?: string
          task_id?: string | null
          tool_name: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          input_json?: Json | null
          output_json?: Json | null
          plan_id?: string | null
          provider?: string
          started_at?: string | null
          status?: string
          task_id?: string | null
          tool_name?: string
          workspace_id?: string
        }
        Relationships: []
      }
      tools: {
        Row: {
          capability_types: string[]
          config_schema: Json
          created_at: string
          enabled: boolean
          id: string
          metadata: Json
          name: string
          provider: string
          slug: string
          supported_actions: Json
          updated_at: string
        }
        Insert: {
          capability_types?: string[]
          config_schema?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          metadata?: Json
          name: string
          provider: string
          slug: string
          supported_actions?: Json
          updated_at?: string
        }
        Update: {
          capability_types?: string[]
          config_schema?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          metadata?: Json
          name?: string
          provider?: string
          slug?: string
          supported_actions?: Json
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          role: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          role?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credit_balances: {
        Row: {
          balance_credits: number
          created_at: string
          plan_id: string
          reserved_credits: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          balance_credits?: number
          created_at?: string
          plan_id?: string
          reserved_credits?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          balance_credits?: number
          created_at?: string
          plan_id?: string
          reserved_credits?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credit_balances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_sources: {
        Row: {
          created_at: string
          id: string
          label: string | null
          source_type: string
          status: string
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          company_brain: string | null
          created_at: string | null
          created_by: string | null
          daily_run_limit: number | null
          id: string
          name: string
          plan: string | null
          slug: string | null
          tokens_used_today: number | null
          updated_at: string | null
        }
        Insert: {
          company_brain?: string | null
          created_at?: string | null
          created_by?: string | null
          daily_run_limit?: number | null
          id?: string
          name: string
          plan?: string | null
          slug?: string | null
          tokens_used_today?: number | null
          updated_at?: string | null
        }
        Update: {
          company_brain?: string | null
          created_at?: string | null
          created_by?: string | null
          daily_run_limit?: number | null
          id?: string
          name?: string
          plan?: string | null
          slug?: string | null
          tokens_used_today?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      company_headcount_series: {
        Row: {
          absolute_change: number | null
          canonical_domain: string | null
          company_key: string | null
          company_name: string | null
          days_since_previous: number | null
          employee_count: number | null
          linkedin_company_url: string | null
          observed_at: string | null
          percent_change: number | null
          previous_employee_count: number | null
          previous_observed_at: string | null
          source: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      lead_model_calls: {
        Row: {
          actual_cost_usd: number | null
          attempt_number: number | null
          cached_input_tokens: number | null
          cost_source: string | null
          estimated_cost_usd: number | null
          failure_code: string | null
          failure_message: string | null
          fallback_reason: string | null
          finished_at: string | null
          id: string | null
          input_tokens: number | null
          latency_ms: number | null
          logical_call_key: string | null
          model: string | null
          output_tokens: number | null
          plan_id: string | null
          reasoning_effort: string | null
          role: string | null
          started_at: string | null
          status: string | null
          task_id: string | null
          workspace_id: string | null
        }
        Insert: {
          actual_cost_usd?: number | null
          attempt_number?: number | null
          cached_input_tokens?: never
          cost_source?: string | null
          estimated_cost_usd?: number | null
          failure_code?: string | null
          failure_message?: string | null
          fallback_reason?: never
          finished_at?: string | null
          id?: string | null
          input_tokens?: never
          latency_ms?: number | null
          logical_call_key?: string | null
          model?: never
          output_tokens?: never
          plan_id?: string | null
          reasoning_effort?: never
          role?: never
          started_at?: string | null
          status?: string | null
          task_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          actual_cost_usd?: number | null
          attempt_number?: number | null
          cached_input_tokens?: never
          cost_source?: string | null
          estimated_cost_usd?: number | null
          failure_code?: string | null
          failure_message?: string | null
          fallback_reason?: never
          finished_at?: string | null
          id?: string | null
          input_tokens?: never
          latency_ms?: number | null
          logical_call_key?: string | null
          model?: never
          output_tokens?: never
          plan_id?: string | null
          reasoning_effort?: never
          role?: never
          started_at?: string | null
          status?: string | null
          task_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_execution_calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_results: {
        Row: {
          account_id: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string | null
          fit_score: number | null
          id: string | null
          lead_type: string | null
          next_action: string | null
          plan_id: string | null
          priority: string | null
          reason: string | null
          signal_id: string | null
          status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          fit_score?: number | null
          id?: string | null
          lead_type?: string | null
          next_action?: string | null
          plan_id?: string | null
          priority?: string | null
          reason?: string | null
          signal_id?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          fit_score?: number | null
          id?: string | null
          lead_type?: string | null
          next_action?: string | null
          plan_id?: string | null
          priority?: string | null
          reason?: string | null
          signal_id?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_candidates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signal_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_channel_performance: {
        Row: {
          channel: string | null
          negative_replies: number | null
          positive_replies: number | null
          reply_rate_pct: number | null
          total_replies: number | null
          total_sent: number | null
        }
        Relationships: []
      }
      outreach_dashboard: {
        Row: {
          closed: number | null
          dead: number | null
          in_sequence: number | null
          linkedin_connected: number | null
          linkedin_pending: number | null
          meetings_booked: number | null
          meetings_this_week: number | null
          new_leads_this_week: number | null
          not_started: number | null
          replied: number | null
          replies_this_week: number | null
          total_leads: number | null
        }
        Relationships: []
      }
      signal_feed: {
        Row: {
          confidence: number | null
          created_at: string | null
          id: string | null
          signal_type: string | null
          source_url: string | null
          summary: string | null
          title: string | null
          verified: boolean | null
          workspace_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          signal_type?: string | null
          source_url?: string | null
          summary?: string | null
          title?: string | null
          verified?: never
          workspace_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          signal_type?: string | null
          source_url?: string | null
          summary?: string | null
          title?: string | null
          verified?: never
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_lineage_lease: {
        Args: {
          p_holder_task_id: string
          p_lease_seconds?: number
          p_lineage_id: string
          p_mission_hash?: string
          p_workspace_id: string
        }
        Returns: {
          acquired: boolean
          current_state: Json
          generation: number
          held_by: string
          held_until: string
          reason: string
          state_version: number
        }[]
      }
      cancel_lineage: {
        Args: {
          p_lineage_id: string
          p_reason?: string
          p_workspace_id: string
        }
        Returns: {
          cancelled: boolean
          prior_status: string
          reason: string
        }[]
      }
      claim_sourcing_continuation: {
        Args: {
          p_claim_id: string
          p_lease_seconds?: number
          p_task_id: string
          p_workspace_id: string
        }
        Returns: {
          checkpoint_version: number
          claimed: boolean
          held_by: string
          held_until: string
          reason: string
          task_id: string
        }[]
      }
      credits_finalize: {
        Args: {
          p_actual: number
          p_reason?: string
          p_status: string
          p_transaction_id: string
        }
        Returns: Json
      }
      credits_grant: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_plan_id?: string
          p_reason?: string
          p_workspace: string
        }
        Returns: Json
      }
      credits_release_stale: {
        Args: { p_older_than?: string }
        Returns: number
      }
      credits_reserve: {
        Args: {
          p_amount: number
          p_company_key?: string
          p_idempotency_key: string
          p_kind: string
          p_task_id?: string
          p_workspace: string
        }
        Returns: Json
      }
      dev_table_counts: { Args: never; Returns: Json }
      get_client_branding: {
        Args: { client_uuid: string }
        Returns: {
          accent_color: string
          client_name: string
          company_display_name: string
          id: string
          logo_url: string
          primary_color: string
          secondary_color: string
        }[]
      }
      get_room_member_profiles: {
        Args: { room_uuid: string }
        Returns: {
          full_name: string
          logo_url: string
          user_id: string
        }[]
      }
      get_user_client_id: { Args: { user_uuid: string }; Returns: string }
      has_org_role: {
        Args: { org_uuid: string; role_names: string[] }
        Returns: boolean
      }
      has_workspace_access: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      increment_tokens: {
        Args: { amount: number; workspace_id_input: string }
        Returns: undefined
      }
      is_org_member: { Args: { org_uuid: string }; Returns: boolean }
      is_room_member: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      monitoring_spend_in_period: {
        Args: { p_period_days?: number; p_workspace: string }
        Returns: number
      }
      provision_workspace_for_user: {
        Args: { _user_id: string }
        Returns: string
      }
      release_lineage_lease: {
        Args: {
          p_expected_version: number
          p_holder_task_id: string
          p_lineage_id: string
          p_made_progress?: boolean
          p_next_state?: Json
          p_terminal_reason?: string
          p_workspace_id: string
        }
        Returns: {
          reason: string
          released: boolean
          state_version: number
        }[]
      }
      release_sourcing_continuation: {
        Args: {
          p_claim_id: string
          p_row_status?: string
          p_task_id: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      seed_agents_for_workspace: {
        Args: { _workspace_id: string }
        Returns: number
      }
      tasks_sweep_stuck_runs: {
        Args: { stale_after?: string }
        Returns: {
          stuck_for: string
          task_id: string
          workspace_id: string
        }[]
      }
    }
    Enums: {
      activity_log_severity: "debug" | "info" | "warning" | "error"
      activity_status: "pending" | "sent" | "skipped" | "failed"
      behavioral_risk_level: "low" | "medium" | "high"
      candidate_source:
        | "resume_screening"
        | "deep_search"
        | "linkedin_scraper"
        | "screening_flow"
      interview_location_type: "video" | "phone" | "in_person"
      interview_status:
        | "scheduled"
        | "completed"
        | "cancelled"
        | "no_show"
        | "rescheduled"
      job_status:
        | "queued"
        | "running"
        | "waiting"
        | "completed"
        | "failed"
        | "cancelled"
      job_step_status:
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "skipped"
        | "retrying"
      lead_status:
        | "not_started"
        | "in_sequence"
        | "replied"
        | "meeting_booked"
        | "closed"
        | "dead"
      lead_tier: "unassigned" | "tier_1" | "tier_2" | "tier_3"
      organization_member_role: "owner" | "admin" | "operator" | "viewer"
      organization_member_status: "active" | "invited" | "disabled"
      reminder_type: "24h" | "1h" | "15min"
      scenario_category:
        | "ambiguity"
        | "accountability"
        | "competing_priorities"
        | "time_pressure"
        | "conflict_resolution"
      screening_session_status:
        | "invited"
        | "in_progress"
        | "completed"
        | "expired"
        | "abandoned"
      secret_connection_status: "active" | "disabled" | "rotating" | "error"
      sequence_status: "draft" | "active" | "paused"
      slot_status: "available" | "booked" | "blocked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_log_severity: ["debug", "info", "warning", "error"],
      activity_status: ["pending", "sent", "skipped", "failed"],
      behavioral_risk_level: ["low", "medium", "high"],
      candidate_source: [
        "resume_screening",
        "deep_search",
        "linkedin_scraper",
        "screening_flow",
      ],
      interview_location_type: ["video", "phone", "in_person"],
      interview_status: [
        "scheduled",
        "completed",
        "cancelled",
        "no_show",
        "rescheduled",
      ],
      job_status: [
        "queued",
        "running",
        "waiting",
        "completed",
        "failed",
        "cancelled",
      ],
      job_step_status: [
        "queued",
        "running",
        "completed",
        "failed",
        "skipped",
        "retrying",
      ],
      lead_status: [
        "not_started",
        "in_sequence",
        "replied",
        "meeting_booked",
        "closed",
        "dead",
      ],
      lead_tier: ["unassigned", "tier_1", "tier_2", "tier_3"],
      organization_member_role: ["owner", "admin", "operator", "viewer"],
      organization_member_status: ["active", "invited", "disabled"],
      reminder_type: ["24h", "1h", "15min"],
      scenario_category: [
        "ambiguity",
        "accountability",
        "competing_priorities",
        "time_pressure",
        "conflict_resolution",
      ],
      screening_session_status: [
        "invited",
        "in_progress",
        "completed",
        "expired",
        "abandoned",
      ],
      secret_connection_status: ["active", "disabled", "rotating", "error"],
      sequence_status: ["draft", "active", "paused"],
      slot_status: ["available", "booked", "blocked"],
    },
  },
} as const
