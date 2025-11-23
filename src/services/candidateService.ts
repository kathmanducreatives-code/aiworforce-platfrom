import { supabase } from "@/integrations/supabase/client";
import { CandidateSource, UnifiedCandidate, ContactHistory } from "@/types/Collaboration";

export const fetchUnifiedCandidate = async (
  source: CandidateSource,
  candidateId: string
): Promise<UnifiedCandidate | null> => {
  try {
    switch (source) {
      case 'resume_screening': {
        const { data, error } = await supabase
          .from('resume_analyses')
          .select('*')
          .eq('id', candidateId)
          .single();
        
        if (error) throw error;
        if (!data) return null;

        return {
          id: data.id,
          source: 'resume_screening',
          name: data.candidate_name,
          email: data.email || undefined,
          fitScore: typeof data.fit_score === 'object' ? (data.fit_score as any)?.value : undefined,
          status: data.status || undefined,
          notes: data.justification || undefined,
        };
      }

      case 'deep_search': {
        const { data, error } = await supabase
          .from('deep_search_results')
          .select('*')
          .eq('id', candidateId)
          .single();
        
        if (error) throw error;
        if (!data) return null;

        return {
          id: data.id,
          source: 'deep_search',
          name: data.candidate_name,
          company: data.company || undefined,
          linkedin_url: data.linkedin_url || undefined,
          fitScore: data.fit_score || undefined,
          status: data.status || undefined,
        };
      }

      case 'linkedin_scraper': {
        const { data, error } = await supabase
          .from('linkedin_leads')
          .select('*')
          .eq('id', candidateId)
          .single();
        
        if (error) throw error;
        if (!data) return null;

        return {
          id: data.id,
          source: 'linkedin_scraper',
          name: data.candidate_name,
          title: data.job_title || undefined,
          company: data.company || undefined,
          email: data.contact_email || undefined,
          linkedin_url: data.linkedin_url || undefined,
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error('Error fetching candidate:', error);
    return null;
  }
};

export const checkContactHistory = async (
  source: CandidateSource,
  candidateId: string
): Promise<ContactHistory | null> => {
  try {
    const { data, error } = await supabase
      .from('collaboration_contact_history')
      .select('*')
      .eq('candidate_source', source)
      .eq('candidate_id', candidateId)
      .order('contacted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as ContactHistory | null;
  } catch (error) {
    console.error('Error checking contact history:', error);
    return null;
  }
};

export const recordContact = async (
  source: CandidateSource,
  candidateId: string,
  contactMethod: string,
  notes?: string
) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('collaboration_contact_history')
      .insert({
        candidate_source: source,
        candidate_id: candidateId,
        contacted_by: user.id,
        contact_method: contactMethod,
        notes: notes,
        contacted_at: new Date().toISOString(),
      });

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error recording contact:', error);
    return false;
  }
};
