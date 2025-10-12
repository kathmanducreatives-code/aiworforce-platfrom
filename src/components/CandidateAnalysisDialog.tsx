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
      <DialogContent className="max-w-none w-screen h-screen p-0 gap-0 flex flex-col bg-background overflow-hidden m-0 rounded-none">
        {/* Premium Header */}
        <div className="flex-shrink-0 relative border-b bg-card">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent"></div>
          
          <DialogHeader className="relative px-4 md:px-6 lg:px-8 py-4 md:py-5 lg:py-6">
            <div className="flex flex-col lg:flex-row items-start justify-between gap-4 lg:gap-6">
              <div className="flex-1 space-y-1.5">
                <DialogTitle className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
                  Candidate Analysis
                </DialogTitle>
                <DialogDescription className="text-sm md:text-base text-muted-foreground font-medium">
                  Comprehensive AI-powered assessment and insights
                </DialogDescription>
              </div>
              
              {candidate.overallScore !== undefined && (
                <div className="relative bg-card rounded-xl border border-accent/20 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Overall Score</div>
                      <div className="text-2xl md:text-3xl font-bold text-foreground">
                        {candidate.overallScore}<span className="text-lg md:text-xl text-muted-foreground font-medium">/10</span>
                      </div>
                    </div>
                    <div className="w-12 h-12 md:w-16 md:h-16 relative">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="4" fill="none" className="text-border" />
                        <circle 
                          cx="50%" cy="50%" r="40%" 
                          stroke="hsl(var(--accent))" 
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
            <div className="flex flex-wrap items-center gap-2 md:gap-3 pt-4 mt-4 border-t">
              <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-2.5 bg-muted rounded-lg border">
                <div className="w-8 h-8 md:w-9 md:h-9 bg-accent rounded-full flex items-center justify-center shadow-sm">
                  <span className="text-xs md:text-sm font-bold text-accent-foreground">
                    {candidate.candidateName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="text-left min-w-0">
                  <div className="font-semibold text-foreground text-xs md:text-sm truncate">{candidate.candidateName}</div>
                  <div className="text-xs text-muted-foreground truncate">{candidate.email}</div>
                </div>
              </div>
              
              {candidate.date && (
                <div className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-muted rounded-lg border">
                  <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
                  <span className="text-xs md:text-sm font-medium text-foreground">
                    {new Date(candidate.date).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </span>
                </div>
              )}
              
              {candidate.recruitmentName && (
                <div className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-muted rounded-lg border">
                  <Folder className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
                  <span className="text-xs md:text-sm font-medium text-foreground">{candidate.recruitmentName}</span>
                </div>
              )}
            </div>
          </DialogHeader>
        </div>
          
        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4 md:p-6 lg:p-8">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="sticky top-0 z-10 grid w-full grid-cols-3 mb-4 md:mb-6 lg:mb-8 h-auto p-1 bg-muted border rounded-lg">
                <TabsTrigger 
                  value="overview" 
                  className="gap-1.5 md:gap-2 py-2 md:py-2.5 lg:py-3 rounded-xl transition-all duration-300 font-medium text-xs md:text-sm group data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30"
                >
                  <Target className="h-3.5 w-3.5 md:h-4 md:w-4 group-hover:scale-110 transition-transform duration-200" />
                  <span className="hidden sm:inline">Overview</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="details" 
                  className="gap-1.5 md:gap-2 py-2 md:py-2.5 lg:py-3 rounded-xl transition-all duration-300 font-medium text-xs md:text-sm group data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30"
                >
                  <FileText className="h-3.5 w-3.5 md:h-4 md:w-4 group-hover:scale-110 transition-transform duration-200" />
                  <span className="hidden sm:inline">Details</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="ai-insights" 
                  className="gap-1.5 md:gap-2 py-2 md:py-2.5 lg:py-3 rounded-xl transition-all duration-300 font-medium text-xs md:text-sm group data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30"
                >
                  <Brain className="h-3.5 w-3.5 md:h-4 md:w-4 group-hover:scale-110 transition-transform duration-200" />
                  <span className="hidden sm:inline">AI Insights</span>
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-4 md:space-y-6 animate-fade-in-up">
                {/* Score Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                  {/* Fit Score Card */}
                  <Card className="bg-card border border-accent/20 hover:shadow-md hover:border-accent/40 transition-all duration-200">
                    <CardHeader className="pb-3 pt-4 md:pt-5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-wide">Fit Score</CardTitle>
                        <div className="p-1.5 md:p-2 bg-accent/10 rounded-lg">
                          <Target className="h-3.5 w-3.5 md:h-4 md:w-4 text-accent" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 md:space-y-3 pb-4 md:pb-5">
                      <div className="text-3xl md:text-4xl font-bold text-foreground">
                        {candidate.fitScore}<span className="text-xl md:text-2xl text-muted-foreground font-medium">/10</span>
                      </div>
                      <Progress 
                        value={(candidate.fitScore || 0) * 10} 
                        className="h-1.5 md:h-2"
                      />
                      <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                        {candidate.fitScore >= 8 ? 'Excellent match for the role' : 
                         candidate.fitScore >= 6 ? 'Good potential fit' : 
                         candidate.fitScore >= 4 ? 'Moderate alignment' : 'Needs consideration'}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Risk Factor Card */}
                  <Card className="bg-card border hover:shadow-md transition-all duration-200">
                    <CardHeader className="pb-3 pt-4 md:pt-5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-wide">Risk Factor</CardTitle>
                        <div className="p-1.5 md:p-2 bg-amber-500/10 rounded-lg">
                          <ShieldAlert className="h-3.5 w-3.5 md:h-4 md:w-4 text-amber-600" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 md:space-y-3 pb-4 md:pb-5">
                      <div className="text-3xl md:text-4xl font-bold text-foreground capitalize">
                        {candidate.riskScore || candidate.riskFactor}
                      </div>
                      <p className="text-xs text-muted-foreground font-medium">Assessment of potential concerns</p>
                    </CardContent>
                  </Card>

                  {/* Reward Factor Card */}
                  <Card className="bg-card border border-accent/20 hover:shadow-md hover:border-accent/40 transition-all duration-200">
                    <CardHeader className="pb-3 pt-4 md:pt-5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-wide">Reward Factor</CardTitle>
                        <div className="p-1.5 md:p-2 bg-accent/10 rounded-lg">
                          <Trophy className="h-3.5 w-3.5 md:h-4 md:w-4 text-accent" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 md:space-y-3 pb-4 md:pb-5">
                      <div className="text-3xl md:text-4xl font-bold text-foreground capitalize">
                        {candidate.rewardScore || candidate.rewardFactor}
                      </div>
                      <p className="text-xs text-muted-foreground font-medium">Potential value and impact</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Strengths & Weaknesses Section */}
                <div className="space-y-4 md:space-y-5">
                  {/* Strengths */}
                  {candidate.strengths?.length > 0 && (
                    <Card className="bg-card border border-accent/20 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <CardHeader className="pb-3 md:pb-4 pt-4 md:pt-5 border-b bg-gradient-to-r from-accent/5 via-accent/3 to-transparent">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 md:gap-3 min-w-0">
                            <div className="p-2 md:p-2.5 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl shadow-lg shadow-emerald-500/20 flex-shrink-0">
                              <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <CardTitle className="text-base md:text-lg font-bold text-foreground">Key Strengths</CardTitle>
                              <p className="text-xs text-muted-foreground mt-0.5">Positive attributes identified</p>
                            </div>
                          </div>
                          <Badge className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-0 shadow-md flex-shrink-0 px-3 py-1">
                            {candidate.strengths.length}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 md:pt-5 pb-4 md:pb-5">
                        <p className="text-sm md:text-base text-foreground leading-relaxed">
                          {candidate.strengths.join('. ')}.
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* Weaknesses */}
                  {candidate.weaknesses?.length > 0 && (
                    <Card className="bg-card border border-amber-200/60 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <CardHeader className="pb-3 md:pb-4 pt-4 md:pt-5 border-b bg-gradient-to-r from-amber-50/50 via-amber-50/30 to-transparent">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 md:gap-3 min-w-0">
                            <div className="p-2 md:p-2.5 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl shadow-lg shadow-amber-500/20 flex-shrink-0">
                              <AlertTriangle className="h-4 w-4 md:h-5 md:w-5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <CardTitle className="text-base md:text-lg font-bold text-foreground">Development Areas</CardTitle>
                              <p className="text-xs text-muted-foreground mt-0.5">Growth opportunities identified</p>
                            </div>
                          </div>
                          <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 shadow-md flex-shrink-0 px-3 py-1">
                            {candidate.weaknesses.length}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 md:pt-5 pb-4 md:pb-5">
                        <p className="text-sm md:text-base text-foreground leading-relaxed">
                          {candidate.weaknesses.join('. ')}.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Resume Access */}
                {candidate.resume && (
                  <Card className="bg-card border border-accent/20">
                    <CardContent className="p-4 md:p-5">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 md:gap-4">
                        <div className="flex items-center gap-2 md:gap-3 min-w-0">
                          <div className="p-2 md:p-2.5 bg-accent/10 rounded-lg flex-shrink-0">
                            <FileText className="h-4 w-4 md:h-5 md:w-5 text-accent" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground text-sm md:text-base">Resume Document</div>
                            <p className="text-xs text-muted-foreground mt-0.5">Original submission for detailed review</p>
                          </div>
                        </div>
                        <Button
                          onClick={() => window.open(candidate.resume, '_blank')}
                          className="gap-2 w-full sm:w-auto flex-shrink-0 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 rounded-xl font-medium px-4 py-2.5 group"
                          size="sm"
                        >
                          <FileText className="h-3.5 w-3.5 md:h-4 md:w-4 group-hover:scale-110 transition-transform duration-200" />
                          <span className="text-xs md:text-sm">Open Resume</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Details Tab */}
              <TabsContent value="details" className="space-y-4 md:space-y-6 animate-fade-in-up">
                {/* Candidate Information */}
                <Card className="bg-card border border-accent/20">
                  <CardHeader className="pb-3 md:pb-4 pt-4 md:pt-5 border-b">
                    <CardTitle className="flex items-center gap-2 md:gap-3 text-base md:text-lg font-bold text-foreground">
                      <div className="p-1.5 md:p-2 bg-accent/10 rounded-lg">
                        <FileText className="h-4 w-4 md:h-5 md:w-5 text-accent" />
                      </div>
                      Candidate Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 md:pt-5 pb-4 md:pb-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                      <div className="space-y-1.5 p-3 md:p-4 bg-muted rounded-lg border">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Full Name</span>
                        <p className="text-sm md:text-base font-bold text-foreground break-words">{candidate.candidateName}</p>
                      </div>
                      <div className="space-y-1.5 p-3 md:p-4 bg-muted rounded-lg border">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Address</span>
                        <p className="text-sm md:text-base font-bold text-foreground break-all">{candidate.email}</p>
                      </div>
                      {candidate.date && (
                        <div className="space-y-1.5 p-3 md:p-4 bg-muted rounded-lg border md:col-span-2">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Analysis Date</span>
                          <p className="text-sm md:text-base font-bold text-foreground">
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
                  {/* Strengths Full List */}
                  {candidate.strengths?.length > 0 && (
                    <Card className="bg-card border border-accent/20 relative">
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-accent to-accent"></div>
                      <CardHeader className="pt-4 md:pt-5 pb-3 md:pb-4 border-b">
                        <CardTitle className="flex items-center gap-2 md:gap-3 text-base md:text-lg font-bold">
                          <div className="p-1.5 md:p-2 bg-accent/10 rounded-lg">
                            <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-accent" />
                          </div>
                          <span className="text-foreground">Key Strengths</span>
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1.5 ml-8 md:ml-11">Positive attributes and capabilities</p>
                      </CardHeader>
                      <CardContent className="pt-3 md:pt-4 pb-4 md:pb-5">
                        <div className="space-y-2 md:space-y-2.5">
                          {candidate.strengths.map((strength, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-start gap-2 md:gap-2.5 p-2.5 md:p-3.5 bg-accent/5 rounded-lg border border-accent/20 hover:bg-accent/10 transition-colors duration-150"
                            >
                              <div className="w-4 h-4 md:w-5 md:h-5 bg-accent rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <CheckCircle className="h-2.5 w-2.5 md:h-3 md:w-3 text-white" />
                              </div>
                              <span className="text-xs md:text-sm text-foreground leading-relaxed font-medium">{strength}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Weaknesses Full List */}
                  {candidate.weaknesses?.length > 0 && (
                    <Card className="bg-card border border-amber-200/60 relative">
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500"></div>
                      <CardHeader className="pt-4 md:pt-5 pb-3 md:pb-4 border-b">
                        <CardTitle className="flex items-center gap-2 md:gap-3 text-base md:text-lg font-bold">
                          <div className="p-1.5 md:p-2 bg-amber-500/10 rounded-lg">
                            <AlertTriangle className="h-4 w-4 md:h-5 md:w-5 text-amber-600" />
                          </div>
                          <span className="text-amber-900">Development Areas</span>
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1.5 ml-8 md:ml-11">Growth opportunities and considerations</p>
                      </CardHeader>
                      <CardContent className="pt-3 md:pt-4 pb-4 md:pb-5">
                        <div className="space-y-2 md:space-y-2.5">
                          {candidate.weaknesses.map((weakness, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-start gap-2 md:gap-2.5 p-2.5 md:p-3.5 bg-amber-50/50 rounded-lg border border-amber-100 hover:bg-amber-50 transition-colors duration-150"
                            >
                              <div className="w-4 h-4 md:w-5 md:h-5 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <AlertTriangle className="h-2.5 w-2.5 md:h-3 md:w-3 text-white" />
                              </div>
                              <span className="text-xs md:text-sm text-foreground leading-relaxed font-medium">{weakness}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

              </TabsContent>

              {/* AI Insights Tab */}
              <TabsContent value="ai-insights" className="space-y-4 md:space-y-6 animate-fade-in-up">
                {/* AI Analysis */}
                {candidate.justification && (
                  <Card className="bg-card border border-accent/20 relative">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-accent via-accent to-accent"></div>
                    <CardHeader className="pt-5 md:pt-6 pb-3 md:pb-4 border-b">
                      <CardTitle className="flex items-center gap-3 md:gap-4">
                        <div className="p-2 md:p-3 bg-accent/10 rounded-xl">
                          <Brain className="h-5 w-5 md:h-6 md:w-6 text-accent" />
                        </div>
                        <div>
                          <div className="text-lg md:text-xl font-bold text-foreground">
                            AI-Powered Analysis
                          </div>
                          <div className="text-xs md:text-sm font-normal text-muted-foreground mt-0.5 md:mt-1">
                            Comprehensive evaluation and intelligent recommendations
                          </div>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 md:pt-5 pb-5 md:pb-6">
                      <div className="p-4 md:p-6 bg-muted rounded-lg border">
                        <p className="text-sm md:text-base text-foreground leading-relaxed whitespace-pre-wrap">
                          {candidate.justification}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* AI Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                  <Card className="bg-card border border-accent/20 relative">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-accent"></div>
                    <CardHeader className="pb-2 md:pb-3 pt-4 md:pt-5">
                      <CardTitle className="text-xs md:text-sm flex items-center gap-2 font-semibold">
                        <CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-accent" />
                        <span className="text-muted-foreground uppercase tracking-wide">Strengths</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4 md:pb-5">
                      <div className="text-3xl md:text-4xl font-bold text-foreground mb-1 md:mb-2">
                        {candidate.strengths?.length || 0}
                      </div>
                      <p className="text-xs text-muted-foreground font-medium">Key strengths identified</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-card border relative">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-500"></div>
                    <CardHeader className="pb-2 md:pb-3 pt-4 md:pt-5">
                      <CardTitle className="text-xs md:text-sm flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5 md:h-4 md:w-4 text-amber-600" />
                        <span className="text-muted-foreground uppercase tracking-wide">Growth Areas</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4 md:pb-5">
                      <div className="text-3xl md:text-4xl font-bold text-foreground mb-1 md:mb-2">
                        {candidate.weaknesses?.length || 0}
                      </div>
                      <p className="text-xs text-muted-foreground font-medium">Areas for development</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-card border border-accent/20 relative">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-accent"></div>
                    <CardHeader className="pb-2 md:pb-3 pt-4 md:pt-5">
                      <CardTitle className="text-xs md:text-sm flex items-center gap-2 font-semibold">
                        <TrendingUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-accent" />
                        <span className="text-muted-foreground uppercase tracking-wide">Overall Score</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4 md:pb-5">
                      <div className="text-3xl md:text-4xl font-bold text-foreground mb-1 md:mb-2">
                        {candidate.overallScore}<span className="text-xl md:text-2xl text-muted-foreground">/10</span>
                      </div>
                      <p className="text-xs text-muted-foreground font-medium">Comprehensive rating</p>
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
