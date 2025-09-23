import { Button } from "@/components/ui/button";
import { Menu, X, Atom, Zap, FileText, BarChart3, Users, Brain, Clock } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-white/90 border-b border-slate-200/50">
      <div className="container mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-lg flex items-center justify-center hover-scale overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-teal-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <Atom className="w-5 h-5 text-white relative z-10 group-hover:animate-pulse" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent group-hover:from-cyan-600 group-hover:to-teal-600 transition-all duration-300">
              ScreeningPilot
            </span>
          </div>

          {/* Navigation - Desktop */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="/features" className="relative text-slate-600 hover:text-cyan-600 font-medium transition-all duration-300 group">
              <span className="relative z-10">Features</span>
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-cyan-500 to-teal-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
            <a href="#pricing" className="relative text-slate-600 hover:text-cyan-600 font-medium transition-all duration-300 group">
              <span className="relative z-10">Pricing</span>
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-cyan-500 to-teal-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
            <a href="#about" className="relative text-slate-600 hover:text-cyan-600 font-medium transition-all duration-300 group">
              <span className="relative z-10">About</span>
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-cyan-500 to-teal-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
            </a>
          </nav>


          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all duration-200 active-scale"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <div className="relative w-6 h-6">
              <Menu className={`w-6 h-6 absolute transition-all duration-300 ${isMenuOpen ? 'opacity-0 rotate-180' : 'opacity-100 rotate-0'}`} />
              <X className={`w-6 h-6 absolute transition-all duration-300 ${isMenuOpen ? 'opacity-100 rotate-0' : 'opacity-0 -rotate-180'}`} />
            </div>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden py-4 border-t border-slate-200/50 animate-slide-down">
            <nav className="flex flex-col gap-4">
              <a href="/features" className="text-slate-600 hover:text-cyan-600 font-medium py-2 transition-all duration-200 hover:translate-x-2 animate-fade-in-left animate-delay-100">
                Features
              </a>
              <a href="#pricing" className="text-slate-600 hover:text-cyan-600 font-medium py-2 transition-all duration-200 hover:translate-x-2 animate-fade-in-left animate-delay-200">
                Pricing
              </a>
              <a href="#about" className="text-slate-600 hover:text-cyan-600 font-medium py-2 transition-all duration-200 hover:translate-x-2 animate-fade-in-left animate-delay-300">
                About
              </a>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;