import { Briefcase, Clock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface JobLandingStepProps {
  job: {
    title: string;
    company_name: string;
    description: string;
    required_skills: string[];
    logo_url?: string | null;
  };
  onStart: () => void;
}

export default function JobLandingStep({ job, onStart }: JobLandingStepProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-lg w-full space-y-8 text-center">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
            {job.logo_url ? (
              <img src={job.logo_url} alt={job.company_name} className="w-5 h-5 rounded-full object-cover" />
            ) : (
              <Briefcase className="w-4 h-4" />
            )}
            {job.company_name || 'Company'}
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            {job.title}
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-md mx-auto">
            {job.description?.slice(0, 200) || 'Apply for this position with a quick AI-powered screening.'}
            {job.description && job.description.length > 200 ? '...' : ''}
          </p>
        </div>

        {job.required_skills?.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {job.required_skills.slice(0, 6).map((skill) => (
              <span key={skill} className="px-2.5 py-1 rounded-md bg-secondary/50 text-secondary-foreground text-xs font-medium">
                {skill}
              </span>
            ))}
            {job.required_skills.length > 6 && (
              <span className="px-2.5 py-1 rounded-md bg-muted text-muted-foreground text-xs">
                +{job.required_skills.length - 6} more
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            ~3 minutes
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-4 h-4" />
            Private & secure
          </div>
        </div>

        <Button onClick={onStart} size="lg" className="w-full max-w-xs mx-auto text-base py-6">
          Start Application
        </Button>

        <p className="text-xs text-muted-foreground">
          Your information is kept confidential and only shared with the hiring team.
        </p>
      </div>
    </div>
  );
}
