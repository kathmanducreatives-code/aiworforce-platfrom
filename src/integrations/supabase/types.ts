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
          fit_score: number | null
          id: string
          ideal_roles: string[] | null
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
          fit_score?: number | null
          id?: string
          ideal_roles?: string[] | null
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
          fit_score?: number | null
          id?: string
          ideal_roles?: string[] | null
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
      candidate_source: "resume_screening" | "deep_search" | "linkedin_scraper"
      interview_location_type: "video" | "phone" | "in_person"
      interview_status:
        | "scheduled"
        | "completed"
        | "cancelled"
        | "no_show"
        | "rescheduled"
      reminder_type: "24h" | "1h" | "15min"
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
      candidate_source: ["resume_screening", "deep_search", "linkedin_scraper"],
      interview_location_type: ["video", "phone", "in_person"],
      interview_status: [
        "scheduled",
        "completed",
        "cancelled",
        "no_show",
        "rescheduled",
      ],
      reminder_type: ["24h", "1h", "15min"],
      slot_status: ["available", "booked", "blocked"],
    },
  },
} as const
