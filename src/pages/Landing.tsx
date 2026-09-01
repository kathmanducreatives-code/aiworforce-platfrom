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
        {/*
          8-10. The three demos, GROUPED and reordered: Leads → Signals →
          Recruiting. Recruiting led the page before, which made it the identity
          rather than one example of the breadth. The first one carries
          #the-work, the nav's "What it does" target.
        */}
        <ProductScreening />
        <ExpertJourney />
        <ProductLookalike />
        {/* 11. A Monday with your AI team */}
        <DayTimelineSection />
        {/* 12. What this replaces */}
        <TimeMath />
        {/* 13. How businesses use Agentory */}
        <SocialProof />
        {/* 14. Build your own AI employee (#build-your-own) */}
        <AgentBuilderSection />
        {/* 15. Pricing */}
        <PricingCard />
        {/* 16. FAQ (#faq) */}
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