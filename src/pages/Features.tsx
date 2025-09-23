import Header from "@/components/Header";
import { 
  Brain, 
  Upload, 
  Target, 
  Users, 
  Zap, 
  Search,
  BarChart3,
  Clock,
  Shield,
  Bot,
  FileText,
  TrendingUp
} from "lucide-react";

const Features = () => {
  const features = [
    {
      icon: Brain,
      title: "AI-Powered Analysis",
      description: "Advanced machine learning algorithms analyze resumes with human-level accuracy, identifying key skills, experience, and qualifications instantly."
    },
    {
      icon: Upload,
      title: "Bulk Resume Upload",
      description: "Upload multiple resumes at once. Our system processes hundreds of resumes simultaneously, saving you hours of manual work."
    },
    {
      icon: Target,
      title: "Smart Candidate Scoring",
      description: "Automated scoring system ranks candidates based on job requirements, giving you a clear view of the best matches for each position."
    },
    {
      icon: Users,
      title: "Team Collaboration",
      description: "Share candidate profiles with your team, add comments, and make collaborative hiring decisions with built-in communication tools."
    },
    {
      icon: Zap,
      title: "Real-time Processing",
      description: "Get instant results as soon as resumes are uploaded. No waiting time - see analysis and scores immediately."
    },
    {
      icon: Search,
      title: "Smart Matching",
      description: "Intelligent matching algorithm compares candidates against job descriptions and requirements for precise fit assessment."
    },
    {
      icon: BarChart3,
      title: "Analytics Dashboard",
      description: "Comprehensive analytics showing hiring trends, candidate quality metrics, and recruitment performance insights."
    },
    {
      icon: Clock,
      title: "Time Tracking",
      description: "Monitor time saved per hire, track recruitment efficiency, and measure team productivity with detailed time analytics."
    },
    {
      icon: Shield,
      title: "Data Security",
      description: "Enterprise-grade security with encrypted data storage, GDPR compliance, and secure candidate information handling."
    },
    {
      icon: Bot,
      title: "Automated Workflows",
      description: "Set up automated email sequences, candidate notifications, and follow-up reminders to streamline your recruitment process."
    },
    {
      icon: FileText,
      title: "Custom Reports",
      description: "Generate detailed reports on candidate pools, hiring metrics, and recruitment ROI with customizable templates."
    },
    {
      icon: TrendingUp,
      title: "Performance Insights",
      description: "Track recruitment success rates, candidate quality improvements, and hiring velocity with actionable insights."
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
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="group p-8 bg-white rounded-2xl border border-slate-200/50 hover:border-cyan-200 hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                >
                  <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <feature.icon className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-4 group-hover:text-cyan-600 transition-colors duration-300">
                    {feature.title}
                  </h3>
                  <p className="text-slate-600 leading-relaxed">
                    {feature.description}
                  </p>
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