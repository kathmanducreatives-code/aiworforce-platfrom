import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import HeroHook from "@/components/landing/HeroHook";
import OldVsNewComparison from "@/components/landing/OldVsNewComparison";
import ProductDashboard from "@/components/landing/ProductDashboard";
import SavingsCalculator from "@/components/landing/SavingsCalculator";
import ProductScreening from "@/components/landing/ProductScreening";
import ProductLookalike from "@/components/landing/ProductLookalike";
import { ScrollJourneySection } from "@/components/landing/ScrollJourneySection";
import TimeMath from "@/components/landing/TimeMath";
import FeatureSet from "@/components/landing/FeatureSet";
import SocialProof from "@/components/landing/SocialProof";
import PricingCard from "@/components/landing/PricingCard";
import FAQSection from "@/components/landing/FAQSection";
import MarqueeBanner from "@/components/landing/MarqueeBanner";
import FinalCTA from "@/components/landing/FinalCTA";
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
    <div className="min-h-screen relative bg-[#050505] overflow-x-hidden font-display">
      <NoiseOverlay />

      {/* Animated mesh gradient blobs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute w-[800px] h-[800px] rounded-full top-[-20%] left-[-10%] opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(5,150,105,0.15) 0%, transparent 70%)', animation: 'mesh-drift 25s ease-in-out infinite' }} />
        <div className="absolute w-[600px] h-[600px] rounded-full top-[40%] right-[-10%] opacity-25"
          style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.12) 0%, transparent 70%)', animation: 'mesh-drift 30s ease-in-out infinite reverse' }} />
        <div className="absolute w-[500px] h-[500px] rounded-full bottom-[-10%] left-[30%] opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)', animation: 'mesh-drift 20s ease-in-out infinite 5s' }} />
      </div>

      {/* 1. Sticky Nav */}
      <Header />

      <main className="relative z-10">
        {/* 2. Hero */}
        <HeroHook />
        {/* 3. Old Way vs New Way (pinned scroll) */}
        <OldVsNewComparison />
        {/* 4. Product Showcase — Dashboard */}
        <ProductDashboard />
        {/* ★ Floating Calculator Notification */}
        <SavingsCalculator />
        {/* 5. Product Showcase — AI Job Screening */}
        <ProductScreening />
        {/* 6. Product Showcase — Lookalike Results */}
        <ProductLookalike />

        {/* 7. The 3D Scroll Journey Engine */}
        <ScrollJourneySection />

        {/* 8. Time Math — Comparison Table */}
        <TimeMath />
        {/* 8. Full Feature Set */}
        <FeatureSet />
        {/* 9. Social Proof */}
        <SocialProof />
        {/* 10. Pricing */}
        <PricingCard />
        {/* 11. FAQ */}
        <FAQSection />
        {/* 12. Marquee Banner */}
        <MarqueeBanner />
        {/* 13. Final CTA */}
        <FinalCTA />
      </main>

      {/* 14. Footer */}
      <Footer />
    </div>
  );
};

export default Landing;
