import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import CustomCursor from "@/components/landing/CustomCursor";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef, lazy, Suspense } from "react";
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
import GlobalSection from "@/components/landing/GlobalSection";
import EmailCapture from "@/components/landing/EmailCapture";
import FiestaBackground from "@/components/landing/FiestaBackground";

// Lazily loaded heavy sections (animation-heavy, below the fold)
const EcosystemSection        = lazy(() => import("@/components/landing/EcosystemSection"));
const DepartmentRevealSection = lazy(() => import("@/components/landing/DepartmentRevealSection"));
const AgentBuilderSection     = lazy(() => import("@/components/landing/AgentBuilderSection"));
const DayTimelineSection      = lazy(() => import("@/components/landing/DayTimelineSection"));
const TeamsAtWorkSection      = lazy(() => import("@/components/landing/TeamsAtWorkSection"));

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
      {/* ═══ CUSTOM CURSOR ═══ */}
      <CustomCursor />

      {/* ═══ GLOBAL ATMOSPHERE SYSTEM ═══ */}
      <FiestaBackground />

      {/* 1. Sticky Nav */}
      <Header />

      <main ref={mainRef} className="relative z-10 w-full">
        {/* 2. Hero */}
        <HeroHook />
        {/* 3. Global Trust Bar */}
        <GlobalTrustBar />
        {/* 4. Ecosystem */}
        <Suspense fallback={<div className="h-screen" />}>
          <EcosystemSection />
        </Suspense>
        {/* 5. Department Reveal */}
        <Suspense fallback={<div className="h-screen" />}>
          <DepartmentRevealSection />
        </Suspense>
        {/* 6. Agent Builder  */}
        <Suspense fallback={<div className="min-h-[60vh]" />}>
          <AgentBuilderSection />
        </Suspense>
        {/* 7. Day Timeline */}
        <Suspense fallback={<div className="min-h-[60vh]" />}>
          <DayTimelineSection />
        </Suspense>
        {/* 8. Teams At Work */}
        <Suspense fallback={<div className="min-h-[40vh]" />}>
          <TeamsAtWorkSection />
        </Suspense>
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
        {/* 21. Email Capture */}
        <EmailCapture />
        {/* 22. Marquee */}
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
