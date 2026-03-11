import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Target, 
  Lightbulb, 
  Heart, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle,
  ChevronDown,
  Quote,
  Brain
} from "lucide-react";
import type { ScreeningBehavioralAnalysis, BehavioralRiskLevel } from "@/types/AdaptiveScreening";
import { useState } from "react";

interface BehavioralAnalysisCardProps {
  analysis: ScreeningBehavioralAnalysis;
  conversationLogs?: Array<{ role: string; content: string; created_at: string }>;
}

const BehavioralAnalysisCard = ({ analysis, conversationLogs }: BehavioralAnalysisCardProps) => {
  const [showTranscript, setShowTranscript] = useState(false);

  const getRiskBadge = (riskLevel: BehavioralRiskLevel) => {
    switch (riskLevel) {
      case 'low':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-sm lg:text-lg px-3 lg:px-4 py-1 whitespace-nowrap">
            <CheckCircle className="w-3 h-3 lg:w-4 lg:h-4 mr-1.5" />
            Low Risk
          </Badge>
        );
      case 'medium':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-sm lg:text-lg px-3 lg:px-4 py-1 whitespace-nowrap">
            <AlertTriangle className="w-3 h-3 lg:w-4 lg:h-4 mr-1.5" />
            Medium Risk
          </Badge>
        );
      case 'high':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-sm lg:text-lg px-3 lg:px-4 py-1 whitespace-nowrap">
            <AlertTriangle className="w-3 h-3 lg:w-4 lg:h-4 mr-1.5" />
            High Risk
          </Badge>
        );
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const SignalCard = ({ 
    icon: Icon, 
    title, 
    score, 
    evidence 
  }: { 
    icon: any; 
    title: string; 
    score?: number; 
    evidence: any[] 
  }) => (
    <Card className="bg-card border-border">
      <CardContent className="p-4 lg:pt-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Icon className="w-4 h-4 lg:w-5 lg:h-5 text-primary flex-shrink-0" />
            <span className="font-medium text-sm lg:text-base truncate">{title}</span>
          </div>
          {score !== undefined && (
            <span className={`text-xl lg:text-2xl font-bold ${getScoreColor(score)} flex-shrink-0 w-12 text-right`}>
              {score}
            </span>
          )}
        </div>
        {score !== undefined && (
          <Progress 
            value={score} 
            className="h-2 mb-4"
          />
        )}
        <div className="space-y-2">
          {evidence.slice(0, 2).map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <Quote className="w-3 h-3 mt-1 text-muted-foreground flex-shrink-0" />
              <p className="text-muted-foreground italic line-clamp-2">"{item.quote}"</p>
            </div>
          ))}
          {evidence.length === 0 && (
            <p className="text-sm text-muted-foreground/60 italic">No evidence recorded</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      {/* Overall Risk Level */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 lg:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground mb-2">Overall Risk Assessment</p>
              {analysis.overall_risk_level && getRiskBadge(analysis.overall_risk_level)}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0">
              <Brain className="w-4 h-4" />
              <span>AI Confidence: {analysis.ai_confidence_score}%</span>
            </div>
          </div>
          {analysis.risk_summary && (
            <p className="mt-4 text-foreground text-sm lg:text-base leading-relaxed">{analysis.risk_summary}</p>
          )}
        </CardContent>
      </Card>

      {/* Behavioral Signals Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SignalCard 
          icon={Target} 
          title="Ownership" 
          score={analysis.ownership_score} 
          evidence={analysis.ownership_evidence} 
        />
        <SignalCard 
          icon={Lightbulb} 
          title="Clarity Under Pressure" 
          score={analysis.clarity_score} 
          evidence={analysis.clarity_evidence} 
        />
        <SignalCard 
          icon={Heart} 
          title="Emotional Regulation" 
          score={analysis.emotional_regulation_score} 
          evidence={analysis.emotional_evidence} 
        />
        <SignalCard 
          icon={RefreshCw} 
          title="Consistency" 
          score={analysis.consistency_score} 
          evidence={analysis.consistency_evidence} 
        />
      </div>

      {/* Flags */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Red Flags */}
        <Card className="bg-red-500/10 border-red-500/30">
          <CardHeader className="pb-2 p-4 lg:p-6 lg:pb-2">
            <CardTitle className="text-red-400 flex items-center gap-2 text-base lg:text-lg">
              <AlertTriangle className="w-4 h-4 lg:w-5 lg:h-5 flex-shrink-0" />
              Areas of Concern
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2 lg:p-6 lg:pt-2 min-h-[120px]">
            {analysis.red_flags.length === 0 ? (
              <p className="text-muted-foreground text-sm">No significant concerns identified</p>
            ) : (
              <div className="space-y-3">
                {analysis.red_flags.map((flag, idx) => (
                  <div key={idx} className="space-y-1">
                    <p className="font-medium text-red-300 text-sm lg:text-base">{flag.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{flag.description}</p>
                    {flag.evidence_quote && (
                      <p className="text-xs text-muted-foreground italic line-clamp-1">"{flag.evidence_quote}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Green Flags */}
        <Card className="bg-green-500/10 border-green-500/30">
          <CardHeader className="pb-2 p-4 lg:p-6 lg:pb-2">
            <CardTitle className="text-green-400 flex items-center gap-2 text-base lg:text-lg">
              <CheckCircle className="w-4 h-4 lg:w-5 lg:h-5 flex-shrink-0" />
              Positive Indicators
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2 lg:p-6 lg:pt-2 min-h-[120px]">
            {analysis.green_flags.length === 0 ? (
              <p className="text-muted-foreground text-sm">No standout positives identified</p>
            ) : (
              <div className="space-y-3">
                {analysis.green_flags.map((flag, idx) => (
                  <div key={idx} className="space-y-1">
                    <p className="font-medium text-green-300 text-sm lg:text-base">{flag.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{flag.description}</p>
                    {flag.evidence_quote && (
                      <p className="text-xs text-muted-foreground italic line-clamp-1">"{flag.evidence_quote}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conversation Transcript */}
      {conversationLogs && conversationLogs.length > 0 && (
        <Collapsible open={showTranscript} onOpenChange={setShowTranscript}>
          <Card className="bg-card border-border">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-muted transition-colors p-4 lg:p-6">
                <CardTitle className="flex items-center justify-between text-base lg:text-lg">
                  <span>Full Conversation Transcript</span>
                  <ChevronDown className={`w-5 h-5 transition-transform flex-shrink-0 ${showTranscript ? 'rotate-180' : ''}`} />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="p-4 lg:p-6 pt-0">
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4 pr-4">
                    {conversationLogs.filter(log => log.role !== 'system').map((log, idx) => (
                      <div key={idx} className={`flex ${log.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] lg:max-w-[80%] rounded-lg px-3 py-2 lg:px-4 lg:py-3 ${
                          log.role === 'user' 
                            ? 'bg-primary/20 text-foreground' 
                            : 'bg-slate-700 text-foreground'
                        }`}>
                          <p className="text-xs text-muted-foreground mb-1">
                            {log.role === 'user' ? 'Candidate' : 'Interviewer'}
                          </p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">{log.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </div>
  );
};

export default BehavioralAnalysisCard;