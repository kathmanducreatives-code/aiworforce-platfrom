import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import PremiumBackground from "@/components/landing/PremiumBackground";
import { Check, Rocket, TrendingUp, Building, Sparkles, ShieldCheck, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const Pricing = () => {
  const navigate = useNavigate();
  
  const plans = [
    {
      name: "Starter",
      price: "$400",
      period: "per month",
      description: "Perfect for solo recruiters and small agencies getting started",
      icon: Rocket,
      features: [
        "1 user seat",
        "Basic Precision Sourcing (50 searches/month)",
        "Profile Intelligence with basic cross-referencing",
        "Essential CRM & Pipeline management",
        "Pre-built email nurturing templates",
        "Basic reporting dashboard",
        "Email support"
      ],
      popular: false,
    },
    {
      name: "Growth",
      price: "$800",
      period: "per month",
      description: "Ideal for growing agencies ready to scale operations",
      icon: TrendingUp,
      features: [
        "3 user seats",
        "Advanced Precision Sourcing (unlimited searches)",
        "Deep Profile Intelligence with full AI vetting",
        "Smart CRM & Pipeline with automation",
        "Custom Email Nurturing (high-volume + personalized)",
        "Advanced analytics & KPI tracking",
        "Priority support",
        "API access"
      ],
      popular: true,
    },
    {
      name: "Enterprise",
      price: "$1,500",
      period: "per month",
      description: "For established agencies demanding maximum performance",
      icon: Building,
      features: [
        "Unlimited user seats",
        "Priority Sourcing with real-time monitoring",
        "Premium Intelligence with patent & publication tracking",
        "Full CRM suite with custom workflows",
        "White-label email nurturing",
        "Custom reporting & data export",
        "Dedicated account manager",
        "Custom integrations & SSO"
      ],
      popular: false,
    }
  ];

  const faqs = [
    {
      question: "Can I change plans anytime?",
      answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately and we'll prorate the difference."
    },
    {
      question: "Is there a free trial?",
      answer: "We offer a 14-day free trial for all plans so you can test our features risk-free. No credit card required to start."
    },
    {
      question: "What payment methods do you accept?",
      answer: "We accept all major credit cards, PayPal, and can arrange invoicing for enterprise clients with annual billing."
    },
    {
      question: "Do you offer custom plans?",
      answer: "Yes, we can create custom enterprise solutions tailored to your specific needs and volume requirements. Contact our sales team for more details."
    },
    {
      question: "What happens when my trial ends?",
      answer: "After your trial ends, you can choose a plan that fits your needs. Your data will be preserved and you can continue right where you left off."
    },
    {
      question: "Is my data secure?",
      answer: "Absolutely. We use enterprise-grade encryption, are SOC 2 compliant, and never share your data with third parties."
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
              <Sparkles className="w-3 h-3 mr-2" />
              Simple, Transparent Pricing
            </Badge>
            
            <h1 className="text-4xl md:text-6xl font-bold gradient-heading mb-6 animate-fade-in-up">
              Choose Your Plan
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto animate-fade-in-up" style={{animationDelay: '0.1s'}}>
              Choose the plan that fits your recruiting agency's needs. All plans include our core CRM features: passive talent discovery, verified intelligence, pipeline management, email nurturing, and data dashboards.
            </p>

            {/* Trust Badge */}
            <div className="flex items-center justify-center gap-2 mt-8 animate-fade-in-up" style={{animationDelay: '0.2s'}}>
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span className="text-muted-foreground">14-day free trial • No credit card required • Cancel anytime</span>
            </div>
          </div>

          {/* Pricing Cards */}
          <h2 className="sr-only">Pricing plans</h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-7xl mx-auto mb-20">
            {plans.map((plan, index) => {
              const IconComponent = plan.icon;
              return (
                <Card 
                  key={plan.name} 
                  className={`relative glass-card-premium glow-hover transition-all duration-300 animate-fade-in-up ${
                    plan.popular 
                      ? 'ring-2 ring-primary shadow-glow scale-105' 
                      : ''
                  }`}
                  style={{animationDelay: `${0.1 * index}s`}}
                >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground shadow-lg">
                        Most Popular
                      </Badge>
                    </div>
                  )}
                  
                  <CardHeader className="text-center pb-8 pt-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center shadow-lg">
                      <IconComponent className="w-8 h-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-bold text-foreground mb-2">
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="text-muted-foreground mb-4">
                      {plan.description}
                    </CardDescription>
                    <div className="text-center">
                      <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                      <span className="text-muted-foreground ml-2">{plan.period}</span>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0">
                    <ul className="space-y-3 mb-8">
                      {plan.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="flex items-center gap-3">
                          <Check className="w-5 h-5 text-primary flex-shrink-0" />
                          <span className="text-muted-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    
                    <Button 
                      onClick={() => navigate('/auth')}
                      className={`w-full ${
                        plan.popular 
                          ? 'bg-primary hover:bg-primary/90 shadow-glow' 
                          : 'bg-secondary hover:bg-secondary/80'
                      } font-medium py-3 transition-all duration-300`}
                    >
                      Get Started
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* FAQ Section */}
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <Badge variant="outline" className="border-primary/30 text-primary mb-4">
                <HelpCircle className="w-3 h-3 mr-2" />
                FAQ
              </Badge>
              <h2 className="text-3xl font-bold text-foreground mb-4">Frequently Asked Questions</h2>
              <p className="text-muted-foreground">Everything you need to know about our pricing and plans</p>
            </div>
            
            <Accordion type="single" collapsible className="space-y-4">
              {faqs.map((faq, index) => (
                <AccordionItem 
                  key={index} 
                  value={`item-${index}`}
                  className="glass-card-premium rounded-xl px-6 border-none"
                >
                  <AccordionTrigger className="text-foreground font-semibold hover:text-primary hover:no-underline">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* CTA Section */}
          <div className="mt-20 text-center">
            <div className="glass-card-premium rounded-3xl p-12 max-w-4xl mx-auto">
              <h2 className="text-3xl font-bold text-foreground mb-4">
                Still have questions?
              </h2>
              <p className="text-muted-foreground mb-8">
                Our team is here to help. Schedule a call with us and we'll help you find the perfect plan for your agency.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button 
                  onClick={() => navigate('/get-demo')}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 shadow-glow"
                >
                  Book a Demo
                </Button>
                <Button 
                  variant="outline"
                  size="lg"
                  className="border-border hover:bg-accent/10 hover:border-primary/50"
                >
                  Contact Sales
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Pricing;
