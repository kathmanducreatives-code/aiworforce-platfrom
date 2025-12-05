import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export const useGoogleCalendar = () => {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      checkConnection();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  const checkConnection = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('google_calendar_tokens')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      setIsConnected(!!data && !error);
    } catch (err) {
      console.error('Error checking Google Calendar connection:', err);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const connect = async () => {
    try {
      const redirectUri = `${window.location.origin}/oauth/google/callback`;
      
      const { data, error } = await supabase.functions.invoke('google-calendar-auth', {
        body: {
          action: 'get-auth-url',
          redirectUri,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message);
      }

      // Redirect to Google OAuth
      window.location.href = data.authUrl;
    } catch (err: any) {
      console.error('Error connecting to Google Calendar:', err);
      toast.error('Failed to connect to Google Calendar');
    }
  };

  const disconnect = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('google_calendar_tokens')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      setIsConnected(false);
      toast.success('Disconnected from Google Calendar');
    } catch (err: any) {
      console.error('Error disconnecting:', err);
      toast.error('Failed to disconnect');
    }
  };

  const createCalendarEvent = async (eventData: {
    summary: string;
    description?: string;
    startTime: string;
    endTime: string;
    timeZone?: string;
    attendees?: string[];
    addMeet?: boolean;
  }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('google-calendar-events', {
        body: {
          action: 'create-event',
          eventData,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message);
      }

      return { event: data.event, meetLink: data.meetLink };
    } catch (err: any) {
      console.error('Error creating calendar event:', err);
      throw err;
    }
  };

  const deleteCalendarEvent = async (eventId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('google-calendar-events', {
        body: {
          action: 'delete-event',
          eventId,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message);
      }

      return true;
    } catch (err: any) {
      console.error('Error deleting calendar event:', err);
      throw err;
    }
  };

  return {
    isConnected,
    isLoading,
    connect,
    disconnect,
    createCalendarEvent,
    deleteCalendarEvent,
    checkConnection,
  };
};
