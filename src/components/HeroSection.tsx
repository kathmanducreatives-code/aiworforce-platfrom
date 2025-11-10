import { ArrowRight } from "lucide-react";
import InteractiveResumeMockup from "./InteractiveResumeMockup";

const HeroSection = () => {
  return (
    <section className="relative min-h-[90vh] bg-gradient-to-br from-background via-background to-muted/20 overflow-hidden">
      {/* Futuristic background effects */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-40" />
      <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-[radial-gradient(circle,_hsl(153_75%_53%_/_0.06)_0%,_transparent_70%)] blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-[radial-gradient(circle,_hsl(153_65%_48%_/_0.05)_0%,_transparent_70%)] blur-[100px] pointer-events-none" />
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(62,207,142,0.08) 1px, transparent 0)',
        backgroundSize: '40px 40px'
      }} />
      
      {/* Main content */}
      <div className="relative container mx-auto px-4 md:px-8 py-20 md:py-24">
        <div className="grid md:grid-cols-[60%_40%] gap-12 items-center">
          {/* Left Column - Content */}
          <div className="text-center md:text-left space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full text-sm text-primary font-semibold">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span>Automated Passive Talent Discovery</span>
            </div>
            
            {/* Heading */}
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-foreground leading-[1.2]">
              <span className="inline-block">
                The All-in-One
              </span>
              <br />
              <span className="relative inline-block">
                <span className="bg-gradient-primary bg-clip-text text-transparent">
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
                <span className="bg-gradient-primary bg-clip-text text-transparent">
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
              <button className="group relative px-8 py-4 bg-gradient-primary
                                text-primary-foreground text-base font-bold rounded-lg
                                shadow-lg hover:shadow-primary hover:scale-[1.02]
                                transition-all duration-300 w-full md:w-auto
                                flex items-center justify-center gap-2 overflow-hidden">
                <span className="relative z-10">Get Started Now</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform relative z-10" />
                <div className="absolute inset-0 bg-gradient-shimmer animate-shimmer opacity-30" />
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
