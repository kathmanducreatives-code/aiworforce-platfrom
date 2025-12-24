import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { 
  Brain, 
  Search, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Eye,
  Users,
  AlertCircle,
  RefreshCw,
  UserPlus,
  Calendar,
  Play,
  Hourglass
} from "lucide-react";
import { format, isToday, isThisWeek, isThisMonth, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import type { BehavioralRiskLevel, ScreeningSessionStatus } from "@/types/AdaptiveScreening";
import CreateScreeningDialog from "@/components/screening/CreateScreeningDialog";
import SessionDetailDialog from "@/components/screening/SessionDetailDialog";
import ScenarioCategoryBadges from "@/components/screening/ScenarioCategoryBadges";

interface CategoryCount {
  category: 'ambiguity' | 'accountability' | 'time_pressure' | 'competing_priorities' | 'conflict_resolution';
  count: number;
}

interface ScreeningSessionRow {
  id: string;
  candidate_id: string;
  session_status: ScreeningSessionStatus;
  invited_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string;
  scenario_count: number;
  current_scenario_index: number;
  candidate_name?: string;
  candidate_email?: string;
  recruitment_name?: string;
  overall_risk_level?: BehavioralRiskLevel;
  risk_summary?: string;
  categories?: CategoryCount[];
}

const ScreeningResults = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ScreeningSessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    inProgress: 0,
    highRisk: 0,
  });
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [uniqueRoles, setUniqueRoles] = useState<string[]>([]);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      setIsLoading(true);

      // Fetch sessions with candidate info and behavioral analysis
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('adaptive_screening_sessions')
        .select(`
          *,
          resume_analyses (
            candidate_name,
            email,
            recruitment_name
          ),
          screening_behavioral_analysis (
            overall_risk_level,
            risk_summary
          )
        `)
        .order('created_at', { ascending: false });

      if (sessionsError) throw sessionsError;

      // Fetch scenario categories for each session
      const sessionIds = (sessionsData || []).map((s: any) => s.id);
      
      let categoryMap: Record<string, CategoryCount[]> = {};
      
      if (sessionIds.length > 0) {
        const { data: logsData } = await supabase
          .from('screening_conversation_logs')
          .select(`
            session_id,
            screening_scenarios (
              category
            )
          `)
          .in('session_id', sessionIds)
          .eq('role', 'assistant');

        // Group categories by session
        (logsData || []).forEach((log: any) => {
          if (log.screening_scenarios?.category) {
            if (!categoryMap[log.session_id]) {
              categoryMap[log.session_id] = [];
            }
            const existing = categoryMap[log.session_id].find(
              c => c.category === log.screening_scenarios.category
            );
            if (existing) {
              existing.count++;
            } else {
              categoryMap[log.session_id].push({
                category: log.screening_scenarios.category,
                count: 1,
              });
            }
          }
        });
      }

      const formattedSessions: ScreeningSessionRow[] = (sessionsData || []).map((session: any) => ({
        id: session.id,
        candidate_id: session.candidate_id,
        session_status: session.session_status,
        invited_at: session.invited_at,
        started_at: session.started_at,
        completed_at: session.completed_at,
        expires_at: session.expires_at,
        scenario_count: session.scenario_count,
        current_scenario_index: session.current_scenario_index,
        candidate_name: session.resume_analyses?.candidate_name,
        candidate_email: session.resume_analyses?.email,
        recruitment_name: session.resume_analyses?.recruitment_name,
        overall_risk_level: session.screening_behavioral_analysis?.[0]?.overall_risk_level,
        risk_summary: session.screening_behavioral_analysis?.[0]?.risk_summary,
        categories: categoryMap[session.id] || [],
      }));

      setSessions(formattedSessions);

      // Extract unique roles
      const roles = [...new Set(
        formattedSessions
          .map(s => s.recruitment_name)
          .filter((r): r is string => !!r)
      )];
      setUniqueRoles(roles);

      // Calculate stats
      setStats({
        total: formattedSessions.length,
        completed: formattedSessions.filter(s => s.session_status === 'completed').length,
        inProgress: formattedSessions.filter(s => s.session_status === 'in_progress').length,
        highRisk: formattedSessions.filter(s => s.overall_risk_level === 'high').length,
      });

    } catch (error: any) {
      console.error('Failed to fetch sessions:', error);
      toast.error('Failed to load screening sessions');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredSessions = sessions.filter(session => {
    const matchesSearch = 
      session.candidate_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.candidate_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.recruitment_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || session.session_status === statusFilter;
    const matchesRisk = riskFilter === 'all' || session.overall_risk_level === riskFilter;
    const matchesRole = roleFilter === 'all' || session.recruitment_name === roleFilter;
    
    // Date filter
    let matchesDate = true;
    if (dateFilter !== 'all' && session.invited_at) {
      const date = parseISO(session.invited_at);
      if (dateFilter === 'today') matchesDate = isToday(date);
      else if (dateFilter === 'week') matchesDate = isThisWeek(date);
      else if (dateFilter === 'month') matchesDate = isThisMonth(date);
    }

    return matchesSearch && matchesStatus && matchesRisk && matchesRole && matchesDate;
  });

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

  const getProgressBadge = (session: ScreeningSessionRow) => {
    switch (session.session_status) {
      case 'completed':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle className="w-3 h-3 mr-1" />
            Complete
          </Badge>
        );
      case 'in_progress':
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Play className="w-3 h-3 mr-1" />
            {session.current_scenario_index + 1}/{session.scenario_count}
          </Badge>
        );
      case 'invited':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <Hourglass className="w-3 h-3 mr-1" />
            Not Started
          </Badge>
        );
      case 'expired':
        return (
          <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">
            <Clock className="w-3 h-3 mr-1" />
            Expired
          </Badge>
        );
      case 'abandoned':
        return (
          <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
            <AlertCircle className="w-3 h-3 mr-1" />
            Abandoned
          </Badge>
        );
      default:
        return null;
    }
  };

  const getRiskBadge = (riskLevel?: BehavioralRiskLevel) => {
    if (!riskLevel) return null;
    
    switch (riskLevel) {
      case 'low':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle className="w-3 h-3 mr-1" />
            Low Risk
          </Badge>
        );
      case 'medium':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <AlertCircle className="w-3 h-3 mr-1" />
            Medium Risk
          </Badge>
        );
      case 'high':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <AlertTriangle className="w-3 h-3 mr-1" />
            High Risk
          </Badge>
        );
    }
  };

  const handleRowClick = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setShowDetailDialog(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Behavioral Screening</h1>
          <p className="text-muted-foreground mt-1">
            Adaptive Stress-Based Screening™ results and insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchSessions} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <UserPlus className="w-4 h-4 mr-2" />
            Create Screening
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Sessions</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Users className="w-8 h-8 text-primary/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold text-green-400">{stats.completed}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">In Progress</p>
                <p className="text-2xl font-bold text-blue-400">{stats.inProgress}</p>
              </div>
              <Clock className="w-8 h-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">High Risk</p>
                <p className="text-2xl font-bold text-red-400">{stats.highRisk}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card/50 border-border">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by candidate name, email, or position..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-full md:w-36">
                <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="invited">Invited</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Risk Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk Levels</SelectItem>
                <SelectItem value="low">Low Risk</SelectItem>
                <SelectItem value="medium">Medium Risk</SelectItem>
                <SelectItem value="high">High Risk</SelectItem>
              </SelectContent>
            </Select>
            {uniqueRoles.length > 0 && (
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Role/Position" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {uniqueRoles.map(role => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sessions Table */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Screening Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-12">
              <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No screening sessions found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Click "Create Screening" to invite a candidate
              </p>
              <Button 
                onClick={() => setShowCreateDialog(true)} 
                className="mt-4"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create Screening
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Risk Level</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSessions.map((session) => (
                  <TableRow 
                    key={session.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => handleRowClick(session.id)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{session.candidate_name || 'Unknown'}</p>
                        <p className="text-sm text-muted-foreground">{session.candidate_email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {session.recruitment_name || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ScenarioCategoryBadges 
                        categories={session.categories || []} 
                        showCounts={session.session_status === 'completed'}
                      />
                    </TableCell>
                    <TableCell>
                      {getProgressBadge(session)}
                    </TableCell>
                    <TableCell>
                      {session.session_status === 'completed' ? (
                        getRiskBadge(session.overall_risk_level) || (
                          <Badge variant="secondary">Analyzing...</Badge>
                        )
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(session.invited_at), 'MMM d, yyyy')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(session.id);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Screening Dialog */}
      <CreateScreeningDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={fetchSessions}
      />

      {/* Session Detail Dialog */}
      <SessionDetailDialog
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
        sessionId={selectedSessionId}
      />
    </div>
  );
};

export default ScreeningResults;
