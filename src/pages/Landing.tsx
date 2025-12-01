import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import InteractiveResumeMockup from "@/components/InteractiveResumeMockup";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="flex items-center justify-center min-h-[calc(100vh-4rem)] px-6 py-12">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          {/* Left side: Text content */}
          <div className="space-y-8 text-center lg:text-left">
            <h1 className="text-5xl font-bold text-foreground">
              AI-Powered Recruitment Platform
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl">
              Streamline your hiring process with intelligent candidate screening, 
              deep search capabilities, and automated workflows.
            </p>
            <div className="flex items-center justify-center lg:justify-start gap-4 pt-4">
              <Button 
                onClick={() => navigate('/auth')}
                size="lg"
                className="bg-primary hover:bg-primary/90"
              >
                Get Started
              </Button>
              <Button 
                onClick={() => navigate('/get-demo')}
                variant="outline"
                size="lg"
              >
                Request Demo
              </Button>
            </div>
          </div>

          {/* Right side: Interactive Resume Mockup */}
          <div className="flex justify-center lg:justify-end">
            <InteractiveResumeMockup />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Landing;
