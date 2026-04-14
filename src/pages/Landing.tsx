import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import CustomCursor from "@/components/landing/CustomCursor";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef, useState, lazy, Suspense } from "react";
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
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
    return () => { };
  }, [user, navigate]);

  // Track scroll progress for the progress bar
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        setScrollProgress(Math.min(scrollTop / docHeight, 1));
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div 
      className="min-h-screen relative isolate bg-transparent font-display text-white selection:bg-accent-mint selection:text-black"
    >
      {/* ═══ SCROLL PROGRESS BAR ═══ */}
      <div
        className="fixed top-0 left-0 h-[2px] z-[9999] pointer-events-none"
        style={{
          width: `${scrollProgress * 100}%`,
          background: 'linear-gradient(90deg, rgba(16,185,129,0.6), #10B981, rgba(0,255,148,0.8))',
          boxShadow: '0 0 8px rgba(16,185,129,0.5), 0 0 20px rgba(16,185,129,0.2)',
          transition: 'width 60ms linear',
        }}
      />

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

