import ModernDashboard from "@/components/ModernDashboard";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Candidates = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/dashboard")}
          className="hover:bg-primary/10 mb-4"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <ModernDashboard />
      </div>
    </div>
  );
};

export default Candidates;
