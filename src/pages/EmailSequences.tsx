import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Plus, Clock, Users, Send, Trash2, ChevronDown, ChevronUp, Eye, MousePointer, Play, RefreshCw } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface SequenceEmail {
  id: string;
  candidate_name: string;
  candidate_email: string;
  step_number: number;
  subject: string;
  status: string;
  send_time_utc: string;
  opens: number;
  clicks: number;
}

interface SequenceGroup {
  sequence_name: string;
  folder_name: string;
  total_emails: number;
  pending_count: number;
  sent_count: number;
  created_at: string;
  unique_candidates: number;
  total_steps: number;
  emails: SequenceEmail[];
  total_opens: number;
  total_clicks: number;
}

const EmailSequences = () => {
  const navigate = useNavigate();
  const [sequences, setSequences] = useState<SequenceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<string[]>([]);
  const [expandedSequence, setExpandedSequence] = useState<string | null>(null);
  const [sendingEmails, setSendingEmails] = useState(false);

  useEffect(() => {
    fetchSequences();
    fetchFolders();
  }, []);

  const fetchSequences = async () => {
    try {
      setLoading(true);

      // Fetch emails
      const { data: emailsData, error: emailsError } = await supabase
        .from('scheduled_emails')
        .select('*')
        .order('sequence_created_at', { ascending: false });

      if (emailsError) throw emailsError;

      // Fetch tracking data
      const { data: trackingData, error: trackingError } = await supabase
        .from('email_tracking')
        .select('scheduled_email_id, event_type');

      if (trackingError) {
        console.error('Error fetching tracking:', trackingError);
      }

      // Create tracking lookup
      const trackingByEmail: Record<string, { opens: number; clicks: number }> = {};
      (trackingData || []).forEach(t => {
        if (!trackingByEmail[t.scheduled_email_id]) {
          trackingByEmail[t.scheduled_email_id] = { opens: 0, clicks: 0 };
        }
        if (t.event_type === 'open') trackingByEmail[t.scheduled_email_id].opens++;
        if (t.event_type === 'click') trackingByEmail[t.scheduled_email_id].clicks++;
      });

      // Group by sequence_name
      const grouped = (emailsData || []).reduce((acc: Record<string, SequenceGroup>, email) => {
        const key = email.sequence_name || 'Unnamed';
        const emailTracking = trackingByEmail[email.id] || { opens: 0, clicks: 0 };

        if (!acc[key]) {
          acc[key] = {
            sequence_name: email.sequence_name || 'Unnamed',
            folder_name: email.folder_name || '',
            total_emails: 0,
            pending_count: 0,
            sent_count: 0,
            created_at: email.sequence_created_at || email.created_at || new Date().toISOString(),
            unique_candidates: 0,
            total_steps: 0,
            emails: [],
            total_opens: 0,
            total_clicks: 0
          };
        }
        acc[key].total_emails++;
        if (email.status === 'pending') acc[key].pending_count++;
        if (email.status === 'sent') acc[key].sent_count++;
        acc[key].total_opens += emailTracking.opens;
        acc[key].total_clicks += emailTracking.clicks;

        acc[key].emails.push({
          id: email.id,
          candidate_name: email.candidate_name,
          candidate_email: email.candidate_email,
          step_number: email.step_number,
          subject: email.subject || '',
          status: email.status || 'pending',
          send_time_utc: email.send_time_utc,
          opens: emailTracking.opens,
          clicks: emailTracking.clicks
        });
        return acc;
      }, {});

      // Calculate unique candidates and max steps per sequence
      Object.values(grouped).forEach(seq => {
        const uniqueCandidates = new Set(seq.emails.map(e => e.candidate_email));
        seq.unique_candidates = uniqueCandidates.size;
        seq.total_steps = Math.max(...seq.emails.map(e => e.step_number), 0);
      });

      setSequences(Object.values(grouped));
    } catch (error) {
      console.error('Error fetching sequences:', error);
      toast({
        title: "Error",
        description: "Failed to load sequences.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchFolders = async () => {
    try {
      const { data, error } = await supabase
        .from('resume_analyses')
        .select('recruitment_name')
        .not('recruitment_name', 'is', null);

      if (error) throw error;

      const uniqueFolders = [...new Set((data || []).map(d => d.recruitment_name).filter(Boolean))];
      setFolders(uniqueFolders as string[]);
    } catch (error) {
      console.error('Error fetching folders:', error);
    }
  };

  const handleDeleteSequence = async (sequenceName: string) => {
    try {
      const { error } = await supabase
        .from('scheduled_emails')
        .delete()
        .eq('sequence_name', sequenceName);

      if (error) throw error;

      toast({
        title: "Sequence Deleted",
        description: `"${sequenceName}" has been deleted.`,
      });

      fetchSequences();
    } catch (error) {
      console.error('Error deleting sequence:', error);
      toast({
        title: "Error",
        description: "Failed to delete sequence.",
        variant: "destructive"
      });
    }
  };

  const handleMarkAsSent = async (emailId: string) => {
    try {
      const { error } = await supabase
        .from('scheduled_emails')
        .update({ status: 'sent' })
        .eq('id', emailId);

      if (error) throw error;

      toast({ title: "Marked as sent" });
      fetchSequences();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleSendPendingEmails = async () => {
    try {
      setSendingEmails(true);
      toast({
        title: "Processing",
        description: "Sending pending emails...",
      });

      const { data, error } = await supabase.functions.invoke('send-scheduled-emails');

      if (error) throw error;

      toast({
        title: "Emails Processed",
        description: `Sent: ${data?.sent || 0}, Failed: ${data?.failed || 0}`,
      });

      fetchSequences();
    } catch (error: any) {
      console.error('Error sending emails:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to send emails.",
        variant: "destructive"
      });
    } finally {
      setSendingEmails(false);
    }
  };

  const getStatusBadge = (seq: SequenceGroup) => {
    if (seq.sent_count === seq.total_emails && seq.total_emails > 0) {
      return <Badge variant="secondary" className="bg-primary/20 text-primary">Completed</Badge>;
    }
    if (seq.pending_count > 0) {
      return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500">In Progress</Badge>;
    }
    return <Badge variant="secondary">Draft</Badge>;
  };

  const getEmailStatusBadge = (status: string) => {
    if (status === 'sent') {
      return <Badge variant="secondary" className="bg-primary/20 text-primary text-xs">Sent</Badge>;
    }
    if (status === 'failed') {
      return <Badge variant="secondary" className="bg-destructive/20 text-destructive text-xs">Failed</Badge>;
    }
    return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500 text-xs">Pending</Badge>;
  };

  return (
    <div className="min-h-screen w-full bg-background">
      <main className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 space-y-6">
        <PageHeader
          title="Email Sequences"
          subtitle="Manage your automated email campaigns"
          breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Email Sequences' }]}
          primaryAction={{
            label: sendingEmails ? 'Sending...' : 'Send Pending',
            onClick: handleSendPendingEmails,
            icon: sendingEmails ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />,
          }}
          secondaryActions={[{
            label: 'Refresh',
            onClick: fetchSequences,
            icon: <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />,
          }]}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard label="Sequences" value={sequences.length} icon={<Mail className="h-4 w-4 text-primary" />} />
          <MetricCard label="Pending" value={sequences.reduce((acc, s) => acc + s.pending_count, 0)} icon={<Clock className="h-4 w-4 text-amber-500" />} />
          <MetricCard label="Sent" value={sequences.reduce((acc, s) => acc + s.sent_count, 0)} icon={<Send className="h-4 w-4 text-emerald-500" />} />
          <MetricCard label="Opens" value={sequences.reduce((acc, s) => acc + s.total_opens, 0)} icon={<Eye className="h-4 w-4 text-blue-500" />} />
          <MetricCard label="Clicks" value={sequences.reduce((acc, s) => acc + s.total_clicks, 0)} icon={<MousePointer className="h-4 w-4 text-purple-500" />} />
        </div>

        {/* Create New Section */}
        {folders.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Create New Sequence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Select a folder to create an email sequence for its candidates:
              </p>
              <div className="flex flex-wrap gap-2">
                {folders.slice(0, 10).map((folder) => (
                  <Button
                    key={folder}
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/email-sequence/${encodeURIComponent(folder)}`)}
                    className="hover:bg-primary/10 hover:text-primary hover:border-primary"
                  >
                    {folder}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sequences List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Sequences</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading sequences...
              </div>
            ) : sequences.length === 0 ? (
              <div className="text-center py-12">
                <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">No email sequences yet</p>
                <p className="text-sm text-muted-foreground">
                  Create your first sequence from a candidate folder
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sequences.map((seq, idx) => (
                  <Collapsible
                    key={idx}
                    open={expandedSequence === seq.sequence_name}
                    onOpenChange={(open) => setExpandedSequence(open ? seq.sequence_name : null)}
                  >
                    <div className="rounded-lg border border-border hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Mail className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{seq.sequence_name}</span>
                              {getStatusBadge(seq)}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {seq.unique_candidates} candidates
                              </span>
                              <span>•</span>
                              <span>{seq.total_steps} steps</span>
                              <span>•</span>
                              <span>{seq.sent_count}/{seq.total_emails} sent</span>
                              {seq.total_opens > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="flex items-center gap-1 text-blue-500">
                                    <Eye className="h-3 w-3" />
                                    {seq.total_opens}
                                  </span>
                                </>
                              )}
                              {seq.total_clicks > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="flex items-center gap-1 text-purple-500">
                                    <MousePointer className="h-3 w-3" />
                                    {seq.total_clicks}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon">
                              {expandedSequence === seq.sequence_name ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Sequence?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will delete all scheduled emails in "{seq.sequence_name}". This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteSequence(seq.sequence_name)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>

                      <CollapsibleContent>
                        <div className="border-t border-border p-4 bg-muted/20">
                          <p className="text-sm font-medium mb-3">Scheduled Emails</p>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {seq.emails
                              .sort((a, b) => a.candidate_name.localeCompare(b.candidate_name) || a.step_number - b.step_number)
                              .map((email) => (
                                <div
                                  key={email.id}
                                  className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/50"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-sm truncate">{email.candidate_name}</span>
                                      <Badge variant="outline" className="text-xs">Step {email.step_number}</Badge>
                                      {getEmailStatusBadge(email.status)}
                                      {email.opens > 0 && (
                                        <span className="flex items-center gap-1 text-xs text-blue-500">
                                          <Eye className="h-3 w-3" />
                                          {email.opens}
                                        </span>
                                      )}
                                      {email.clicks > 0 && (
                                        <span className="flex items-center gap-1 text-xs text-purple-500">
                                          <MousePointer className="h-3 w-3" />
                                          {email.clicks}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate mt-1">
                                      {email.subject}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Scheduled: {format(new Date(email.send_time_utc), 'MMM d, yyyy h:mm a')}
                                    </p>
                                  </div>
                                  {email.status === 'pending' && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleMarkAsSent(email.id)}
                                      className="text-xs"
                                    >
                                      Mark Sent
                                    </Button>
                                  )}
                                </div>
                              ))}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default EmailSequences;
