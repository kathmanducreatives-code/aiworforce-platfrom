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
          client_name: string
          contact_email: string | null
          contact_name: string | null
          created_at: string | null
          id: string
          industry: string | null
          updated_at: string | null
        }
        Insert: {
          client_name: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          industry?: string | null
          updated_at?: string | null
        }
        Update: {
          client_name?: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          industry?: string | null
          updated_at?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
