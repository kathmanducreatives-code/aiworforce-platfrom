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
import { CheckCircle2, AlertTriangle, Clock, MonitorOff, Download, Copy, Archive, Briefcase, MessageSquare, FileText, Target, HelpCircle } from "lucide-react";
import InterviewQuestionsPanel from "./InterviewQuestionsPanel";

interface ApplicantDetailModalProps {
  application: any;
  job: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

const getCategoryBadge = (cat: string | null) => {
  switch (cat) {
    case "strong_fit": return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Strong Fit</Badge>;
    case "good_fit": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Good Fit</Badge>;
    case "maybe": return <Badge variant="secondary">Maybe</Badge>;
    case "not_qualified": return <Badge variant="destructive">Not Qualified</Badge>;
    default: return <Badge variant="secondary">Pending</Badge>;
  }
};

const ApplicantDetailModal = ({ application, job, open, onOpenChange, onUpdate }: ApplicantDetailModalProps) => {
  const [status, setStatus] = useState(application.recruiter_status || "new");
  const [notes, setNotes] = useState(application.recruiter_notes || "");
  const [saving, setSaving] = useState(false);

  const extracted = application.extracted_data as any;
  const answers = (application.screening_answers as any[]) || [];
  const strengths = (application.strengths as any[]) || [];
  const redFlags = (application.red_flags as any[]) || [];
  const totalMinutes = Math.round((application.total_time_seconds || 0) / 60);

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("screening_applications").update({
      recruiter_status: status,
      recruiter_notes: notes,
    }).eq("id", application.id);
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{extracted?.name || "Candidate"}</span>
            <div className="flex items-center gap-2">
              {application.match_score != null && (
                <span className={`text-2xl font-bold ${application.match_score >= 80 ? 'text-emerald-400' : application.match_score >= 60 ? 'text-amber-400' : 'text-destructive'}`}>
                  {application.match_score}%
                </span>
              )}
              {getCategoryBadge(application.match_category)}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 text-sm text-muted-foreground border-b border-border pb-3">
          <span>Applied {format(new Date(application.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{totalMinutes} min</span>
          <span className="flex items-center gap-1"><MonitorOff className="h-3.5 w-3.5" />{application.tab_switches || 0} tab switches</span>
        </div>

        <Tabs defaultValue="overview" className="mt-2">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="overview"><Target className="h-4 w-4 mr-1" />Overview</TabsTrigger>
            <TabsTrigger value="resume"><FileText className="h-4 w-4 mr-1" />Resume</TabsTrigger>
            <TabsTrigger value="qa"><MessageSquare className="h-4 w-4 mr-1" />Q&A</TabsTrigger>
            <TabsTrigger value="interview"><HelpCircle className="h-4 w-4 mr-1" />Interview</TabsTrigger>
            <TabsTrigger value="actions"><Briefcase className="h-4 w-4 mr-1" />Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            {strengths.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Strengths</h4>
                <div className="space-y-1.5">
                  {strengths.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{typeof s === 'string' ? s : (s as any)?.text || JSON.stringify(s)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {redFlags.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Red Flags</h4>
                <div className="space-y-1.5">
                  {redFlags.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-amber-400">
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{typeof r === 'string' ? r : (r as any)?.text || JSON.stringify(r)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Match Breakdown */}
            {job && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Requirements Match</h4>
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
                        <span>{skill}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="resume" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><Label className="text-muted-foreground">Name</Label><p className="text-foreground">{extracted?.name || "-"}</p></div>
              <div><Label className="text-muted-foreground">Email</Label><p className="text-foreground">{extracted?.email || "-"}</p></div>
              <div><Label className="text-muted-foreground">Phone</Label><p className="text-foreground">{extracted?.phone || "-"}</p></div>
              <div><Label className="text-muted-foreground">Experience</Label><p className="text-foreground">{extracted?.total_years_experience || 0} years</p></div>
            </div>
            {extracted?.skills && (
              <div>
                <Label className="text-muted-foreground">Skills</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(extracted.skills as string[]).map((s: string) => (
                    <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
            {extracted?.work_history && (
              <div>
                <Label className="text-muted-foreground">Work History</Label>
                <div className="space-y-2 mt-1">
                  {(extracted.work_history as any[]).map((w: any, i: number) => (
                    <div key={i} className="text-sm border-l-2 border-primary/30 pl-3">
                      <p className="font-medium text-foreground">{w.title} at {w.company}</p>
                      <p className="text-muted-foreground text-xs">{w.start_date} – {w.end_date || "Present"} · {w.years} yrs</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {application.resume_url && (
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" /> Download Resume
              </Button>
            )}
          </TabsContent>

          <TabsContent value="qa" className="space-y-4 mt-4">
            {answers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No screening answers yet.</p>
            ) : (
              answers.map((a: any, i: number) => (
                <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <p className="font-medium text-foreground text-sm">{a.question}</p>
                    <Badge variant={a.score >= 7 ? "default" : a.score >= 4 ? "secondary" : "destructive"} className="text-xs ml-2">
                      {a.score}/10
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground bg-muted/50 rounded p-2">{a.answer}</p>
                  {a.analysis && <p className="text-xs text-muted-foreground italic">{a.analysis}</p>}
                  {a.time_seconds && <span className="text-xs text-muted-foreground">⏱ {Math.round(a.time_seconds / 60)}m {a.time_seconds % 60}s</span>}
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="interview" className="mt-4">
            <InterviewQuestionsPanel questions={application.interview_questions} />
          </TabsContent>

          <TabsContent value="actions" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Recruiter Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="reviewing">Reviewing</SelectItem>
                  <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="hired">Hired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Private Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Add recruiter notes..." />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              <Button variant="outline" onClick={handleArchive}>
                <Archive className="h-4 w-4 mr-1" /> Archive
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ApplicantDetailModal;
