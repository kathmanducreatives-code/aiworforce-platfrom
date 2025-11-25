import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import logoImage from "@/assets/hr20-asia-logo.png";

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="flex items-center justify-center min-h-[calc(100vh-4rem)] px-6">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <img 
            src={logoImage} 
            alt="HR20 Asia" 
            className="h-24 w-auto mx-auto mb-8"
          />
          <h1 className="text-5xl font-bold text-foreground">
            AI-Powered Recruitment Platform
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Streamline your hiring process with intelligent candidate screening, 
            deep search capabilities, and automated workflows.
          </p>
          <div className="flex items-center justify-center gap-4 pt-4">
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
      </main>
    </div>
  );
};

export default Landing;
