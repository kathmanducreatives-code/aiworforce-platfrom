import Header from "@/components/Header";
import { Brain, Upload, Target, GitBranch } from "lucide-react";

const Features = () => {
  const features = [
    {
      icon: Brain,
      title: "AI-Powered Analysis",
      description: "Advanced machine learning algorithms analyze resumes with human-level accuracy, identifying key skills, experience, and qualifications instantly.",
      gradient: "from-violet-500 to-purple-600"
    },
    {
      icon: Upload,
      title: "Bulk Resume Upload",
      description: "Upload multiple resumes at once. Our system processes hundreds of resumes simultaneously, saving you hours of manual work.",
      gradient: "from-blue-500 to-cyan-600"
    },
    {
      icon: Target,
      title: "Smart Candidate Scoring",
      description: "Automated scoring system ranks candidates based on job requirements, giving you a clear view of the best matches for each position.",
      gradient: "from-emerald-500 to-teal-600"
    },
    {
      icon: GitBranch,
      title: "Pipeline Management",
      description: "Streamline your recruitment pipeline with intuitive candidate tracking, stage management, and automated workflow transitions.",
      gradient: "from-orange-500 to-red-600"
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-20 bg-gradient-to-br from-slate-50 to-cyan-50/30">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-6">
                Powerful Features for Modern Recruitment
              </h1>
              <p className="text-xl text-slate-600 mb-8 leading-relaxed">
                Discover all the tools and capabilities that make ScreeningPilot the ultimate solution for AI-powered resume screening and candidate management.
              </p>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 bg-gradient-to-b from-white to-slate-50/50">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-12 max-w-6xl mx-auto">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="group relative p-10 bg-white rounded-3xl border border-slate-100 hover:border-slate-200 hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 overflow-hidden"
                >
                  {/* Background Gradient Effect */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
                  
                  {/* Icon */}
                  <div className={`relative w-20 h-20 bg-gradient-to-br ${feature.gradient} rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-lg`}>
                    <feature.icon className="w-10 h-10 text-white" />
                  </div>
                  
                  {/* Content */}
                  <div className="relative">
                    <h3 className="text-2xl font-bold text-slate-900 mb-4 group-hover:text-slate-800 transition-colors duration-300">
                      {feature.title}
                    </h3>
                    <p className="text-slate-600 leading-relaxed text-lg">
                      {feature.description}
                    </p>
                  </div>

                  {/* Decorative Element */}
                  <div className={`absolute -top-2 -right-2 w-24 h-24 bg-gradient-to-br ${feature.gradient} rounded-full opacity-10 group-hover:opacity-20 transition-opacity duration-500`} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-gradient-to-r from-cyan-600 to-teal-600">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-4xl font-bold text-white mb-6">
                Ready to Transform Your Recruitment Process?
              </h2>
              <p className="text-xl text-cyan-100 mb-8">
                Join thousands of recruitment agencies already using ScreeningPilot to hire faster and smarter.
              </p>
              <button className="bg-white text-cyan-600 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-slate-50 transition-colors duration-300 shadow-lg hover:shadow-xl">
                Start Free Trial
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Features;