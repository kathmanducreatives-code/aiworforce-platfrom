import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import JobLandingStep from "@/components/apply/JobLandingStep";
import ResumeUploadStep from "@/components/apply/ResumeUploadStep";
import ScreeningChatStep from "@/components/apply/ScreeningChatStep";
import ThankYouStep from "@/components/apply/ThankYouStep";

type Step = 'landing' | 'resume' | 'screening' | 'thankyou' | 'already_applied';

export default function CandidateApply() {
  const { slug } = useParams<{ slug: string }>();
  const [step, setStep] = useState<Step>('landing');
  const [job, setJob] = useState<any>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
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

  const handleStart = () => {
    // No record creation here — we only move to resume step
    setStep('resume');
  };

  const handleResumeComplete = async (data: any) => {
    // Check for duplicate application by email
    if (data.email && job) {
      const { data: existing } = await supabase
        .from('screening_applications')
        .select('id, extracted_data')
        .eq('job_id', job.id)
        .eq('is_archived', false);

      if (existing && existing.length > 0) {
        const hasDuplicate = existing.some((app: any) => {
          const appEmail = (app.extracted_data as any)?.email;
          return appEmail && appEmail.toLowerCase() === data.email.toLowerCase();
        });
        if (hasDuplicate) {
          setStep('already_applied');
          return;
        }
      }
    }

    // Create application record NOW (after resume is uploaded, not on "Start")
    const { data: appData, error: insertError } = await supabase
      .from('screening_applications')
      .insert({ job_id: job.id })
      .select('id, access_token')
      .single();

    if (insertError || !appData) {
      console.error('Failed to create application:', insertError);
      return;
    }

    // Save parsed resume data via token-gated RPC (anon UPDATE is no longer allowed directly)
    await supabase.rpc('update_screening_application_with_token', {
      p_id: appData.id,
      p_access_token: (appData as any).access_token,
      p_extracted_data: data,
    });

    setApplicationId(appData.id);
    setAccessToken((appData as any).access_token);
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
      return <ResumeUploadStep jobId={job.id} onComplete={handleResumeComplete} />;
    case 'screening':
      return <ScreeningChatStep applicationId={applicationId!} accessToken={accessToken!} extractedData={extractedData} onComplete={handleScreeningComplete} />;
    case 'already_applied':
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/10 mx-auto">
              <Loader2 className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Already Applied</h1>
            <p className="text-muted-foreground">
              It looks like you've already submitted an application for this position. Our team is reviewing it — you'll hear back soon!
            </p>
          </div>
        </div>
      );
    case 'thankyou':
      return <ThankYouStep job={job} />;
  }
}
