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
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      activity_feed: {
        Row: {
          agent_id: string | null
          body: string | null
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          task_plan_id: string | null
          title: string | null
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          body?: string | null
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          task_plan_id?: string | null
          title?: string | null
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          body?: string | null
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          task_plan_id?: string | null
          title?: string | null
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
      agents: {
        Row: {
          avatar_color: string | null
          avatar_icon: string | null
          created_at: string | null
          department: string
          id: string
          is_default: boolean | null
          model: string
          name: string
          role_prompt: string
          status: string | null
          tools: Json | null
          trigger_config: Json | null
          trigger_type: string | null
          workspace_id: string | null
        }
        Insert: {
          avatar_color?: string | null
          avatar_icon?: string | null
          created_at?: string | null
          department: string
          id?: string
          is_default?: boolean | null
          model?: string
          name: string
          role_prompt: string
          status?: string | null
          tools?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
          workspace_id?: string | null
        }
        Update: {
          avatar_color?: string | null
          avatar_icon?: string | null
          created_at?: string | null
          department?: string
          id?: string
          is_default?: boolean | null
          model?: string
          name?: string
          role_prompt?: string
          status?: string | null
          tools?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
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
          created_at: string | null
          id: string
          payload: Json | null
          resolved_at: string | null
          status: string | null
          summary: string | null
          task_id: string | null
          task_plan_id: string | null
          title: string | null
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          resolved_at?: string | null
          status?: string | null
          summary?: string | null
          task_id?: string | null
          task_plan_id?: string | null
          title?: string | null
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          resolved_at?: string | null
          status?: string | null
          summary?: string | null
          task_id?: string | null
          task_plan_id?: string | null
          title?: string | null
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
          ideal_roles?: s