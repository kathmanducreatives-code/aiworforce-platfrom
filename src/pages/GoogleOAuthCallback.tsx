import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const GoogleOAuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const error = searchParams.get('error');

      if (error) {
        setStatus('error');
        setErrorMessage(error);
        return;
      }

      if (!code) {
        setStatus('error');
        setErrorMessage('No authorization code received');
        return;
      }

      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setStatus('error');
          setErrorMessage('Not logged in');
          return;
        }

        // Exchange code for tokens
        const redirectUri = `${window.location.origin}/oauth/google/callback`;
        const { data, error: fnError } = await supabase.functions.invoke('google-calendar-auth', {
          body: {
            action: 'exchange-code',
            code,
            redirectUri,
          },
        });

        if (fnError || data?.error) {
          throw new Error(data?.error || fnError?.message || 'Token exchange failed');
        }

        // Calculate token expiry
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);

        // Store tokens in database
        const { error: dbError } = await supabase
          .from('google_calendar_tokens')
          .upsert({
            user_id: user.id,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            token_expiry: expiresAt.toISOString(),
          }, {
            onConflict: 'user_id',
          });

        if (dbError) {
          throw new Error('Failed to save tokens');
        }

        setStatus('success');
        
        // Redirect after short delay
        setTimeout(() => {
          navigate('/interview-scheduler/settings');
        }, 2000);

      } catch (err: any) {
        console.error('OAuth callback error:', err);
        setStatus('error');
        setErrorMessage(err.message || 'Authentication failed');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          {status === 'loading' && (
            <div className="space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <h2 className="text-xl font-semibold">Connecting Google Calendar...</h2>
              <p className="text-muted-foreground">Please wait while we complete the setup.</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-4">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <h2 className="text-xl font-semibold">Connected Successfully!</h2>
              <p className="text-muted-foreground">
                Your Google Calendar is now connected. Redirecting...
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="text-xl font-semibold">Connection Failed</h2>
              <p className="text-muted-foreground">{errorMessage}</p>
              <Button onClick={() => navigate('/interview-scheduler/settings')}>
                Back to Settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GoogleOAuthCallback;
