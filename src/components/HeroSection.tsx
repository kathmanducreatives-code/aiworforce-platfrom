import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, Brain, Target } from "lucide-react";
import { useEffect, useState } from "react";

const HeroSection = () => {
  const [typedText, setTypedText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const fullText = "AI Precision";

  useEffect(() => {
    if (currentIndex < fullText.length) {
      const timeout = setTimeout(() => {
        setTypedText(fullText.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, 120); // Typing speed
      return () => clearTimeout(timeout);
    } else {
      // Blink cursor after typing is complete
      const cursorInterval = setInterval(() => {
        setShowCursor(prev => !prev);
      }, 600);
      return () => clearInterval(cursorInterval);
    }
  }, [currentIndex, fullText]);

  return (
    <section className="relative overflow-hidden bg-white min-h-screen flex items-center">
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,_rgba(6,182,212,0.08)_0%,_transparent_50%)]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_60%,_rgba(20,184,166,0.06)_0%,_transparent_50%)]"></div>
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-gradient-to-br from-cyan-500/5 to-teal-500/5 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-gradient-to-tr from-teal-500/5 to-cyan-500/5 rounded-full blur-3xl"></div>
      
      <div className="container relative mx-auto px-6 py-20">
        <div className="max-w-6xl mx-auto">
          
          {/* Main Hero Content */}
          <div className="text-center space-y-12">
            
            {/* Premium Badge */}
            <div className="inline-flex items-center px-4 py-2 bg-slate-50 border border-cyan-200 text-cyan-700 text-sm font-medium rounded-full animate-fade-in-down hover-scale">
              <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full mr-2 animate-pulse"></div>
              AI-Powered Resume Screening
            </div>
            
            {/* Main Heading */}
            <div className="space-y-6">
              <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight">
                <div className="block text-slate-900 mb-4 opacity-0 animate-fade-in animate-delay-300 animate-fill-forwards transform translate-y-8 hover:scale-105 transition-all duration-500 relative">
                  <span className="inline-block text-slate-900">Screen Resumes</span>
                </div>
                <div className="block mb-6 opacity-0 animate-fade-in animate-delay-700 animate-fill-forwards transform translate-y-8">
                  <span className="inline-block text-cyan-600 hover:scale-110 transition-all duration-500 relative font-extrabold tracking-tight">
                    <span className="absolute inset-0 bg-gradient-to-r from-cyan-500/30 to-teal-500/30 blur-2xl animate-pulse"></span>
                    <span className="relative z-10">10x Faster</span>
                  </span>
                </div>
                <div className="block text-slate-800 opacity-0 animate-fade-in animate-delay-1200 animate-fill-forwards transform translate-y-8 relative">
                  <span className="mr-3 text-slate-700">with</span>
                  <span className="relative inline-block">
                    <span className="bg-gradient-to-r from-cyan-600 to-teal-500 bg-clip-text text-transparent font-mono relative tracking-wide">
                      {typedText}
                      <span className={`inline-block w-0.5 h-12 ml-1 bg-gradient-to-b from-cyan-500 to-teal-500 ${showCursor ? 'opacity-100' : 'opacity-0'} transition-opacity duration-100`}></span>
                    </span>
                    <span className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-teal-500/20 blur-lg animate-pulse"></span>
                  </span>
                </div>
              </h1>
              
              <p className="text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto opacity-0 animate-fade-in animate-delay-[1800ms] animate-fill-forwards transform translate-y-4 hover:text-slate-700 transition-all duration-500 relative">
                <span className="relative z-10">Transform your hiring process with intelligent resume analysis. Find the perfect candidates in seconds, not hours.</span>
                <span className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-teal-500/5 blur-xl opacity-0 hover:opacity-100 transition-opacity duration-500"></span>
              </p>
            </div>

            {/* CTA Button */}
            <div className="flex justify-center animate-fade-in-up animate-delay-500">
              <Button 
                size="lg" 
                className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white shadow-2xl hover:shadow-cyan-500/25 transition-all duration-300 text-lg px-8 py-6 rounded-xl font-semibold hover-scale active-scale group border-0 relative overflow-hidden"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-teal-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
                <span className="relative z-10">Start Free Trial</span>
                <ArrowRight className="ml-2 w-5 h-5 relative z-10 group-hover-slide-right transition-transform" />
              </Button>
            </div>

            {/* Feature Grid */}
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto pt-16">
              <div className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl p-6 hover:shadow-xl hover:border-cyan-300/50 transition-all duration-300 animate-fade-in-up animate-delay-100 hover-lift">
                <div className="w-12 h-12 bg-gradient-to-br from-cyan-50 to-teal-50 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300">
                  <Zap className="w-6 h-6 text-cyan-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2 group-hover:text-cyan-700 transition-colors">Instant Analysis</h3>
                <p className="text-slate-600 text-sm leading-relaxed">Process hundreds of resumes in minutes with 95% accuracy powered by advanced AI models.</p>
              </div>
              
              <div className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl p-6 hover:shadow-xl hover:border-teal-300/50 transition-all duration-300 animate-fade-in-up animate-delay-200 hover-lift">
                <div className="w-12 h-12 bg-gradient-to-br from-teal-50 to-emerald-50 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300">
                  <Brain className="w-6 h-6 text-teal-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2 group-hover:text-teal-700 transition-colors">Smart Matching</h3>
                <p className="text-slate-600 text-sm leading-relaxed">Advanced pattern recognition identifies top candidates based on your specific requirements.</p>
              </div>
              
              <div className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl p-6 hover:shadow-xl hover:border-purple-300/50 transition-all duration-300 animate-fade-in-up animate-delay-300 hover-lift">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300">
                  <Target className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2 group-hover:text-purple-700 transition-colors">Precise Scoring</h3>
                <p className="text-slate-600 text-sm leading-relaxed">Get detailed candidate scores and insights to make data-driven hiring decisions.</p>
              </div>
            </div>

            {/* Stats */}
            <div className="pt-16 animate-fade-in-up animate-delay-500">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto">
                <div className="text-center group hover-scale">
                  <div className="text-2xl font-bold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent mb-1 group-hover:animate-pulse-glow">10,000+</div>
                  <div className="text-slate-500 text-sm">Resumes Processed</div>
                </div>
                <div className="text-center group hover-scale">
                  <div className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent mb-1 group-hover:animate-pulse-glow">95%</div>
                  <div className="text-slate-500 text-sm">Accuracy Rate</div>
                </div>
                <div className="text-center group hover-scale">
                  <div className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-1 group-hover:animate-pulse-glow">500+</div>
                  <div className="text-slate-500 text-sm">Companies</div>
                </div>
                <div className="text-center group hover-scale">
                  <div className="text-2xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent mb-1 group-hover:animate-pulse-glow">2min</div>
                  <div className="text-slate-500 text-sm">Setup Time</div>
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