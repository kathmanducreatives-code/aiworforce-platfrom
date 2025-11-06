import { ArrowRight } from "lucide-react";
import InteractiveResumeMockup from "./InteractiveResumeMockup";

const HeroSection = () => {
  return (
    <section className="relative min-h-[90vh] bg-background overflow-hidden">
      {/* Subtle background mesh */}
      <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-[radial-gradient(circle,_hsl(243_75%_59%_/_0.04)_0%,_transparent_70%)] blur-[80px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-[radial-gradient(circle,_hsl(262_83%_58%_/_0.03)_0%,_transparent_70%)] blur-[80px] pointer-events-none" />
      
      {/* Main content */}
      <div className="relative container mx-auto px-4 md:px-8 py-20 md:py-24">
        <div className="grid md:grid-cols-[60%_40%] gap-12 items-center">
          {/* Left Column - Content */}
          <div className="text-center md:text-left space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/5 border border-primary/20 rounded-full text-sm text-primary font-medium">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>Automated Passive Talent Discovery</span>
            </div>
            
            {/* Heading */}
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-[1.2]">
              <span className="inline-block">
                The All-in-One
              </span>
              <br />
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-primary via-accent-secondary to-primary bg-clip-text text-transparent">
                  Recruitment
                </span>
              </span>
              {" "}
              <span className="inline-block">
                Platform
              </span>
              <br />
              <span className="inline-block">
                Built on{" "}
              </span>
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-primary via-accent to-accent-secondary bg-clip-text text-transparent font-extrabold">
                  Intelligence
                </span>
              </span>
            </h1>
            
            {/* Description */}
            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto md:mx-0">
              From sourcing to nurturing — automate your entire recruiting workflow. Discover top candidates, gain deep insights, and manage every relationship in one AI-powered system.
            </p>
            
            {/* CTA Button */}
            <div className="space-y-4">
              <button className="group relative px-8 py-4 bg-accent
                                text-white text-base font-semibold rounded-lg
                                hover:bg-accent/90 hover:shadow-lg
                                transition-all duration-200 w-full md:w-auto
                                flex items-center justify-center gap-2">
                Get Started Now
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              
              {/* Trust element */}
              <p className="text-sm text-muted-foreground text-center md:text-left">
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
