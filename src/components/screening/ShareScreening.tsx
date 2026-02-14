import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Check, Search, Mail, Send, Loader2, Link2, Clock } from "lucide-react";
import type { RequirementsData } from "./RequirementsForm";
import type { GeneratedQuestion } from "./QuestionPreview";
import type { InterviewSettings } from "./InterviewSettingsForm";

interface CandidateOption {
  id: string;
  name: string;
  email: string;
  source: "resume_screening" | "icp_lookalike" | "linkedin_leads";
}

interface ShareScreeningProps {
  requirements: RequirementsData;
  questions: GeneratedQuestion[];
  settings: InterviewSettings;
  generatedUrl: string | null;
  onUrlGenerated: (url: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  resume_screening: "Resume Screening",
  icp_lookalike: "ICP Lookalike",
  linkedin_leads: "LinkedIn Leads",
};

export function ShareScreening({ requirements, questions, settings, generatedUrl, onUrlGenerated }: ShareScreeningProps) {
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateOption | null>(null);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkGenerated, setLinkGenerated] = useState(!!generatedUrl);

  useEffect(() => {
    fetchCandidates();
  }, []);

  // Auto-generate link on mount if not already generated
  useEffect(() => {
    if (!generatedUrl && !isGenerating) {
      generateLink();
    }
  }, []);

  const fetchCandidates = async () => {
    const results: CandidateOption[] = [];

    // Resume Screening
    const { data: resumes } = await supabase
      .from('resume_analyses')
      .select('id, candidate_name, email')
      .not('email', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);
    
    resumes?.forEach(r => {
      if (r.email) results.push({ id: r.id, name: r.candidate_name, email: r.email, source: 'resume_screening' });
    });

    // LinkedIn Leads
    const { data: leads } = await supabase
      .from('linkedin_leads')
      .select('id, candidate_name, contact_email')
      .not('contact_email', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    leads?.forEach(l => {
      if (l.contact_email) results.push({ id: l.id, name: l.candidate_name, email: l.contact_email, source: 'linkedin_leads' });
    });

    setCandidates(results);
  };

  const generateLink = async (candidateId?: string) => {
    setIsGenerating(true);
    try {
      // Filter questions by enabled types
      const filteredQuestions = questions.filter(q => {
        if (!["accountability", "culture_fit", "red_flag"].includes(q.category)) {
          return settings.enabledTypes.includes("skill");
        }
        return settings.enabledTypes.includes(q.category);
      }).slice(0, settings.questionCount);

      const { data, error } = await supabase.functions.invoke('generate-screening-invite', {
        body: {
          candidate_id: candidateId || 'preview',
          role_title: requirements.role_title,
          required_skills: requirements.required_skills,
          experience_level: requirements.experience_level,
          culture_keywords: requirements.culture_keywords,
          pre_generated_questions: filteredQuestions,
          scenario_count: filteredQuestions.length,
          expires_in_days: parseInt(expiresInDays),
          send_email: false,
          role_briefing: {
            role_title: requirements.role_title,
            required_skills: requirements.required_skills,
            experience_level: requirements.experience_level,
            culture_keywords: requirements.culture_keywords,
            industry: requirements.industry,
            free_text: requirements.free_text,
            ai_generated: true,
          },
        },
      });

      if (error) throw error;

      if (data?.screening_url) {
        onUrlGenerated(data.screening_url);
        setLinkGenerated(true);
      }
    } catch (err: any) {
      console.error('Failed to generate link:', err);
      toast.error('Failed to generate screening link');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const sendEmail = async () => {
    if (!selectedCandidate || !generatedUrl) return;
    setIsSendingEmail(true);
    try {
      const { error } = await supabase.functions.invoke('generate-screening-invite', {
        body: {
          candidate_id: selectedCandidate.id,
          role_title: requirements.role_title,
          required_skills: requirements.required_skills,
          experience_level: requirements.experience_level,
          culture_keywords: requirements.culture_keywords,
          pre_generated_questions: questions,
          scenario_count: settings.questionCount,
          expires_in_days: parseInt(expiresInDays),
          send_email: true,
          role_briefing: {
            role_title: requirements.role_title,
            required_skills: requirements.required_skills,
            experience_level: requirements.experience_level,
            culture_keywords: requirements.culture_keywords,
            industry: requirements.industry,
            free_text: requirements.free_text,
            ai_generated: true,
          },
        },
      });

      if (error) throw error;
      toast.success(`Invitation email sent to ${selectedCandidate.email}`);
    } catch (err: any) {
      console.error('Failed to send email:', err);
      toast.error('Failed to send invitation email');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const filtered = candidates.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const grouped = {
    resume_screening: filtered.filter(c => c.source === 'resume_screening'),
    linkedin_leads: filtered.filter(c => c.source === 'linkedin_leads'),
    icp_lookalike: filtered.filter(c => c.source === 'icp_lookalike'),
  };

  return (
    <div className="space-y-6">
      {/* Section A: Copy Link */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" />
          <Label className="text-base font-semibold">Copy Screening Link</Label>
        </div>

        {isGenerating ? (
          <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating your screening link...
          </div>
        ) : generatedUrl ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <code className="flex-1 bg-muted/50 p-3 rounded-lg text-xs break-all border border-border">
                {generatedUrl}
              </code>
              <Button size="icon" variant="outline" onClick={copyToClipboard} className="shrink-0">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Share this link with your candidate — it's valid for {expiresInDays} days.
            </div>
          </div>
        ) : (
          <Button onClick={() => generateLink()} variant="outline" size="sm">
            Generate Link
          </Button>
        )}

        <div className="w-32">
          <Select value={expiresInDays} onValueChange={setExpiresInDays}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 days</SelectItem>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-background px-3 text-muted-foreground">or</span>
        </div>
      </div>

      {/* Section B: Send Email */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          <Label className="text-base font-semibold">Send Email Directly</Label>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search candidates by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <ScrollArea className="h-40 border border-border rounded-lg">
          <div className="p-2 space-y-2">
            {Object.entries(grouped).map(([source, items]) => {
              if (items.length === 0) return null;
              return (
                <div key={source}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
                    {SOURCE_LABELS[source]}
                  </p>
                  {items.map((c) => (
                    <button
                      key={`${c.source}-${c.id}`}
                      onClick={() => setSelectedCandidate(c)}
                      className={`w-full text-left p-2.5 rounded-md transition-colors text-sm ${
                        selectedCandidate?.id === c.id && selectedCandidate?.source === c.source
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </button>
                  ))}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No candidates with email found</p>
            )}
          </div>
        </ScrollArea>

        {selectedCandidate && (
          <div className="space-y-3">
            <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
              <p className="font-medium text-sm">{selectedCandidate.name}</p>
              <p className="text-xs text-muted-foreground">{selectedCandidate.email}</p>
              <Badge variant="outline" className="mt-1 text-[10px]">
                {SOURCE_LABELS[selectedCandidate.source]}
              </Badge>
            </div>
            <Button
              onClick={sendEmail}
              disabled={isSendingEmail || !generatedUrl}
              className="w-full"
            >
              {isSendingEmail ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Invitation Email
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
