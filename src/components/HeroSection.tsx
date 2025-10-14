import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, Brain, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// Particle background component
const Particles = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    {[...Array(25)].map((_, i) => (
      <div
        key={i}
        className="absolute rounded-full bg-gradient-to-r from-primary/30 to-accent-secondary/20"
        style={{
          width: `${Math.random() * 8 + 2}px`,
          height: `${Math.random() * 8 + 2}px`,
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          animation: `float-particle ${Math.random() * 10 + 15}s linear infinite`,
          animationDelay: `${Math.random() * 5}s`,
        }}
      />
    ))}
  </div>
);

// Geometric shapes component
const GeometricShapes = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    {/* Triangle */}
    <div className="absolute w-32 h-32 opacity-10" style={{top: '10%', right: '15%'}}>
      <div className="w-full h-full animate-float-slow" style={{
        background: 'linear-gradient(135deg, hsl(174 72% 42%), hsl(187 85% 53%))',
        clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
        animation: 'float-rotate 20s ease-in-out infinite'
      }}/>
    </div>
    
    {/* Circle */}
    <div className="absolute w-24 h-24 rounded-full opacity-10 animate-float-medium" 
         style={{top: '60%', left: '10%', background: 'linear-gradient(135deg, hsl(187 85% 53%), hsl(168 76% 42%))'}}>
    </div>
    
    {/* Hexagon */}
    <div className="absolute w-28 h-28 opacity-10" style={{bottom: '20%', right: '20%'}}>
      <div className="w-full h-full animate-float-reverse" style={{
        background: 'linear-gradient(135deg, hsl(168 76% 42%), hsl(174 72% 42%))',
        clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
        animation: 'float-rotate-reverse 25s ease-in-out infinite'
      }}/>
    </div>
  </div>
);

const HeroSection = () => {
  const navigate = useNavigate();
  const [typedText, setTypedText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const fullText = "AI Precision";

  useEffect(() => {
    if (currentIndex < fullText.length) {
      const timeout = setTimeout(() => {
        setTypedText(fullText.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, 120);
      return () => clearTimeout(timeout);
    } else {
      const cursorInterval = setInterval(() => {
        setShowCursor(prev => !prev);
      }, 600);
      return () => clearInterval(cursorInterval);
    }
  }, [currentIndex, fullText]);

  return (
    <section className="relative overflow-hidden bg-white min-h-screen flex items-center">
      {/* Animated Mesh Gradient Background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-mesh opacity-40 animate-mesh-1" />
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-mesh opacity-30 animate-mesh-2" />
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-mesh opacity-20 animate-mesh-3" />
      </div>

      {/* Animated Gradient Orbs */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-gradient-to-br from-primary/20 to-accent-secondary/20 rounded-full blur-3xl animate-float-slow" />
      <div className="absolute bottom-1/3 -right-20 w-80 h-80 bg-gradient-to-tr from-accent-secondary/20 to-primary-light/20 rounded-full blur-3xl animate-float-medium" />
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl animate-pulse-slow" />
      
      {/* Particles */}
      <Particles />
      
      {/* Geometric Shapes */}
      <GeometricShapes />
      
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
              <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-tight tracking-tight">
                {/* Screen Resumes with shimmer effect */}
                <div className="block text-slate-900 mb-4 animate-slide-fade-up">
                  <span className="inline-block relative">
                    <span className="relative z-10">Screen Resumes</span>
                    <span className="absolute inset-0 bg-gradient-shimmer bg-[length:200%_100%] animate-shimmer-sweep opacity-30" />
                  </span>
                </div>
                
                {/* 10x Faster with enhanced glow */}
                <div className="block mb-6 animate-slide-fade-up animation-delay-300">
                  <span className="inline-block relative group cursor-default">
                    <span className="absolute inset-0 bg-gradient-to-r from-primary via-accent-secondary to-primary bg-[length:200%_100%] blur-3xl animate-glow-pulse-teal opacity-50 group-hover:opacity-70 transition-opacity" />
                    <span className="relative z-10 bg-gradient-to-r from-primary via-accent-secondary to-primary bg-clip-text text-transparent font-extrabold animate-gradient-x">
                      10x Faster
                    </span>
                  </span>
                </div>
                
                {/* AI Precision with enhanced typing */}
                <div className="block text-slate-800 animate-slide-fade-up animation-delay-600">
                  <span className="mr-3 text-slate-700">with</span>
                  <span className="relative inline-block">
                    <span className="absolute inset-0 bg-gradient-to-r from-primary/30 to-accent-secondary/30 blur-2xl animate-pulse" />
                    <span className="relative z-10 bg-gradient-to-r from-primary to-accent-secondary bg-clip-text text-transparent font-mono tracking-wide">
                      {typedText.split('').map((char, i) => (
                        <span key={i} className="inline-block animate-fade-in" style={{animationDelay: `${i * 100}ms`}}>
                          {char}
                        </span>
                      ))}
                      <span className={`inline-block w-0.5 h-12 ml-1 bg-gradient-to-b from-primary to-accent-secondary ${showCursor ? 'opacity-100' : 'opacity-0'} transition-opacity`} />
                    </span>
                  </span>
                </div>
              </h1>
              
              <p className="text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto animate-slide-fade-up animation-delay-900">
                Transform your hiring process with intelligent resume analysis. Find the perfect candidates in seconds, not hours.
              </p>
            </div>

            {/* Magnetic CTA Button */}
            <div className="flex justify-center animate-slide-fade-up animation-delay-1200">
              <Button 
                size="lg"
                onClick={() => navigate('/get-demo')}
                className="relative group magnetic ripple-container bg-gradient-to-r from-primary via-accent-secondary to-primary bg-[length:200%_100%] hover:bg-[position:100%_0] text-white shadow-primary-lg hover:shadow-glow transition-all duration-500 text-lg px-10 py-7 rounded-2xl font-bold border-0 overflow-hidden animate-glow-pulse-teal"
              >
                {/* Animated background layers */}
                <span className="absolute inset-0 bg-gradient-to-r from-primary-light to-accent-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-500 animate-gradient-x" />
                
                {/* Shimmer effect */}
                <span className="absolute inset-0 bg-gradient-shimmer bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer-sweep" />
                
                {/* Particle burst on hover */}
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {[...Array(8)].map((_, i) => (
                    <span
                      key={i}
                      className="absolute w-1 h-1 bg-white rounded-full animate-particle-burst"
                      style={{
                        left: '50%',
                        top: '50%',
                        animationDelay: `${i * 0.1}s`,
                        transform: `rotate(${i * 45}deg)`
                      }}
                    />
                  ))}
                </span>
                
                <span className="relative z-10 flex items-center">
                  Start Free Trial
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />
                </span>
              </Button>
            </div>

            {/* Enhanced Feature Cards with Glassmorphism */}
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto pt-20">
              {[
                { icon: Zap, title: "Instant Analysis", desc: "Process hundreds of resumes in minutes with 95% accuracy powered by advanced AI models.", gradient: "from-primary to-primary-light", delay: "100" },
                { icon: Brain, title: "Smart Matching", desc: "Advanced pattern recognition identifies top candidates based on your specific requirements.", gradient: "from-accent to-accent-secondary", delay: "200" },
                { icon: Target, title: "Precise Scoring", desc: "Get detailed candidate scores and insights to make data-driven hiring decisions.", gradient: "from-purple-500 to-pink-500", delay: "300" }
              ].map((feature, idx) => (
                <div key={idx} className={`group glass-card-enhanced elevation-2 elevation-hover-3 rounded-3xl p-8 hover:scale-105 transition-all duration-500 animate-slide-fade-up animation-delay-${feature.delay} tilt-hover relative overflow-hidden`}>
                  {/* Animated border gradient */}
                  <div className={`absolute inset-0 bg-gradient-to-r ${feature.gradient} opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500`} />
                  
                  <div className="relative z-10">
                    <div className={`w-16 h-16 bg-gradient-to-br ${feature.gradient} rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-12 transition-all duration-500 shadow-lg animate-bounce-soft`}>
                      <feature.icon className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-primary transition-colors">{feature.title}</h3>
                    <p className="text-slate-600 leading-relaxed">{feature.desc}</p>
                  </div>
                  
                  {/* Particle effect on hover */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="absolute w-1 h-1 bg-primary rounded-full animate-particle-float"
                        style={{
                          left: `${Math.random() * 100}%`,
                          top: `${Math.random() * 100}%`,
                          animationDelay: `${i * 0.2}s`
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Animated Stats Counter */}
            <div className="pt-20 animate-slide-fade-up animation-delay-1200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-12 max-w-4xl mx-auto">
                {[
                  { value: "10,000+", label: "Resumes Processed", gradient: "from-primary to-accent-secondary" },
                  { value: "95%", label: "Accuracy Rate", gradient: "from-accent to-emerald-500" },
                  { value: "500+", label: "Companies", gradient: "from-purple-500 to-pink-500" },
                  { value: "2min", label: "Setup Time", gradient: "from-amber-500 to-orange-500" }
                ].map((stat, idx) => (
                  <div key={idx} className="text-center group relative">
                    {/* Circular progress background */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className={`w-24 h-24 rounded-full bg-gradient-to-r ${stat.gradient} opacity-10 group-hover:opacity-20 group-hover:scale-110 transition-all duration-500 animate-scale-pulse`} />
                    </div>
                    
                    <div className="relative z-10">
                      <div className={`text-3xl md:text-4xl font-black bg-gradient-to-r ${stat.gradient} bg-clip-text text-transparent mb-2 group-hover:scale-110 transition-transform duration-300 animate-glow-pulse-teal`}>
                        {stat.value}
                      </div>
                      <div className="text-slate-600 text-sm font-medium">{stat.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 animate-bounce-soft">
        <div className="flex flex-col items-center gap-2 text-slate-400 group cursor-pointer">
          <span className="text-sm font-medium opacity-70 group-hover:opacity-100 transition-opacity">Scroll to explore</span>
          <div className="w-6 h-10 border-2 border-primary/30 rounded-full flex items-start justify-center p-2 group-hover:border-primary/60 transition-colors">
            <div className="w-1.5 h-1.5 bg-primary rounded-full animate-scroll-indicator" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;