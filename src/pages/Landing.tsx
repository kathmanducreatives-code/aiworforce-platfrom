import LandingHeader from "@/components/landing/LandingHeader";
import Footer from "@/components/landing/Footer";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import HeroHook from "@/components/landing/HeroHook";
import TimeMath from "@/components/landing/TimeMath";
import SocialProof from "@/components/landing/SocialProof";
import PricingCard from "@/components/landing/PricingCard";
import FAQSection from "@/components/landing/FAQSection";
import MarqueeBanner from "@/components/landing/MarqueeBanner";
import FinalCTA from "@/components/landing/FinalCTA";
import GlobalTrustBar from "@/components/landing/GlobalTrustBar";
import EcosystemSection from "@/components/landing/EcosystemSection";
import DepartmentRevealSection from "@/components/landing/DepartmentRevealSection";
import TeamsAtWorkSection from "@/components/landing/TeamsAtWorkSection";
import GlobalSection from "@/components/landing/GlobalSection";
import DayTimelineSection from "@/components/landing/DayTimelineSection";
import AgentBuilderSection from "@/components/landing/AgentBuilderSection";
import FiestaBackground from "@/components/landing/FiestaBackground";

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
    <div 
      className="min-h-screen relative isolate bg-transparent font-display text-white selection:bg-accent-mint selection:text-black"
    >
      {/* ═══ GLOBAL ATMOSPHERE SYSTEM ═══ */}
      <FiestaBackground />

      {/* 1. Sticky Nav */}
      <LandingHeader />

      <main ref={mainRef} className="relative z-10 w-full">
        {/* 2. Hero */}
        <HeroHook />
        {/* 3. Global Trust Bar */}
        <GlobalTrustBar />
        {/* 4. Ecosystem */}
        <EcosystemSection />
        {/* 5. Department Reveal (AI WORKFORCE) */}
        <DepartmentRevealSection />
        {/* 17. Custom Agent Builder (LABORATORY) */}
        <AgentBuilderSection />
        {/* 13. A Day With Your Workforce */}
        <DayTimelineSection />
        {/* 14. Teams At Work */}
        <TeamsAtWorkSection />
        {/* 15. The Math */}
        <TimeMath />
        {/* 16. Social Proof */}
        <SocialProof />
        {/* 18. Pricing */}
        <PricingCard />
        {/* 19. FAQ */}
        <FAQSection />
        {/* 20. Global */}
        <GlobalSection />
        {/* 21. Marquee */}
        <MarqueeBanner />
        {/* 22. Final CTA */}
        <FinalCTA />
      </main>

      {/* 23. Footer */}
      <Footer />
    </div>
  );
};

export default Landing;
