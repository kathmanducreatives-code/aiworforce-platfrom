import { supabase } from "@/integrations/supabase/client";

export interface SessionData {
  search_criteria: {
    jobTitle: string;
    location: string;
    keywords: string[];
    experienceLevel: string;
    industry: string;
    numberOfLeads: number;
  };
  status?: string;
}

export const sessionApi = {
  async createSession(data: SessionData) {
    const { data: session, error } = await supabase
      .from("scraping_sessions")
      .insert({
        search_criteria: data.search_criteria,
        status: data.status || "pending",
        total_leads: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return session;
  },

  async updateSession(sessionId: string, updates: Partial<SessionData> & { total_leads?: number; completed_at?: string }) {
    const { data, error } = await supabase
      .from("scraping_sessions")
      .update(updates)
      .eq("id", sessionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getSession(sessionId: string) {
    const { data, error } = await supabase
      .from("scraping_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error) throw error;
    return data;
  },

  async getSessions(limit = 50) {
    const { data, error } = await supabase
      .from("scraping_sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  },
};
