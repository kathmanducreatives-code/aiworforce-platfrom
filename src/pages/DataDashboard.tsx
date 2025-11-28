import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Users, Target, TrendingUp, Clock, Award, Send, Brain, BarChart3, Search, Mail, CheckCircle, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface DashboardMetrics {
  totalCandidates: number;
  candidatesThisWeek: number;
  candidatesThisMonth: number;
  highQualityCandidates: number;
  averageFitScore: number;
  timeSavedThisMonth: number;
  screeningToInterviewRate: number;
  placementsThisMonth: number;
  totalPlacements: number;
  placementConversionRate: number;
  emailsSent: number;
  leadsScraped: number;
  deepSearchEnrichmentScore: number;
  deepSearchCount: number;
  stageDistribution: { stage: string; count: number; percentage: number }[];
  topRejectionReasons: { reason: string; count: number }[];
}

const DataDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalCandidates: 0,
    candidatesThisWeek: 0,
    candidatesThisMonth: 0,
    highQualityCandidates: 0,
    averageFitScore: 0,
    timeSavedThisMonth: 0,
    screeningToInterviewRate: 0,
    placementsThisMonth: 0,
    totalPlacements: 0,
    placementConversionRate: 0,
    emailsSent: 0,
    leadsScraped: 0,
    deepSearchEnrichmentScore: 0,
    deepSearchCount: 0,
    stageDistribution: [],
    topRejectionReasons: [],
  });

  useEffect(() => {
    fetchDashboardMetrics();
  }, []);

  const fetchDashboardMetrics = async () => {
    try {
      setLoading(true);
      
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        { data: candidates },
        { data: placements },
        { data: emails },
        { data: linkedinLeads },
        { data: deepSearchResults }
      ] = await Promise.all([
        supabase.from('resume_analyses').select('*'),
        supabase.from('client_placements').select('*'),
        supabase.from('scheduled_emails').select('*'),
        supabase.from('linkedin_leads').select('*'),
        supabase.from('deep_search_results').select('*')
      ]);

      const totalCandidates = candidates?.length || 0;
      const candidatesThisWeek = candidates?.filter(c => new Date(c.created_at) >= oneWeekAgo).length || 0;
      const candidatesThisMonth = candidates?.filter(c => new Date(c.created_at) >= oneMonthAgo).length || 0;

      const highQualityCandidates = candidates?.filter(c => {
        const fitScore = c.fit_score as any;
        const score = typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
        return score >= 75;
      }).length || 0;

      const fitScores = candidates?.map(c => {
        const fitScore = c.fit_score as any;
        return typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
      }).filter(score => score > 0) || [];
      const averageFitScore = fitScores.length > 0 
        ? Math.round(fitScores.reduce((a, b) => a + b, 0) / fitScores.length) 
        : 0;

      const timeSavedThisMonth = candidatesThisMonth * 45;

      const interviewReady = candidates?.filter(c => {
        const overall = c.overall_factor as any;
        const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
        return score >= 70;
      }).length || 0;
      const screeningToInterviewRate = totalCandidates > 0 
        ? Math.round((interviewReady / totalCandidates) * 100) 
        : 0;

      const placementsThisMonth = placements?.filter(p => 
        new Date(p.placement_date) >= oneMonthAgo
      ).length || 0;

      const totalPlacements = placements?.length || 0;
      const placementConversionRate = totalCandidates > 0 
        ? Math.round((totalPlacements / totalCandidates) * 100) 
        : 0;

      const emailsSent = emails?.length || 0;
      const leadsScraped = linkedinLeads?.length || 0;
      const deepSearchCount = deepSearchResults?.length || 0;

      const deepSearchScores = deepSearchResults?.map(r => r.fit_score || 0).filter(s => s > 0) || [];
      const deepSearchEnrichmentScore = deepSearchScores.length > 0
        ? Math.round(deepSearchScores.reduce((a, b) => a + b, 0) / deepSearchScores.length)
        : 0;

      // Stage distribution
      const stageDistribution = [
        { 
          stage: 'Initial Screening', 
          count: candidates?.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score < 50;
          }).length || 0,
          percentage: 0
        },
        { 
          stage: 'Under Review', 
          count: candidates?.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score >= 50 && score < 70;
          }).length || 0,
          percentage: 0
        },
        { 
          stage: 'Interview Ready', 
          count: candidates?.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score >= 70 && score < 85;
          }).length || 0,
          percentage: 0
        },
        { 
          stage: 'Top Candidates', 
          count: candidates?.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score >= 85;
          }).length || 0,
          percentage: 0
        }
      ];

      stageDistribution.forEach(stage => {
        stage.percentage = totalCandidates > 0 
          ? Math.round((stage.count / totalCandidates) * 100) 
          : 0;
      });

      // Top rejection reasons
      const rejectionReasons: { [key: string]: number } = {};
      candidates?.forEach(c => {
        const riskFactor = c.risk_factor as any;
        if (typeof riskFactor === 'object' && riskFactor !== null) {
          const score = riskFactor.score || 0;
          if (score >= 60) {
            const reason = riskFactor.text || 'High Risk Factor';
            rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
          }
        }
      });

      const topRejectionReasons = Object.entries(rejectionReasons)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setMetrics({
        totalCandidates,
        candidatesThisWeek,
        candidatesThisMonth,
        highQualityCandidates,
        averageFitScore,
        timeSavedThisMonth,
        screeningToInterviewRate,
        placementsThisMonth,
        totalPlacements,
        placementConversionRate,
        emailsSent,
        leadsScraped,
        deepSearchEnrichmentScore,
        deepSearchCount,
        stageDistribution,
        topRejectionReasons,
      });

      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard metrics:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
              <BarChart3 className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground">
                Data Analytics
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Comprehensive recruitment insights and performance metrics
              </p>
            </div>
          </div>
        </div>

        {/* Main KPI Cards */}
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                Total Candidates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-3xl font-bold text-foreground">
                {metrics.totalCandidates}
              </div>
              <div className="flex gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="text-muted-foreground">Week:</span>
                  <span className="font-semibold text-foreground">{metrics.candidatesThisWeek}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                  <span className="text-muted-foreground">Month:</span>
                  <span className="font-semibold text-foreground">{metrics.candidatesThisMonth}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Target className="h-4 w-4 text-primary" />
                </div>
                Avg Fit Score
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-foreground">
                  {metrics.averageFitScore}%
                </div>
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <Progress value={metrics.averageFitScore} className="h-2 bg-muted" />
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{metrics.highQualityCandidates}</span> high-quality (≥75)
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Clock className="h-4 w-4 text-primary" />
                </div>
                Time Saved This Month
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-3xl font-bold text-foreground">
                {Math.round(metrics.timeSavedThisMonth / 60)}h
              </div>
              <p className="text-xs text-muted-foreground">
                {metrics.timeSavedThisMonth} minutes total
              </p>
              <div className="flex items-center gap-2 px-2 py-1 bg-primary/5 rounded border border-primary/10">
                <Clock className="h-3 w-3 text-primary" />
                <span className="text-xs font-medium text-primary">
                  45 min/candidate
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Award className="h-4 w-4 text-primary" />
                </div>
                Placements
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-foreground">
                  {metrics.placementsThisMonth}
                </div>
                <span className="text-xs text-muted-foreground">this month</span>
              </div>
              <Progress value={metrics.placementConversionRate} className="h-2 bg-muted" />
              <p className="text-xs text-muted-foreground">
                {metrics.placementConversionRate}% conversion rate
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Metrics Row */}
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 mb-8">
          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Screening → Interview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {metrics.screeningToInterviewRate}%
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Emails Sent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {metrics.emailsSent}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Leads Scraped
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {metrics.leadsScraped}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                DeepSearch Runs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {metrics.deepSearchCount}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Enrichment Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {metrics.deepSearchEnrichmentScore}%
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline Health & Risk Factors */}
        <div className="grid gap-6 lg:grid-cols-2 mb-8">
          {/* Pipeline Health */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                Pipeline Health
              </CardTitle>
              <CardDescription className="text-xs">Candidate distribution across stages</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {metrics.stageDistribution.map((stage, index) => {
                  const colors = [
                    'text-primary',
                    'text-primary/80',
                    'text-primary/60',
                    'text-primary/40'
                  ];
                  return (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">{stage.stage}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${colors[index]}`}>
                            {stage.count}
                          </span>
                          <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
                            {stage.percentage}%
                          </Badge>
                        </div>
                      </div>
                      <Progress 
                        value={stage.percentage} 
                        className="h-2 bg-muted"
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Risk Factors */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="p-2 bg-destructive/10 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                Risk Factors
              </CardTitle>
              <CardDescription className="text-xs">Top rejection reasons</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {metrics.topRejectionReasons.length > 0 ? (
                  metrics.topRejectionReasons.map((reason, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive/10 text-destructive text-xs font-bold">
                          {index + 1}
                        </div>
                        <span className="text-sm text-foreground">{reason.reason}</span>
                      </div>
                      <Badge variant="secondary" className="bg-destructive/10 text-destructive border-0">
                        {reason.count}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <div className="text-center">
                      <CheckCircle className="h-12 w-12 mx-auto mb-2 text-primary" />
                      <p className="text-sm">No significant risk factors detected</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DataDashboard;
