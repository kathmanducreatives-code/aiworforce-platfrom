import { Twitter, Linkedin, Mail } from 'lucide-react';

const SOCIAL_LINKS = [
  { Icon: Twitter, label: "Follow us on Twitter" },
  { Icon: Linkedin, label: "Connect on LinkedIn" },
  { Icon: Mail, label: "Contact us by email" },
] as const;

const Footer = () => (
  <footer className="relative border-t border-white/5 bg-black px-6 py-24">
    <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-16 mb-24">
      {/* Brand Column */}
      <div className="md:col-span-4">
        <div className="flex items-center gap-3 mb-8">
           <div className="w-10 h-10 rounded-xl bg-accent-mint flex items-center justify-center shadow-[0_0_20px_rgba(0,255,148,0.3)]">
              <div className="w-5 h-5 bg-black rounded-sm rotate-45" />
           </div>
           <span className="text-xl font-display font-black text-white tracking-tighter">PILOT</span>
        </div>
        <p className="text-white/50 text-sm leading-relaxed max-w-xs mb-8">
          The autonomous AI workforce for modern founders. Built to give every company a research and growth engine that never sleeps.
        </p>
        <div className="flex gap-4">
           {SOCIAL_LINKS.map(({ Icon, label }) => (
             <a key={label} href="#" aria-label={label} className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-accent-mint hover:border-accent-mint/30 transition-all">
                <Icon className="w-4 h-4" />
             </a>
           ))}
        </div>
      </div>

      {/* Links Columns */}
      <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-12">
        <div>
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-8">Product</h4>
          <div className="space-y-4">
            {['Workforce', 'Talent', 'Growth', 'Intelligence'].map((l) => (
              <a key={l} href="#" className="block text-sm text-white/50 hover:text-accent-mint transition-colors font-medium">{l}</a>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-8">Legal</h4>
          <div className="space-y-4">
            {['Privacy', 'Terms', 'Security'].map((l) => (
              <a key={l} href="#" className="block text-sm text-white/50 hover:text-accent-mint transition-colors font-medium">{l}</a>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-8">Support</h4>
          <div className="space-y-4">
            {['Documentation', 'Changelog', 'Contact'].map((l) => (
              <a key={l} href="#" className="block text-sm text-white/50 hover:text-accent-mint transition-colors font-medium">{l}</a>
            ))}
          </div>
        </div>
      </div>
    </div>

    <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8 pt-12 border-t border-white/5">
       <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
          <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">System Status: All Systems Operational</span>
       </div>
       <div className="text-[10px] font-black text-white/50 uppercase tracking-widest">
          &copy; 2026 SCREENINGPILOT AGENTS. ALL RIGHTS RESERVED.
       </div>
    </div>
  </footer>
);

export default Footer;
