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
    <div className="min-h-screen relative bg-white overflow-hidden">
      <NoiseOverlay />

      {/* Floating background orbs */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute w-[400px] h-[400px] rounded-full bg-emerald-500/[0.04] blur-[100px] top-[-5%] left-[-5%]" style={{ animation: 'float-slow 8s ease-in-out infinite' }} />
        <div className="absolute w-[350px] h-[350px] rounded-full bg-emerald-600/[0.03] blur-[120px] top-[30%] right-[-5%]" style={{ animation: 'float-gentle 12s ease-in-out infinite' }} />
        <div className="absolute w-[250px] h-[250px] rounded-full bg-emerald-400/[0.04] blur-[80px] bottom-[15%] left-[20%]" style={{ animation: 'float-slow 10s ease-in-out infinite 2s' }} />
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
        {/* ★ Floating Calculator Widget (between pages 1 & 2) */}
        <SavingsCalculator />
        {/* 5. Product Showcase — AI Job Screening */}
        <ProductScreening />
        {/* 6. Product Showcase — Lookalike Results */}
        <ProductLookalike />
        {/* 7. Time Math — Comparison Table */}
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
