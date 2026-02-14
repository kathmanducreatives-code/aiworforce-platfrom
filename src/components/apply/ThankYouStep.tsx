import { CheckCircle2 } from "lucide-react";

export default function ThankYouStep() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Application Submitted!</h1>
          <p className="text-muted-foreground">
            Thank you for completing the screening. Your application has been received and is being reviewed.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-foreground font-medium">What happens next?</p>
          <p className="text-sm text-muted-foreground mt-1">
            You'll hear back within 3-5 business days. The hiring team will review your application and reach out if you're a good match.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          You can safely close this page.
        </p>
      </div>
    </div>
  );
}
