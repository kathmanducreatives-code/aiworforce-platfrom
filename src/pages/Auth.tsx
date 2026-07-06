import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, MailCheck } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'forgot';

async function destinationForUser(userId: string): Promise<string> {
  try {
    // Wait briefly for the workspace provision trigger to land.
    const { data } = await supabase
      .from('company_brain')
      .select('onboarding_completed')
      .limit(1)
      .maybeSingle();
    return data?.onboarding_completed ? '/dashboard' : '/onboarding/company-brain';
  } catch {
    return '/onboarding/company-brain';
  }
}

const Auth = () => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // Same-origin relative next target (e.g. from /.lovable/oauth/consent).
  const nextParam = searchParams.get('next');
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null;

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Only react to a real sign-in; don't auto-redirect during recovery flow.
      if (event === 'SIGNED_IN' && session?.user) {
        if (safeNext) {
          window.location.href = safeNext;
          return;
        }
        const dest = await destinationForUser(session.user.id);
        navigate(dest, { replace: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate, safeNext]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: 'Welcome back', description: 'You are signed in.' });
        // onAuthStateChange handles the destination.
      } else if (mode === 'signup') {
        const redirectUrl = `${window.location.origin}/onboarding/company-brain`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectUrl, data: { full_name: fullName } },
        });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation required — don't claim success.
          setCheckEmail(true);
        } else {
          toast({ title: 'Account created', description: 'Setting up your workspace…' });
          navigate('/onboarding/company-brain', { replace: true });
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({ title: 'Check your email', description: 'Password reset link sent.' });
        setMode('signin');
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fieldClassName =
    'h-11 border-white/15 bg-white/[0.04] text-white placeholder:text-white/45 shadow-inner shadow-black/20 focus-visible:border-emerald-400 focus-visible:bg-white/[0.06]';

  const headline =
    mode === 'signup' ? 'Build your AI workforce'
    : mode === 'forgot' ? 'Reset your password'
    : 'Welcome back';
  const subcopy =
    mode === 'signup' ? 'Create your workspace, teach Agentory about your company, and run your first AI workflow.'
    : mode === 'forgot' ? "Enter your email and we'll send a reset link."
    : 'Sign in to continue building with your AI workforce.';

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center overflow-hidden bg-transparent p-4 text-white">
      <Button
        variant="ghost"
        onClick={() => navigate('/')}
        className="absolute left-4 top-4 flex items-center gap-2 text-white/65 hover:bg-white/5 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </Button>
      <Card className="w-full max-w-md border-white/10 bg-[#0D0D0D]/95 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">{headline}</CardTitle>
          <CardDescription className="text-center text-white/55">{subcopy}</CardDescription>
        </CardHeader>
        <CardContent>
          {checkEmail ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <MailCheck className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <div className="text-base font-medium">Check your email</div>
                <div className="text-sm text-white/55 mt-1">
                  We sent a confirmation link to <span className="text-white">{email}</span>. Click it to finish creating your account.
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => { setCheckEmail(false); setMode('signin'); }}
                className="text-emerald-300 hover:text-emerald-200"
              >
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleAuth} className="space-y-4">
              {mode === 'signup' && (
                <div className="space-y-2">
                  <Label htmlFor="fullName" className="text-white/75">Full Name</Label>
                  <Input
                    id="fullName" type="text" placeholder="Enter your full name"
                    value={fullName} onChange={(e) => setFullName(e.target.value)}
                    required className={fieldClassName}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-white/75">Email</Label>
                <Input
                  id="email" type="email" placeholder="Enter your email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required className={fieldClassName}
                />
              </div>
              {mode !== 'forgot' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-white/75">Password</Label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => setMode('forgot')}
                        className="text-xs text-emerald-300 hover:text-emerald-200"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <Input
                    id="password" type="password" placeholder="Enter your password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    required minLength={8} className={fieldClassName}
                  />
                </div>
              )}
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-500 text-white hover:bg-emerald-400"
                disabled={loading}
              >
                {loading ? 'Please wait...'
                  : mode === 'signin' ? 'Sign in'
                  : mode === 'signup' ? 'Create account'
                  : 'Send reset link'}
              </Button>
            </form>
          )}

          {!checkEmail && (
            <div className="mt-4 text-center text-sm">
              {mode === 'signin' && (
                <button type="button" onClick={() => setMode('signup')} className="text-emerald-300 hover:text-emerald-200">
                  Don't have an account? Create one
                </button>
              )}
              {mode === 'signup' && (
                <button type="button" onClick={() => setMode('signin')} className="text-emerald-300 hover:text-emerald-200">
                  Already have an account? Sign in
                </button>
              )}
              {mode === 'forgot' && (
                <button type="button" onClick={() => setMode('signin')} className="text-emerald-300 hover:text-emerald-200">
                  Back to sign in
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
