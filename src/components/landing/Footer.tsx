import { Link } from 'react-router-dom';
import { Brain, Twitter, Linkedin, Mail } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="bg-[#065f46] text-white relative z-10">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Product */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-emerald-400 flex items-center justify-center">
                <Brain className="w-4 h-4 text-emerald-900" />
              </div>
              <span className="font-sans font-bold text-lg">ScreeningPilot</span>
            </div>
            <ul className="space-y-3">
              <li><Link to="/lead-scraper" className="text-white/60 hover:text-white text-sm transition-colors">Lookalike Search</Link></li>
              <li><Link to="/features" className="text-white/60 hover:text-white text-sm transition-colors">AI Screening</Link></li>
              <li><Link to="/lead-scraper" className="text-white/60 hover:text-white text-sm transition-colors">Lead Scraper</Link></li>
              <li><Link to="/deep-search" className="text-white/60 hover:text-white text-sm transition-colors">Deep Search</Link></li>
              <li><span className="text-white/60 text-sm">Pipeline</span></li>
              <li><span className="text-white/60 text-sm">Collaboration</span></li>
              <li><Link to="/pricing" className="text-white/60 hover:text-white text-sm transition-colors">Pricing</Link></li>
            </ul>
          </div>

          {/* Company */}
          <div className="space-y-4">
            <h4 className="font-sans font-semibold text-sm uppercase tracking-wider text-white/80 mb-6">Company</h4>
            <ul className="space-y-3">
              <li><span className="text-white/60 text-sm">About</span></li>
              <li><span className="text-white/60 text-sm">Blog</span></li>
              <li><span className="text-white/60 text-sm">Careers</span></li>
              <li><span className="text-white/60 text-sm">Contact</span></li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h4 className="font-sans font-semibold text-sm uppercase tracking-wider text-white/80 mb-6">Legal</h4>
            <ul className="space-y-3">
              <li><span className="text-white/60 text-sm">Privacy Policy</span></li>
              <li><span className="text-white/60 text-sm">Terms of Service</span></li>
              <li><span className="text-white/60 text-sm">Security</span></li>
              <li><span className="text-white/60 text-sm">GDPR</span></li>
            </ul>
          </div>

          {/* Connect */}
          <div className="space-y-4">
            <h4 className="font-sans font-semibold text-sm uppercase tracking-wider text-white/80 mb-6">Connect</h4>
            <div className="flex items-center gap-3">
              <a href="#" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <Twitter className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <Linkedin className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <Mail className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/40 text-sm">© {new Date().getFullYear()} ScreeningPilot. All rights reserved.</p>
          <p className="text-white/40 text-sm italic">Built for founders who refuse to overpay.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
