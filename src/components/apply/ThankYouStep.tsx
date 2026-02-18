import { CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThankYouStepProps {
  job?: {
    title: string;
    company_name: string;
    slug?: string;
  };
}

export default function ThankYouStep({ job }: ThankYouStepProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Application Submitted!</h1>
          <p className="text-muted-foreground">
            Thank you for completing the screening{job?.title ? ` for ${job.title}` : ''}. Your application has been received and is being reviewed.
          </p>
        </div>

        {/* Progress timeline */}
        <div className="bg-card border border-border rounded-xl p-5 text-left space-y-3">
          <p className="text-sm font-medium text-foreground">Your Application Journey</p>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <span className="text-sm text-foreground">Application Submitted</span>
            </div>
            <div className="ml-3 border-l-2 border-border h-3" />
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-primary/50 flex items-center justify-center flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-primary/50 animate-pulse" />
              </div>
              <span className="text-sm text-muted-foreground">Under Review (3–5 business days)</span>
            </div>
            <div className="ml-3 border-l-2 border-border h-3" />
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0" />
              <span className="text-sm text-muted-foreground">Interview Invitation</span>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-foreground font-medium">What happens next?</p>
          <p className="text-sm text-muted-foreground mt-1">
            You'll hear back within 3-5 business days. The hiring team will review your application and reach out if you're a good match.
          </p>
        </div>

        {job?.company_name && (
          <p className="text-xs text-muted-foreground">
            Applied at <span className="font-medium text-foreground">{job.company_name}</span>
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          You can safely close this page.
        </p>
      </div>
    </div>
  );
}
