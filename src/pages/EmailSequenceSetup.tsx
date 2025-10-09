import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Send, Clock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Header from "@/components/Header";
import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";
import EmailStepCard, { EmailStep } from "@/components/email-sequence/EmailStepCard";
import EmailEditor from "@/components/email-sequence/EmailEditor";

const EmailSequenceSetup = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();
  const [sequenceName, setSequenceName] = useState("");
  const [sendTime, setSendTime] = useState("9am");
  const [companyName, setCompanyName] = useState("");
  const [senderName, setSenderName] = useState("");
  const [candidates, setCandidates] = useState<ResumeAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Multi-step email management
  const [emailSteps, setEmailSteps] = useState<EmailStep[]>([
    {
      id: '1',
      stepNumber: 1,
      subject: '',
      content: '',
      delayDays: 0,
      delayUnit: 'days'
    }
  ]);
  const [activeStepId, setActiveStepId] = useState<string>('1');

  useEffect(() => {
    const fetchCandidates = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('resume_analyses')
          .select('*')
          .eq('recruitment_name', folderName)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching candidates:', error);
        } else {
          const mappedCandidates = (data || []).map(item => {
            const parseJsonString = (jsonStr: string | null): string[] => {
              if (!jsonStr) return [];
              try {
                return JSON.parse(jsonStr);
              } catch {
                return [];
              }
            };

            return {
              id: item.id,
              candidateName: item.candidate_name,
              email: item.email || '',
              resume: item.resume || '',
              strengths: parseJsonString(item.strengths),
              weaknesses: parseJsonString(item.weaknesses),
              fitScore: typeof item.fit_score === 'number' ? item.fit_score : 
                       (typeof item.fit_score === 'object' && item.fit_score !== null ? 
                        (item.fit_score as any) || 0 : 0),
              overallFactor: typeof item.overall_factor === 'number' ? item.overall_factor : 
                            (typeof item.overall_factor === 'object' && item.overall_factor !== null ? 
                             (item.overall_factor as any) || 0 : 0),
              riskFactor: typeof item.risk_factor === 'number' ? item.risk_factor : 
                         (typeof item.risk_factor === 'object' && item.risk_factor !== null ? 
                          (item.risk_factor as any).score || 0 : 0),
              rewardFactor: typeof item.reward_factor === 'number' ? item.reward_factor : 
                           (typeof item.reward_factor === 'object' && item.reward_factor !== null ? 
                            (item.reward_factor as any).score || 0 : 0),
              justification: item.justification || '',
              recruitmentName: item.recruitment_name || '',
              date: item.created_at
            } as ResumeAnalysis;
          });
          setCandidates(mappedCandidates);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    if (folderName) {
      fetchCandidates();
    }
  }, [folderName]);

  const addStep = () => {
    const newStepNumber = emailSteps.length + 1;
    const newStep: EmailStep = {
      id: Date.now().toString(),
      stepNumber: newStepNumber,
      subject: '',
      content: '',
      delayDays: newStepNumber === 1 ? 0 : 3,
      delayUnit: 'days'
    };
    setEmailSteps([...emailSteps, newStep]);
    setActiveStepId(newStep.id);
  };

  const deleteStep = (stepId: string) => {
    if (emailSteps.length === 1) {
      toast({
        title: "Cannot Delete",
        description: "You must have at least one email step.",
        variant: "destructive"
      });
      return;
    }

    const newSteps = emailSteps
      .filter(s => s.id !== stepId)
      .map((step, index) => ({ ...step, stepNumber: index + 1 }));
    
    setEmailSteps(newSteps);
    
    if (activeStepId === stepId) {
      setActiveStepId(newSteps[0].id);
    }
  };

  const updateStep = (stepId: string, field: keyof EmailStep, value: string | number) => {
    setEmailSteps(steps =>
      steps.map(step =>
        step.id === stepId ? { ...step, [field]: value } : step
      )
    );
  };

  const updateActiveStepContent = (field: 'subject' | 'content', value: string) => {
    updateStep(activeStepId, field, value);
  };

  const handleCreateSequence = async () => {
    // Validation
    if (!sequenceName.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter a sequence name.",
        variant: "destructive"
      });
      return;
    }

    const hasEmptySteps = emailSteps.some(step => !step.subject.trim() || !step.content.trim());
    if (hasEmptySteps) {
      toast({
        title: "Incomplete Steps",
        description: "All email steps must have a subject and content.",
        variant: "destructive"
      });
      return;
    }

    try {
      const candidateData = candidates.map(candidate => ({
        name: candidate.candidateName,
        email: candidate.email,
        fitScore: candidate.fitScore,
        firstName: candidate.candidateName.split(' ')[0]
      }));

      const payload = {
        sequenceName,
        folderName,
        candidates: candidateData,
        candidateCount: candidateData.length,
        emailSteps: emailSteps.map(step => ({
          stepNumber: step.stepNumber,
          subject: step.subject,
          content: step.content,
          delayDays: step.delayUnit === 'hours' ? 0 : step.delayDays,
          delayHours: step.delayUnit === 'hours' ? step.delayDays : 0
        })),
        globalSettings: {
          sendTime,
          timezone: "UTC",
          companyName: companyName || "Your Company",
          senderName: senderName || "Recruiter"
        },
        timestamp: new Date().toISOString(),
        status: "active"
      };

      console.log('Sending payload to webhook:', payload);

      const response = await fetch('https://ppprasidha.app.n8n.cloud/webhook/a251b2f4-2dce-42a2-b3d9-caf544105748', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        mode: 'no-cors', // Handle CORS issues
      });

      // Since we're using no-cors, we can't check response status or body
      console.log('Webhook triggered successfully');

      toast({
        title: "Email Sequence Created",
        description: `Successfully created "${sequenceName}" with ${emailSteps.length} email${emailSteps.length > 1 ? 's' : ''}.`,
      });

      setTimeout(() => {
        navigate(`/folder/${encodeURIComponent(folderName || '')}`);
      }, 2000);

    } catch (error) {
      console.error('Error sending to webhook:', error);
      
      let errorMessage = "Failed to create email sequence. ";
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          errorMessage += "Network error - please check your connection.";
        } else {
          errorMessage += error.message;
        }
      }
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  const activeStep = emailSteps.find(s => s.id === activeStepId) || null;

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-white to-emerald-50">
      <Header />
      
      <main className="container mx-auto px-4 sm:px-6 py-8 pt-24 max-w-7xl animate-fade-in">
        {/* Header Section */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate(`/folder/${encodeURIComponent(folderName || '')}`)}
            className="hover:bg-slate-100 hover:scale-105 transition-all duration-200 rounded-xl p-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2">
              Email Sequence Setup
            </h1>
            <p className="text-slate-600">
              Create multi-step email sequence for <span className="font-semibold text-emerald-600">{folderName}</span>
            </p>
          </div>
        </div>

        {/* Main Content - Two Column Layout */}
        <div className="grid lg:grid-cols-[350px_1fr] gap-6">
          {/* Left Panel - Step List */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Email Steps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {emailSteps.map((step) => (
                  <EmailStepCard
                    key={step.id}
                    step={step}
                    isActive={step.id === activeStepId}
                    onSelect={() => setActiveStepId(step.id)}
                    onDelete={() => deleteStep(step.id)}
                    onUpdate={(field, value) => updateStep(step.id, field, value)}
                    showDelete={emailSteps.length > 1}
                  />
                ))}
                
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={addStep}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Email Step
                </Button>
              </CardContent>
            </Card>

            {/* Sequence Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sequence Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="sequence-name">Sequence Name *</Label>
                  <Input
                    id="sequence-name"
                    placeholder="e.g., AI Engineers Outreach"
                    value={sequenceName}
                    onChange={(e) => setSequenceName(e.target.value)}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="company-name">Company Name</Label>
                  <Input
                    id="company-name"
                    placeholder="Your Company"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="sender-name">Sender Name</Label>
                  <Input
                    id="sender-name"
                    placeholder="Your Name"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="send-time">Send Time</Label>
                  <Select value={sendTime} onValueChange={setSendTime}>
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9am">9:00 AM</SelectItem>
                      <SelectItem value="11am">11:00 AM</SelectItem>
                      <SelectItem value="2pm">2:00 PM</SelectItem>
                      <SelectItem value="4pm">4:00 PM</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Recipients:
                    </span>
                    <span className="font-semibold">{candidates.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Total Steps:
                    </span>
                    <span className="font-semibold">{emailSteps.length}</span>
                  </div>
                </div>

                <Button
                  onClick={handleCreateSequence}
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Create Sequence
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Email Editor */}
          <EmailEditor
            step={activeStep}
            onUpdate={updateActiveStepContent}
          />
        </div>
      </main>
    </div>
  );
};

export default EmailSequenceSetup;
