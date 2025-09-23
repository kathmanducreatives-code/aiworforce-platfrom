import Header from "@/components/Header";
import { Check, Zap, Crown, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const Pricing = () => {
  const plans = [
    {
      name: "Starter",
      price: "$400",
      period: "per month",
      description: "Perfect for small businesses getting started",
      icon: Zap,
      features: [
        "1 user seat",
        "Unlimited resume screening",
        "Basic dashboard",
        "AI-powered analysis",
        "Email support"
      ],
      popular: false,
      gradient: "from-blue-500 to-purple-500"
    },
    {
      name: "Growth",
      price: "$800",
      period: "per month",
      description: "Recommended for growing teams and HR departments",
      icon: Crown,
      features: [
        "3 user seats",
        "Unlimited resume screening",
        "Full pipeline automation",
        "Email nurturing & sequences",
        "Folder/tags management",
        "Basic analytics",
        "Priority support"
      ],
      popular: true,
      gradient: "from-cyan-500 to-teal-500"
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "$1,500+/month",
      description: "For large organizations with complex needs",
      icon: Rocket,
      features: [
        "Unlimited user seats",
        "Unlimited screening & automation",
        "Advanced analytics",
        "Priority support & onboarding",
        "Custom integrations",
        "Dedicated account manager",
        "White-label solution",
        "API access"
      ],
      popular: false,
      gradient: "from-purple-500 to-pink-500"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50">
      <Header />
      
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-6">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-slate-800 via-cyan-600 to-teal-600 bg-clip-text text-transparent mb-6">
              Choose Your Plan
            </h1>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Scale your recruitment process with our flexible pricing plans designed for teams of all sizes
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-8 max-w-7xl mx-auto">
            {plans.map((plan, index) => {
              const IconComponent = plan.icon;
              return (
                <Card 
                  key={plan.name} 
                  className={`relative transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 ${
                    plan.popular 
                      ? 'ring-2 ring-cyan-500 shadow-xl scale-105' 
                      : 'hover:shadow-lg'
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                      <span className="bg-gradient-to-r from-cyan-500 to-teal-500 text-white px-4 py-1 rounded-full text-sm font-medium shadow-lg">
                        Most Popular
                      </span>
                    </div>
                  )}
                  
                  <CardHeader className="text-center pb-8 pt-8">
                    <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br ${plan.gradient} flex items-center justify-center shadow-lg`}>
                      <IconComponent className="w-8 h-8 text-white" />
                    </div>
                    <CardTitle className="text-2xl font-bold text-slate-800 mb-2">
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="text-slate-600 mb-4">
                      {plan.description}
                    </CardDescription>
                    <div className="text-center">
                      <span className="text-4xl font-bold text-slate-800">{plan.price}</span>
                      <span className="text-slate-600 ml-2">{plan.period}</span>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0">
                    <ul className="space-y-3 mb-8">
                      {plan.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="flex items-center gap-3">
                          <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                          <span className="text-slate-700">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    
                    <Button 
                      className={`w-full ${
                        plan.popular 
                          ? 'bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600' 
                          : 'bg-slate-800 hover:bg-slate-900'
                      } text-white font-medium py-3 transition-all duration-300 shadow-lg hover:shadow-xl`}
                    >
                      Get Started
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* FAQ Section */}
          <div className="mt-20 text-center">
            <h2 className="text-3xl font-bold text-slate-800 mb-8">Frequently Asked Questions</h2>
            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              <div className="text-left">
                <h3 className="font-semibold text-slate-800 mb-2">Can I change plans anytime?</h3>
                <p className="text-slate-600">Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.</p>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-slate-800 mb-2">Is there a free trial?</h3>
                <p className="text-slate-600">We offer a 14-day free trial for all plans so you can test our features risk-free.</p>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-slate-800 mb-2">What payment methods do you accept?</h3>
                <p className="text-slate-600">We accept all major credit cards, PayPal, and can arrange invoicing for enterprise clients.</p>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-slate-800 mb-2">Do you offer custom plans?</h3>
                <p className="text-slate-600">Yes, we can create custom enterprise solutions tailored to your specific needs and volume requirements.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Pricing;