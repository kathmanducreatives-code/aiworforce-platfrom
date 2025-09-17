import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Users, Clock, Send, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Header from "@/components/Header";
import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";

const EmailSequenceSetup = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();
  const [sequenceName, setSequenceName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [subjectLine, setSubjectLine] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [sendTime, setSendTime] = useState("");
  const [frequency, setFrequency] = useState("");
  const [candidates, setCandidates] = useState<ResumeAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

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
          // Map database fields to interface structure
          const mappedCandidates = (data || []).map(item => {
            // Parse JSON strings
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

  const emailTemplates = [
    { id: "initial", name: "Initial Contact", description: "First outreach email to candidates" },
    { id: "follow-up", name: "Follow-up", description: "Second contact after no response" },
    { id: "interview", name: "Interview Invitation", description: "Invite qualified candidates for interview" },
    { id: "custom", name: "Custom Template", description: "Create your own email template" }
  ];

  const handleCreateSequence = async () => {
    if (!sequenceName || !selectedTemplate) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields to create the email sequence.",
        variant: "destructive"
      });
      return;
    }

    try {
      // Prepare the payload with all form data including candidate emails
      const candidateEmails = candidates.map(candidate => ({
        name: candidate.candidateName,
        email: candidate.email,
        fitScore: candidate.fitScore
      }));

      const payload = {
        sequenceName,
        selectedTemplate,
        subjectLine,
        emailContent,
        sendTime,
        frequency,
        folderName,
        candidates: candidateEmails,
        candidateCount: candidateEmails.length,
        timestamp: new Date().toISOString(),
        status: "active"
      };

      console.log('Sending payload to webhook:', payload);

      // Send data to the webhook with additional options to handle CORS
      const response = await fetch('https://prrasidha.app.n8n.cloud/webhook/a251b2f4-2dce-42a2-b3d9-caf544105748', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        mode: 'cors',
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Response error:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const result = await response.json();
      console.log('Webhook response:', result);

      toast({
        title: "Email Sequence Created",
        description: `Successfully created "${sequenceName}" for ${folderName} candidates and sent to webhook.`,
      });

      // Navigate back to folder view after a short delay
      setTimeout(() => {
        navigate(`/folder/${encodeURIComponent(folderName || '')}`);
      }, 2000);

    } catch (error) {
      console.error('Error sending to webhook:', error);
      
      // More detailed error message
      let errorMessage = "Failed to create email sequence. ";
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          errorMessage += "Network error - please check your connection or webhook URL.";
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

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-white to-emerald-50">
      <Header />
      
      <main className="container mx-auto px-4 sm:px-6 py-8 pt-24 max-w-4xl animate-fade-in">
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
              Create an automated email sequence for <span className="font-semibold text-emerald-600">{folderName}</span> candidates
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Setup Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Sequence Details */}
            <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <Settings className="h-5 w-5 text-emerald-600" />
                  Sequence Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="sequence-name" className="text-slate-700 font-medium">
                    Sequence Name *
                  </Label>
                  <Input
                    id="sequence-name"
                    placeholder="e.g., AI Engineers Outreach 2024"
                    value={sequenceName}
                    onChange={(e) => setSequenceName(e.target.value)}
                    className="mt-2 border-slate-200 focus:border-emerald-300 focus:ring-emerald-200"
                  />
                </div>

                <div>
                  <Label htmlFor="template-select" className="text-slate-700 font-medium">
                    Email Template *
                  </Label>
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger className="mt-2 border-slate-200 focus:border-emerald-300 focus:ring-emerald-200">
                      <SelectValue placeholder="Choose an email template" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailTemplates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          <div>
                            <div className="font-medium">{template.name}</div>
                            <div className="text-sm text-slate-500">{template.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="subject-line" className="text-slate-700 font-medium">
                    Subject Line
                  </Label>
                  <Input
                    id="subject-line"
                    placeholder="Exciting AI Engineering Opportunity at [Company]"
                    value={subjectLine}
                    onChange={(e) => setSubjectLine(e.target.value)}
                    className="mt-2 border-slate-200 focus:border-emerald-300 focus:ring-emerald-200"
                  />
                </div>

                <div>
                  <Label htmlFor="email-content" className="text-slate-700 font-medium">
                    Email Content Preview
                  </Label>
                  <Textarea
                    id="email-content"
                    placeholder="Hi [Candidate Name], We came across your profile and are impressed by your AI/ML experience..."
                    value={emailContent}
                    onChange={(e) => setEmailContent(e.target.value)}
                    rows={6}
                    className="mt-2 border-slate-200 focus:border-emerald-300 focus:ring-emerald-200"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Timing Settings */}
            <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <Clock className="h-5 w-5 text-emerald-600" />
                  Timing & Schedule
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="send-time" className="text-slate-700 font-medium">
                      Send Time
                    </Label>
                    <Select value={sendTime} onValueChange={setSendTime}>
                      <SelectTrigger className="mt-2 border-slate-200 focus:border-emerald-300">
                        <SelectValue placeholder="Select time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="9am">9:00 AM</SelectItem>
                        <SelectItem value="11am">11:00 AM</SelectItem>
                        <SelectItem value="2pm">2:00 PM</SelectItem>
                        <SelectItem value="4pm">4:00 PM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="frequency" className="text-slate-700 font-medium">
                      Frequency
                    </Label>
                    <Select value={frequency} onValueChange={setFrequency}>
                      <SelectTrigger className="mt-2 border-slate-200 focus:border-emerald-300">
                        <SelectValue placeholder="Select frequency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Summary Sidebar */}
          <div className="space-y-6">
            <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <Users className="h-5 w-5 text-emerald-600" />
                  Sequence Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Target Folder:</span>
                  <span className="font-semibold text-emerald-600">{folderName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Recipients:</span>
                  <span className="font-semibold">{candidates.length} candidates</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Status:</span>
                  <span className="font-semibold text-amber-600">Draft</span>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="space-y-3">
              <Button
                onClick={handleCreateSequence}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 rounded-xl font-medium py-3 group"
              >
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 group-hover:scale-110 transition-transform duration-200" />
                  Create & Start Sequence
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 rounded-xl"
              >
                <Plus className="h-4 w-4 mr-2" />
                Save as Draft
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default EmailSequenceSetup;