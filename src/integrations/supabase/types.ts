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
      adaptive_screening_sessions: {
        Row: {
          candidate_id: string | null
          company: string | null
          completed_at: string | null
          contact_name: string | null
          created_at: string | null
          id: string
          job_id: string | null
          profile_name: string | null
          role_briefing: Json | null
          scenario_config: Json | null
          session_status: string | null
          total_score: number | null
        }
        Insert: {
          candidate_id?: string | null
          company?: string | null
          completed_at?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          job_id?: string | null
          profile_name?: string | null
          role_briefing?: Json | null
          scenario_config?: Json | null
          session_status?: string | null
          total_score?: number | null
        }
        Update: {
          candidate_id?: string | null
          company?: string | null
          completed_at?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          job_id?: string | null
          profile_name?: string | null
          role_briefing?: Json | null
          scenario_config?: Json | null
          session_status?: string | null
          total_score?: number | null
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          agent_id: string | null
          completed_at: string | null
          id: string
          input: Json | null
          output: Json | null
          started_at: string | null
          status: string | null
          task_plan_id: string | null
        }
        Insert: {
          agent_id?: string | null
          completed_at?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          started_at?: string | null
          status?: string | null
          task_plan_id?: string | null
        }
        Update: {
          agent_id?: string | null
          completed_at?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          started_at?: string | null
          status?: string | null
          task_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_task_plan_id_fkey"
            columns: ["task_plan_id"]
            isOneToOne: false
            referencedRelation: "task_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          capabilities: Json | null
          config: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          model: string
          name: string
          role: string | null
          system_prompt: string | null
          updated_at: string | null
        }
        Insert: {
          capabilities?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          model?: string
          name: string
          role?: string | null
          system_prompt?: string | null
          updated_at?: string | null
        }
        Update: {
          capabilities?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          model?: string
          name?: string
          role?: string | null
          system_prompt?: string | null
          updated_at?: string | null
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
          created_at: string | null
          current_company: string | null
          current_title: string | null
          enriched_data: Json | null
          full_name: string | null
          headline: string | null
          id: string
          inserted_at: string | null
          linkedin_url: string | null
          location: string | null
          profile_name: string | null
          raw_data: Json | null
          scrape_run_id: string | null
          session_id: string | null
          similarity_score: number | null
        }
        Insert: {
          created_at?: string | null
          current_company?: string | null
          current_title?: string | null
          enriched_data?: Json | null
          full_name?: string | null
          headline?: string | null
          id?: string
          inserted_at?: string | null
          linkedin_url?: string | null
          location?: string | null
          profile_name?: string | null
          raw_data?: Json | null
          scrape_run_id?: string | null
          session_id?: string | null
          similarity_score?: number | null
        }
        Update: {
          created_at?: string | null
          current_company?: string | null
          current_title?: string | null
          enriched_data?: Json | null
          full_name?: string | null
          headline?: string | null
          id?: string
          inserted_at?: string | null
          linkedin_url?: string | null
          location?: string | null
          profile_name?: string | null
          raw_data?: Json | null
          scrape_run_id?: string | null
          session_id?: string | null
          similarity_score?: number | null
        }
        Relationships: []
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
          created_at: string | null
          id: string
          industry: string | null
          metadata: Json | null
          name: string
          website: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          industry?: string | null
          metadata?: Json | null
          name: string
          website?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          industry?: string | null
          metadata?: Json | null
          name?: string
          website?: string | null
        }
        Relationships: []
      }
      competitor_intel_signals: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          payload: Json | null
          signal_type: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          signal_type?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          signal_type?: string | null
        }
        Relationships: []
      }
      competitor_job_postings: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          posted_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          posted_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          posted_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      competitor_profiles: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          profile_data: Json | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          profile_data?: Json | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          profile_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "competitor_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_slug: string
          channel: string | null
          created_at: string
          id: string
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_slug: string
          channel?: string | null
          created_at?: string
          id?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_slug?: string
          channel?: string | null
          created_at?: string
          id?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      deep_search_analysis: {
        Row: {
          created_at: string
          id: string
          query: string | null
          result: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          query?: string | null
          result?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          query?: string | null
          result?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      deep_search_results: {
        Row: {
          ai_confidence_level: number | null
          ai_summary: string | null
          candidate_id: string | null
          candidate_name: string
          company: string | null
          company_match_notes: string | null
          created_at: string | null
          fit_score: number | null
          id: string
          ideal_roles: string[] | null
          linkedin_url: string | null
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
          company?: string | null
          company_match_notes?: string | null
          created_at?: string | null
          fit_score?: number | null
          id?: string
          ideal_roles?: string[] | null
          linkedin_url?: string | null
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
          company?: string | null
          company_match_notes?: string | null
          created_at?: string | null
          fit_score?: number | null
          id?: string
          ideal_roles?: string[] | null
          linkedin_url?: string | null
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
      firecrawl_scrape_logs: {
        Row: {
          created_at: string | null
          id: string
          payload: Json | null
          status: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          payload?: Json | null
          status?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          payload?: Json | null
          status?: string | null
          url?: string | null
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
          created_at: string | null
          growth_score: number | null
          id: string
          industry: string | null
          metadata: Json | null
          signals: Json | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          company_name: string
          created_at?: string | null
          growth_score?: number | null
          id?: string
          industry?: string | null
          metadata?: Json | null
          signals?: Json | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string | null
          growth_score?: number | null
          id?: string
          industry?: string | null
          metadata?: Json | null
          signals?: Json | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      icp_lookalike_sessions: {
        Row: {
          company_location: Json | null
          company_size: string | null
          config: Json | null
          created_at: string | null
          hiring_intensity: string | null
          id: string
          industry_names: Json | null
          profile_name: string | null
          results_count: number | null
          scrape_status: string | null
          session_id: string
          status: string | null
          strong_matches_count: number | null
          target_industry: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_location?: Json | null
          company_size?: string | null
          config?: Json | null
          created_at?: string | null
          hiring_intensity?: string | null
          id?: string
          industry_names?: Json | null
          profile_name?: string | null
          results_count?: number | null
          scrape_status?: string | null
          session_id: string
          status?: string | null
          strong_matches_count?: number | null
          target_industry?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_location?: Json | null
          company_size?: string | null
          config?: Json | null
          created_at?: string | null
          hiring_intensity?: string | null
          id?: string
          industry_names?: Json | null
          profile_name?: string | null
          results_count?: number | null
          scrape_status?: string | null
          session_id?: string
          status?: string | null
          strong_matches_count?: number | null
          target_industry?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
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
      job_distribution_postings: {
        Row: {
          created_at: string | null
          id: string
          job_id: string | null
          metadata: Json | null
          platform: string | null
          posted_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          platform?: string | null
          posted_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          platform?: string | null
          posted_at?: string | null
          url?: string | null
        }
        Relationships: []
      }
      job_distribution_status: {
        Row: {
          created_at: string | null
          external_url: string | null
          id: string
          job_id: string | null
          metadata: Json | null
          platform: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          external_url?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          platform: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          external_url?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          platform?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      job_market_intelligence: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id?: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
        }
        Relationships: []
      }
      job_postings: {
        Row: {
          created_at: string | null
          description: string | null
          experience_level: string | null
          id: string
          location: string | null
          required_skills: string[] | null
          salary_max: number | null
          salary_min: number | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          experience_level?: string | null
          id?: string
          location?: string | null
          required_skills?: string[] | null
          salary_max?: number | null
          salary_min?: number | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          experience_level?: string | null
          id?: string
          location?: string | null
          required_skills?: string[] | null
          salary_max?: number | null
          salary_min?: number | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
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
          scraped_at: string
          search_criteria: Json | null
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
          scraped_at?: string
          search_criteria?: Json | null
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
          scraped_at?: string
          search_criteria?: Json | null
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
          content: string | null
          created_at: string
          id: string
          scheduled_at: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          scheduled_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          scheduled_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      marketing_tasks: {
        Row: {
          created_at: string | null
          description: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          priority: string | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      marketing_videos: {
        Row: {
          background_video_url: string | null
          created_at: string | null
          duration: number | null
          feature_name: string
          final_video_url: string | null
          has_motion_graphics: boolean | null
          id: string
          script: Json | null
          thumbnail_url: string | null
        }
        Insert: {
          background_video_url?: string | null
          created_at?: string | null
          duration?: number | null
          feature_name: string
          final_video_url?: string | null
          has_motion_graphics?: boolean | null
          id?: string
          script?: Json | null
          thumbnail_url?: string | null
        }
        Update: {
          background_video_url?: string | null
          created_at?: string | null
          duration?: number | null
          feature_name?: string
          final_video_url?: string | null
          has_motion_graphics?: boolean | null
          id?: string
          script?: Json | null
          thumbnail_url?: string | null
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
      outreach_activities: {
        Row: {
          action_type: string
          body: string | null
          channel: string
          created_at: string
          executed_date: string | null
          id: string
          lead_id: string
          response_received: boolean | null
          response_text: string | null
          scheduled_date: string | null
          sequence_id: string | null
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
          response_received?: boolean | null
          response_text?: string | null
          scheduled_date?: string | null
          sequence_id?: string | null
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
          response_received?: boolean | null
          response_text?: string | null
          scheduled_date?: string | null
          sequence_id?: string | null
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
      outreach_leads: {
        Row: {
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
      pricing_history: {
        Row: {
          company_id: string | null
          id: string
          observed_at: string | null
          price_data: Json | null
        }
        Insert: {
          company_id?: string | null
          id?: string
          observed_at?: string | null
          price_data?: Json | null
        }
        Update: {
          company_id?: string | null
          id?: string
          observed_at?: string | null
          price_data?: Json | null
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
          fit_score: number | null
          id: string
          justification: string | null
          nurturing_stage: string | null
          overall_factor: number | null
          processing_time_minutes: number | null
          recruitment_name: string | null
          resume: string | null
          reward_factor: number | null
          risk_factor: number | null
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
          fit_score?: number | null
          id?: string
          justification?: string | null
          nurturing_stage?: string | null
          overall_factor?: number | null
          processing_time_minutes?: number | null
          recruitment_name?: string | null
          resume?: string | null
          reward_factor?: number | null
          risk_factor?: number | null
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
          fit_score?: number | null
          id?: string
          justification?: string | null
          nurturing_stage?: string | null
          overall_factor?: number | null
          processing_time_minutes?: number | null
          recruitment_name?: string | null
          resume?: string | null
          reward_factor?: number | null
          risk_factor?: number | null
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
          body: string | null
          candidate_email: string | null
          candidate_id: string | null
          candidate_name: string | null
          created_at: string
          folder_name: string | null
          id: string
          recipient_email: string | null
          scheduled_send_time: string | null
          send_time_utc: string | null
          sequence_created_at: string | null
          sequence_id: string | null
          sequence_name: string | null
          status: string | null
          step_number: number | null
          subject: string | null
          user_id: string | null
        }
        Insert: {
          body?: string | null
          candidate_email?: string | null
          candidate_id?: string | null
          candidate_name?: string | null
          created_at?: string
          folder_name?: string | null
          id?: string
          recipient_email?: string | null
          scheduled_send_time?: string | null
          send_time_utc?: string | null
          sequence_created_at?: string | null
          sequence_id?: string | null
          sequence_name?: string | null
          status?: string | null
          step_number?: number | null
          subject?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string | null
          candidate_email?: string | null
          candidate_id?: string | null
          candidate_name?: string | null
          created_at?: string
          folder_name?: string | null
          id?: string
          recipient_email?: string | null
          scheduled_send_time?: string | null
          send_time_utc?: string | null
          sequence_created_at?: string | null
          sequence_id?: string | null
          sequence_name?: string | null
          status?: string | null
          step_number?: number | null
          subject?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      scraping_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          name: string | null
          scrape_run_id: string | null
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
          scrape_run_id?: string | null
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
          scrape_run_id?: string | null
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
          created_at: string | null
          id: string
          red_flags: Json | null
          session_id: string | null
          strengths: Json | null
          summary: string | null
          trait_scores: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          red_flags?: Json | null
          session_id?: string | null
          strengths?: Json | null
          summary?: string | null
          trait_scores?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          red_flags?: Json | null
          session_id?: string | null
          strengths?: Json | null
          summary?: string | null
          trait_scores?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "screening_behavioral_analysis_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "adaptive_screening_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_conversation_logs: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          role: string | null
          session_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          role?: string | null
          session_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          role?: string | null
          session_id?: string | null
        }
        Relationships: [
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
          category: string
          created_at: string | null
          difficulty_level: string | null
          follow_up_prompts: Json | null
          id: string
          is_active: boolean | null
          scenario_prompt: string
        }
        Insert: {
          category: string
          created_at?: string | null
          difficulty_level?: string | null
          follow_up_prompts?: Json | null
          id?: string
          is_active?: boolean | null
          scenario_prompt: string
        }
        Update: {
          category?: string
          created_at?: string | null
          difficulty_level?: string | null
          follow_up_prompts?: Json | null
          id?: string
          is_active?: boolean | null
          scenario_prompt?: string
        }
        Relationships: []
      }
      screening_template_questions: {
        Row: {
          category: string | null
          created_at: string | null
          difficulty_level: string | null
          display_order: number | null
          follow_up_prompts: Json | null
          id: string
          is_required: boolean | null
          scenario_id: string | null
          scenario_prompt: string | null
          template_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          difficulty_level?: string | null
          display_order?: number | null
          follow_up_prompts?: Json | null
          id?: string
          is_required?: boolean | null
          scenario_id?: string | null
          scenario_prompt?: string | null
          template_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          difficulty_level?: string | null
          display_order?: number | null
          follow_up_prompts?: Json | null
          id?: string
          is_required?: boolean | null
          scenario_id?: string | null
          scenario_prompt?: string | null
          template_id?: string | null
        }
        Relationships: [
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
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
        }
        Relationships: []
      }
      talent_signals: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          payload: Json | null
          signal_type: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          signal_type?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          signal_type?: string | null
        }
        Relationships: []
      }
      task_plans: {
        Row: {
          created_at: string | null
          goal: string
          id: string
          status: string | null
          steps: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          goal: string
          id?: string
          status?: string | null
          steps?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          goal?: string
          id?: string
          status?: string | null
          steps?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          agent_slug: string
          completed_at: string | null
          created_at: string
          depends_on: string[]
          error_message: string | null
          id: string
          parent_task_id: string | null
          payload: Json
          plan_id: string | null
          result: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_slug: string
          completed_at?: string | null
          created_at?: string
          depends_on?: string[]
          error_message?: string | null
          id?: string
          parent_task_id?: string | null
          payload?: Json
          plan_id?: string | null
          result?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_slug?: string
          completed_at?: string | null
          created_at?: string
          depends_on?: string[]
          error_message?: string | null
          id?: string
          parent_task_id?: string | null
          payload?: Json
          plan_id?: string | null
          result?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "task_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
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
      candidate_source: "resume_screening" | "deep_search" | "linkedin_scraper"
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
      candidate_source: ["resume_screening", "deep_search", "linkedin_scraper"],
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
      sequence_status: ["draft", "active", "paused"],
      slot_status: ["available", "booked", "blocked"],
    },
  },
} as const
