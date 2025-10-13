import React, { useRef, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar, Folder, FileText, Target, ShieldAlert, Trophy, CheckCircle, AlertTriangle, Brain, TrendingUp, ChevronDown } from "lucide-react";
import type { ResumeAnalysis } from "@/types/ResumeAnalysis";

interface CandidateAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: ResumeAnalysis | null;
}

export const CandidateAnalysisDialog = ({ open, onOpenChange, candidate }: CandidateAnalysisDialogProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const lastScrollTop = useRef(0);
  const [strengthsOpen, setStrengthsOpen] = useState(true);
  const [weaknessesOpen, setWeaknessesOpen] = useState(true);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      const scrollTop = scrollElement.scrollTop;
      // Fade out when scrolling down past 10px
      setIsScrollingDown(scrollTop > lastScrollTop.current && scrollTop > 10);
      lastScrollTop.current = scrollTop;
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, []);

  if (!candidate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-none w-screen h-screen p-0 gap-0 flex flex-col bg-background overflow-hidden m-0 rounded-none">
        {/* Clean, Minimal Header */}
        <div className="flex-shrink-0 border-b bg-background">
          <DialogHeader className="px-8 py-8">
            <div className="flex items-start justify-between gap-8">
              {/* Candidate Info */}
              <div className="flex-1 space-y-6">
                <div className="space-y-2">
                  <DialogTitle className="text-2xl font-semibold text-foreground tracking-tight">
                    {candidate.candidateName}
                  </DialogTitle>
                  <DialogDescription className="text-base text-muted-foreground">
                    {candidate.email}
                  </DialogDescription>
                </div>
                
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {candidate.date && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {new Date(candidate.date).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </span>
                    </div>
                  )}
                  
                  {candidate.recruitmentName && (
                    <div className="flex items-center gap-2">
                      <Folder className="h-4 w-4" />
                      <span>{candidate.recruitmentName}</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Overall Score */}
              {candidate.overallScore !== undefined && (
                <div className="flex flex-col items-end gap-1">
                  <div className="text-sm font-medium text-muted-foreground">Overall Score</div>
                  <div className="text-5xl font-semibold text-foreground">
                    {candidate.overallScore}<span className="text-2xl text-muted-foreground">/10</span>
                  </div>
                </div>
              )}
            </div>
          </DialogHeader>
        </div>
          
        {/* Scrollable Content Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/20">
          <div className="max-w-6xl mx-auto px-8 py-12">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="inline-flex h-11 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground mb-12">
                <TabsTrigger 
                  value="overview" 
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-6 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  Overview
                </TabsTrigger>
                <TabsTrigger 
                  value="details" 
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-6 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  Details
                </TabsTrigger>
                <TabsTrigger 
                  value="ai-insights" 
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-6 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  AI Insights
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-12">
                {/* Score Metrics Grid */}
                <div className="grid grid-cols-3 gap-6">
                  {/* Fit Score Card */}
                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300 group">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-muted rounded-lg group-hover:bg-foreground/5 transition-colors">
                          <Target className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground">Fit Score</CardTitle>
                      </div>
                      <div className="space-y-4">
                        <div className="text-5xl font-semibold text-foreground">
                          {candidate.fitScore}<span className="text-2xl text-muted-foreground">/10</span>
                        </div>
                        <Progress 
                          value={(candidate.fitScore || 0) * 10} 
                          className="h-2"
                        />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {candidate.fitScore >= 8 ? 'Excellent match for the role' : 
                         candidate.fitScore >= 6 ? 'Good potential fit' : 
                         candidate.fitScore >= 4 ? 'Moderate alignment' : 'Needs consideration'}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Risk Factor Card */}
                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300 group">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-muted rounded-lg group-hover:bg-foreground/5 transition-colors">
                          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground">Risk Factor</CardTitle>
                      </div>
                      <div className="text-5xl font-semibold text-foreground capitalize">
                        {candidate.riskScore || candidate.riskFactor}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground">Assessment of potential concerns</p>
                    </CardContent>
                  </Card>

                  {/* Reward Factor Card */}
                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300 group">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-muted rounded-lg group-hover:bg-foreground/5 transition-colors">
                          <Trophy className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground">Reward Factor</CardTitle>
                      </div>
                      <div className="text-5xl font-semibold text-foreground capitalize">
                        {candidate.rewardScore || candidate.rewardFactor}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground">Potential value and impact</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Strengths & Weaknesses Section */}
                <div className="space-y-6">
                  {/* Strengths */}
                  {candidate.strengths?.length > 0 && (
                    <Collapsible open={strengthsOpen} onOpenChange={setStrengthsOpen}>
                      <Card className="bg-background border hover:border-foreground/20 transition-all duration-300 overflow-hidden">
                        <CollapsibleTrigger className="w-full">
                          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="p-2.5 bg-muted rounded-lg">
                                  <CheckCircle className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div className="text-left">
                                  <CardTitle className="text-lg font-semibold text-foreground">Key Strengths</CardTitle>
                                  <p className="text-sm text-muted-foreground mt-1">Positive attributes identified</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className="text-sm px-3 py-1">
                                  {candidate.strengths.length}
                                </Badge>
                                <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-300 ${strengthsOpen ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-6 pb-8">
                            <p className="text-base text-foreground leading-relaxed">
                              {candidate.strengths.join('. ')}.
                            </p>
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  )}

                  {/* Development Areas */}
                  {candidate.weaknesses?.length > 0 && (
                    <Collapsible open={weaknessesOpen} onOpenChange={setWeaknessesOpen}>
                      <Card className="bg-background border hover:border-foreground/20 transition-all duration-300 overflow-hidden">
                        <CollapsibleTrigger className="w-full">
                          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="p-2.5 bg-muted rounded-lg">
                                  <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div className="text-left">
                                  <CardTitle className="text-lg font-semibold text-foreground">Development Areas</CardTitle>
                                  <p className="text-sm text-muted-foreground mt-1">Growth opportunities identified</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className="text-sm px-3 py-1">
                                  {candidate.weaknesses.length}
                                </Badge>
                                <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-300 ${weaknessesOpen ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-6 pb-8">
                            <p className="text-base text-foreground leading-relaxed">
                              {candidate.weaknesses.join('. ')}.
                            </p>
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  )}
                </div>

                {/* Resume Access */}
                {candidate.resume && (
                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                    <CardContent className="p-8">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2.5 bg-muted rounded-lg">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="font-semibold text-foreground text-base">Resume Document</div>
                            <p className="text-sm text-muted-foreground mt-1">Original submission for detailed review</p>
                          </div>
                        </div>
                        <Button
                          onClick={() => window.open(candidate.resume, '_blank')}
                          variant="outline"
                          className="hover:bg-muted transition-colors"
                        >
                          Open Resume
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Details Tab */}
              <TabsContent value="details" className="space-y-12">
                {/* Candidate Information */}
                <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                  <CardHeader className="pb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-muted rounded-lg">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <CardTitle className="text-lg font-semibold text-foreground">Candidate Information</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <span className="text-sm font-medium text-muted-foreground">Full Name</span>
                      <p className="text-base text-foreground">{candidate.candidateName}</p>
                    </div>
                    <div className="space-y-2">
                      <span className="text-sm font-medium text-muted-foreground">Email Address</span>
                      <p className="text-base text-foreground">{candidate.email}</p>
                    </div>
                    {candidate.date && (
                      <div className="space-y-2">
                        <span className="text-sm font-medium text-muted-foreground">Analysis Date</span>
                        <p className="text-base text-foreground">
                          {new Date(candidate.date).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                          })}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Detailed Analysis */}
                <div className="grid grid-cols-2 gap-8">
                  {/* Strengths Full List */}
                  {candidate.strengths?.length > 0 && (
                    <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                      <CardHeader className="pb-6">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="p-2.5 bg-muted rounded-lg">
                            <CheckCircle className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <CardTitle className="text-lg font-semibold text-foreground">Key Strengths</CardTitle>
                        </div>
                        <p className="text-sm text-muted-foreground">Positive attributes and capabilities</p>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {candidate.strengths.map((strength, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-start gap-3 p-4 bg-muted/50 hover:bg-muted rounded-lg transition-colors"
                            >
                              <CheckCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                              <span className="text-sm text-foreground leading-relaxed">{strength}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Development Areas Full List */}
                  {candidate.weaknesses?.length > 0 && (
                    <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                      <CardHeader className="pb-6">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="p-2.5 bg-muted rounded-lg">
                            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <CardTitle className="text-lg font-semibold text-foreground">Development Areas</CardTitle>
                        </div>
                        <p className="text-sm text-muted-foreground">Growth opportunities and considerations</p>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {candidate.weaknesses.map((weakness, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-start gap-3 p-4 bg-muted/50 hover:bg-muted rounded-lg transition-colors"
                            >
                              <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                              <span className="text-sm text-foreground leading-relaxed">{weakness}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* AI Insights Tab */}
              <TabsContent value="ai-insights" className="space-y-12">
                {/* AI Analysis */}
                {candidate.justification && (
                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-muted rounded-lg">
                          <Brain className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <CardTitle className="text-lg font-semibold text-foreground">
                            AI-Powered Analysis
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            Comprehensive evaluation and intelligent recommendations
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="p-6 bg-muted/50 rounded-lg">
                        <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap">
                          {candidate.justification}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* AI Summary Cards */}
                <div className="grid grid-cols-3 gap-6">
                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-muted rounded-lg">
                          <CheckCircle className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground">Strengths</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-5xl font-semibold text-foreground mb-2">
                        {candidate.strengths?.length || 0}
                      </div>
                      <p className="text-sm text-muted-foreground">Key strengths identified</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-muted rounded-lg">
                          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground">Growth Areas</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-5xl font-semibold text-foreground mb-2">
                        {candidate.weaknesses?.length || 0}
                      </div>
                      <p className="text-sm text-muted-foreground">Areas for development</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-background border hover:border-foreground/20 transition-all duration-300">
                    <CardHeader className="pb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-muted rounded-lg">
                          <TrendingUp className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <CardTitle className="text-sm font-medium text-muted-foreground">Overall Score</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-5xl font-semibold text-foreground mb-2">
                        {candidate.overallScore}<span className="text-2xl text-muted-foreground">/10</span>
                      </div>
                      <p className="text-sm text-muted-foreground">Comprehensive rating</p>
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
