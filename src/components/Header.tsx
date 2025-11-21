import { Button } from "@/components/ui/button";
import { Menu, X, Atom, Zap, FileText, BarChart3, Users, Brain, Clock, LogOut } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useClient } from "@/contexts/ClientContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, profile, signOut } = useAuth();
  const { client } = useClient();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };
  return <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/90 border-b border-primary/20 shadow-primary">
      <div className="container mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="/" className="flex items-center gap-3 group">
            {user && profile?.logo_url ? (
              <div className="flex flex-col items-start gap-1">
                <img 
                  src={profile.logo_url} 
                  alt={profile.full_name || 'Client logo'} 
                  className="h-10 w-auto transition-all duration-300 group-hover:scale-105" 
                />
                <span className="text-xs text-muted-foreground">Powered by ScreeningPilot</span>
              </div>
            ) : (
              <>
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:shadow-glow">
                  <Brain className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="text-2xl font-bold text-primary group-hover:text-primary-light transition-colors duration-300">
                  ScreeningPilot
                </span>
              </>
            )}
          </a>

          {/* Navigation - Desktop */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="/features" className="relative text-muted-foreground hover:text-primary font-bold transition-all duration-300 hover:drop-shadow-[0_0_8px_rgba(62,207,142,0.4)] group">
              <span className="relative z-10">Features</span>
              <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-gradient-primary shadow-glow transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
            <a href="/lead-scraper" className="relative text-muted-foreground hover:text-primary font-bold transition-all duration-300 hover:drop-shadow-[0_0_8px_rgba(62,207,142,0.4)] group">
              <span className="relative z-10">Lead Scraper</span>
              <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-gradient-primary shadow-glow transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
            <a href="/deep-search" className="relative text-muted-foreground hover:text-primary font-bold transition-all duration-300 hover:drop-shadow-[0_0_8px_rgba(62,207,142,0.4)] group">
              <span className="relative z-10">Deep Search</span>
              <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-gradient-primary shadow-glow transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
            <a href="/pricing" className="relative text-muted-foreground hover:text-primary font-bold transition-all duration-300 hover:drop-shadow-[0_0_8px_rgba(62,207,142,0.4)] group">
              <span className="relative z-10">Pricing</span>
              <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-gradient-primary shadow-glow transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
            <a href="/get-demo" className="relative text-muted-foreground hover:text-primary font-bold transition-all duration-300 hover:drop-shadow-[0_0_8px_rgba(62,207,142,0.4)] group">
              <span className="relative z-10">Get a Demo</span>
              <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-gradient-primary shadow-glow transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
          </nav>

          {/* Auth Buttons */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <Button variant="outline" onClick={handleSignOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            ) : (
              <Button onClick={() => navigate('/auth')}>
                Sign In
              </Button>
            )}
          </div>


          {/* Mobile Menu Button */}
          <button className="md:hidden p-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg transition-all duration-200" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            <div className="relative w-6 h-6">
              <Menu className={`w-6 h-6 absolute transition-all duration-300 ${isMenuOpen ? 'opacity-0 rotate-180' : 'opacity-100 rotate-0'}`} />
              <X className={`w-6 h-6 absolute transition-all duration-300 ${isMenuOpen ? 'opacity-100 rotate-0' : 'opacity-0 -rotate-180'}`} />
            </div>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && <div className="md:hidden py-4 border-t border-border/50 animate-slide-down">
            <nav className="flex flex-col gap-4">
              <a href="/features" className="text-muted-foreground hover:text-primary font-medium py-2 transition-all duration-200">
                Features
              </a>
              <a href="/lead-scraper" className="text-muted-foreground hover:text-primary font-medium py-2 transition-all duration-200">
                Lead Scraper
              </a>
              <a href="/deep-search" className="text-muted-foreground hover:text-primary font-medium py-2 transition-all duration-200">
                Deep Search
              </a>
              <a href="/pricing" className="text-muted-foreground hover:text-primary font-medium py-2 transition-all duration-200">
                Pricing
              </a>
              <a href="/get-demo" className="text-muted-foreground hover:text-primary font-medium py-2 transition-all duration-200">
                Get a Demo
              </a>
              
              {/* Mobile Auth Buttons */}
              <div className="pt-4 border-t border-border/50 mt-4">
                {user ? (
                  <Button variant="outline" onClick={handleSignOut} className="w-full">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                ) : (
                  <Button onClick={() => navigate('/auth')} className="w-full">
                    Sign In
                  </Button>
                )}
              </div>
            </nav>
          </div>}
      </div>
    </header>;
};
export default Header;