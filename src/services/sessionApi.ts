import { supabase } from "@/integrations/supabase/client";
import type { SearchFormData } from "@/components/lead-scraper/SearchForm";

export interface SessionData {
  search_criteria: SearchFormData;
  status?: string;
}

export const sessionApi = {
  async createSession(data: SessionData) {
    const { data: session, error } = await supabase
      .from("scraping_sessions")
      .insert({
        search_criteria: data.search_criteria as any,
        status: data.status || "pending",
        total_leads: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return session;
  },

  async updateSession(sessionId: string, updates: Partial<SessionData> & { total_leads?: number; completed_at?: string }) {
    const updateData: any = { ...updates };
    if (updateData.search_criteria) {
      updateData.search_criteria = updateData.search_criteria as any;
    }
    
    const { data, error } = await supabase
      .from("scraping_sessions")
      .update(updateData)
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
