import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle2, AlertTriangle, Clock, MonitorOff, Download, Archive,
  Briefcase, MessageSquare, FileText, Target, HelpCircle, CalendarPlus, MessageSquarePlus
} from "lucide-react";
import InterviewQuestionsPanel from "./InterviewQuestionsPanel";
import ScheduleInterviewDialog from "@/components/interview/ScheduleInterviewDialog";
import StartDiscussionDialog from "@/components/collaboration/StartDiscussionDialog";

interface ApplicantDetailModalProps {
  application: any;
  job: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

const getCategoryConfig = (cat: string | null) => {
  switch (cat) {
    case "strong_fit": return { label: "Strong Fit", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", avatar: "from-emerald-600/80 to-emerald-500/60" };
    case "good_fit": return { label: "Good Fit", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", avatar: "from-amber-600/80 to-amber-500/60" };
    case "maybe": return { label: "Maybe", badge: "bg-muted/50 text-muted-foreground border-border/50", avatar: "from-muted-foreground/40 to-muted-foreground/20" };
    case "not_qualified": return { label: "Not Qualified", badge: "bg-destructive/15 text-destructive border-destructive/30", avatar: "from-destructive/60 to-destructive/40" };
    default: return { label: "Pending", badge: "bg-muted/40 text-muted-foreground border-border/40", avatar: "from-muted-foreground/30 to-muted-foreground/15" };
  }
};

const getScoreColor = (score: number) => {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-destructive";
};

const ApplicantDetailModal = ({ application, job, open, onOpenChange, onUpdate }: ApplicantDetailModalProps) => {
  const [status, setStatus] = useState(application.recruiter_status || "new");
  const [notes, setNotes] = useState(application.recruiter_notes || "");
  const [saving, setSaving] = useState(false);
  const [notifyCandidate, setNotifyCandidate] = useState(true);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showDiscussionDialog, setShowDiscussionDialog] = useState(false);
  const [interviewTypes, setInterviewTypes] = useState<any[]>([]);

  const fetchInterviewTypes = async () => {
    const { data } = await supabase.from('interview_types').select('*').eq('is_active', true);
    setInterviewTypes(data || []);
  };

  const handleOpenSchedule = () => { fetchInterviewTypes(); setShowScheduleDialog(true); };

  const handleScheduleConfirm = async (interviewData: any) => {
    const { data, error } = await supabase.from('interviews').insert({
      ...interviewData,
      recruiter_id: (await supabase.auth.getUser()).data.user?.id
    }).select().single();
    if (error) { toast.error('Failed to schedule interview'); return null; }
    toast.success('Interview scheduled');
    setStatus('interview_scheduled');
    setTimeout(() => handleSave(), 100);
    return data;
  };

  const extracted = application.extracted_data as any;
  const answers = (application.screening_answers as any[]) || [];
  const strengths = (application.strengths as any[]) || [];
  const redFlags = (application.red_flags as any[]) || [];
  const totalMinutes = Math.round((application.total_time_seconds || 0) / 60);
  const name = extracted?.name || "Candidate";
  const initials = name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();
  const config = getCategoryConfig(application.match_category);

  const handleSave = async () => {
    setSaving(true);
    const statusChanged = status !== application.recruiter_status;
    await supabase.from("screening_applications").update({ recruiter_status: status, recruiter_notes: notes }).eq("id", application.id);
    if (notifyCandidate && statusChanged && status !== "new") {
      supabase.functions.invoke('screening-notifications', {
        body: { action: 'candidate_status_update', application_id: application.id, new_status: status },
      }).catch((e: any) => console.error('Status notification failed:', e));
    }
    setSaving(false);
    toast.success("Saved");
    onUpdate();
  };

  const handleArchive = async () => {
    await supabase.from("screening_applications").update({ is_archived: true }).eq("id", application.id);
    toast.success("Archived");
    onUpdate();
    onOpenChange(false);
  };

  const handleDownload = async () => {
    if (!application.resume_url) return;
    const { data } = await supabase.storage.from("screening-resumes").createSignedUrl(application.resume_url, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-full h-full rounded-none sm:max-w-3xl sm:h-auto sm:max-h-[90vh] sm:rounded-lg overflow-y-auto p-0 gap-0 border-none sm:border sm:border-border/60 bg-card/95 backdrop-blur-xl">
        {/* Premium Header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-card via-card to-primary/5 border-b border-border/50 p-5 md:p-6">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/3 to-transparent pointer-events-none" />
          <DialogHeader className="relative">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Avatar */}
              <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${config.avatar} flex items-center justify-center text-white font-bold text-lg flex-shrink-0 border border-white/10 shadow-lg`}>
                {initials || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold text-foreground truncate">{name}</DialogTitle>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {application.match_score != null && (
                    <span className={`text-xl font-bold ${getScoreColor(application.match_score)}`}>
                      {application.match_score}%
                    </span>
                  )}
                  <Badge className={`border text-xs font-medium ${config.badge}`}>{config.label}</Badge>
                </div>
              </div>
            </div>
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-3 pt-3 border-t border-border/40">
              <span>Applied {format(new Date(application.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{totalMinutes} min</span>
              <span className="flex items-center gap-1"><MonitorOff className="h-3.5 w-3.5" />{application.tab_switches || 0} tab switches</span>
            </div>
          </DialogHeader>
        </div>

        <div className="p-4 md:p-6">
          <Tabs defaultValue="overview">
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 mb-5">
              <TabsList className="w-max md:w-full md:grid md:grid-cols-5 bg-muted/40 border border-border/50 p-1 h-auto">
                <TabsTrigger value="overview" className="text-xs py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5" /><span className="hidden sm:inline">Overview</span>
                </TabsTrigger>
                <TabsTrigger value="resume" className="text-xs py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /><span className="hidden sm:inline">Resume</span>
                </TabsTrigger>
                <TabsTrigger value="qa" className="text-xs py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" /><span className="hidden sm:inline">Q&amp;A</span>
                </TabsTrigger>
                <TabsTrigger value="interview" className="text-xs py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5">
                  <HelpCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline">Interview</span>
                </TabsTrigger>
                <TabsTrigger value="actions" className="text-xs py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" /><span className="hidden sm:inline">Actions</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="space-y-4 mt-0">
              {strengths.length > 0 && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Strengths
                  </h4>
                  <div className="space-y-2">
                    {strengths.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-emerald-400/90">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>{typeof s === 'string' ? s : (s as any)?.text || JSON.stringify(s)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {redFlags.length > 0 && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                  <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> Red Flags
                  </h4>
                  <div className="space-y-2">
                    {redFlags.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-red-400/90">
                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>{typeof r === 'string' ? r : (r as any)?.text || JSON.stringify(r)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {job && (
                <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Requirements Match</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {(extracted?.total_years_experience || 0) >= (job.required_years || 0) ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                      )}
                      <span>Experience: {extracted?.total_years_experience || 0}+ yrs (need {job.required_years})</span>
                    </div>
                    {(job.required_skills || []).map((skill: string) => {
                      const has = (extracted?.skills || []).some((s: string) => s.toLowerCase().includes(skill.toLowerCase()));
                      return (
                        <div key={skill} className="flex items-center gap-2">
                          {has ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                          <span className="text-foreground">{skill}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="resume" className="space-y-4 mt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: "Name", value: extracted?.name },
                  { label: "Email", value: extracted?.email },
                  { label: "Phone", value: extracted?.phone },
                  { label: "Experience", value: extracted?.total_years_experience ? `${extracted.total_years_experience} years` : null },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-border/40 bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className="text-sm text-foreground font-medium">{value || "—"}</p>
                  </div>
                ))}
              </div>
              {extracted?.skills && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(extracted.skills as string[]).map((s: string) => (
                      <span key={s} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {extracted?.work_history && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Work History</p>
                  {(extracted.work_history as any[]).map((w: any, i: number) => (
                    <div key={i} className="text-sm border-l-2 border-primary/40 pl-3 py-1">
                      <p className="font-medium text-foreground">{w.title} at {w.company}</p>
                      <p className="text-muted-foreground text-xs">{w.start_date} – {w.end_date || "Present"} · {w.years} yrs</p>
                    </div>
                  ))}
                </div>
              )}
              {application.resume_url && (
                <Button variant="outline" size="sm" onClick={handleDownload} className="border-border/60 hover:border-primary/40">
                  <Download className="h-4 w-4 mr-2" /> Download Resume
                </Button>
              )}
            </TabsContent>

            <TabsContent value="qa" className="space-y-3 mt-0">
              {answers.length === 0 ? (
                <p className="text-muted-foreground text-sm">No screening answers yet.</p>
              ) : (
                answers.map((a: any, i: number) => (
                  <div key={i} className="rounded-xl border border-border/50 bg-card/60 p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-foreground text-sm leading-snug">{a.question}</p>
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-semibold flex-shrink-0 ${
                        a.score >= 7 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : a.score >= 4 ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                        : "bg-destructive/15 text-destructive border-destructive/30"
                      }`}>
                        {a.score}/10
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg p-3 border border-border/30">{a.answer}</p>
                    {a.analysis && <p className="text-xs text-muted-foreground/70 italic">{a.analysis}</p>}
                    {a.time_seconds && <span className="text-xs text-muted-foreground/60 flex items-center gap-1"><Clock className="h-3 w-3" />{Math.round(a.time_seconds / 60)}m {a.time_seconds % 60}s</span>}
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="interview" className="mt-0">
              <InterviewQuestionsPanel questions={application.interview_questions} />
            </TabsContent>

            <TabsContent value="actions" className="space-y-4 mt-0">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
                    <CalendarPlus className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-foreground">Next Steps</h4>
                    <p className="text-xs text-muted-foreground">Schedule an interview or start a team discussion.</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button onClick={handleOpenSchedule} className="w-full sm:w-auto">
                    <CalendarPlus className="h-4 w-4 mr-2" /> Schedule Interview
                  </Button>
                  <Button onClick={() => setShowDiscussionDialog(true)} variant="outline" className="w-full sm:w-auto border-border/60 hover:border-primary/40">
                    <MessageSquarePlus className="h-4 w-4 mr-2" /> Discuss Candidate
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recruiter Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="border-border/60 bg-background/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="reviewing">Reviewing</SelectItem>
                      <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="hired">Hired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Private Notes</Label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Add recruiter notes..." className="border-border/60 bg-background/60 resize-none" />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="notify" checked={notifyCandidate} onCheckedChange={(v) => setNotifyCandidate(!!v)} />
                  <Label htmlFor="notify" className="text-sm text-muted-foreground cursor-pointer">Notify candidate of status change</Label>
                </div>
                <div className="flex gap-2 pt-2 border-t border-border/40">
                  <Button onClick={handleSave} disabled={saving} className="flex-1 sm:flex-none sm:px-6">
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                  <Button variant="outline" onClick={handleArchive} className="border-border/60 hover:border-destructive/40 hover:text-destructive">
                    <Archive className="h-4 w-4 mr-1.5" /> Archive
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
          <DialogContent className="max-w-2xl">
            <ScheduleInterviewDialog
              open={showScheduleDialog}
              onOpenChange={setShowScheduleDialog}
              interviewTypes={interviewTypes}
              onSchedule={handleScheduleConfirm}
              candidate={{
                name: extracted?.name || "Candidate",
                email: extracted?.email || "",
                id: application.id,
                source: 'screening_flow'
              }}
            />
          </DialogContent>
        </Dialog>

        <StartDiscussionDialog
          open={showDiscussionDialog}
          onOpenChange={setShowDiscussionDialog}
          candidateId={application.id}
          candidateName={extracted?.name || "Candidate"}
          candidateSource="screening_flow"
        />
      </DialogContent>
    </Dialog>
  );
};

export default ApplicantDetailModal;
