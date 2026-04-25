import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Interview, InterviewType, InterviewSlot } from '@/types/Interview';
import { useToast } from '@/hooks/use-toast';

export function useInterviews() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [interviewTypes, setInterviewTypes] = useState<InterviewType[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchInterviews = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('interviews')
        .select('*')
        .eq('recruiter_id', user.id)
        .order('scheduled_at', { ascending: true });

      if (error) throw error;
      setInterviews((data as Interview[]) || []);
    } catch (error: any) {
      console.error('Error fetching interviews:', error);
      toast({
        title: 'Error',
        description: 'Failed to load interviews',
        variant: 'destructive',
      });
    }
  };

  const fetchInterviewTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('interview_types')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setInterviewTypes((data as InterviewType[]) || []);
    } catch (error: any) {
      console.error('Error fetching interview types:', error);
    }
  };

  const createInterviewType = async (interviewType: Partial<InterviewType>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('interview_types')
        .insert({
          name: interviewType.name || '',
          duration_minutes: interviewType.duration_minutes || 30,
          description: interviewType.description || null,
          location_type: interviewType.location_type || 'video',
          meeting_link_template: interviewType.meeting_link_template || null,
          buffer_minutes: interviewType.buffer_minutes || 15,
          created_by: user.id,
        } as any)
        .select()
        .single();

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Interview type created',
      });
      
      await fetchInterviewTypes();
      return data as InterviewType;
    } catch (error: any) {
      console.error('Error creating interview type:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create interview type',
        variant: 'destructive',
      });
      return null;
    }
  };

  const updateInterviewType = async (id: string, updates: Partial<InterviewType>) => {
    try {
      const { error } = await supabase
        .from('interview_types')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Interview type updated',
      });
      
      await fetchInterviewTypes();
    } catch (error: any) {
      console.error('Error updating interview type:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update interview type',
        variant: 'destructive',
      });
    }
  };

  const deleteInterviewType = async (id: string) => {
    try {
      const { error } = await supabase
        .from('interview_types')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Interview type deleted',
      });
      
      await fetchInterviewTypes();
    } catch (error: any) {
      console.error('Error deleting interview type:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete interview type',
        variant: 'destructive',
      });
    }
  };

  const scheduleInterview = async (interview: Partial<Interview>, sendEmailInvite: boolean = true) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('interviews')
        .insert({
          candidate_name: interview.candidate_name || '',
          candidate_email: interview.candidate_email || '',
          scheduled_at: interview.scheduled_at || new Date().toISOString(),
          duration_minutes: interview.duration_minutes || 30,
          status: interview.status || 'scheduled',
          candidate_id: interview.candidate_id || null,
          candidate_source: interview.candidate_source || null,
          interview_type_id: interview.interview_type_id || null,
          slot_id: interview.slot_id || null,
          meeting_link: interview.meeting_link || null,
          location: interview.location || null,
          notes: interview.notes || null,
          recruiter_id: user.id,
        } as any)
        .select()
        .single();

      if (error) throw error;

      // Send email invite if requested
      if (sendEmailInvite && interview.candidate_email) {
        try {
          // Get recruiter profile for name
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('user_id', user.id)
            .single();

          const { error: emailError } = await supabase.functions.invoke('send-interview-invite', {
            body: {
              candidateName: interview.candidate_name,
              candidateEmail: interview.candidate_email,
              scheduledAt: interview.scheduled_at,
              durationMinutes: interview.duration_minutes || 30,
              meetingLink: interview.meeting_link,
              recruiterName: profile?.full_name || 'Recruiting Team',
            },
          });

          if (emailError) {
            console.error('Error sending interview invite email:', emailError);
            toast({
              title: 'Interview Scheduled',
              description: 'Interview was scheduled but email invite failed to send',
              variant: 'default',
            });
          } else {
            toast({
              title: 'Success',
              description: 'Interview scheduled and invite sent to candidate',
            });
          }
        } catch (emailErr) {
          console.error('Error invoking email function:', emailErr);
          toast({
            title: 'Interview Scheduled',
            description: 'Interview was scheduled but email invite failed to send',
            variant: 'default',
          });
        }
      } else {
        toast({
          title: 'Success',
          description: 'Interview scheduled successfully',
        });
      }
      
      await fetchInterviews();
      return data as Interview;
    } catch (error: any) {
      console.error('Error scheduling interview:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to schedule interview',
        variant: 'destructive',
      });
      return null;
    }
  };

  const updateInterview = async (id: string, updates: Partial<Interview>) => {
    try {
      const { error } = await supabase
        .from('interviews')
        .update(updates as any)
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Interview updated',
      });
      
      await fetchInterviews();
    } catch (error: any) {
      console.error('Error updating interview:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update interview',
        variant: 'destructive',
      });
    }
  };

  const cancelInterview = async (id: string, reason?: string) => {
    try {
      const { error } = await supabase
        .from('interviews')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason,
        })
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Interview cancelled',
      });
      
      await fetchInterviews();
    } catch (error: any) {
      console.error('Error cancelling interview:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to cancel interview',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchInterviews(), fetchInterviewTypes()]);
      setLoading(false);
    };
    loadData();
  }, []);

  // Subscribe to realtime updates (INSERT-only + debounced to coalesce bursts).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fetchInterviews(), 300);
    };

    const channel = supabase
      .channel('interviews-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'interviews',
        },
        debouncedFetch,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  const upcomingInterviews = interviews.filter(
    (i) => i.status === 'scheduled' && new Date(i.scheduled_at) > new Date()
  );

  const todayInterviews = interviews.filter((i) => {
    const today = new Date();
    const interviewDate = new Date(i.scheduled_at);
    return (
      i.status === 'scheduled' &&
      interviewDate.toDateString() === today.toDateString()
    );
  });

  return {
    interviews,
    interviewTypes,
    upcomingInterviews,
    todayInterviews,
    loading,
    fetchInterviews,
    fetchInterviewTypes,
    createInterviewType,
    updateInterviewType,
    deleteInterviewType,
    scheduleInterview,
    updateInterview,
    cancelInterview,
  };
}
