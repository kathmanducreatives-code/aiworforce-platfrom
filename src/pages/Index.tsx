import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import ResumeUpload from "@/components/ResumeUpload";
import ModernDashboard from "@/components/ModernDashboard";

const Index = () => {
  return (
    <div className="min-h-screen bg-white">
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