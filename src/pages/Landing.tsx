import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import { DigitalBlueprintBg } from "@/components/shared/DigitalBlueprintBg";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import HeroHook from "@/components/landing/HeroHook";
import { TransformationSection } from "@/components/landing/TransformationSection";

import ProductDashboard from "@/components/landing/ProductDashboard";

import ProductScreening from "@/components/landing/ProductScreening";
import ProductLookalike from "@/components/landing/ProductLookalike";
import TimeMath from "@/components/landing/TimeMath";
import FeatureSet from "@/components/landing/FeatureSet";
import SocialProof from "@/components/landing/SocialProof";
import PricingCard from "@/components/landing/PricingCard";
import FAQSection from "@/components/landing/FAQSection";
import MarqueeBanner from "@/components/landing/MarqueeBanner";
import FinalCTA from "@/components/landing/FinalCTA";
import { ExpertJourney } from "@/components/landing/ExpertJourney";

gsap.registerPlugin(ScrollTrigger);

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }

    return () => { };
  }, [user, navigate]);

  return (
    <div className="min-h-screen relative bg-deep-space overflow-clip font-display text-white">
      <DigitalBlueprintBg />

      {/* 1. Sticky Nav */}
      <Header />

      <main ref={mainRef} className="relative z-10 w-full">
        {/* 2. Hero */}
        <HeroHook />
        {/* 3. The Transformation (pinned scrub) */}
        <TransformationSection />

        {/* PINNED INTERACTIVE STAGES */}
        <ProductDashboard />
        <ProductLookalike />
        <ProductScreening />

        {/* Expert Journey — 4-step scroll stack */}
        <ExpertJourney />

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
