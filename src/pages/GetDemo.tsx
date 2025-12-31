import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import PremiumBackground from "@/components/landing/PremiumBackground";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Sparkles, Calendar, Clock, Users, Brain, Zap, Shield, ArrowRight } from "lucide-react";

const GetDemo = () => {
  const [formData, setFormData] = useState({
    fullName: "",
    workEmail: "",
    companyName: "",
    jobTitle: "",
    message: ""
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const benefits = [
    {
      icon: Brain,
      title: "Personalized Demo",
      description: "Tailored to your agency's specific recruitment challenges"
    },
    {
      icon: Clock,
      title: "30-Minute Session",
      description: "Focused walkthrough of features most relevant to you"
    },
    {
      icon: Users,
      title: "Expert Guidance",
      description: "Get answers from our recruitment technology specialists"
    },
    {
      icon: Zap,
      title: "Quick Setup",
      description: "Learn how to get started in under 10 minutes"
    }
  ];

  const testimonials = [
    {
      quote: "ScreeningPilot cut our time-to-fill by 60%. The demo showed us exactly how to leverage AI for our niche roles.",
      author: "Sarah Chen",
      role: "Founder, TechTalent Partners",
    },
    {
      quote: "The personalized demo helped us understand how the CRM could transform our client relationships.",
      author: "Michael Rodriguez",
      role: "Managing Director, Elite Recruiters",
    }
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <PremiumBackground />
      <Header />
      
      <main className="relative z-10 pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <Badge 
              variant="outline" 
              className="border-primary/30 text-primary mb-6 animate-fade-in"
            >
              <Calendar className="w-3 h-3 mr-2" />
              Book Your Personalized Demo
            </Badge>
            
            <h1 className="text-4xl md:text-5xl font-bold gradient-heading mb-6 animate-fade-in-up">
              See ScreeningPilot in Action
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto animate-fade-in-up" style={{animationDelay: '0.1s'}}>
              Book a live demo and discover how our CRM automates passive talent discovery, delivers verified candidate intelligence, and helps you make faster, smarter placements with less manual work.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 max-w-6xl mx-auto">
            {/* Left Column - Benefits */}
            <div className="space-y-8">
              {/* What to Expect */}
              <div className="glass-card-premium rounded-2xl p-8 animate-fade-in-up" style={{animationDelay: '0.2s'}}>
                <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  What to Expect
                </h2>
                <div className="space-y-4">
                  {benefits.map((benefit, index) => (
                    <div key={index} className="flex items-start gap-4">
                      <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                        <benefit.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{benefit.title}</h3>
                        <p className="text-muted-foreground text-sm">{benefit.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Testimonials */}
              <div className="space-y-4">
                {testimonials.map((testimonial, index) => (
                  <div 
                    key={index}
                    className="glass-card-premium rounded-2xl p-6 animate-fade-in-up"
                    style={{animationDelay: `${0.3 + index * 0.1}s`}}
                  >
                    <p className="text-muted-foreground mb-4 italic">"{testimonial.quote}"</p>
                    <div>
                      <p className="text-foreground font-semibold">{testimonial.author}</p>
                      <p className="text-primary text-sm">{testimonial.role}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Trust Badge */}
              <div className="flex items-center gap-3 text-muted-foreground animate-fade-in-up" style={{animationDelay: '0.5s'}}>
                <Shield className="w-5 h-5 text-primary" />
                <span className="text-sm">Join 500+ agencies who've experienced our demo</span>
              </div>
            </div>

            {/* Right Column - Form */}
            <div className="animate-fade-in-up" style={{animationDelay: '0.2s'}}>
              <Card className="glass-card-premium">
                <CardHeader>
                  <CardTitle className="text-2xl font-semibold text-foreground">Request Your Demo</CardTitle>
                </CardHeader>
                <CardContent>
                  {!submitted ? (
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="fullName" className="text-foreground font-medium">
                            Full Name *
                          </Label>
                          <Input
                            id="fullName"
                            name="fullName"
                            value={formData.fullName}
                            onChange={handleInputChange}
                            required
                            className="bg-background/50 border-border/50 focus:border-primary focus:ring-primary"
                            placeholder="Enter your full name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="workEmail" className="text-foreground font-medium">
                            Work Email *
                          </Label>
                          <Input
                            id="workEmail"
                            name="workEmail"
                            type="email"
                            value={formData.workEmail}
                            onChange={handleInputChange}
                            required
                            className="bg-background/50 border-border/50 focus:border-primary focus:ring-primary"
                            placeholder="your.email@company.com"
                          />
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="companyName" className="text-foreground font-medium">
                            Company Name
                          </Label>
                          <Input
                            id="companyName"
                            name="companyName"
                            value={formData.companyName}
                            onChange={handleInputChange}
                            className="bg-background/50 border-border/50 focus:border-primary focus:ring-primary"
                            placeholder="Your company name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="jobTitle" className="text-foreground font-medium">
                            Job Title
                          </Label>
                          <Input
                            id="jobTitle"
                            name="jobTitle"
                            value={formData.jobTitle}
                            onChange={handleInputChange}
                            className="bg-background/50 border-border/50 focus:border-primary focus:ring-primary"
                            placeholder="Your job title"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="message" className="text-foreground font-medium">
                          What would you like to see in the demo?
                        </Label>
                        <Textarea
                          id="message"
                          name="message"
                          value={formData.message}
                          onChange={handleInputChange}
                          className="bg-background/50 border-border/50 focus:border-primary focus:ring-primary min-h-[120px]"
                          placeholder="Tell us about your specific needs or what you'd like to see during the demo..."
                        />
                      </div>

                      <Button 
                        type="submit" 
                        className="w-full h-12 text-lg font-semibold bg-primary hover:bg-primary/90 shadow-glow group"
                      >
                        <span className="flex items-center gap-2">
                          Request Demo
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </span>
                      </Button>
                    </form>
                  ) : (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-8 h-8 text-primary" />
                      </div>
                      <h3 className="text-2xl font-semibold text-foreground mb-4">
                        Thank you!
                      </h3>
                      <p className="text-lg text-muted-foreground">
                        Our team will reach out shortly to schedule your demo.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default GetDemo;
