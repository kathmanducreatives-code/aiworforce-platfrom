import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle, Users, Zap, TrendingUp, Sparkles, Target, Clock } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      {/* Decorative Elements */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-accent/10"></div>
      <div className="absolute top-1/4 right-1/4 w-72 h-72 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-gradient-to-tr from-accent/15 to-primary/15 rounded-full blur-3xl animate-pulse delay-1000"></div>
      
      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="max-w-6xl mx-auto">
          
          {/* Main Hero Content */}
          <div className="text-center space-y-12 animate-fade-in">
            
            {/* Badge */}
            <div className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-primary/10 to-accent/10 text-primary text-sm font-semibold rounded-full border border-primary/20 hover-scale">
              <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
              Next-Gen AI Recruitment Platform
            </div>
            
            {/* Heading */}
            <div className="space-y-6">
              <h1 className="text-5xl lg:text-7xl font-bold text-foreground leading-[1.1] tracking-tight">
                Screen Resumes with{" "}
                <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient bg-300%">
                  AI Precision
                </span>
              </h1>
              <p className="text-xl lg:text-2xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
                Transform your recruitment process with intelligent resume screening. 
                Upload multiple resumes and get instant AI-powered analysis, scoring, and insights in seconds.
              </p>
            </div>

            {/* Feature Cards */}
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <div className="group p-6 bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
                <div className="w-12 h-12 bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Clock className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">95% Time Saved</h3>
                <p className="text-sm text-muted-foreground">Instant AI analysis replaces hours of manual screening</p>
              </div>
              
              <div className="group p-6 bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl hover:shadow-lg hover:shadow-accent/5 transition-all duration-300 hover:-translate-y-1">
                <div className="w-12 h-12 bg-gradient-to-br from-accent/10 to-accent/5 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Target className="w-6 h-6 text-accent" />
                </div>
                <h3 className="font-semibold mb-2">Better Matches</h3>
                <p className="text-sm text-muted-foreground">Advanced AI identifies the perfect candidates faster</p>
              </div>
              
              <div className="group p-6 bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
                <div className="w-12 h-12 bg-gradient-to-br from-primary/10 to-accent/10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <TrendingUp className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">Faster Hiring</h3>
                <p className="text-sm text-muted-foreground">Streamlined process from screening to final selection</p>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg" 
                className="bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary text-primary-foreground shadow-lg hover:shadow-xl hover:shadow-primary/25 transition-all duration-300 text-lg px-10 py-6 rounded-xl hover-scale"
              >
                Start Screening Now
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button 
                variant="outline" 
                size="lg" 
                className="text-lg px-10 py-6 rounded-xl border-2 hover:bg-card/80 backdrop-blur-sm hover-scale"
              >
                Watch Demo
                <Sparkles className="ml-2 w-5 h-5" />
              </Button>
            </div>

            {/* Social Proof */}
            <div className="pt-12">
              <div className="max-w-4xl mx-auto">
                <p className="text-sm text-muted-foreground mb-8 font-medium">Trusted by 500+ recruitment agencies worldwide</p>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-8 items-center opacity-60">
                  <div className="text-xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">RecruiterPro</div>
                  <div className="text-xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">TalentHub</div>
                  <div className="text-xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">HireGenius</div>
                  <div className="text-xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent hidden md:block">EliteHR</div>
                  <div className="text-xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent hidden md:block">StaffFlow</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;