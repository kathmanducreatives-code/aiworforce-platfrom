import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const EmailCapture = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const { toast } = useToast();

  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    setErrorMsg('');
    setStatus('loading');

    try {
      const { error } = await supabase
        .from('codex_leads')
        .insert([{ 
          company: 'LANDING_PAGE_WAITLIST',
          personalized_message: `Inbound waitlist: ${email}`,
          source_url: window.location.href,
          data: { 
            email,
            source: 'landing_page_footer',
            timestamp: new Date().toISOString(),
          } 
        }]);

      if (error) throw error;
      
      setStatus('success');
      toast({
        title: "Success",
        description: "You've been added to our early access list.",
      });
    } catch (err: any) {
      console.error('Email capture error:', err);
      setStatus('error');
      setErrorMsg(err.message || 'Failed to capture email. Please try again.');
      toast({
        variant: "destructive",
        title: "Error",
        description: "Something went wrong. Please try again.",
      });
    }
  };

  return (
    <section className="relative z-10 py-20 md:py-28 border-t border-white/5 overflow-hidden">
      {/* Soft ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-accent-mint/[0.04] blur-[100px] rounded-full pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-6 text-center">
        {/* Label */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent-mint/30 bg-accent-mint/5 mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-mint font-bold">Early Access</span>
        </div>

        <h2 className="font-display font-black text-3xl md:text-5xl text-white tracking-tight leading-[1.05] mb-5">
          Not ready to sign up?<br />
          <span className="text-white/50">Get the briefing first.</span>
        </h2>
        <p className="text-white/40 text-base md:text-lg leading-relaxed mb-10 max-w-lg mx-auto">
          One email. We'll show you exactly which agents your business needs and how to deploy them.
        </p>

        <AnimatePresence mode="wait">
          {status === 'success' ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="w-16 h-16 rounded-2xl bg-accent-mint/10 border border-accent-mint/30 flex items-center justify-center shadow-[0_0_40px_rgba(0,255,148,0.15)]">
                <Check className="w-8 h-8 text-accent-mint" />
              </div>
              <p className="text-white font-bold text-lg">You're on the list.</p>
              <p className="text-white/40 text-sm">We'll reach out within 24 hours.</p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col sm:flex-row gap-3 w-full"
            >
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setErrorMsg(''); }}
                placeholder="your@email.com"
                disabled={status === 'loading'}
                className="flex-1 h-[56px] px-5 rounded-[14px] bg-white/[0.03] border border-white/10 text-white placeholder:text-white/25 text-sm font-medium focus:outline-none focus:border-accent-mint/40 focus:bg-white/[0.05] transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={status === 'loading' || !email}
                className="h-[56px] px-8 rounded-[14px] bg-white text-black text-sm font-black uppercase tracking-widest transition-all duration-300 hover:bg-accent-mint hover:scale-[1.02] shadow-[0_0_20px_rgba(255,255,255,0.15)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0"
              >
                {status === 'loading' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>Get the brief <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Error */}
        {errorMsg && (
          <p className="mt-3 text-red-400 text-xs font-medium">{errorMsg}</p>
        )}

        {/* Trust note */}
        {status !== 'success' && (
          <p className="mt-5 text-[11px] text-white/20 font-medium">
            No spam. No sales calls. Just one useful email.
          </p>
        )}
      </div>
    </section>
  );
};

export default EmailCapture;
