import { ArrowRight } from "lucide-react";
import InteractiveResumeMockup from "./InteractiveResumeMockup";

const HeroSection = () => {
  return (
    <section className="relative min-h-[90vh] bg-[#0a0a0a] dot-grid-pattern starfield overflow-hidden">
      {/* Subtle background glows */}
      <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-[radial-gradient(circle,_rgba(20,184,166,0.08)_0%,_transparent_70%)] blur-[60px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-[radial-gradient(circle,_rgba(6,182,212,0.06)_0%,_transparent_70%)] blur-[60px] pointer-events-none" />
      
      {/* Main content */}
      <div className="relative container mx-auto px-4 md:px-8 py-20 md:py-24">
        <div className="grid md:grid-cols-[60%_40%] gap-12 items-center">
          {/* Left Column - Content */}
          <div className="text-center md:text-left space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 border border-teal-500/20 rounded-full text-sm text-white">
              <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
              <span>Trusted by 500+ Companies</span>
            </div>
            
            {/* Heading */}
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-white leading-[1.1]">
              AI-Powered Resume<br />
              Screening That<br />
              Actually Works.
            </h1>
            
            {/* Description */}
            <p className="text-lg md:text-xl text-gray-400 max-w-xl mx-auto md:mx-0">
              Screen hundreds of resumes in minutes with 95% AI accuracy. Get detailed candidate insights, smart matching, and data-driven hiring decisions—all from one platform.
            </p>
            
            {/* CTA Button */}
            <div className="space-y-4">
              <button className="group relative px-8 py-4 bg-gradient-to-r from-teal-500 to-cyan-500 
                                text-white text-lg font-semibold rounded-lg
                                hover:shadow-[0_0_30px_rgba(20,184,166,0.5)]
                                transition-all duration-300 w-full md:w-auto
                                flex items-center justify-center gap-2">
                Get Started Now
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              
              {/* Trust element */}
              <p className="text-sm text-gray-500 text-center md:text-left">
                No credit card required • Free 14-day trial
              </p>
            </div>
          </div>
          
          {/* Right Column - Interactive Mockup */}
          <div className="hidden md:block">
            <InteractiveResumeMockup />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
