import Header from "@/components/Header";
import { Search, Brain, GitBranch, Mail, TrendingUp, CheckCircle, Zap, ShieldCheck, Database } from "lucide-react";
import { Button } from "@/components/ui/button";

const Features = () => {
  const features = [
    {
      icon: Search,
      title: "Precision Sourcing Engine",
      description: "Automates the search for passive candidates on LinkedIn and other professional sites. Eliminates manual list building — recruiters stop spending time on repetitive searching and list compilation.",
      benefit: "Eliminates Manual List Building",
      gradient: "from-blue-500 to-cyan-500",
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600"
    },
    {
      icon: Brain,
      title: "Deep Profile Intelligence",
      description: "Cross-references scraped profiles across multiple online sources (social, patents, publications) and delivers AI-vetted analysis. Provides verified conversation angles — ensuring first outreach is highly personalized and informed.",
      benefit: "Verified Conversation Angles",
      gradient: "from-purple-500 to-pink-500",
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600"
    },
    {
      icon: GitBranch,
      title: "Centralized CRM & Pipeline",
      description: "A dedicated system for managing both candidate and client relationships, deal flow, and specific follow-up statuses. Creates a single source of truth — all candidate history, client notes, and recruitment progress tracked in one place.",
      benefit: "Single Source of Truth",
      gradient: "from-teal-500 to-green-500",
      iconBg: "bg-teal-50",
      iconColor: "text-teal-600"
    },
    {
      icon: Mail,
      title: "Customizable Email Nurturing",
      description: "Allows for both high-volume sequences (for general roles) and highly personalized, single-touch emails (for niche roles). Maintains relationships at scale — ensuring no lead goes cold through automation or strategic manual check-ins.",
      benefit: "Relationships at Scale",
      gradient: "from-orange-500 to-red-500",
      iconBg: "bg-orange-50",
      iconColor: "text-orange-600"
    },
    {
      icon: TrendingUp,
      title: "Recruiting Agency Data Dashboard",
      description: "Visual metrics on placements, time-to-fill, source efficiency, and follow-up status. Enables data-driven growth — agency owners can quickly view KPIs and make strategic decisions to scale the business.",
      benefit: "Data-Driven Growth",
      gradient: "from-indigo-500 to-blue-500",
      iconBg: "bg-indigo-50",
      iconColor: "text-indigo-600"
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
                The Only CRM Built for <span className="bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">Recruiting Excellence</span>
              </h1>
              <p className="text-xl text-slate-600 mb-12 leading-relaxed animate-fade-in-up" style={{animationDelay: '0.2s'}}>
                Automate passive talent discovery, deliver verified candidate intelligence, and manage every relationship in one AI-powered system. Built specifically for recruiting agencies who want to make faster, smarter placements.
              </p>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto mb-16">
                <div className="text-center animate-fade-in-up" style={{animationDelay: '0.3s'}}>
                  <div className="text-4xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent mb-2">90%</div>
                  <div className="text-slate-600 font-medium">Faster Sourcing</div>
                  <div className="text-sm text-slate-500 mt-1">Time saved on manual searching</div>
                </div>
                <div className="text-center animate-fade-in-up" style={{animationDelay: '0.4s'}}>
                  <div className="text-4xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent mb-2">100%</div>
                  <div className="text-slate-600 font-medium">Verified Intelligence</div>
                  <div className="text-sm text-slate-500 mt-1">Cross-referenced data accuracy</div>
                </div>
                <div className="text-center animate-fade-in-up" style={{animationDelay: '0.5s'}}>
                  <div className="text-4xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent mb-2">3x</div>
                  <div className="text-slate-600 font-medium">More Pipeline</div>
                  <div className="text-sm text-slate-500 mt-1">Relationship management capacity</div>
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
                  className="group relative bg-white rounded-2xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 border border-slate-100 animate-fade-in-up"
                  style={{animationDelay: `${0.1 * index}s`}}
                >
                  {/* Icon Container */}
                  <div className={`inline-flex p-4 rounded-xl ${feature.iconBg} mb-6 group-hover:scale-110 transition-transform duration-300`}>
                    <feature.icon className={`h-8 w-8 ${feature.iconColor}`} />
                  </div>
                  
                  {/* Title */}
                  <h3 className="text-2xl font-bold text-slate-900 mb-4">
                    {feature.title}
                  </h3>
                  
                  {/* Description */}
                  <p className="text-slate-600 mb-4 leading-relaxed">
                    {feature.description}
                  </p>
                  
                  {/* Benefit Badge */}
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-50 border border-teal-200 rounded-full text-sm text-teal-700 font-medium">
                    <CheckCircle className="h-4 w-4" />
                    {feature.benefit}
                  </div>
                  
                  {/* Hover gradient border effect */}
                  <div className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r ${feature.gradient} p-[2px] -z-10`}>
                    <div className="w-full h-full bg-white rounded-2xl"></div>
                  </div>
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
            
            <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
              <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-2xl p-8 border border-teal-100 animate-fade-in-up" style={{animationDelay: '0.1s'}}>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-white rounded-xl shadow-sm">
                    <Zap className="h-6 w-6 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Passive Talent at Scale</h3>
                    <p className="text-slate-700">
                      Automatically discover high-quality passive candidates who aren't actively job hunting. Build targeted lists in minutes, not hours.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-8 border border-purple-100 animate-fade-in-up" style={{animationDelay: '0.2s'}}>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-white rounded-xl shadow-sm">
                    <ShieldCheck className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Verified Intelligence</h3>
                    <p className="text-slate-700">
                      Cross-reference profiles across multiple sources. Get AI-vetted insights and personalized conversation starters for every outreach.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 border border-blue-100 animate-fade-in-up" style={{animationDelay: '0.3s'}}>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-white rounded-xl shadow-sm">
                    <Database className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">True CRM for Recruiting</h3>
                    <p className="text-slate-700">
                      Manage candidates AND clients in one place. Track every interaction, note, and deal stage without losing critical information.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-2xl p-8 border border-orange-100 animate-fade-in-up" style={{animationDelay: '0.4s'}}>
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-white rounded-xl shadow-sm">
                    <TrendingUp className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Data-Driven Decisions</h3>
                    <p className="text-slate-700">
                      View real-time KPIs on placements, time-to-fill, and source efficiency. Make strategic decisions to scale your recruiting business.
                    </p>
                  </div>
                </div>
              </div>
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
                Ready to Transform Your Recruiting Agency?
              </h2>
              <p className="text-xl text-slate-600 mb-8 animate-fade-in-up" style={{animationDelay: '0.1s'}}>
                Join hundreds of recruiting agencies using ScreeningPilot to automate passive talent discovery, deliver verified intelligence, and make faster placements.
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