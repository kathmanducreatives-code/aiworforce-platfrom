import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle, Users, Zap, TrendingUp } from "lucide-react";
import heroImage from "@/assets/hero-resume-screening.jpg";

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-subtle">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Content */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center px-3 py-1 bg-primary/10 text-primary text-sm font-medium rounded-full">
                <Zap className="w-4 h-4 mr-2" />
                AI-Powered Recruitment
              </div>
              <h1 className="text-4xl lg:text-6xl font-bold text-foreground leading-tight">
                Screen Resumes with 
                <span className="bg-gradient-hero bg-clip-text text-transparent"> AI Precision</span>
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Transform your recruitment process with intelligent resume screening. 
                Upload multiple resumes and get instant AI-powered analysis, scoring, and insights.
              </p>
            </div>

            {/* Benefits */}
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-5 h-5 text-accent" />
                <span className="text-sm font-medium">95% Time Saved</span>
              </div>
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-accent" />
                <span className="text-sm font-medium">Better Matches</span>
              </div>
              <div className="flex items-center space-x-2">
                <TrendingUp className="w-5 h-5 text-accent" />
                <span className="text-sm font-medium">Faster Hiring</span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Button 
                size="lg" 
                className="bg-gradient-primary hover:shadow-primary transition-all duration-300 text-lg px-8"
              >
                Start Screening Now
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button variant="outline" size="lg" className="text-lg px-8">
                Watch Demo
              </Button>
            </div>

            {/* Social Proof */}
            <div className="pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground mb-4">Trusted by 500+ recruitment agencies</p>
              <div className="flex items-center space-x-8 opacity-60">
                <div className="text-lg font-semibold">RecruiterPro</div>
                <div className="text-lg font-semibold">TalentHub</div>
                <div className="text-lg font-semibold">HireGenius</div>
              </div>
            </div>
          </div>

          {/* Hero Image */}
          <div className="relative">
            <div className="relative z-10">
              <img 
                src={heroImage} 
                alt="AI-powered resume screening visualization" 
                className="w-full h-auto rounded-2xl shadow-lg"
              />
            </div>
            {/* Decorative elements */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-primary/20 rounded-full blur-xl"></div>
            <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-accent/20 rounded-full blur-xl"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;