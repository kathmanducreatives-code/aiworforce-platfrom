import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle, Users, Zap, TrendingUp, Sparkles, Target, Clock, Atom, Brain, Rocket } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-slate-50/50 to-white min-h-screen flex items-center">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(6,182,212,0.1)_0%,_transparent_50%)]"></div>
      <div className="absolute top-20 right-20 w-96 h-96 bg-gradient-to-br from-cyan-400/20 to-teal-400/20 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-20 left-20 w-80 h-80 bg-gradient-to-tr from-teal-400/15 to-cyan-400/15 rounded-full blur-3xl animate-pulse delay-1000"></div>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-cyan-500/5 to-teal-500/5 rounded-full blur-3xl animate-pulse delay-2000"></div>
      
      <div className="container relative mx-auto px-6 py-32">
        <div className="max-w-7xl mx-auto">
          
          {/* Main Hero Content */}
          <div className="text-center space-y-16">
            
            {/* Premium Badge */}
            <div className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-slate-900 to-slate-700 text-white text-sm font-bold rounded-full shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105">
              <div className="w-2 h-2 bg-cyan-400 rounded-full mr-3 animate-pulse"></div>
              Built by AI Recruitment Experts
            </div>
            
            {/* Main Heading */}
            <div className="space-y-8">
              <h1 className="text-6xl lg:text-8xl font-bold leading-[0.9] tracking-tight">
                <span className="block text-slate-900 mb-4">World's Most</span>
                <span className="block bg-gradient-to-r from-cyan-600 via-teal-500 to-cyan-600 bg-clip-text text-transparent bg-300% animate-gradient">
                  Powerful AIs.
                </span>
                <span className="block text-slate-900 mt-4">One Subscription.</span>
              </h1>
              
              <p className="text-xl lg:text-2xl text-slate-600 leading-relaxed max-w-4xl mx-auto font-medium">
                Stop juggling tabs and subscriptions - AI Recruitment gives you access to 
                all best-in-class AI models for just $12/month. That's almost half of 
                what you'd pay for a single premium AI chat subscription.
              </p>
            </div>

            {/* CTA Button */}
            <div className="flex justify-center">
              <Button 
                size="lg" 
                className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white shadow-2xl hover:shadow-cyan-500/25 transition-all duration-300 text-xl px-12 py-8 rounded-2xl font-bold hover:scale-105 group"
              >
                Get Started Now
                <ArrowRight className="ml-3 w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>

            {/* Feature Grid */}
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto pt-16">
              <div className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-xl rounded-3xl p-8 hover:shadow-2xl hover:shadow-cyan-500/10 transition-all duration-300 hover:scale-[1.02]">
                <div className="w-16 h-16 bg-gradient-to-br from-cyan-50 to-teal-50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Clock className="w-8 h-8 text-cyan-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">Experience smarter & more accurate answers</h3>
                <p className="text-slate-600 leading-relaxed">Get instant AI-powered resume analysis with 95% accuracy, replacing hours of manual screening work.</p>
              </div>
              
              <div className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-xl rounded-3xl p-8 hover:shadow-2xl hover:shadow-emerald-500/10 transition-all duration-300 hover:scale-[1.02]">
                <div className="w-16 h-16 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Brain className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">Advanced AI pattern recognition</h3>
                <p className="text-slate-600 leading-relaxed">Our neural networks identify subtle candidate patterns that human reviewers often miss.</p>
              </div>
              
              <div className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-xl rounded-3xl p-8 hover:shadow-2xl hover:shadow-purple-500/10 transition-all duration-300 hover:scale-[1.02]">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Rocket className="w-8 h-8 text-purple-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">Lightning-fast deployment</h3>
                <p className="text-slate-600 leading-relaxed">Deploy in minutes with zero setup. Start screening resumes immediately with our plug-and-play solution.</p>
              </div>
            </div>

            {/* Stats */}
            <div className="pt-20">
              <p className="text-lg font-semibold text-slate-700 mb-12">Trusted by 10,000+ HR professionals worldwide</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
                <div className="text-center">
                  <div className="text-4xl font-bold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent mb-2">500+</div>
                  <div className="text-slate-600 font-medium">Companies</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent mb-2">1M+</div>
                  <div className="text-slate-600 font-medium">Resumes Analyzed</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">95%</div>
                  <div className="text-slate-600 font-medium">Accuracy Rate</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent mb-2">24/7</div>
                  <div className="text-slate-600 font-medium">AI Availability</div>
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