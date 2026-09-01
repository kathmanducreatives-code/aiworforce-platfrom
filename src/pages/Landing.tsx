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
        {/* 4. The Problem (Transformation) */}
        <TransformationSection />
        {/* 5. Your AI Team — portraits + powered by */}
        <MeetYourAITeamSection />
        {/* 6. They work together — war room simulation (#how-it-works) */}
        <MeetTheTeamSection />
        {/*
          7. Under the hood — the tool orbit.
          MOVED from position 4. Leading with the tools read as an integration
          marketplace; the same orbit means "you never manage any of this" only
          once the reader already knows there are AI employees using it.
        */}
        <EcosystemSection />
        {/* 8. What Agentory handles (#the-work) */}
        <TeamsAtWorkSection />
        {/*
          9-11. The three demos, GROUPED and reordered: Leads → Signals →
          Recruiting. Recruiting led the page before, which made it the identity
          rather than one example of the breadth.
        */}
        <ProductScreening />
        <ExpertJourney />
        <ProductLookalike />
        {/* 12. A Monday with your AI team */}
        <DayTimelineSection />
        {/* 13. What this replaces */}
        <TimeMath />
        {/* 14. How businesses use Agentory */}
        <SocialProof />
        {/* 15. Build your own AI employee (#build-your-own) */}
        <AgentBuilderSection />
        {/* 16. Pricing */}
        <PricingCard />
        {/* 17. FAQ (#faq) */}
        <FAQSection />
        {/* 18. Global */}
        <GlobalSection />
        {/* 19. Marquee */}
        <MarqueeBanner />
        {/* 20. Final CTA */}
        <FinalCTA />
      </main>

      {/* 21. Footer */}
      <Footer />
    </div>
  );
};

export default Landing;