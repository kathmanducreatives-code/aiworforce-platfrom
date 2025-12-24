import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  Brain, 
  Copy, 
  Check,
  Calendar,
  User,
  Briefcase,
  ExternalLink
} from "lucide-react";
import { format } from "date-fns";
import BehavioralAnalysisCard from "./BehavioralAnalysisCard";
import ScenarioCategoryBadges from "./ScenarioCategoryBadges";
import type { ScreeningBehavioralAnalysis, BehavioralRiskLevel, ScreeningSessionStatus } from "@/types/AdaptiveScreening";

interface SessionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
}

interface SessionDetail {
  id: string;
  session_status: ScreeningSessionStatus;
  invited_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string;
  scenario_count: number;
  current_scenario_index: number;
  access_token: string;
  candidate_name: string;
  candidate_email: string | null;
  recruitment_name: string | null;
}

interface CategoryCount {
  category: 'ambiguity' | 'accountability' | 'time_pressure' | 'competing_priorities' | 'conflict_resolution';
  count: number;
}

const SessionDetailDialog = ({
  open,
  onOpenChange,
  sessionId,
}: SessionDetailDialogProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [analysis, setAnalysis] = useState<ScreeningBehavioralAnalysis | null>(null);
  const [conversationLogs, setConversationLogs] = useState<any[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryCount[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && sessionId) {
      fetchSessionDetails();
    }
  }, [open, sessionId]);

  const fetchSessionDetails = async () => {
    if (!sessionId) return;

    try {
      setIsLoading(true);

      // Fetch session with candidate info
      const { data: sessionData, error: sessionError } = await supabase
        .from('adaptive_screening_sessions')
        .select(`
          *,
          resume_analyses (
            candidate_name,
            email,
            recruitment_name
          )
        `)
        .eq('id', sessionId)
        .single();

      if (sessionError) throw sessionError;

      setSession({
        ...sessionData,
        candidate_name: sessionData.resume_analyses?.candidate_name || 'Unknown',
        candidate_email: sessionData.resume_analyses?.email,
        recruitment_name: sessionData.resume_analyses?.recruitment_name,
      });

      // Fetch behavioral analysis
      const { data: analysisData } = await supabase
        .from('screening_behavioral_analysis')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (analysisData) {
        // Cast JSON arrays to proper types
        const parseEvidence = (data: any): any[] => Array.isArray(data) ? data : [];
        const parseFlags = (data: any): any[] => Array.isArray(data) ? data : [];
        
        setAnalysis({
          id: analysisData.id,
          session_id: analysisData.session_id,
          candidate_id: analysisData.candidate_id,
          ownership_score: analysisData.ownership_score || 0,
          ownership_evidence: parseEvidence(analysisData.ownership_evidence),
          clarity_score: analysisData.clarity_score || 0,
          clarity_evidence: parseEvidence(analysisData.clarity_evidence),
          emotional_regulation_score: analysisData.emotional_regulation_score || 0,
          emotional_evidence: parseEvidence(analysisData.emotional_evidence),
          consistency_score: analysisData.consistency_score || 0,
          consistency_evidence: parseEvidence(analysisData.consistency_evidence),
          red_flags: parseFlags(analysisData.red_flags),
          green_flags: parseFlags(analysisData.green_flags),
          overall_risk_level: analysisData.overall_risk_level,
          risk_summary: analysisData.risk_summary || '',
          ai_confidence_score: analysisData.ai_confidence_score || 0,
          analysis_completed_at: analysisData.analysis_completed_at,
          created_at: analysisData.created_at,
          updated_at: analysisData.updated_at,
        });
      }

      // Fetch conversation logs with scenario info
      const { data: logsData } = await supabase
        .from('screening_conversation_logs')
        .select(`
          *,
          screening_scenarios (
            category,
            name
          )
        `)
        .eq('session_id', sessionId)
        .order('message_index', { ascending: true });

      setConversationLogs(logsData || []);

      // Calculate category breakdown
      const categoryCounts: Record<string, number> = {};
      (logsData || []).forEach((log: any) => {
        if (log.screening_scenarios?.category && log.role === 'assistant') {
          const cat = log.screening_scenarios.category;
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
      });

      const breakdown: CategoryCount[] = Object.entries(categoryCounts).map(([category, count]) => ({
        category: category as CategoryCount['category'],
        count,
      }));
      setCategoryBreakdown(breakdown);

    } catch (error: any) {
      console.error('Failed to fetch session details:', error);
      toast.error('Failed to load session details');
    } finally {
      setIsLoading(false);
    }
  };

  const copyScreeningLink = async () => {
    if (!session) return;
    
    const url = `${window.location.origin}/screening/${session.access_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  const getStatusBadge = (status: ScreeningSessionStatus) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">In Progress</Badge>;
      case 'invited':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Invited</Badge>;
      case 'expired':
        return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">Expired</Badge>;
      case 'abandoned':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Abandoned</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Session Details
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : session ? (
          <div className="space-y-6">
            {/* Session Header */}
            <div className="p-4 bg-muted/30 rounded-lg border">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold flex items-center gap-2">
                    <User className="w-5 h-5 text-muted-foreground" />
                    {session.candidate_name}
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                    {session.recruitment_name && (
                      <span className="flex items-center gap-1">
                        <Briefcase className="w-4 h-4" />
                        {session.recruitment_name}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Invited {format(new Date(session.invited_at), 'MMM d, yyyy')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(session.session_status)}
                  {session.session_status === 'invited' && (
                    <Button variant="outline" size="sm" onClick={copyScreeningLink}>
                      {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                      Copy Link
                    </Button>
                  )}
                </div>
              </div>

              {/* Scenario Categories */}
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground mb-2">Scenario Categories</p>
                <ScenarioCategoryBadges 
                  categories={categoryBreakdown} 
                  showCounts={session.session_status === 'completed'}
                  size="md"
                />
              </div>

              {/* Progress indicator for in-progress sessions */}
              {session.session_status === 'in_progress' && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Progress: Scenario {session.current_scenario_index + 1} of {session.scenario_count}
                  </p>
                  <div className="w-full bg-muted rounded-full h-2 mt-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${((session.current_scenario_index + 1) / session.scenario_count) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Analysis and Transcript Tabs */}
            {session.session_status === 'completed' && analysis ? (
              <Tabs defaultValue="analysis" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="analysis">Behavioral Analysis</TabsTrigger>
                  <TabsTrigger value="transcript">Full Transcript</TabsTrigger>
                </TabsList>
                <TabsContent value="analysis" className="mt-4">
                  <BehavioralAnalysisCard analysis={analysis} />
                </TabsContent>
                <TabsContent value="transcript" className="mt-4">
                  <BehavioralAnalysisCard 
                    analysis={analysis} 
                    conversationLogs={conversationLogs.map(log => ({
                      role: log.role,
                      content: log.content,
                      created_at: log.created_at,
                    }))} 
                  />
                </TabsContent>
              </Tabs>
            ) : session.session_status === 'completed' ? (
              <div className="text-center py-8 text-muted-foreground">
                <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Behavioral analysis is being processed...</p>
                <p className="text-sm mt-1">This may take a few moments.</p>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Session not yet completed</p>
                <p className="text-sm mt-1">
                  {session.session_status === 'invited' 
                    ? 'Waiting for candidate to start the screening.'
                    : session.session_status === 'in_progress'
                    ? 'Candidate is currently completing the screening.'
                    : 'This session has expired or was abandoned.'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Session not found
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SessionDetailDialog;
