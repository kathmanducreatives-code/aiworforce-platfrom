import ResumeUpload from "@/components/ResumeUpload";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Users, ArrowLeft } from "lucide-react";

const Screening = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-6">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="hover:bg-primary/10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Resume Screener
              </h1>
              <p className="text-muted-foreground">
                Upload and analyze candidate resumes with AI-powered intelligence
              </p>
            </div>
            <Button
              onClick={() => navigate("/candidates")}
              variant="outline"
              className="gap-2"
            >
              <Users className="h-4 w-4" />
              View All Candidates
            </Button>
          </div>
        </div>

        <ResumeUpload />
      </div>
    </div>
  );
};

export default Screening;
