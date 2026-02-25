import { Button } from "@/components/ui/button";
import { Menu, X, Brain, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useClient } from "@/contexts/ClientContext";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, profile, signOut } = useAuth();
  const { client } = useClient();
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled
          ? 'bg-white/80 backdrop-blur-[20px] border-b border-zinc-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
          : 'bg-white/60 backdrop-blur-md border-b border-transparent'
        }`}
      style={{ padding: scrolled ? '0' : '0' }}
    >
      <div className="max-w-7xl mx-auto px-6">
        <div
          className={`flex items-center justify-between transition-all duration-300 ${scrolled ? 'h-14' : 'h-16'
            }`}
        >
          {/* Logo */}
          <a href={user ? "/dashboard" : "/"} className="flex items-center gap-2.5 group">
            {user && profile?.logo_url ? (
              <div className="flex flex-col items-start gap-1">
                <img
                  src={profile.logo_url}
                  alt={profile.full_name || 'Client logo'}
                  className="h-10 w-auto transition-all duration-300 group-hover:scale-105"
                />
                <span className="text-[10px] text-zinc-400">Powered by ScreeningPilot</span>
              </div>
            ) : (
              <>
                <div className="w-7 h-7 bg-emerald-600 rounded-full flex items-center justify-center">
                  <div className="w-2.5 h-2.5 bg-white rounded-full" />
                </div>
                <span className="text-lg font-bold text-zinc-900">
                  ScreeningPilot
                </span>
              </>
            )}
          </a>

          {/* Navigation - Desktop */}
          <nav className="hidden md:flex items-center gap-7">
            {['Features', 'Lead Scraper', 'Deep Search', 'Pricing', 'Get a Demo'].map((item) => (
              <a
                key={item}
                href={`/${item.toLowerCase().replace(/\s+/g, '-')}`}
                className="text-sm text-zinc-500 hover:text-zinc-900 font-medium transition-colors duration-200"
              >
                {item}
              </a>
            ))}
          </nav>

          {/* Auth Buttons */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            ) : (
              <>
                <button
                  onClick={() => navigate('/auth')}
                  className="text-sm text-zinc-500 hover:text-zinc-900 font-medium transition-colors"
                >
                  Sign In
                </button>
                <button
                  onClick={() => navigate('/auth')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_4px_16px_rgba(5,150,105,0.25)]"
                >
                  Start Free Trial
                </button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden py-4 border-t border-zinc-100">
            <nav className="flex flex-col gap-1">
              {['Features', 'Lead Scraper', 'Deep Search', 'Pricing', 'Get a Demo'].map((item) => (
                <a
                  key={item}
                  href={`/${item.toLowerCase().replace(/\s+/g, '-')}`}
                  className="text-zinc-600 hover:text-emerald-600 font-medium py-2.5 px-2 rounded-lg hover:bg-emerald-50/50 transition-all text-sm"
                >
                  {item}
                </a>
              ))}
              <div className="pt-3 mt-2 border-t border-zinc-100 space-y-2">
                {user ? (
                  <Button variant="outline" onClick={handleSignOut} className="w-full" size="sm">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                ) : (
                  <>
                    <button
                      onClick={() => navigate('/auth')}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-all"
                    >
                      Start Free Trial
                    </button>
                    <button
                      onClick={() => navigate('/auth')}
                      className="w-full text-sm text-zinc-500 font-medium py-2"
                    >
                      Sign In
                    </button>
                  </>
                )}
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
};
export default Header;