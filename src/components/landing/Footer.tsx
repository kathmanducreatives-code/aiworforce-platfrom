import { Twitter, Linkedin, Mail } from 'lucide-react';

const Footer = () => (
  <footer className="relative border-t border-white/[0.04] bg-[#020202] px-4 py-16">
    <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-10 mb-12">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/25 mb-4">Product</h4>
        <div className="space-y-3">
          {['AI Workforce Platform', 'Talent Department', 'Growth Department', 'Intelligence Department', 'Custom Agent Builder', 'Pricing'].map((l) => (
            <a key={l} href="#" className="block text-sm text-white/30 hover:text-white/60 transition-colors">{l}</a>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/25 mb-4">Company</h4>
        <div className="space-y-3">
          {['About', 'Blog', 'Careers', 'Contact', 'Changelog'].map((l) => (
            <a key={l} href="#" className="block text-sm text-white/30 hover:text-white/60 transition-colors">{l}</a>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/25 mb-4">Legal</h4>
        <div className="space-y-3">
          {['Privacy Policy', 'Terms of Service', 'GDPR', 'Security'].map((l) => (
            <a key={l} href="#" className="block text-sm text-white/30 hover:text-white/60 transition-colors">{l}</a>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/25 mb-4">Connect</h4>
        <div className="flex gap-3">
          {[Twitter, Linkedin, Mail].map((Icon, i) => (
            <a key={i} href="#" className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/25 hover:text-emerald-400 hover:border-emerald-500/20 transition-all">
              <Icon className="w-4 h-4" />
            </a>
          ))}
        </div>
      </div>
    </div>
    <div className="border-t border-white/[0.04] pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(5,150,105,0.5)]" />
        <span className="text-xs text-white/20">© 2026 ScreeningPilot</span>
      </div>
      <p className="text-xs text-white/15 italic">Built to give every founder an AI workforce.</p>
    </div>
  </footer>
);

export default Footer;