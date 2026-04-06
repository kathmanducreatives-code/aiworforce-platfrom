import { Twitter, Linkedin, Mail, Github, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const SOCIAL_LINKS = [
  { Icon: Twitter,  href: 'https://twitter.com/screeningpilot',              label: 'Twitter'  },
  { Icon: Linkedin, href: 'https://linkedin.com/company/screeningpilot',      label: 'LinkedIn' },
  { Icon: Github,   href: 'https://github.com/screeningpilot',               label: 'GitHub'   },
  { Icon: Mail,     href: 'mailto:hello@screeningpilot.com',                 label: 'Email'    },
];

const Footer = () => {
  const navigate = useNavigate();

  return (
    <footer className="relative border-t border-white/5 bg-transparent overflow-hidden px-6 pt-32 pb-12 w-full">
      {/* Premium Glow Gradient */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] opacity-[0.15] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent-mint to-transparent pointer-events-none" />
      
      <div className="max-w-7xl mx-auto w-full relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8 mb-24">
          
          {/* Brand Column */}
          <div className="lg:col-span-4 flex flex-col items-start">
            <div className="flex items-center gap-3 mb-8 cursor-pointer group" onClick={() => navigate('/')}>
               <div className="w-10 h-10 rounded-xl bg-accent-mint/10 border border-accent-mint/20 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.12)] group-hover:shadow-[0_0_30px_rgba(16,185,129,0.22)] transition-all">
                  <div className="w-4 h-4 rounded-full bg-accent-mint group-hover:scale-110 transition-transform" />
               </div>
               <span className="text-xl font-display font-black text-white tracking-tighter">SCREENINGPILOT</span>
            </div>
            <p className="text-white/40 text-sm leading-[1.8] max-w-[280px] mb-8 font-medium">
              The autonomous AI workforce for modern recruiting and growth. Built to give every agency an engine that never sleeps.
            </p>
            <div className="flex gap-3">
               {SOCIAL_LINKS.map(({ Icon, href, label }) => (
                 <a
                   key={label}
                   href={href}
                   target={href.startsWith('mailto') ? undefined : '_blank'}
                   rel={href.startsWith('mailto') ? undefined : 'noopener noreferrer'}
                   aria-label={label}
                   className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all hover:-translate-y-0.5"
                 >
                   <Icon className="w-4 h-4" />
                 </a>
               ))}
            </div>
          </div>

          {/* Links Columns */}
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-8 lg:gap-12">
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-[0.15em] text-white mb-6">Product</h4>
              <div className="flex flex-col gap-4">
                {['Talent Agents', 'Growth Hub', 'Content Engine', 'Market Intelligence', 'Enterprise'].map((l) => (
                  <a key={l} href="#" className="text-[13px] text-white/50 hover:text-white transition-colors font-medium flex items-center gap-1 group">
                    {l}
                  </a>
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-[0.15em] text-white mb-6">Resources</h4>
              <div className="flex flex-col gap-4">
                {['Documentation', 'API Reference', 'Integrations', 'Changelog', 'Pricing'].map((l) => (
                  <a key={l} href="#" className="text-[13px] text-white/50 hover:text-white transition-colors font-medium flex items-center gap-1 group">
                    {l}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-[11px] font-black uppercase tracking-[0.15em] text-white mb-6">Company</h4>
              <div className="flex flex-col gap-4">
                {['About Us', 'Careers', 'Blog', 'Contact', 'Partners'].map((l) => (
                  <a key={l} href="#" className="text-[13px] text-white/50 hover:text-white transition-colors font-medium flex items-center gap-1 group">
                    {l}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-[11px] font-black uppercase tracking-[0.15em] text-white mb-6">Legal</h4>
              <div className="flex flex-col gap-4">
                {['Privacy Policy', 'Terms of Service', 'Security (SOC2)', 'Cookie Policy'].map((l) => (
                  <a key={l} href="#" className="text-[13px] text-white/50 hover:text-white transition-colors font-medium flex items-center gap-1 group">
                    {l}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Global Terminal / Bottom Bar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-white/10">
           <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
             <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-mint/10 border border-accent-mint/20">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse shadow-[0_0_8px_#10B981]" />
                <span className="text-[10px] font-bold text-accent-mint uppercase tracking-widest">All Systems Operational</span>
             </div>
             
             <button className="text-[12px] font-medium text-white/40 hover:text-white transition-colors flex items-center gap-1 group">
               Status Page <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
             </button>
           </div>
           
           <div className="text-[12px] font-medium text-white/40 flex items-center gap-2">
              <span>© {new Date().getFullYear()} ScreeningPilot Inc.</span>
              <span className="w-1 h-1 rounded-full bg-white/20 hidden sm:block" />
              <span className="hidden sm:block">San Francisco, CA</span>
           </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;