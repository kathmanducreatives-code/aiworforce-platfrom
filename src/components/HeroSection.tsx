import { ArrowRight } from "lucide-react";
import InteractiveResumeMockup from "./InteractiveResumeMockup";

const HeroSection = () => {
  return (
    <section className="relative min-h-[90vh] bg-white overflow-hidden">
      {/* Subtle background glows */}
      <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-[radial-gradient(circle,_rgba(20,184,166,0.05)_0%,_transparent_70%)] blur-[80px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-[radial-gradient(circle,_rgba(6,182,212,0.03)_0%,_transparent_70%)] blur-[80px] pointer-events-none" />
      
      {/* Main content */}
      <div className="relative container mx-auto px-4 md:px-8 py-20 md:py-24">
        <div className="grid md:grid-cols-[60%_40%] gap-12 items-center">
          {/* Left Column - Content */}
          <div className="text-center md:text-left space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 border border-teal-200 rounded-full text-sm text-teal-700">
              <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
              <span>Trusted by 500+ Companies</span>
            </div>
            
            {/* Heading */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.2]">
              AI-Powered Resume<br />
              <span className="relative inline-block">
                <span className="absolute inset-0 bg-gradient-to-r from-teal-500 to-cyan-500 blur-2xl opacity-30 animate-glow-pulse-teal" />
                <span className="relative bg-gradient-to-r from-teal-500 to-cyan-500 bg-clip-text text-transparent animate-gradient-x">
                  Screening
                </span>
              </span>{" "}That<br />
              Actually Works.
            </h1>
            
            {/* Description */}
            <p className="text-base md:text-lg text-slate-600 max-w-xl mx-auto md:mx-0">
              Screen hundreds of resumes in minutes with 95% AI accuracy. Get detailed candidate insights, smart matching, and data-driven hiring decisions—all from one platform.
            </p>
            
            {/* CTA Button */}
            <div className="space-y-4">
              <button className="group relative px-8 py-4 bg-gradient-to-r from-teal-500 to-cyan-500 
                                text-white text-base font-semibold rounded-lg
                                hover:shadow-[0_0_30px_rgba(20,184,166,0.5)]
                                transition-all duration-300 w-full md:w-auto
                                flex items-center justify-center gap-2">
                Get Started Now
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              
              {/* Trust element */}
              <p className="text-sm text-slate-500 text-center md:text-left">
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
