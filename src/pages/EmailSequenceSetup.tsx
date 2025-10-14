import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Send, Clock, Users, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
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
  const [sendTimeHour, setSendTimeHour] = useState("9");
  const [sendTimePeriod, setSendTimePeriod] = useState("am");
  const [sendTimeEndHour, setSendTimeEndHour] = useState("");
  const [sendTimeEndPeriod, setSendTimeEndPeriod] = useState("pm");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [companyName, setCompanyName] = useState("");
  const [senderName, setSenderName] = useState("");
  const [startDate, setStartDate] = useState<Date>(new Date());
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

  // Helper function to calculate send_time_utc for each step
  const calculateSendTimeUTC = (stepNumber: number, baseDate: Date): string => {
    const step = emailSteps.find(s => s.stepNumber === stepNumber);
    if (!step) return baseDate.toISOString();

    // Parse sendTime from hour and period
    const hour = parseInt(sendTimeHour);
    const isPM = sendTimePeriod === 'pm';
    const hourIn24 = isPM && hour !== 12 ? hour + 12 : hour === 12 && !isPM ? 0 : hour;

    // Start with base date
    const sendDate = new Date(baseDate);
    sendDate.setUTCHours(hourIn24, 0, 0, 0);

    // For step 1, use the base date + sendTime
    if (stepNumber === 1) {
      return sendDate.toISOString();
    }

    // For step 2+, add delays from all previous steps
    let totalDelayMinutes = 0;
    for (let i = 1; i < stepNumber; i++) {
      const prevStep = emailSteps.find(s => s.stepNumber === i);
      if (prevStep) {
        if (prevStep.delayUnit === 'minutes') {
          totalDelayMinutes += prevStep.delayDays;
        } else if (prevStep.delayUnit === 'hours') {
          totalDelayMinutes += prevStep.delayDays * 60;
        } else {
          totalDelayMinutes += prevStep.delayDays * 24 * 60;
        }
      }
    }

    sendDate.setUTCMinutes(sendDate.getUTCMinutes() + totalDelayMinutes);
    return sendDate.toISOString();
  };

  // Helper function to replace tokens in text
  const replaceTokens = (
    text: string,
    candidateName: string,
    firstName: string,
    company: string,
    sender: string
  ): string => {
    return text
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{candidateName\}\}/g, candidateName)
      .replace(/\{\{companyName\}\}/g, company)
      .replace(/\{\{senderName\}\}/g, sender);
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
      const company = companyName || "Your Company";
      const sender = senderName || "Recruiter";
      const baseDate = startDate;
      
      // Generate unique sequence ID
      const sequenceId = `seq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      // Helper to format time in 12-hour format with AM/PM
      const formatTo12Hour = (hour: string, period: string): string => {
        const hourNum = parseInt(hour);
        return `${hourNum}:00 ${period.toUpperCase()}`;
      };
      
      const windowStart = formatTo12Hour(sendTimeHour, sendTimePeriod);
      const windowEnd = sendTimeEndHour ? formatTo12Hour(sendTimeEndHour, sendTimeEndPeriod) : formatTo12Hour(sendTimeHour, sendTimePeriod);
      
      let successCount = 0;
      let failureCount = 0;

      toast({
        title: "Scheduling Emails",
        description: `Scheduling email sequences for ${candidates.length} candidate(s)...`,
      });

      // Loop through each candidate and send complete sequence
      for (const candidate of candidates) {
        try {
          const firstName = candidate.candidateName.split(' ')[0];
          
          // Build all steps with personalized content
          const steps = emailSteps.map((step) => {
            const sendTimeUTC = calculateSendTimeUTC(step.stepNumber, baseDate);
            
            const personalizedSubject = replaceTokens(
              step.subject,
              candidate.candidateName,
              firstName,
              company,
              sender
            );
            
            const personalizedContent = replaceTokens(
              step.content,
              candidate.candidateName,
              firstName,
              company,
              sender
            );

            return {
              step_number: step.stepNumber,
              subject: personalizedSubject,
              content: personalizedContent,
              delay_days: step.delayDays,
              delay_unit: step.delayUnit,
              send_time_utc: sendTimeUTC
            };
          });

          // Create complete sequence payload with all steps
          const sequencePayload = {
            // Unique Identifiers
            sequence_id: sequenceId,
            candidate_id: candidate.id,
            
            // Candidate Information
            candidate_name: candidate.candidateName,
            candidate_email: candidate.email,
            fit_score: candidate.fitScore || 0,
            
            // Sequence Metadata
            sequence_name: sequenceName,
            folder_name: folderName,
            recruitment_name: candidate.recruitmentName || folderName,
            
            // All Email Steps
            total_steps: emailSteps.length,
            steps: steps,
            
            // Send Window Configuration
            window_start: windowStart,
            window_end: windowEnd,
            timezone: timezone,
            start_date: startDate.toISOString(),
            
            // Global Settings
            company_name: company,
            sender_name: sender,
            
            // Sequence Tracking
            sequence_created_at: new Date().toISOString(),
            status: "pending"
          };

          console.log(`Sending complete sequence for ${candidate.candidateName}:`, sequencePayload);

          // Send POST request with complete sequence
          const response = await fetch('https://ppprasidha.app.n8n.cloud/webhook/lovable-intake', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(sequencePayload),
          });

          if (response.ok) {
            successCount++;
            console.log(`✓ Successfully scheduled sequence for ${candidate.candidateName}`);
          } else {
            failureCount++;
            console.error(`✗ Failed to schedule sequence for ${candidate.candidateName}:`, response.status);
          }
        } catch (error) {
          failureCount++;
          console.error(`✗ Error scheduling sequence for ${candidate.candidateName}:`, error);
        }
      }

      // Show final summary
      if (successCount > 0) {
        toast({
          title: "Email Sequences Created",
          description: `Successfully scheduled ${successCount} complete sequence${successCount !== 1 ? 's' : ''} with ${emailSteps.length} step${emailSteps.length !== 1 ? 's' : ''} each.${failureCount > 0 ? ` ${failureCount} failed.` : ''}`,
        });

        setTimeout(() => {
          navigate(`/folder/${encodeURIComponent(folderName || '')}`);
        }, 2000);
      } else {
        throw new Error('All email scheduling requests failed');
      }

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

                <div className="pt-2">
                  <h4 className="text-sm font-semibold mb-3 text-slate-700">Delivery Preferences</h4>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="send-time-start">Send Between (Start)</Label>
                      <div className="flex gap-2 mt-2">
                        <Select value={sendTimeHour} onValueChange={setSendTimeHour}>
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="4">4</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="6">6</SelectItem>
                            <SelectItem value="7">7</SelectItem>
                            <SelectItem value="8">8</SelectItem>
                            <SelectItem value="9">9</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="11">11</SelectItem>
                            <SelectItem value="12">12</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={sendTimePeriod} onValueChange={setSendTimePeriod}>
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="am">AM</SelectItem>
                            <SelectItem value="pm">PM</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="send-time-end">Send Between (End - Optional)</Label>
                      <div className="flex gap-2 mt-2">
                        <Select value={sendTimeEndHour} onValueChange={setSendTimeEndHour}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="No end time" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="4">4</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="6">6</SelectItem>
                            <SelectItem value="7">7</SelectItem>
                            <SelectItem value="8">8</SelectItem>
                            <SelectItem value="9">9</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="11">11</SelectItem>
                            <SelectItem value="12">12</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={sendTimeEndPeriod} onValueChange={setSendTimeEndPeriod}>
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="am">AM</SelectItem>
                            <SelectItem value="pm">PM</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="timezone">Timezone</Label>
                      <Select value={timezone} onValueChange={setTimezone}>
                        <SelectTrigger className="mt-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                          <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                          <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                          <SelectItem value="America/Phoenix">Arizona Time (MST)</SelectItem>
                          <SelectItem value="America/Anchorage">Alaska Time (AKT)</SelectItem>
                          <SelectItem value="Pacific/Honolulu">Hawaii Time (HST)</SelectItem>
                          <SelectItem value="UTC">UTC</SelectItem>
                          <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                          <SelectItem value="Europe/Paris">Paris (CET/CEST)</SelectItem>
                          <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                          <SelectItem value="Asia/Shanghai">Shanghai (CST)</SelectItem>
                          <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
                          <SelectItem value="Australia/Sydney">Sydney (AEDT/AEST)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="start-date">Start Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal mt-2",
                              !startDate && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {startDate ? format(startDate, "PPP") : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={startDate}
                            onSelect={(date) => date && setStartDate(date)}
                            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                            initialFocus
                            className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
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
