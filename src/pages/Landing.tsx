import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import HeroSection from "@/components/landing/HeroSection";
import AssemblyLineSection from "@/components/landing/AssemblyLineSection";
import LiveTerminalSection from "@/components/landing/LiveTerminalSection";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { ChevronDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen text-foreground relative overflow-hidden" style={{ background: "#030507" }}>
      {/* Universal subtle architect grid across entire landing page */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      
      <div className="relative z-50">
        <Header className="bg-[#030507]/90" />
      </div>
      
      <main className="relative z-10 w-full overflow-hidden">
        {/* New Sections */}
        <HeroSection />
        
        <AssemblyLineSection />
        
        <LiveTerminalSection />

        {/* Final CTA Section */}
        <section className="py-24 px-6 relative">
          <div className="max-w-4xl mx-auto text-center space-y-8 animate-fade-in-up">
            <h2 className="text-4xl md:text-5xl font-black text-white leading-tight">
              Ready to deploy your <span style={{ color: "#00FF94" }}>AI workforce?</span>
            </h2>
            <p className="text-xl mx-auto max-w-2xl" style={{ color: "rgba(255,255,255,0.55)" }}>
              Join the organizations scaling their operations with autonomous talent, growth, and intelligence operatives.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <button 
                onClick={() => navigate('/auth')}
                className="group relative flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold text-lg overflow-hidden transition-all duration-300 w-full sm:w-auto"
                style={{
                  background: "#00FF94",
                  color: "#030507",
                  boxShadow: "0 0 40px rgba(0,255,148,0.25)"
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#05D97E";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 0 60px rgba(0,255,148,0.4)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#00FF94";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 0 40px rgba(0,255,148,0.25)";
                }}
              >
                Start Free Trial
                <TrendingUp className="w-5 h-5 transition-transform group-hover:-translate-y-0.5" />
              </button>
              <button 
                onClick={() => navigate('/get-demo')}
                className="group flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold text-lg transition-all duration-300 w-full sm:w-auto"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "white"
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
                }}
              >
                Book a Demo
              </button>
            </div>
          </div>
          
          {/* Bottom subtle glow */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] pointer-events-none"
               style={{ background: "radial-gradient(ellipse at bottom, rgba(0,255,148,0.08) 0%, transparent 60%)" }} />
        </section>
      </main>

      <div className="relative z-10 border-t border-white/5 bg-[#030507]">
        <Footer />
      </div>
    </div>
  );
};

export default Landing;
