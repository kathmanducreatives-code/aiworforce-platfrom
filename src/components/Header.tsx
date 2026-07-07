import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Menu, X, Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    { label: 'How It Works', href: '#hero-to-expert-sequence' },
    { label: 'Departments', href: '#departments' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'Enterprise', href: '#enterprise' },
  ];

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled
      ? 'bg-[#030303]/60 backdrop-blur-xl border-b border-white/[0.03] py-3'
      : 'bg-transparent py-5'
      }`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => navigate('/')}>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)] group-hover:scale-125 transition-transform animate-pulse" />
          <span className="font-display font-bold text-lg text-white tracking-tight">ScreeningPilot</span>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <a key={item.label} href={item.href}
              className="text-sm text-neutral-400 hover:text-white font-medium transition-colors duration-300 relative group">
              {item.label}
              <span className="absolute -bottom-1 left-0 w-0 h-[1px] bg-emerald-400 group-hover:w-full transition-all duration-300" />
            </a>
          ))}
        </nav>

        {/* Right */}
        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <>
              <button onClick={() => navigate('/dashboard')} className="text-sm text-neutral-400 hover:text-white font-medium transition-colors">Dashboard</button>
              <button onClick={signOut} className="text-sm text-neutral-400 hover:text-white font-medium transition-colors">Sign Out</button>
            </>
          ) : (
            <>
              <button onClick={() => navigate('/auth')} className="text-sm text-neutral-400 hover:text-white font-medium transition-colors">Sign In</button>
              <button onClick={() => navigate('/dashboard')} className="text-sm text-neutral-300 hover:text-white font-medium transition-colors">Launch App</button>
              <button onClick={() => navigate('/auth')} className="liquid-fill-btn h-[36px] px-5 bg-emerald-500/[0.04] border border-emerald-500/25 text-emerald-300 text-sm font-medium rounded-full transition-all duration-300 hover:bg-emerald-500/[0.08] hover:border-emerald-500/40 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)] flex items-center justify-center">
                Meet your workforce →
              </button>
            </>
          )}
          {/* Language selector */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors px-2 py-1 rounded-md border border-white/[0.04]">
              <Globe className="w-3.5 h-3.5" /> EN
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#0A0A0A] border-white/[0.04]">
              <DropdownMenuItem className="text-white text-xs font-medium focus:bg-white/[0.04]">English</DropdownMenuItem>
              <DropdownMenuItem disabled className="text-white/20 text-xs">हिंदी — coming soon</DropdownMenuItem>
              <DropdownMenuItem disabled className="text-white/20 text-xs">Deutsch — coming soon</DropdownMenuItem>
              <DropdownMenuItem disabled className="text-white/20 text-xs">Português — coming soon</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile */}
        <button
          className="md:hidden p-2 text-neutral-400 hover:text-white rounded-lg transition-colors"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMenuOpen}
        >
          {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {isMenuOpen && (
        <div className="md:hidden mx-4 mt-2 glass-elevated rounded-2xl p-4 border border-white/[0.04]">
          {navItems.map((item) => (
            <a key={item.label} href={item.href} className="block py-3 text-sm text-neutral-400 hover:text-white font-medium border-b border-white/[0.03] last:border-0">{item.label}</a>
          ))}
          <div className="mt-4 flex gap-3 items-center">
            <button onClick={() => navigate('/auth')} className="text-sm text-neutral-400 hover:text-white font-medium">Sign In</button>
            <button onClick={() => navigate('/auth')} className="bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-300 text-sm font-medium px-4 py-2 rounded-full">Meet your workforce →</button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;