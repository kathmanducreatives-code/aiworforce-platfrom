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
import ProductScreening from "@/components/landing/ProductScreening";
import ProductLookalike from "@/components/landing/ProductLookalike";
import TimeMath from "@/components/landing/TimeMath";
import SocialProof from "@/components/landing/SocialProof";
import PricingCard from "@/components/landing/PricingCard";
import FAQSection from "@/components/landing/FAQSection";
import MarqueeBanner from "@/components/landing/MarqueeBanner";
import FinalCTA from "@/components/landing/FinalCTA";
import { ExpertJourney } from "@/components/landing/ExpertJourney";
import MeetTheTeamSection from "@/components/landing/MeetTheTeamSection";
import GlobalTrustBar from "@/components/landing/GlobalTrustBar";
import EcosystemSection from "@/components/landing/EcosystemSection";
import TeamsAtWorkSection from "@/components/landing/TeamsAtWorkSection";
import GlobalSection from "@/components/landing/GlobalSection";
import DayTimelineSection from "@/components/landing/DayTimelineSection";
import AgentBuilderSection from "@/components/landing/AgentBuilderSection";
import MeetYourAITeamSection from "@/components/landing/MeetYourAITeamSection";

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ limitCallbacks: true });

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
    <div className="min-h-screen relative bg-deep-space font-display text-white">
      <DigitalBlueprintBg />

      {/* 1. Sticky Nav */}
      <Header />

      <main ref={mainRef} className="relative z-10 w-full">
        {/* 2. Hero */}
        <HeroHook />
        {/* 3. Global Trust Bar */}
        <GlobalTrustBar />
        {/* 4. Ecosystem */}
        <EcosystemSection />
        {/* 5. The Problem (Transformation) */}
        <TransformationSection />
        {/* 6. Meet Your AI Team — portraits + powered by */}
        <MeetYourAITeamSection />
        {/* 6b. War Room workforce simulation */}
        <MeetTheTeamSection />
        {/* 7. Talent Department */}
        <ProductLookalike />
        {/* 8. Growth Department */}
        <ProductScreening />
        {/* 9. Intelligence Department */}
        <ExpertJourney />
        {/* 10. A Day With Your Workforce */}
        <DayTimelineSection />
        {/* 11. Teams At Work */}
        <TeamsAtWorkSection />
        {/* 12. The Math */}
        <TimeMath />
        {/* 13. Social Proof */}
        <SocialProof />
        {/* 14. Custom Agent Builder */}
        <AgentBuilderSection />
        {/* 15. Pricing */}
        <PricingCard />
        {/* 16. FAQ */}
        <FAQSection />
        {/* 17. Global */}
        <GlobalSection />
        {/* 18. Marquee */}
        <MarqueeBanner />
        {/* 19. Final CTA */}
        <FinalCTA />
      </main>

      {/* 20. Footer */}
      <Footer />
    </div>
  );
};

export default Landing;