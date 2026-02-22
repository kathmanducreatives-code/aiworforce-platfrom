import Header from "@/components/Header";
import Footer from "@/components/landing/Footer";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import HeroHook from "@/components/landing/HeroHook";
import OldVsNewComparison from "@/components/landing/OldVsNewComparison";
import BehavioralEngine from "@/components/landing/BehavioralEngine";
import SocialProofMetrics from "@/components/landing/SocialProofMetrics";
import ClosingCTA from "@/components/landing/ClosingCTA";
import CustomCursor from "@/components/landing/CustomCursor";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen relative bg-background">
      <CustomCursor />
      <Header />
      
      <main className="relative z-10 pt-20">
        <HeroHook />
        <OldVsNewComparison />
        <BehavioralEngine />
        <SocialProofMetrics />
        <ClosingCTA />
      </main>

      <Footer />
    </div>
  );
};

export default Landing;
