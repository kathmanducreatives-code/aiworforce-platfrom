import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import JobLandingStep from "@/components/apply/JobLandingStep";
import ResumeUploadStep from "@/components/apply/ResumeUploadStep";
import ScreeningChatStep from "@/components/apply/ScreeningChatStep";
import ThankYouStep from "@/components/apply/ThankYouStep";

type Step = 'landing' | 'resume' | 'screening' | 'thankyou';

export default function CandidateApply() {
  const { slug } = useParams<{ slug: string }>();
  const [step, setStep] = useState<Step>('landing');
  const [job, setJob] = useState<any>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch job by slug
  useEffect(() => {
    async function fetchJob() {
      if (!slug) {
        setError('Invalid application link');
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('screening_jobs')
        .select('*')
        .eq('slug', slug)
        .eq('status', 'active')
        .single();

      if (fetchError || !data) {
        setError('This screening link is no longer active or does not exist.');
        setLoading(false);
        return;
      }

      setJob(data);
      setLoading(false);
    }
    fetchJob();
  }, [slug]);

  const handleStart = async () => {
    // Create application record
    const { data, error: insertError } = await supabase
      .from('screening_applications')
      .insert({ job_id: job.id })
      .select('id')
      .single();

    if (insertError || !data) {
      console.error('Failed to create application:', insertError);
      return;
    }

    setApplicationId(data.id);
    setStep('resume');
  };

  const handleResumeComplete = (data: any) => {
    setExtractedData(data);
    setStep('screening');
  };

  const handleScreeningComplete = () => {
    setStep('thankyou');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-3">
          <h1 className="text-xl font-bold text-foreground">Link Not Found</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  switch (step) {
    case 'landing':
      return <JobLandingStep job={job} onStart={handleStart} />;
    case 'resume':
      return <ResumeUploadStep applicationId={applicationId!} onComplete={handleResumeComplete} />;
    case 'screening':
      return <ScreeningChatStep applicationId={applicationId!} extractedData={extractedData} onComplete={handleScreeningComplete} />;
    case 'thankyou':
      return <ThankYouStep />;
  }
}
