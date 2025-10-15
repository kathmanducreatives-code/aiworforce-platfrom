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
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-slate-900 leading-[1.2]">
              <span className="inline-block animate-fade-in-up opacity-0 [animation-delay:100ms] [animation-fill-mode:forwards]">
                AI-Powered Resume
              </span>
              <br />
              <span className="relative inline-block group animate-fade-in-up opacity-0 [animation-delay:300ms] [animation-fill-mode:forwards]">
                <span className="absolute inset-0 bg-gradient-to-r from-teal-500 to-cyan-500 blur-2xl opacity-20 animate-glow-pulse-teal" />
                <span className="relative bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-600 text-teal-600 [background-clip:text] [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] bg-[length:200%_100%] animate-gradient-x group-hover:scale-110 transition-transform duration-300">
                  <span className="inline-block animate-[float_3s_ease-in-out_infinite]">Screening</span>
                </span>
                {/* Shimmer effect */}
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 animate-shimmer-sweep pointer-events-none" />
              </span>{" "}
              <span className="inline-block animate-fade-in-up opacity-0 [animation-delay:500ms] [animation-fill-mode:forwards]">
                That
              </span>
              <br />
              <span className="inline-block animate-fade-in-up opacity-0 [animation-delay:700ms] [animation-fill-mode:forwards] hover:text-teal-600 transition-colors duration-300">
                Actually Works.
              </span>
            </h1>
            
            {/* Description */}
            <p className="text-lg md:text-xl text-slate-600 max-w-xl mx-auto md:mx-0">
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
