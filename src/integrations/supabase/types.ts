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
          closely_connection_status: string | null
          closely_last_event: string | null
          closely_last_event_at: string | null
          closely_synced: boolean | null
          company: string
          company_size: string | null
          contact_name: string
          created_at: string
          current_sequence_step: number | null
          email: string | null
          id: string
          industry: string | null
          last_touch_date: string | null
          linkedin_url: string | null
          next_action_date: string | null
          notes: string | null
          sequence_id: string | null
          signals: Json | null
          status: Database["public"]["Enums"]["lead_status"] | null
          tier: Database["public"]["Enums"]["lead_tier"] | null
          title: string | null
          updated_at: string
        }
        Insert: {
          closely_connection_status?: string | null
          closely_last_event?: string | null
          closely_last_event_at?: string | null
          closely_synced?: boolean | null
          company: string
          company_size?: string | null
          contact_name: string
          created_at?: string
          current_sequence_step?: number | null
          email?: string | null
          id?: string
          industry?: string | null
          last_touch_date?: string | null
          linkedin_url?: string | null
          next_action_date?: string | null
          notes?: string | null
          sequence_id?: string | null
          signals?: Json | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tier?: Database["public"]["Enums"]["lead_tier"] | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          closely_connection_status?: string | null
          closely_last_event?: string | null
          closely_last_event_at?: string | null
          closely_synced?: boolean | null
          company?: string
          company_size?: string | null
          contact_name?: string
          created_at?: string
          current_sequence_step?: number | null
          email?: string | null
          id?: string
          industry?: string | null
          last_touch_date?: string | null
          linkedin_url?: string | null
          next_action_date?: string | null
          notes?: string | null
          sequence_id?: string | null
          signals?: Json | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tier?: Database["public"]["Enums"]["lead_tier"] | null
          title?: string | null
          updated_at?: string
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
      profiles: {
        Row: {
          client_id: string | null
          created_at: string | null
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
    }
    Views: {
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
    }
    Functions: {
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
      is_room_member: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
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
      lead_status:
        | "not_started"
        | "in_sequence"
        | "replied"
        | "meeting_booked"
        | "closed"
        | "dead"
      lead_tier: "unassigned" | "tier_1" | "tier_2" | "tier_3"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      lead_status: [
        "not_started",
        "in_sequence",
        "replied",
        "meeting_booked",
        "closed",
        "dead",
      ],
      lead_tier: ["unassigned", "tier_1", "tier_2", "tier_3"],
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
      sequence_status: ["draft", "active", "paused"],
      slot_status: ["available", "booked", "blocked"],
    },
  },
} as const
