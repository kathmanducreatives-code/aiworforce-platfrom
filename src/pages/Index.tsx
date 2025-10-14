import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import ResumeUpload from "@/components/ResumeUpload";
import ModernDashboard from "@/components/ModernDashboard";

const Index = () => {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />
      <main>
        <HeroSection />
        <ResumeUpload />
        <ModernDashboard />
      </main>
    </div>
  );
};

export default Index;