import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

/**
 * Public route /reset-password. Supabase redirects users here with a
 * `type=recovery` token in the URL hash. We let onAuthStateChange establish
 * the recovery session, then accept the new password via updateUser.
 */
const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Supabase JS will pick up the recovery token from the URL hash
    // automatically and emit a PASSWORD_RECOVERY event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    // Also check existing session in case the hash was already consumed.
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    if (password !== confirm) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: 'Password updated', description: 'You are signed in.' });
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      toast({ title: 'Could not update password', description: err.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center p-4 text-white">
      <Card className="w-full max-w-md border-white/10 bg-[#0D0D0D]/95 text-white shadow-2xl backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription className="text-white/55">
            Pick a strong password you haven't used before.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!ready ? (
            <div className="flex items-center gap-2 text-sm text-white/65">
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying recovery link…
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw" className="text-white/75">New password</Label>
                <Input
                  id="pw" type="password" minLength={8} required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="h-11 border-white/15 bg-white/[0.04] text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-white/75">Confirm password</Label>
                <Input
                  id="confirm" type="password" minLength={8} required
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="h-11 border-white/15 bg-white/[0.04] text-white"
                />
              </div>
              <Button type="submit" disabled={loading} className="h-11 w-full bg-emerald-500 text-white hover:bg-emerald-400">
                {loading ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
