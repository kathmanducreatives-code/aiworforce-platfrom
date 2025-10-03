import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Users, Clock, TrendingUp, Target, Mail, Award, AlertTriangle, CheckCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface DashboardMetrics {
  totalCandidates: number;
  candidatesThisWeek: number;
  candidatesThisMonth: number;
  averageFitScore: number;
  highQualityCandidates: number;
  autoScreenedPercentage: number;
  averageProcessingTime: number;
  topRejectionReasons: { reason: string; count: number }[];
  engagementRate: number;
  candidatesInNurturing: number;
  stageDistribution: { stage: string; count: number; percentage: number }[];
}

const DataDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalCandidates: 0,
    candidatesThisWeek: 0,
    candidatesThisMonth: 0,
    averageFitScore: 0,
    highQualityCandidates: 0,
    autoScreenedPercentage: 0,
    averageProcessingTime: 0,
    topRejectionReasons: [],
    engagementRate: 0,
    candidatesInNurturing: 0,
    stageDistribution: []
  });

  useEffect(() => {
    fetchDashboardMetrics();
  }, []);

  const fetchDashboardMetrics = async () => {
    try {
      setLoading(true);
      const { data: candidates, error } = await supabase
        .from('resume_analyses')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!candidates) {
        setLoading(false);
        return;
      }

      // Calculate metrics
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const candidatesThisWeek = candidates.filter(c => new Date(c.created_at) >= oneWeekAgo).length;
      const candidatesThisMonth = candidates.filter(c => new Date(c.created_at) >= oneMonthAgo).length;

      // Calculate average fit score
      const fitScores = candidates.map(c => {
        const fitScore = c.fit_score as any;
        return typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
      }).filter(score => score > 0);
      
      const averageFitScore = fitScores.length > 0 
        ? fitScores.reduce((a, b) => a + b, 0) / fitScores.length 
        : 0;

      const highQualityCandidates = candidates.filter(c => {
        const fitScore = c.fit_score as any;
        const score = typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
        return score >= 75;
      }).length;

      // Stage distribution (based on overall score)
      const stageDistribution = [
        { 
          stage: 'Initial Screening', 
          count: candidates.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score < 50;
          }).length,
          percentage: 0
        },
        { 
          stage: 'Under Review', 
          count: candidates.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score >= 50 && score < 70;
          }).length,
          percentage: 0
        },
        { 
          stage: 'Interview Ready', 
          count: candidates.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score >= 70 && score < 85;
          }).length,
          percentage: 0
        },
        { 
          stage: 'Top Candidates', 
          count: candidates.filter(c => {
            const overall = c.overall_factor as any;
            const score = typeof overall === 'object' && overall !== null ? (overall.score || 0) : 0;
            return score >= 85;
          }).length,
          percentage: 0
        }
      ];

      // Calculate percentages
      stageDistribution.forEach(stage => {
        stage.percentage = candidates.length > 0 
          ? Math.round((stage.count / candidates.length) * 100) 
          : 0;
      });

      // Top rejection reasons (based on risk factors)
      const rejectionReasons: { [key: string]: number } = {};
      candidates.forEach(c => {
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
        totalCandidates: candidates.length,
        candidatesThisWeek,
        candidatesThisMonth,
        averageFitScore: Math.round(averageFitScore),
        highQualityCandidates,
        autoScreenedPercentage: 100, // All candidates are auto-screened
        averageProcessingTime: 2, // Simulated value in minutes
        topRejectionReasons,
        engagementRate: Math.round(Math.random() * 30 + 60), // Simulated 60-90%
        candidatesInNurturing: Math.round(candidates.length * 0.3), // Simulated 30%
        stageDistribution
      });

      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard metrics:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4" />
          <p className="text-slate-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/')}
                  className="gap-2 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Dashboard
                </Button>
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-3">
                Data Analytics
              </h1>
              <p className="text-slate-600 text-lg font-medium">
                Comprehensive insights into your recruitment pipeline
              </p>
            </div>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Users className="h-4 w-4 text-cyan-500" />
                Total Candidates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">{metrics.totalCandidates}</div>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-slate-500">This week:</span>
                  <span className="font-semibold text-cyan-600 ml-1">{metrics.candidatesThisWeek}</span>
                </div>
                <div>
                  <span className="text-slate-500">This month:</span>
                  <span className="font-semibold text-teal-600 ml-1">{metrics.candidatesThisMonth}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Target className="h-4 w-4 text-emerald-500" />
                Average Fit Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">{metrics.averageFitScore}%</div>
              <div className="flex items-center gap-2">
                <Progress value={metrics.averageFitScore} className="h-2" />
              </div>
              <p className="text-sm text-slate-500 mt-2">
                {metrics.highQualityCandidates} high-quality candidates (75%+)
              </p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-500" />
                Screening Efficiency
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">{metrics.autoScreenedPercentage}%</div>
              <p className="text-sm text-slate-500">Auto-screened candidates</p>
              <p className="text-sm text-purple-600 font-medium mt-2">
                Avg. time: {metrics.averageProcessingTime} min/candidate
              </p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Mail className="h-4 w-4 text-blue-500" />
                Engagement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">{metrics.engagementRate}%</div>
              <p className="text-sm text-slate-500">Email engagement rate</p>
              <p className="text-sm text-blue-600 font-medium mt-2">
                {metrics.candidatesInNurturing} in nurturing
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline Health & Stage Distribution */}
        <div className="grid gap-6 lg:grid-cols-2 mb-8">
          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-cyan-500" />
                Pipeline Health
              </CardTitle>
              <CardDescription>Candidate distribution across stages</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {metrics.stageDistribution.map((stage, index) => (
                  <div key={index}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">{stage.stage}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{stage.count}</span>
                        <Badge variant="secondary" className="text-xs">{stage.percentage}%</Badge>
                      </div>
                    </div>
                    <Progress value={stage.percentage} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Top Risk Factors
              </CardTitle>
              <CardDescription>Common reasons for candidate concerns</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.topRejectionReasons.length > 0 ? (
                <div className="space-y-3">
                  {metrics.topRejectionReasons.map((reason, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <span className="text-sm text-slate-700 flex-1">{reason.reason}</span>
                      <Badge variant="outline" className="ml-2">{reason.count}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3 text-emerald-500" />
                  <p className="text-sm">No high-risk candidates detected</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detailed Metrics Table */}
        <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-cyan-500" />
              Performance Summary
            </CardTitle>
            <CardDescription>Key performance indicators at a glance</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Candidates Screened (Week)</TableCell>
                  <TableCell>{metrics.candidatesThisWeek}</TableCell>
                  <TableCell>
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Active</Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Candidates Screened (Month)</TableCell>
                  <TableCell>{metrics.candidatesThisMonth}</TableCell>
                  <TableCell>
                    <Badge className="bg-cyan-100 text-cyan-700 hover:bg-cyan-200">On Track</Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">High-Quality Rate</TableCell>
                  <TableCell>
                    {metrics.totalCandidates > 0 
                      ? Math.round((metrics.highQualityCandidates / metrics.totalCandidates) * 100) 
                      : 0}%
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-200">Excellent</Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Automation Rate</TableCell>
                  <TableCell>{metrics.autoScreenedPercentage}%</TableCell>
                  <TableCell>
                    <Badge className="bg-teal-100 text-teal-700 hover:bg-teal-200">Optimal</Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DataDashboard;
