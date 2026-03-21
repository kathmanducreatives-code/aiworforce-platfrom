import { motion } from 'framer-motion';
import { Video, Star, Users, Clock, Sparkles, Bell, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

const ExpertMarketplace = () => {
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);

  const handleJoinWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setJoined(true);
    toast.success("You're on the list! We'll notify you when Expert Interviews launches.");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-16 md:py-24">
        
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold tracking-widest uppercase mb-6">
            <Sparkles className="w-3.5 h-3.5" /> Coming Soon
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 tracking-tight">
            Expert Interviews
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Deploy vetted technical leaders from top-tier companies to conduct unbiased, 
            structured interviews on your behalf. Pay per interview, no commitments.
          </p>
        </motion.div>

        {/* Feature Preview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {[
            { icon: Users, label: 'Vetted Experts', value: 'FAANG-level', desc: 'Senior engineers & PMs from top companies' },
            { icon: Clock, label: 'Turnaround', value: '< 24h', desc: 'Interviews scheduled within hours' },
            { icon: Star, label: 'Quality', value: '98%', desc: 'Client satisfaction rate' },
            { icon: Video, label: 'Delivery', value: 'Full Report', desc: 'Recorded session + structured scorecard' },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-5 text-center"
            >
              <div className="mx-auto w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <item.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xl font-bold text-foreground font-mono">{item.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Waitlist CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="max-w-md mx-auto"
        >
          {joined ? (
            <div className="text-center rounded-2xl border border-primary/20 bg-primary/5 p-8">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">You're on the waitlist!</h3>
              <p className="text-sm text-muted-foreground">
                We'll email you at <span className="font-medium text-foreground">{email}</span> when 
                Expert Interviews is ready.
              </p>
            </div>
          ) : (
            <form onSubmit={handleJoinWaitlist} className="text-center">
              <h3 className="text-lg font-bold text-foreground mb-2">Get early access</h3>
              <p className="text-sm text-muted-foreground mb-5">
                Be the first to know when Expert Interviews launches.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="flex-1 rounded-xl border border-border bg-card/80 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors shadow-[0_4px_14px_rgba(5,148,103,0.2)] flex items-center gap-2"
                >
                  Join <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ExpertMarketplace;
