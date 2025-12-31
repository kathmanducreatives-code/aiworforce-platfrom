import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import PremiumBackground from "@/components/landing/PremiumBackground";
import { Search, Brain, GitBranch, Mail, TrendingUp, CheckCircle, Zap, ShieldCheck, Database, Sparkles, ArrowRight, Target, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

const Features = () => {
  const navigate = useNavigate();
  
  const features = [
    {
      icon: Search,
      title: "Precision Sourcing Engine",
      description: "Automates the search for passive candidates on LinkedIn and other professional sites. Eliminates manual list building — recruiters stop spending time on repetitive searching and list compilation.",
      benefit: "Eliminates Manual List Building",
    },
    {
      icon: Brain,
      title: "Deep Profile Intelligence",
      description: "Cross-references scraped profiles across multiple online sources (social, patents, publications) and delivers AI-vetted analysis. Provides verified conversation angles — ensuring first outreach is highly personalized and informed.",
      benefit: "Verified Conversation Angles",
    },
    {
      icon: GitBranch,
      title: "Centralized CRM & Pipeline",
      description: "A dedicated system for managing both candidate and client relationships, deal flow, and specific follow-up statuses. Creates a single source of truth — all candidate history, client notes, and recruitment progress tracked in one place.",
      benefit: "Single Source of Truth",
    },
    {
      icon: Mail,
      title: "Customizable Email Nurturing",
      description: "Allows for both high-volume sequences (for general roles) and highly personalized, single-touch emails (for niche roles). Maintains relationships at scale — ensuring no lead goes cold through automation or strategic manual check-ins.",
      benefit: "Relationships at Scale",
    },
    {
      icon: TrendingUp,
      title: "Recruiting Agency Data Dashboard",
      description: "Visual metrics on placements, time-to-fill, source efficiency, and follow-up status. Enables data-driven growth — agency owners can quickly view KPIs and make strategic decisions to scale the business.",
      benefit: "Data-Driven Growth",
    }
  ];

  const benefits = [
    {
      icon: Zap,
      title: "Passive Talent at Scale",
      description: "Automatically discover high-quality passive candidates who aren't actively job hunting. Build targeted lists in minutes, not hours.",
    },
    {
      icon: ShieldCheck,
      title: "Verified Intelligence",
      description: "Cross-reference profiles across multiple sources. Get AI-vetted insights and personalized conversation starters for every outreach.",
    },
    {
      icon: Database,
      title: "True CRM for Recruiting",
      description: "Manage candidates AND clients in one place. Track every interaction, note, and deal stage without losing critical information.",
    },
    {
      icon: TrendingUp,
      title: "Data-Driven Decisions",
      description: "View real-time KPIs on placements, time-to-fill, and source efficiency. Make strategic decisions to scale your recruiting business.",
    }
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <PremiumBackground />
      <Header />
      
      <main className="relative z-10 pt-24 pb-16">
        {/* Hero Section */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto text-center">
            <Badge 
              variant="outline" 
              className="border-primary/30 text-primary mb-8 animate-fade-in"
            >
              <Sparkles className="w-3 h-3 mr-2" />
              Revolutionary AI Technology
            </Badge>
            
            <h1 className="text-4xl md:text-6xl font-bold gradient-heading mb-8 animate-fade-in-up">
              The Only CRM Built for <br />
              <span className="text-primary">Recruiting Excellence</span>
            </h1>
            
            <p className="text-xl text-muted-foreground mb-12 leading-relaxed max-w-4xl mx-auto animate-fade-in-up" style={{animationDelay: '0.2s'}}>
              Automate passive talent discovery, deliver verified candidate intelligence, and manage every relationship in one AI-powered system. Built specifically for recruiting agencies who want to make faster, smarter placements.
            </p>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto mb-16">
              <div className="glass-card-premium rounded-2xl p-6 text-center animate-fade-in-up" style={{animationDelay: '0.3s'}}>
                <div className="text-4xl font-bold text-primary mb-2">90%</div>
                <div className="text-foreground font-medium">Faster Sourcing</div>
                <div className="text-sm text-muted-foreground mt-1">Time saved on manual searching</div>
              </div>
              <div className="glass-card-premium rounded-2xl p-6 text-center animate-fade-in-up" style={{animationDelay: '0.4s'}}>
                <div className="text-4xl font-bold text-primary mb-2">100%</div>
                <div className="text-foreground font-medium">Verified Intelligence</div>
                <div className="text-sm text-muted-foreground mt-1">Cross-referenced data accuracy</div>
              </div>
              <div className="glass-card-premium rounded-2xl p-6 text-center animate-fade-in-up" style={{animationDelay: '0.5s'}}>
                <div className="text-4xl font-bold text-primary mb-2">3x</div>
                <div className="text-foreground font-medium">More Pipeline</div>
                <div className="text-sm text-muted-foreground mt-1">Relationship management capacity</div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-16 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-8">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="group glass-card-premium glow-hover rounded-2xl p-8 animate-fade-in-up"
                  style={{animationDelay: `${0.1 * index}s`}}
                >
                  {/* Icon Container */}
                  <div className="inline-flex p-4 rounded-xl bg-primary/10 mb-6 group-hover:scale-110 transition-transform duration-300">
                    <feature.icon className="h-8 w-8 text-primary" />
                  </div>
                  
                  {/* Title */}
                  <h3 className="text-2xl font-bold text-foreground mb-4">
                    {feature.title}
                  </h3>
                  
                  {/* Description */}
                  <p className="text-muted-foreground mb-4 leading-relaxed">
                    {feature.description}
                  </p>
                  
                  {/* Benefit Badge */}
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-sm text-primary font-medium">
                    <CheckCircle className="h-4 w-4" />
                    {feature.benefit}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6 animate-fade-in-up">
                Why Choose ScreeningPilot?
              </h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
              {benefits.map((benefit, index) => (
                <div 
                  key={index}
                  className="glass-card-premium glow-hover rounded-2xl p-8 animate-fade-in-up" 
                  style={{animationDelay: `${0.1 * index}s`}}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-primary/10 rounded-xl">
                      <benefit.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-foreground mb-2">{benefit.title}</h3>
                      <p className="text-muted-foreground">
                        {benefit.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-20 px-6 border-t border-border/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <Badge variant="outline" className="border-primary/30 text-primary mb-4">
                <Target className="w-3 h-3 mr-2" />
                Simple Process
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                How It Works
              </h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Get started in minutes and transform your recruitment workflow
              </p>
            </div>

            <div className="grid md:grid-cols-4 gap-8">
              {[
                { step: "01", title: "Source Candidates", description: "Use our AI-powered search to find passive talent from LinkedIn and other platforms" },
                { step: "02", title: "Deep Analysis", description: "Get verified intelligence with cross-referenced data and personalized conversation starters" },
                { step: "03", title: "Engage & Nurture", description: "Send personalized email sequences and track every interaction in your CRM" },
                { step: "04", title: "Make Placements", description: "Close deals faster with data-driven insights and streamlined workflows" }
              ].map((item, index) => (
                <div key={index} className="text-center animate-fade-in-up" style={{animationDelay: `${0.1 * index}s`}}>
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-primary">{item.step}</span>
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="glass-card-premium rounded-3xl p-12 text-center">
              <Badge variant="outline" className="border-primary/30 text-primary mb-6 animate-fade-in">
                <Users className="w-3 h-3 mr-2" />
                Join 10,000+ Companies
              </Badge>
              
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6 animate-fade-in-up">
                Ready to Transform Your Recruiting Agency?
              </h2>
              <p className="text-xl text-muted-foreground mb-8 animate-fade-in-up max-w-2xl mx-auto" style={{animationDelay: '0.1s'}}>
                Join hundreds of recruiting agencies using ScreeningPilot to automate passive talent discovery, deliver verified intelligence, and make faster placements.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-fade-in-up" style={{animationDelay: '0.2s'}}>
                <Button 
                  onClick={() => navigate('/auth')}
                  size="lg" 
                  className="bg-primary hover:bg-primary/90 shadow-glow group"
                >
                  <span className="flex items-center gap-2">
                    Start Free Trial
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                </Button>
                
                <Button 
                  onClick={() => navigate('/get-demo')}
                  size="lg" 
                  variant="outline"
                  className="border-border hover:bg-accent/10 hover:border-primary/50"
                >
                  Watch Demo
                </Button>
              </div>
              
              <p className="text-sm text-muted-foreground mt-4">
                No credit card required • 14-day free trial • Cancel anytime
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Features;
