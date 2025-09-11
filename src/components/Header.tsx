import { Button } from "@/components/ui/button";
import { Menu, X, Atom } from "lucide-react";
import { useState } from "react";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-white/10">
      <div className="container mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-lg flex items-center justify-center">
              <Atom className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-white to-slate-200 bg-clip-text text-transparent">
              AI Recruit
            </span>
          </div>

          {/* Navigation - Desktop */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-slate-300 hover:text-cyan-400 font-medium transition-colors duration-200">
              Features
            </a>
            <a href="#pricing" className="text-slate-300 hover:text-cyan-400 font-medium transition-colors duration-200">
              Pricing  
            </a>
            <a href="#about" className="text-slate-300 hover:text-cyan-400 font-medium transition-colors duration-200">
              About
            </a>
          </nav>

          {/* CTA Button - Desktop */}
          <div className="hidden md:flex">
            <Button className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white font-semibold px-6 py-2 rounded-xl shadow-lg hover:shadow-xl hover:shadow-cyan-500/25 transition-all duration-200 hover:scale-105">
              Log In
              <svg className="w-4 h-4 ml-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-slate-300 hover:text-white"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden py-4 border-t border-white/10">
            <nav className="flex flex-col gap-4">
              <a href="#features" className="text-slate-300 hover:text-cyan-400 font-medium py-2">
                Features
              </a>
              <a href="#pricing" className="text-slate-300 hover:text-cyan-400 font-medium py-2">
                Pricing
              </a>
              <a href="#about" className="text-slate-300 hover:text-cyan-400 font-medium py-2">
                About
              </a>
              <Button className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white font-semibold px-6 py-2 rounded-xl shadow-lg mt-2 w-fit">
                Log In
              </Button>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;