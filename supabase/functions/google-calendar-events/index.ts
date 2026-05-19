import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_ID');
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokenData = await tokenResponse.json();
  if (tokenData.error) {
    console.error('Token refresh failed:', tokenData);
    return null;
  }
  return tokenData.access_token;
}

async function getValidAccessToken(userId: string, supabase: any): Promise<string | null> {
  const { data: tokenData, error } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !tokenData) {
    console.error('No token found for user:', userId);
    return null;
  }

  const now = new Date();
  const expiry = new Date(tokenData.token_expiry);

  // Refresh if token expires in less than 5 minutes
  if (expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    console.log('Token expired or expiring soon, refreshing...');
    const newAccessToken = await refreshAccessToken(tokenData.refresh_token);
    
    if (newAccessToken) {
      // Update token in database
      const newExpiry = new Date(Date.now() + 3600 * 1000); // 1 hour from now
      await supabase
        .from('google_calendar_tokens')
        .update({ 
          access_token: newAccessToken, 
          token_expiry: newExpiry.toISOString() 
        })
        .eq('user_id', userId);
      
      return newAccessToken;
    }
    return null;
  }

  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create Supabase client with user's JWT
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Verify user from JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    const { action, eventData, eventId } = await req.json();
    console.log('Google Calendar Events - Action:', action, 'User:', user.id);

    const accessToken = await getValidAccessToken(user.id, supabaseClient);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Not connected to Google Calendar' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const calendarId = 'primary';
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

    if (action === 'create-event') {
      // Create a calendar event
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: eventData.summary,
          description: eventData.description,
          start: {
            dateTime: eventData.startTime,
            timeZone: eventData.timeZone || 'UTC',
          },
          end: {
            dateTime: eventData.endTime,
            timeZone: eventData.timeZone || 'UTC',
          },
          attendees: eventData.attendees?.map((email: string) => ({ email })),
          conferenceData: eventData.addMeet ? {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          } : undefined,
        }),
      });

      const event = await response.json();
      
      if (event.error) {
        console.error('Failed to create event:', event.error);
        throw new Error(event.error.message);
      }

      console.log('Created calendar event:', event.id);
      
      return new Response(JSON.stringify({ 
        event,
        meetLink: event.hangoutLink 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'delete-event') {
      const response = await fetch(`${baseUrl}/${eventId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok && response.status !== 204) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to delete event');
      }

      console.log('Deleted calendar event:', eventId);
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'list-events') {
      const { timeMin, timeMax } = eventData;
      const url = new URL(baseUrl);
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      return new Response(JSON.stringify({ events: data.items }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Google Calendar Events error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
