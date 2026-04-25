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

const LandingHeader = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navItems = [
    { label: "How It Works", href: "#hero-to-expert-sequence" },
    { label: "Departments", href: "#departments" },
    { label: "Pricing", href: "#pricing" },
    { label: "Enterprise", href: "#enterprise" },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled ? "glass-strong border-b border-white/5 py-3" : "bg-transparent py-5"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => navigate("/")}>
          <div className="w-2.5 h-2.5 rounded-full bg-[#298799] shadow-[0_0_10px_rgba(41,135,153,0.6)] group-hover:scale-125 transition-transform animate-pulse" />
          <span className="font-display font-black text-xl text-white tracking-tighter">ScreeningPilot</span>
        </div>

        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-sm text-white/60 hover:text-white font-semibold transition-colors duration-300 relative group"
            >
              {item.label}
              <span className="absolute -bottom-1 left-0 w-0 h-[1px] bg-[#298799] group-hover:w-full transition-all duration-300" />
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <>
              <button
                onClick={() => navigate("/dashboard")}
                className="text-sm text-white/50 hover:text-white font-medium transition-colors"
              >
                Dashboard
              </button>
              <button onClick={signOut} className="text-sm text-white/50 hover:text-white font-medium transition-colors">
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button onClick={() => navigate("/auth")} className="text-sm text-white/60 hover:text-white font-semibold transition-colors">
                Sign In
              </button>
              <button
                onClick={() => navigate("/auth")}
                className="glass-button-green h-[42px] px-6 text-white text-sm font-semibold rounded-full transition-all duration-300 border border-[#298799]/20 shadow-[0_12px_28px_rgba(0,0,0,0.28),0_0_16px_rgba(41,135,153,0.08)] flex items-center justify-center"
              >
                Meet your workforce →
              </button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors px-2 py-1 rounded-md border border-white/[0.06]">
              <Globe className="w-3.5 h-3.5" /> EN
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#0d1117] border-white/[0.08]">
              <DropdownMenuItem className="text-white text-xs font-medium">English</DropdownMenuItem>
              <DropdownMenuItem disabled className="text-white/20 text-xs">
                हिंदी — coming soon
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="text-white/20 text-xs">
                Deutsch — coming soon
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="text-white/20 text-xs">
                Português — coming soon
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button
          className="md:hidden p-2 text-white/50 hover:text-white rounded-lg transition-colors"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
        >
          {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {isMenuOpen && (
        <div className="md:hidden mx-4 mt-2 glass rounded-2xl p-4">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="block py-3 text-sm text-white/60 hover:text-white font-medium border-b border-white/5 last:border-0"
            >
              {item.label}
            </a>
          ))}
          <div className="mt-4 flex gap-3">
            <button onClick={() => navigate("/auth")} className="text-sm text-white/60 hover:text-white font-medium">
              Sign In
            </button>
            <button
              onClick={() => navigate("/auth")}
              className="glass-button-green text-white text-sm font-semibold px-4 py-2 rounded-full border border-[#298799]/20"
            >
              Meet your workforce →
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default LandingHeader;
