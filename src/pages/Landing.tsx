import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import HeroHook from "@/components/landing/HeroHook";
import OldVsNewComparison from "@/components/landing/OldVsNewComparison";
import BehavioralEngine from "@/components/landing/BehavioralEngine";
import SocialProofMetrics from "@/components/landing/SocialProofMetrics";
import ClosingCTA from "@/components/landing/ClosingCTA";
import CustomCursor from "@/components/landing/CustomCursor";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen relative bg-background overflow-hidden">
      <CustomCursor />

      {/* Floating background orbs */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="floating-orb w-[500px] h-[500px] top-[-10%] left-[-10%]" style={{ animation: 'float-slow 8s ease-in-out infinite' }} />
        <div className="floating-orb w-[400px] h-[400px] top-[40%] right-[-5%]" style={{ animation: 'float-gentle 12s ease-in-out infinite' }} />
        <div className="floating-orb w-[300px] h-[300px] bottom-[10%] left-[20%]" style={{ animation: 'float-slow 10s ease-in-out infinite 2s' }} />
        <div className="floating-orb w-[200px] h-[200px] top-[20%] left-[60%]" style={{ animation: 'float-gentle 9s ease-in-out infinite 4s' }} />
      </div>

      {/* Subtle grid pattern */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(hsl(var(--primary) / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.3) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <Header />
      
      <main className="relative z-10 pt-20">
        <HeroHook />
        <OldVsNewComparison />
        <BehavioralEngine />
        <SocialProofMetrics />
        <ClosingCTA />
      </main>

      <Footer />
    </div>
  );
};

export default Landing;
