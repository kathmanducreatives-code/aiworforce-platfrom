import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Folder, FileText, Target, ShieldAlert, Trophy, CheckCircle, AlertTriangle, Brain, TrendingUp } from "lucide-react";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";

interface CandidateAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: ResumeAnalysis | null;
}

export const CandidateAnalysisDialog = ({ open, onOpenChange, candidate }: CandidateAnalysisDialogProps) => {
  if (!candidate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none m-0 p-0 rounded-none flex flex-col bg-gradient-to-br from-slate-50 to-slate-100/30">
        {/* Premium Header */}
        <div className="flex-shrink-0 relative border-b border-slate-200/60 bg-white/95 backdrop-blur-sm">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent"></div>
          
          <DialogHeader className="relative px-8 py-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1 space-y-2">
                <DialogTitle className="text-3xl font-bold text-slate-900 tracking-tight">
                  Candidate Analysis
                </DialogTitle>
                <DialogDescription className="text-base text-slate-600 font-medium">
                  Comprehensive AI-powered assessment and insights
                </DialogDescription>
              </div>
              
              {candidate.overallScore !== undefined && (
                <div className="relative bg-gradient-to-br from-white to-slate-50 rounded-xl border border-slate-200/60 p-5 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Overall Score</div>
                      <div className="text-3xl font-bold text-slate-900">
                        {candidate.overallScore}<span className="text-xl text-slate-500 font-medium">/10</span>
                      </div>
                    </div>
                    <div className="w-16 h-16 relative">
                      <svg className="w-16 h-16 transform -rotate-90">
                        <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-slate-200" />
                        <circle 
                          cx="32" cy="32" r="28" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth="4" 
                          fill="none" 
                          strokeDasharray={`${(candidate.overallScore / 10) * 175.93} 175.93`}
                          className="transition-all duration-1000 ease-out"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Candidate Info Bar */}
            <div className="flex flex-wrap items-center gap-3 pt-5 mt-5 border-t border-slate-200/50">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 rounded-lg border border-slate-200/50">
                <div className="w-9 h-9 bg-gradient-to-br from-primary to-primary-dark rounded-full flex items-center justify-center shadow-sm">
                  <span className="text-sm font-bold text-white">
                    {candidate.candidateName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="text-left">
                  <div className="font-semibold text-slate-900 text-sm">{candidate.candidateName}</div>
                  <div className="text-xs text-slate-500">{candidate.email}</div>
                </div>
              </div>
              
              {candidate.date && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 rounded-lg border border-slate-200/50">
                  <Calendar className="h-4 w-4 text-slate-600" />
                  <span className="text-sm font-medium text-slate-700">
                    {new Date(candidate.date).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </span>
                </div>
              )}
              
              {candidate.recruitmentName && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 rounded-lg border border-slate-200/50">
                  <Folder className="h-4 w-4 text-slate-600" />
                  <span className="text-sm font-medium text-slate-700">{candidate.recruitmentName}</span>
                </div>
              )}
            </div>
          </DialogHeader>
        </div>
          
        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8 max-w-[1400px] mx-auto">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-8 h-auto p-1 bg-white border border-slate-200 shadow-sm rounded-lg">
                <TabsTrigger 
                  value="overview" 
                  className="gap-2 py-3 rounded-md data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm transition-all duration-200 font-medium text-sm"
                >
                  <Target className="h-4 w-4" />
                  <span>Overview</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="details" 
                  className="gap-2 py-3 rounded-md data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm transition-all duration-200 font-medium text-sm"
                >
                  <FileText className="h-4 w-4" />
                  <span>Details</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="ai-insights" 
                  className="gap-2 py-3 rounded-md data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm transition-all duration-200 font-medium text-sm"
                >
                  <Brain className="h-4 w-4" />
                  <span>AI Insights</span>
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6">
                {/* Score Metrics Grid */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Fit Score Card */}
                  <Card className="bg-white border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 rounded-lg">
                    <CardHeader className="pb-3 pt-5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Fit Score</CardTitle>
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <Target className="h-4 w-4 text-primary" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pb-5">
                      <div className="text-4xl font-bold text-slate-900">
                        {candidate.fitScore}<span className="text-2xl text-slate-400 font-medium">/10</span>
                      </div>
                      <Progress 
                        value={(candidate.fitScore || 0) * 10} 
                        className="h-2"
                      />
                      <p className="text-xs text-slate-600 font-medium leading-relaxed">
                        {candidate.fitScore >= 8 ? 'Excellent match for the role' : 
                         candidate.fitScore >= 6 ? 'Good potential fit' : 
                         candidate.fitScore >= 4 ? 'Moderate alignment' : 'Needs consideration'}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Risk Factor Card */}
                  <Card className="bg-white border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 rounded-lg">
                    <CardHeader className="pb-3 pt-5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Risk Factor</CardTitle>
                        <div className="p-2 bg-amber-500/10 rounded-lg">
                          <ShieldAlert className="h-4 w-4 text-amber-600" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pb-5">
                      <div className="text-4xl font-bold text-slate-900">
                        {candidate.riskFactor}
                      </div>
                      <p className="text-xs text-slate-600 font-medium">Assessment of potential concerns</p>
                    </CardContent>
                  </Card>

                  {/* Reward Factor Card */}
                  <Card className="bg-white border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 rounded-lg">
                    <CardHeader className="pb-3 pt-5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Reward Factor</CardTitle>
                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                          <Trophy className="h-4 w-4 text-emerald-600" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pb-5">
                      <div className="text-4xl font-bold text-slate-900">
                        {candidate.rewardFactor}
                      </div>
                      <p className="text-xs text-slate-600 font-medium">Potential value and impact</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Strengths & Weaknesses Section */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Strengths */}
                  {candidate.strengths?.length > 0 && (
                    <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                      <CardHeader className="pb-4 pt-5 border-b border-slate-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-500/10 rounded-lg">
                              <CheckCircle className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <CardTitle className="text-lg font-bold text-slate-900">Key Strengths</CardTitle>
                              <p className="text-xs text-slate-500 mt-0.5">Positive attributes identified</p>
                            </div>
                          </div>
                          <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200 hover:bg-emerald-500/20">
                            {candidate.strengths.length}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 pb-5">
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                          <p className="text-sm text-slate-700 leading-relaxed font-medium">
                            {candidate.strengths.join('. ')}.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Weaknesses */}
                  {candidate.weaknesses?.length > 0 && (
                    <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                      <CardHeader className="pb-4 pt-5 border-b border-slate-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-500/10 rounded-lg">
                              <AlertTriangle className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                              <CardTitle className="text-lg font-bold text-slate-900">Development Areas</CardTitle>
                              <p className="text-xs text-slate-500 mt-0.5">Growth opportunities identified</p>
                            </div>
                          </div>
                          <Badge className="bg-amber-500/10 text-amber-700 border-amber-200 hover:bg-amber-500/20">
                            {candidate.weaknesses.length}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 pb-5">
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                          <p className="text-sm text-slate-700 leading-relaxed font-medium">
                            {candidate.weaknesses.join('. ')}.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Resume Access */}
                {candidate.resume && (
                  <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-primary/10 rounded-lg">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">Resume Document</div>
                            <p className="text-xs text-slate-500 mt-0.5">Original submission for detailed review</p>
                          </div>
                        </div>
                        <Button
                          onClick={() => window.open(candidate.resume, '_blank')}
                          variant="outline"
                          className="gap-2"
                        >
                          <FileText className="h-4 w-4" />
                          Open Resume
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Details Tab */}
              <TabsContent value="details" className="space-y-6">
                {/* Candidate Information */}
                <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                  <CardHeader className="pb-4 pt-5 border-b border-slate-100">
                    <CardTitle className="flex items-center gap-3 text-lg font-bold text-slate-900">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      Candidate Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 pb-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5 p-4 bg-slate-50 rounded-lg border border-slate-100">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Full Name</span>
                        <p className="text-base font-bold text-slate-900">{candidate.candidateName}</p>
                      </div>
                      <div className="space-y-1.5 p-4 bg-slate-50 rounded-lg border border-slate-100">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email Address</span>
                        <p className="text-base font-bold text-slate-900">{candidate.email}</p>
                      </div>
                      {candidate.date && (
                        <div className="space-y-1.5 p-4 bg-slate-50 rounded-lg border border-slate-100 col-span-2">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Analysis Date</span>
                          <p className="text-base font-bold text-slate-900">
                            {new Date(candidate.date).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'long', 
                              day: 'numeric' 
                            })}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Detailed Analysis */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Strengths Full List */}
                  {candidate.strengths?.length > 0 && (
                    <Card className="bg-white border border-emerald-200/60 shadow-sm rounded-lg">
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500"></div>
                      <CardHeader className="pt-5 pb-4 border-b border-slate-100">
                        <CardTitle className="flex items-center gap-3 text-lg font-bold">
                          <div className="p-2 bg-emerald-500/10 rounded-lg">
                            <CheckCircle className="h-5 w-5 text-emerald-600" />
                          </div>
                          <span className="text-emerald-900">Key Strengths</span>
                        </CardTitle>
                        <p className="text-xs text-slate-600 mt-1.5 ml-11">Positive attributes and capabilities</p>
                      </CardHeader>
                      <CardContent className="pt-4 pb-5">
                        <div className="space-y-2.5">
                          {candidate.strengths.map((strength, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-start gap-2.5 p-3.5 bg-emerald-50/50 rounded-lg border border-emerald-100 hover:bg-emerald-50 transition-colors duration-150"
                            >
                              <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <CheckCircle className="h-3 w-3 text-white" />
                              </div>
                              <span className="text-sm text-slate-700 leading-relaxed font-medium">{strength}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Weaknesses Full List */}
                  {candidate.weaknesses?.length > 0 && (
                    <Card className="bg-white border border-amber-200/60 shadow-sm rounded-lg">
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500"></div>
                      <CardHeader className="pt-5 pb-4 border-b border-slate-100">
                        <CardTitle className="flex items-center gap-3 text-lg font-bold">
                          <div className="p-2 bg-amber-500/10 rounded-lg">
                            <AlertTriangle className="h-5 w-5 text-amber-600" />
                          </div>
                          <span className="text-amber-900">Development Areas</span>
                        </CardTitle>
                        <p className="text-xs text-slate-600 mt-1.5 ml-11">Growth opportunities and considerations</p>
                      </CardHeader>
                      <CardContent className="pt-4 pb-5">
                        <div className="space-y-2.5">
                          {candidate.weaknesses.map((weakness, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-start gap-2.5 p-3.5 bg-amber-50/50 rounded-lg border border-amber-100 hover:bg-amber-50 transition-colors duration-150"
                            >
                              <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <AlertTriangle className="h-3 w-3 text-white" />
                              </div>
                              <span className="text-sm text-slate-700 leading-relaxed font-medium">{weakness}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Resume Content */}
                {candidate.resume && (
                  <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                    <CardHeader className="pb-4 pt-5 border-b border-slate-100">
                      <CardTitle className="flex items-center gap-3 text-lg font-bold text-slate-900">
                        <div className="p-2 bg-slate-100 rounded-lg">
                          <FileText className="h-5 w-5 text-slate-700" />
                        </div>
                        Resume Content
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5 pb-5">
                      <div className="p-5 bg-slate-50 rounded-lg border border-slate-100">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 font-mono">
                          {candidate.resume}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* AI Insights Tab */}
              <TabsContent value="ai-insights" className="space-y-6">
                {/* AI Analysis */}
                {candidate.justification && (
                  <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-primary-light to-primary"></div>
                    <CardHeader className="pt-6 pb-4 border-b border-slate-100">
                      <CardTitle className="flex items-center gap-4">
                        <div className="p-3 bg-primary/10 rounded-xl">
                          <Brain className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <div className="text-xl font-bold text-slate-900">
                            AI-Powered Analysis
                          </div>
                          <div className="text-sm font-normal text-slate-600 mt-1">
                            Comprehensive evaluation and intelligent recommendations
                          </div>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5 pb-6">
                      <div className="p-6 bg-slate-50 rounded-lg border border-slate-100">
                        <p className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                          {candidate.justification}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* AI Summary Cards */}
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500"></div>
                    <CardHeader className="pb-3 pt-5">
                      <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <span className="text-slate-600 uppercase tracking-wide">Strengths</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5">
                      <div className="text-4xl font-bold text-slate-900 mb-2">
                        {candidate.strengths?.length || 0}
                      </div>
                      <p className="text-xs text-slate-600 font-medium">Key strengths identified</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-500"></div>
                    <CardHeader className="pb-3 pt-5">
                      <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <span className="text-slate-600 uppercase tracking-wide">Growth Areas</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5">
                      <div className="text-4xl font-bold text-slate-900 mb-2">
                        {candidate.weaknesses?.length || 0}
                      </div>
                      <p className="text-xs text-slate-600 font-medium">Areas for development</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border border-slate-200 shadow-sm rounded-lg">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-primary"></div>
                    <CardHeader className="pb-3 pt-5">
                      <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        <span className="text-slate-600 uppercase tracking-wide">Overall Score</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5">
                      <div className="text-4xl font-bold text-slate-900 mb-2">
                        {candidate.overallScore}<span className="text-2xl text-slate-400">/10</span>
                      </div>
                      <p className="text-xs text-slate-600 font-medium">Comprehensive rating</p>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
