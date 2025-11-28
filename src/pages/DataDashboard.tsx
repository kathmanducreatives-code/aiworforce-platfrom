import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Users, Target, TrendingUp, Clock, Award, Send, Brain, BarChart3, Search } from "lucide-react";

interface DashboardMetrics {
  totalCandidates: number;
  highQualityCandidates: number;
  averageFitScore: number;
  timeSavedThisMonth: number;
  screeningToInterviewRate: number;
  placementsThisMonth: number;
  placementConversionRate: number;
  emailsSent: number;
  leadsScraped: number;
  deepSearchEnrichmentScore: number;
}

const DataDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalCandidates: 0,
    highQualityCandidates: 0,
    averageFitScore: 0,
    timeSavedThisMonth: 0,
    screeningToInterviewRate: 0,
    placementsThisMonth: 0,
    placementConversionRate: 0,
    emailsSent: 0,
    leadsScraped: 0,
    deepSearchEnrichmentScore: 0,
  });

  useEffect(() => {
    fetchDashboardMetrics();
  }, []);

  const fetchDashboardMetrics = async () => {
    try {
      setLoading(true);
      
      const now = new Date();
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Fetch all data in parallel
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

      // 1. Total Candidates
      const totalCandidates = candidates?.length || 0;

      // 2. High-Quality Candidates (Fit ≥ 75)
      const highQualityCandidates = candidates?.filter(c => {
        const fitScore = c.fit_score as any;
        const score = typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
        return score >= 75;
      }).length || 0;

      // 3. Average Fit Score
      const fitScores = candidates?.map(c => {
        const fitScore = c.fit_score as any;
        return typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
      }).filter(score => score > 0) || [];
      const averageFitScore = fitScores.length > 0 
        ? Math.round(fitScores.reduce((a, b) => a + b, 0) / fitScores.length) 
        : 0;

      // 4. Time Saved This Month (candidates this month × 45 min per screening)
      const candidatesThisMonth = candidates?.filter(c => 
        new Date(c.created_at) >= oneMonthAgo
      ).length || 0;
      const timeSavedThisMonth = candidatesThisMonth * 45; // minutes

      // 5. Screening → Interview Rate
      const interviewReady = candidates?.filter(c => {
        const overall = c.overall_factor as any;
        const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
        return score >= 70;
      }).length || 0;
      const screeningToInterviewRate = totalCandidates > 0 
        ? Math.round((interviewReady / totalCandidates) * 100) 
        : 0;

      // 6. Placements This Month
      const placementsThisMonth = placements?.filter(p => 
        new Date(p.placement_date) >= oneMonthAgo
      ).length || 0;

      // 7. Placement Conversion Rate
      const totalPlacements = placements?.length || 0;
      const placementConversionRate = totalCandidates > 0 
        ? Math.round((totalPlacements / totalCandidates) * 100) 
        : 0;

      // 8. Emails Sent
      const emailsSent = emails?.length || 0;

      // 9. Leads Scraped
      const leadsScraped = linkedinLeads?.length || 0;

      // 10. DeepSearch Enrichment Score (average fit score from deep search results)
      const deepSearchScores = deepSearchResults?.map(r => r.fit_score || 0).filter(s => s > 0) || [];
      const deepSearchEnrichmentScore = deepSearchScores.length > 0
        ? Math.round(deepSearchScores.reduce((a, b) => a + b, 0) / deepSearchScores.length)
        : 0;

      setMetrics({
        totalCandidates,
        highQualityCandidates,
        averageFitScore,
        timeSavedThisMonth,
        screeningToInterviewRate,
        placementsThisMonth,
        placementConversionRate,
        emailsSent,
        leadsScraped,
        deepSearchEnrichmentScore,
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

  const kpiCards = [
    {
      title: "Total Candidates",
      value: metrics.totalCandidates,
      icon: Users,
      color: "primary"
    },
    {
      title: "High-Quality Candidates",
      subtitle: "Fit ≥ 75",
      value: metrics.highQualityCandidates,
      icon: Target,
      color: "primary"
    },
    {
      title: "Average Fit Score",
      value: `${metrics.averageFitScore}%`,
      icon: TrendingUp,
      color: "primary"
    },
    {
      title: "Time Saved This Month",
      value: `${Math.round(metrics.timeSavedThisMonth / 60)}h`,
      subtitle: `${metrics.timeSavedThisMonth} minutes`,
      icon: Clock,
      color: "primary"
    },
    {
      title: "Screening → Interview Rate",
      value: `${metrics.screeningToInterviewRate}%`,
      icon: TrendingUp,
      color: "primary"
    },
    {
      title: "Placements This Month",
      value: metrics.placementsThisMonth,
      icon: Award,
      color: "primary"
    },
    {
      title: "Placement Conversion Rate",
      value: `${metrics.placementConversionRate}%`,
      icon: Target,
      color: "primary"
    },
    {
      title: "Emails Sent",
      value: metrics.emailsSent,
      icon: Send,
      color: "primary"
    },
    {
      title: "Leads Scraped",
      value: metrics.leadsScraped,
      icon: Search,
      color: "primary"
    },
    {
      title: "DeepSearch Enrichment Score",
      value: `${metrics.deepSearchEnrichmentScore}%`,
      icon: Brain,
      color: "primary"
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-8">
        {/* Header */}
        <div className="mb-8 px-4 sm:px-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Data Analytics
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Key performance indicators for recruitment operations
          </p>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 px-4 sm:px-0">
          {kpiCards.map((kpi, index) => (
            <Card 
              key={index}
              className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)]"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    {kpi.title}
                  </CardTitle>
                  <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                    <kpi.icon className="h-4 w-4 text-primary" />
                  </div>
                </div>
                {kpi.subtitle && (
                  <p className="text-[10px] text-muted-foreground mt-1">{kpi.subtitle}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DataDashboard;
