import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Menu, X, Brain } from "lucide-react";

const Header = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navItems = [
    { label: 'Features', href: '#features' },
    { label: 'Lead Scraper', href: '/lead-scraper' },
    { label: 'Deep Search', href: '/deep-search' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'Get a Demo', href: '/get-demo' },
  ];

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled
      ? 'bg-background/80 backdrop-blur-2xl border-b border-border py-3'
      : 'bg-transparent py-5'
      }`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => navigate('/')}>
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(5,150,105,0.6)] group-hover:scale-125 transition-transform" />
          <span className="font-display font-black text-xl text-white tracking-tighter">ScreeningPilot</span>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <a key={item.label} href={item.href}
              className="text-sm text-white/60 hover:text-white font-semibold transition-colors duration-300 relative group">
              {item.label}
              <span className="absolute -bottom-1 left-0 w-0 h-[1px] bg-emerald-500 group-hover:w-full transition-all duration-300" />
            </a>
          ))}
        </nav>

        {/* Right */}
        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <>
              <button onClick={() => navigate('/dashboard')} className="text-sm text-white/50 hover:text-white font-medium transition-colors">Dashboard</button>
              <button onClick={signOut} className="text-sm text-white/50 hover:text-white font-medium transition-colors">Sign Out</button>
            </>
          ) : (
            <>
              <button onClick={() => navigate('/auth')} className="text-sm text-white/60 hover:text-white font-semibold transition-colors">Sign In</button>
              <button onClick={() => navigate('/auth')} className="liquid-fill-btn h-[40px] px-6 bg-emerald-600/20 border border-emerald-500/50 text-white text-sm font-semibold rounded-full transition-all duration-300 hover:shadow-[0_0_20px_rgba(5,150,105,0.5)] flex items-center justify-center">
                Start Free Trial
              </button>
            </>
          )}
        </div>

        {/* Mobile */}
        <button className="md:hidden p-2 text-white/50 hover:text-white rounded-lg transition-colors" onClick={() => setIsMenuOpen(!isMenuOpen)}>
          {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {isMenuOpen && (
        <div className="md:hidden mx-4 mt-2 glass rounded-2xl p-4">
          {navItems.map((item) => (
            <a key={item.label} href={item.href} className="block py-3 text-sm text-white/60 hover:text-white font-medium border-b border-white/5 last:border-0">{item.label}</a>
          ))}
          <div className="mt-4 flex gap-3">
            <button onClick={() => navigate('/auth')} className="text-sm text-white/60 hover:text-white font-medium">Sign In</button>
            <button onClick={() => navigate('/auth')} className="bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-full">Start Free Trial</button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;