import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, Brain, Target } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-slate-950 min-h-screen flex items-center">
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,_rgba(6,182,212,0.15)_0%,_transparent_50%)]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_60%,_rgba(20,184,166,0.1)_0%,_transparent_50%)]"></div>
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-gradient-to-br from-cyan-500/10 to-teal-500/5 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-gradient-to-tr from-teal-500/10 to-cyan-500/5 rounded-full blur-3xl"></div>
      
      <div className="container relative mx-auto px-6 py-20">
        <div className="max-w-6xl mx-auto">
          
          {/* Main Hero Content */}
          <div className="text-center space-y-12">
            
            {/* Premium Badge */}
            <div className="inline-flex items-center px-4 py-2 bg-white/5 backdrop-blur-sm border border-cyan-500/20 text-cyan-300 text-sm font-medium rounded-full">
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full mr-2 animate-pulse"></div>
              AI-Powered Resume Screening
            </div>
            
            {/* Main Heading */}
            <div className="space-y-6">
              <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight">
                <span className="block text-white mb-2">Screen Resumes</span>
                <span className="block bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                  10x Faster
                </span>
                <span className="block text-white/90 mt-2">with AI Precision</span>
              </h1>
              
              <p className="text-lg text-slate-300 leading-relaxed max-w-2xl mx-auto">
                Transform your hiring process with intelligent resume analysis. 
                Find the perfect candidates in seconds, not hours.
              </p>
            </div>

            {/* CTA Button */}
            <div className="flex justify-center">
              <Button 
                size="lg" 
                className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-white shadow-2xl hover:shadow-cyan-500/25 transition-all duration-300 text-lg px-8 py-6 rounded-xl font-semibold hover:scale-105 group border-0"
              >
                Start Free Trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>

            {/* Feature Grid */}
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto pt-16">
              <div className="group backdrop-blur-sm bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 hover:border-cyan-500/30 transition-all duration-300">
                <div className="w-12 h-12 bg-gradient-to-br from-cyan-500/20 to-teal-500/20 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Zap className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Instant Analysis</h3>
                <p className="text-slate-400 text-sm leading-relaxed">Process hundreds of resumes in minutes with 95% accuracy powered by advanced AI models.</p>
              </div>
              
              <div className="group backdrop-blur-sm bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 hover:border-teal-500/30 transition-all duration-300">
                <div className="w-12 h-12 bg-gradient-to-br from-teal-500/20 to-emerald-500/20 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Brain className="w-6 h-6 text-teal-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Smart Matching</h3>
                <p className="text-slate-400 text-sm leading-relaxed">Advanced pattern recognition identifies top candidates based on your specific requirements.</p>
              </div>
              
              <div className="group backdrop-blur-sm bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 hover:border-purple-500/30 transition-all duration-300">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Target className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Precise Scoring</h3>
                <p className="text-slate-400 text-sm leading-relaxed">Get detailed candidate scores and insights to make data-driven hiring decisions.</p>
              </div>
            </div>

            {/* Stats */}
            <div className="pt-16">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto">
                <div className="text-center">
                  <div className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent mb-1">10,000+</div>
                  <div className="text-slate-400 text-sm">Resumes Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent mb-1">95%</div>
                  <div className="text-slate-400 text-sm">Accuracy Rate</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-1">500+</div>
                  <div className="text-slate-400 text-sm">Companies</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent mb-1">2min</div>
                  <div className="text-slate-400 text-sm">Setup Time</div>
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