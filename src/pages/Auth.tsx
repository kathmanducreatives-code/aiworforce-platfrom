import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

import { useToast } from '@/hooks/use-toast';
import { ArrowLeft } from 'lucide-react';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        navigate('/dashboard', { replace: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        
        if (error) throw error;
        
        toast({
          title: "Success!",
          description: "You have been logged in successfully.",
        });
        
        navigate('/dashboard');
      } else {
        const redirectUrl = window.location.origin;
        
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              full_name: fullName
            }
          }
        });
        
        if (error) throw error;
        
        toast({
          title: "Success!",
          description: "Please check your email to confirm your account.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fieldClassName =
    "h-11 border-white/15 bg-white/[0.04] text-white placeholder:text-white/45 shadow-inner shadow-black/20 focus-visible:border-emerald-400 focus-visible:bg-white/[0.06]";

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
          <CardTitle className="text-2xl text-center">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </CardTitle>
          <CardDescription className="text-center text-white/55">
            {isLogin 
              ? 'Enter your credentials to access your dashboard' 
              : 'Sign up to start using our AI-powered recruitment system'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-white/75">Full Name</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required={!isLogin}
                  className={fieldClassName}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-white/75">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={fieldClassName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-white/75">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className={fieldClassName}
              />
            </div>
            <Button
              type="submit"
              className="h-11 w-full bg-emerald-500 text-white hover:bg-emerald-400"
              disabled={loading}
            >
              {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Sign Up')}
            </Button>
          </form>
          
          <div className="mt-4 text-center">
            <Button
              variant="link"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-emerald-300 hover:text-emerald-200"
            >
              {isLogin 
                ? "Don't have an account? Sign up" 
                : 'Already have an account? Sign in'
              }
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
