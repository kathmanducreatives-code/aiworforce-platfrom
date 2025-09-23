import Header from "@/components/Header";
import { Brain, Upload, Target, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";

const Features = () => {
  const features = [
    {
      icon: Brain,
      title: "AI-Powered Analysis",
      description: "Advanced machine learning algorithms analyze resumes with human-level accuracy, identifying key skills, experience, and qualifications instantly.",
      gradient: "from-cyan-50 to-teal-50",
      iconColor: "text-cyan-600"
    },
    {
      icon: Upload,
      title: "Bulk Resume Upload",
      description: "Upload multiple resumes at once. Our system processes hundreds of resumes simultaneously, saving you hours of manual work.",
      gradient: "from-teal-50 to-emerald-50",
      iconColor: "text-teal-600"
    },
    {
      icon: Target,
      title: "Smart Candidate Scoring",
      description: "Automated scoring system ranks candidates based on job requirements, giving you a clear view of the best matches for each position.",
      gradient: "from-purple-50 to-pink-50",
      iconColor: "text-purple-600"
    },
    {
      icon: GitBranch,
      title: "Pipeline Management",
      description: "Streamline your recruitment pipeline with intuitive candidate tracking, stage management, and automated workflow transitions.",
      gradient: "from-amber-50 to-orange-50",
      iconColor: "text-amber-600"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-gradient-to-br from-cyan-500/10 to-teal-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-gradient-to-tr from-teal-500/10 to-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{animationDelay: '1s'}}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-r from-purple-500/5 to-pink-500/5 rounded-full blur-2xl animate-pulse" style={{animationDelay: '2s'}}></div>
      </div>

      <Header />
      
      <main className="pt-24 pb-16 relative">
        {/* Hero Section */}
        <section className="py-20 relative">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-4xl mx-auto">
              <div className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-cyan-50 to-teal-50 border border-cyan-200 text-cyan-700 text-sm font-medium rounded-full animate-fade-in mb-8">
                <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full mr-2 animate-pulse"></div>
                Revolutionary AI Technology
              </div>
              
              <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-slate-800 via-cyan-600 to-teal-600 bg-clip-text text-transparent mb-8 animate-fade-in-up">
                Powerful Features for Modern Recruitment
              </h1>
              <p className="text-xl text-slate-600 mb-12 leading-relaxed animate-fade-in-up" style={{animationDelay: '0.2s'}}>
                Discover all the tools and capabilities that make ScreeningPilot the ultimate solution for AI-powered resume screening and candidate management.
              </p>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto mb-16">
                <div className="text-center animate-fade-in-up" style={{animationDelay: '0.3s'}}>
                  <div className="text-2xl font-bold bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent mb-1">10x</div>
                  <div className="text-slate-500 text-sm">Faster Screening</div>
                </div>
                <div className="text-center animate-fade-in-up" style={{animationDelay: '0.4s'}}>
                  <div className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent mb-1">95%</div>
                  <div className="text-slate-500 text-sm">Accuracy Rate</div>
                </div>
                <div className="text-center animate-fade-in-up" style={{animationDelay: '0.5s'}}>
                  <div className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-1">24/7</div>
                  <div className="text-slate-500 text-sm">Processing</div>
                </div>
                <div className="text-center animate-fade-in-up" style={{animationDelay: '0.6s'}}>
                  <div className="text-2xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent mb-1">∞</div>
                  <div className="text-slate-500 text-sm">Scalability</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-16 relative">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="group relative backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl p-8 hover:shadow-2xl hover:border-cyan-300/50 transition-all duration-500 hover:-translate-y-2 animate-fade-in-up overflow-hidden"
                  style={{animationDelay: `${0.1 * index}s`}}
                >
                  {/* Animated background gradient */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient.replace('50', '10')} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}></div>
                  
                  {/* Floating decoration */}
                  <div className={`absolute -top-2 -right-2 w-16 h-16 bg-gradient-to-br ${feature.gradient} rounded-full opacity-10 group-hover:opacity-20 group-hover:scale-110 transition-all duration-500`}></div>
                  
                  {/* Icon */}
                  <div className={`relative w-14 h-14 bg-gradient-to-br ${feature.gradient} rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500 shadow-lg group-hover:shadow-xl`}>
                    <feature.icon className={`w-7 h-7 ${feature.iconColor} group-hover:text-white transition-colors duration-300`} />
                  </div>
                  
                  {/* Content */}
                  <div className="relative">
                    <h3 className={`text-xl font-semibold text-slate-900 mb-4 group-hover:${feature.iconColor} transition-colors duration-300`}>
                      {feature.title}
                    </h3>
                    <p className="text-slate-600 leading-relaxed group-hover:text-slate-700 transition-colors duration-300">
                      {feature.description}
                    </p>
                  </div>

                  {/* Hover glow effect */}
                  <div className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`} 
                       style={{boxShadow: `0 0 60px ${feature.gradient.includes('cyan') ? 'rgba(6, 182, 212, 0.3)' : feature.gradient.includes('teal') ? 'rgba(20, 184, 166, 0.3)' : feature.gradient.includes('purple') ? 'rgba(147, 51, 234, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`}}></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive Benefits Section */}
        <section className="py-20 relative">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-6 animate-fade-in-up">
                Why Choose ScreeningPilot?
              </h2>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {[
                { title: "Save Time", value: "90%", description: "Reduction in screening time", color: "from-cyan-500 to-blue-500" },
                { title: "Improve Quality", value: "85%", description: "Better candidate matches", color: "from-teal-500 to-emerald-500" },
                { title: "Reduce Costs", value: "70%", description: "Lower hiring expenses", color: "from-purple-500 to-pink-500" }
              ].map((benefit, index) => (
                <div key={index} className="group text-center p-6 rounded-xl bg-white/60 backdrop-blur-sm border border-slate-200/50 hover:bg-white/80 hover:shadow-xl transition-all duration-300 animate-fade-in-up" style={{animationDelay: `${0.2 * index}s`}}>
                  <div className={`text-4xl font-bold bg-gradient-to-r ${benefit.color} bg-clip-text text-transparent mb-2 group-hover:scale-110 transition-transform duration-300`}>
                    {benefit.value}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800 mb-2">{benefit.title}</h3>
                  <p className="text-slate-600 text-sm">{benefit.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Enhanced CTA Section */}
        <section className="py-20 mt-16 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-600/10 to-teal-600/10 rounded-3xl mx-6"></div>
          <div className="container mx-auto px-6 relative">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center px-4 py-2 bg-white/20 backdrop-blur-sm border border-white/30 text-slate-700 text-sm font-medium rounded-full mb-6 animate-fade-in">
                <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full mr-2 animate-pulse"></div>
                Join 10,000+ Companies
              </div>
              
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-6 animate-fade-in-up">
                Ready to Transform Your Recruitment Process?
              </h2>
              <p className="text-xl text-slate-600 mb-8 animate-fade-in-up" style={{animationDelay: '0.1s'}}>
                Join thousands of recruitment agencies already using ScreeningPilot to hire faster and smarter.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-fade-in-up" style={{animationDelay: '0.2s'}}>
                <Button 
                  size="lg" 
                  className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white shadow-2xl hover:shadow-cyan-500/25 transition-all duration-300 text-lg px-8 py-6 rounded-xl font-semibold border-0 group relative overflow-hidden"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-teal-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
                  <span className="relative z-10">Start Free Trial</span>
                </Button>
                
                <Button 
                  size="lg" 
                  variant="outline"
                  className="border-2 border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 text-lg px-8 py-6 rounded-xl font-semibold transition-all duration-300"
                >
                  Watch Demo
                </Button>
              </div>
              
              <p className="text-sm text-slate-500 mt-4">
                No credit card required • 14-day free trial • Cancel anytime
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Features;