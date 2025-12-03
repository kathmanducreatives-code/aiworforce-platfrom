import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { InterviewAvailability } from '@/types/Interview';
import { useToast } from '@/hooks/use-toast';

export function useAvailability() {
  const [availability, setAvailability] = useState<InterviewAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAvailability = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('interview_availability')
        .select('*')
        .eq('user_id', user.id)
        .order('day_of_week');

      if (error) throw error;
      setAvailability((data as InterviewAvailability[]) || []);
    } catch (error: any) {
      console.error('Error fetching availability:', error);
      toast({
        title: 'Error',
        description: 'Failed to load availability',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const setDayAvailability = async (
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const existing = availability.find((a) => a.day_of_week === dayOfWeek);

      if (existing) {
        const { error } = await supabase
          .from('interview_availability')
          .update({
            start_time: startTime,
            end_time: endTime,
            timezone,
            is_active: true,
          })
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('interview_availability')
          .insert({
            user_id: user.id,
            day_of_week: dayOfWeek,
            start_time: startTime,
            end_time: endTime,
            timezone,
            is_active: true,
          });

        if (error) throw error;
      }

      toast({
        title: 'Success',
        description: 'Availability updated',
      });

      await fetchAvailability();
    } catch (error: any) {
      console.error('Error setting availability:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update availability',
        variant: 'destructive',
      });
    }
  };

  const toggleDayAvailability = async (dayOfWeek: number, isActive: boolean) => {
    try {
      const existing = availability.find((a) => a.day_of_week === dayOfWeek);
      if (!existing) return;

      const { error } = await supabase
        .from('interview_availability')
        .update({ is_active: isActive })
        .eq('id', existing.id);

      if (error) throw error;

      await fetchAvailability();
    } catch (error: any) {
      console.error('Error toggling availability:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update availability',
        variant: 'destructive',
      });
    }
  };

  const removeDayAvailability = async (dayOfWeek: number) => {
    try {
      const existing = availability.find((a) => a.day_of_week === dayOfWeek);
      if (!existing) return;

      const { error } = await supabase
        .from('interview_availability')
        .delete()
        .eq('id', existing.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Availability removed',
      });

      await fetchAvailability();
    } catch (error: any) {
      console.error('Error removing availability:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to remove availability',
        variant: 'destructive',
      });
    }
  };

  const setDefaultAvailability = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const defaultDays = [1, 2, 3, 4, 5]; // Monday to Friday

      for (const day of defaultDays) {
        const existing = availability.find((a) => a.day_of_week === day);
        if (!existing) {
          await supabase.from('interview_availability').insert({
            user_id: user.id,
            day_of_week: day,
            start_time: '09:00',
            end_time: '17:00',
            timezone,
            is_active: true,
          });
        }
      }

      toast({
        title: 'Success',
        description: 'Default availability set (Mon-Fri, 9am-5pm)',
      });

      await fetchAvailability();
    } catch (error: any) {
      console.error('Error setting default availability:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to set default availability',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchAvailability();
  }, []);

  return {
    availability,
    loading,
    fetchAvailability,
    setDayAvailability,
    toggleDayAvailability,
    removeDayAvailability,
    setDefaultAvailability,
  };
}
