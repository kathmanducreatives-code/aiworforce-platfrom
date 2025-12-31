import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import InteractiveResumeMockup from "@/components/InteractiveResumeMockup";
import TypewriterText from "@/components/landing/TypewriterText";
import AnimatedCounter from "@/components/landing/AnimatedCounter";
import FeatureCard from "@/components/landing/FeatureCard";
import BackgroundEffects from "@/components/landing/BackgroundEffects";
import { Sparkles, Brain, Zap, Users, Target, TrendingUp, ArrowRight, ChevronDown, Quote, CheckCircle, ShieldCheck, Clock, Headphones } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <BackgroundEffects />
      
      <Header />
      
      <main className="relative z-10 pt-20">
        {/* Hero Section */}
        <section className="flex items-center justify-center min-h-screen px-6 py-20">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            {/* Left side: Animated Text Content */}
            <div className="space-y-8 text-center lg:text-left animate-fade-in-up">
              {/* Trust Badge */}
              <Badge 
                variant="outline" 
                className="border-primary/30 text-primary animate-fade-in"
              >
                <Sparkles className="w-3 h-3 mr-2" />
                Trusted by 500+ Recruiters Worldwide
              </Badge>

              {/* Animated Headline */}
              <h1 className="text-5xl lg:text-6xl font-bold text-foreground leading-tight">
                <TypewriterText 
                  text="AI-Powered" 
                  className="text-primary bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]"
                  speed={80}
                />
                <br />
                <span className="animate-fade-in-up" style={{ animationDelay: '1s' }}>
                  Recruitment Platform
                </span>
              </h1>

              {/* Description */}
              <p className="text-xl text-muted-foreground max-w-2xl animate-fade-in-up" style={{ animationDelay: '1.5s' }}>
                Streamline your hiring process with intelligent candidate screening, 
                deep search capabilities, and automated workflows.
              </p>

              {/* Feature Pills */}
              <div className="flex flex-wrap gap-2 justify-center lg:justify-start animate-fade-in-up" style={{ animationDelay: '2s' }}>
                {['AI Screening', 'Deep Search', 'Automated Workflows'].map((feature, i) => (
                  <div 
                    key={feature}
                    className="px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium border border-primary/20 animate-scale-in"
                    style={{ animationDelay: `${2 + i * 0.1}s` }}
                  >
                    ✓ {feature}
                  </div>
                ))}
              </div>

              {/* CTA Buttons */}
              <div className="flex items-center justify-center lg:justify-start gap-4 pt-4 animate-fade-in-up" style={{ animationDelay: '2.5s' }}>
                <Button 
                  onClick={() => navigate('/auth')}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 shadow-glow group relative overflow-hidden"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    Get Started
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                </Button>
                <Button 
                  onClick={() => navigate('/get-demo')}
                  variant="outline"
                  size="lg"
                  className="border-border hover:bg-accent/10 hover:border-primary/50 transition-all"
                >
                  Request Demo
                </Button>
              </div>
            </div>

            {/* Right side: Enhanced Interactive Resume Mockup */}
            <div className="flex justify-center lg:justify-end animate-fade-in-up" style={{ animationDelay: '1s' }}>
              <div className="relative">
                {/* Connection Lines Effect */}
                <div className="absolute -left-20 top-1/2 w-20 h-px bg-gradient-to-r from-transparent to-primary/30 animate-pulse" />
                
                <div className="animate-scale-in" style={{ animationDelay: '1.2s' }}>
                  <InteractiveResumeMockup />
                </div>

                {/* Decorative Elements */}
                <div className="absolute -top-4 -right-4 w-24 h-24 bg-primary/10 rounded-full blur-2xl animate-pulse-glow" />
                <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-accent/10 rounded-full blur-2xl animate-pulse-glow" style={{ animationDelay: '1s' }} />
              </div>
            </div>
          </div>
        </section>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 text-muted-foreground" />
        </div>

        {/* Trust Indicators Section */}
        <section className="py-20 px-6 border-t border-border/50">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              <div className="space-y-2 animate-fade-in-up">
                <div className="text-5xl font-bold text-primary">
                  <AnimatedCounter end={10000} suffix="+" />
                </div>
                <div className="text-muted-foreground">Candidates Screened</div>
              </div>
              <div className="space-y-2 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                <div className="text-5xl font-bold text-primary">
                  <AnimatedCounter end={98} suffix="%" />
                </div>
                <div className="text-muted-foreground">AI Accuracy</div>
              </div>
              <div className="space-y-2 animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
                <div className="text-5xl font-bold text-primary">
                  <AnimatedCounter end={5} suffix="x" />
                </div>
                <div className="text-muted-foreground">Faster Hiring</div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Preview Cards */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12 space-y-4 animate-fade-in-up">
              <h2 className="text-4xl font-bold text-foreground">
                Powerful Features for Modern Recruitment
              </h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Everything you need to find, screen, and hire top talent efficiently
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <FeatureCard
                icon={Brain}
                title="AI Screening"
                description="Intelligent resume analysis with fit scoring and automated candidate evaluation"
                delay={0}
              />
              <FeatureCard
                icon={Target}
                title="Deep Search"
                description="Advanced candidate discovery with comprehensive profile analysis and insights"
                delay={100}
              />
              <FeatureCard
                icon={Zap}
                title="Automation"
                description="Streamline workflows with automated email sequences and candidate nurturing"
                delay={200}
              />
              <FeatureCard
                icon={Users}
                title="Collaboration"
                description="Team chat, candidate sharing, and real-time collaboration features"
                delay={300}
              />
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="py-20 px-6 border-t border-border/50">
          <div className="max-w-4xl mx-auto text-center space-y-8 animate-fade-in-up">
            <h2 className="text-4xl font-bold text-foreground">
              Ready to Transform Your Hiring?
            </h2>
            <p className="text-xl text-muted-foreground">
              Join hundreds of recruiters who are already using AI to hire smarter and faster
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button 
                onClick={() => navigate('/auth')}
                size="lg"
                className="bg-primary hover:bg-primary/90 shadow-glow group"
              >
                <span className="flex items-center gap-2">
                  Start Free Trial
                  <TrendingUp className="w-4 h-4 transition-transform group-hover:translate-y-[-2px]" />
                </span>
              </Button>
              <Button 
                onClick={() => navigate('/get-demo')}
                variant="outline"
                size="lg"
                className="border-border hover:bg-accent/10"
              >
                Book a Demo
              </Button>
            </div>
          </div>
        </section>

        {/* Testimonials Section */}
        <section className="py-20 px-6 border-t border-border/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <Badge variant="outline" className="border-primary/30 text-primary mb-4">
                <Quote className="w-3 h-3 mr-2" />
                What Our Customers Say
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Trusted by Leading Agencies
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  quote: "ScreeningPilot cut our time-to-fill by 60%. The AI screening is incredibly accurate and saves us hours every day.",
                  author: "Sarah Chen",
                  role: "Founder, TechTalent Partners",
                  rating: 5
                },
                {
                  quote: "The deep search feature helped us find passive candidates we never would have discovered otherwise. Game changer.",
                  author: "Michael Rodriguez",
                  role: "Managing Director, Elite Recruiters",
                  rating: 5
                },
                {
                  quote: "Finally, a CRM built for recruiters. The automation features have tripled our pipeline capacity.",
                  author: "Emily Watson",
                  role: "CEO, NextGen Staffing",
                  rating: 5
                }
              ].map((testimonial, index) => (
                <div 
                  key={index}
                  className="glass-card-premium glow-hover rounded-2xl p-8 animate-fade-in-up"
                  style={{animationDelay: `${0.1 * index}s`}}
                >
                  <div className="flex gap-1 mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Sparkles key={i} className="w-4 h-4 text-primary fill-primary" />
                    ))}
                  </div>
                  <p className="text-muted-foreground mb-6 italic">"{testimonial.quote}"</p>
                  <div>
                    <p className="text-foreground font-semibold">{testimonial.author}</p>
                    <p className="text-primary text-sm">{testimonial.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Why Choose Us Section */}
        <section className="py-20 px-6 border-t border-border/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Why Recruiters Choose Us
              </h2>
            </div>

            <div className="grid md:grid-cols-4 gap-6">
              {[
                { icon: ShieldCheck, title: "Enterprise Security", desc: "SOC 2 compliant with end-to-end encryption" },
                { icon: Clock, title: "24/7 Availability", desc: "Always-on platform with 99.9% uptime" },
                { icon: Headphones, title: "Priority Support", desc: "Dedicated success managers for all plans" },
                { icon: CheckCircle, title: "14-Day Free Trial", desc: "No credit card required to get started" }
              ].map((item, index) => (
                <div key={index} className="text-center animate-fade-in-up" style={{animationDelay: `${0.1 * index}s`}}>
                  <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <item.icon className="w-7 h-7 text-primary" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Landing;
