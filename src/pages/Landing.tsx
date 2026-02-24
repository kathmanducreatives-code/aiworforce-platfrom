import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import HeroHook from "@/components/landing/HeroHook";
import OldVsNewComparison from "@/components/landing/OldVsNewComparison";
import BehavioralEngine from "@/components/landing/BehavioralEngine";
import SocialProof from "@/components/landing/SocialProof";
import SocialProofMetrics from "@/components/landing/SocialProofMetrics";
import FAQSection from "@/components/landing/FAQSection";
import FinalCTA from "@/components/landing/FinalCTA";
import ClosingCTA from "@/components/landing/ClosingCTA";
import NoiseOverlay from "@/components/landing/NoiseOverlay";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen relative bg-white overflow-hidden">
      {/* Global noise overlay */}
      <NoiseOverlay />

      {/* Floating background orbs */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute w-[400px] h-[400px] rounded-full bg-emerald-500/[0.04] blur-[100px] top-[-5%] left-[-5%]" style={{ animation: 'float-slow 8s ease-in-out infinite' }} />
        <div className="absolute w-[350px] h-[350px] rounded-full bg-emerald-600/[0.03] blur-[120px] top-[40%] right-[-5%]" style={{ animation: 'float-gentle 12s ease-in-out infinite' }} />
        <div className="absolute w-[250px] h-[250px] rounded-full bg-emerald-400/[0.04] blur-[80px] bottom-[15%] left-[20%]" style={{ animation: 'float-slow 10s ease-in-out infinite 2s' }} />
      </div>

      <Header />

      <main className="relative z-10">
        {/* 1. Hero */}
        <HeroHook />
        {/* 2. Old Way vs New Way (pinned scroll) */}
        <OldVsNewComparison />
        {/* 3. Core Technology */}
        <BehavioralEngine />
        {/* 4. Social Proof (NEW) */}
        <SocialProof />
        {/* 5. The Numbers + Marquee */}
        <SocialProofMetrics />
        {/* 6. Closing CTA (strikethrough comparison) */}
        <ClosingCTA />
        {/* 7. FAQ (NEW) */}
        <FAQSection />
        {/* 8. Final CTA Block (NEW) */}
        <FinalCTA />
      </main>

      <Footer />
    </div>
  );
};

export default Landing;
