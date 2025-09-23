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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50">
      <Header />
      
      <main className="pt-24 pb-16">
        {/* Hero Section */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-slate-800 via-cyan-600 to-teal-600 bg-clip-text text-transparent mb-6">
                Powerful Features for Modern Recruitment
              </h1>
              <p className="text-xl text-slate-600 mb-12 leading-relaxed">
                Discover all the tools and capabilities that make ScreeningPilot the ultimate solution for AI-powered resume screening and candidate management.
              </p>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-16">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="group backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl p-8 hover:shadow-xl hover:border-cyan-300/50 transition-all duration-300 hover:-translate-y-1"
                >
                  {/* Icon */}
                  <div className={`w-12 h-12 bg-gradient-to-br ${feature.gradient} rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300`}>
                    <feature.icon className={`w-6 h-6 ${feature.iconColor}`} />
                  </div>
                  
                  {/* Content */}
                  <div>
                    <h3 className={`text-xl font-semibold text-slate-900 mb-4 group-hover:${feature.iconColor.replace('text-', 'text-')} transition-colors`}>
                      {feature.title}
                    </h3>
                    <p className="text-slate-600 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 mt-16">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-6">
                Ready to Transform Your Recruitment Process?
              </h2>
              <p className="text-xl text-slate-600 mb-8">
                Join thousands of recruitment agencies already using ScreeningPilot to hire faster and smarter.
              </p>
              <Button 
                size="lg" 
                className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white shadow-2xl hover:shadow-cyan-500/25 transition-all duration-300 text-lg px-8 py-6 rounded-xl font-semibold border-0"
              >
                Start Free Trial
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Features;