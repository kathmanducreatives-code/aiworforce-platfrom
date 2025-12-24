import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-lg px-4 py-1">
            <CheckCircle className="w-4 h-4 mr-2" />
            Low Risk
          </Badge>
        );
      case 'medium':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-lg px-4 py-1">
            <AlertTriangle className="w-4 h-4 mr-2" />
            Medium Risk
          </Badge>
        );
      case 'high':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-lg px-4 py-1">
            <AlertTriangle className="w-4 h-4 mr-2" />
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

  const getProgressColor = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
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
    <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            <span className="font-medium">{title}</span>
          </div>
          {score !== undefined && (
            <span className={`text-2xl font-bold ${getScoreColor(score)}`}>
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
              <p className="text-muted-foreground italic">"{item.quote}"</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Overall Risk Level */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Overall Risk Assessment</p>
              {analysis.overall_risk_level && getRiskBadge(analysis.overall_risk_level)}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Brain className="w-4 h-4" />
              AI Confidence: {analysis.ai_confidence_score}%
            </div>
          </div>
          {analysis.risk_summary && (
            <p className="mt-4 text-foreground">{analysis.risk_summary}</p>
          )}
        </CardContent>
      </Card>

      {/* Behavioral Signals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Red Flags */}
        <Card className="bg-red-500/10 border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-400 flex items-center gap-2 text-lg">
              <AlertTriangle className="w-5 h-5" />
              Areas of Concern
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analysis.red_flags.length === 0 ? (
              <p className="text-muted-foreground text-sm">No significant concerns identified</p>
            ) : (
              <div className="space-y-3">
                {analysis.red_flags.map((flag, idx) => (
                  <div key={idx} className="space-y-1">
                    <p className="font-medium text-red-300">{flag.title}</p>
                    <p className="text-sm text-muted-foreground">{flag.description}</p>
                    {flag.evidence_quote && (
                      <p className="text-xs text-muted-foreground italic">"{flag.evidence_quote}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Green Flags */}
        <Card className="bg-green-500/10 border-green-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-green-400 flex items-center gap-2 text-lg">
              <CheckCircle className="w-5 h-5" />
              Positive Indicators
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analysis.green_flags.length === 0 ? (
              <p className="text-muted-foreground text-sm">No standout positives identified</p>
            ) : (
              <div className="space-y-3">
                {analysis.green_flags.map((flag, idx) => (
                  <div key={idx} className="space-y-1">
                    <p className="font-medium text-green-300">{flag.title}</p>
                    <p className="text-sm text-muted-foreground">{flag.description}</p>
                    {flag.evidence_quote && (
                      <p className="text-xs text-muted-foreground italic">"{flag.evidence_quote}"</p>
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
          <Card className="bg-slate-800/50 border-slate-700">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-slate-700/30 transition-colors">
                <CardTitle className="flex items-center justify-between text-lg">
                  <span>Full Conversation Transcript</span>
                  <ChevronDown className={`w-5 h-5 transition-transform ${showTranscript ? 'rotate-180' : ''}`} />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <ScrollArea className="h-96">
                  <div className="space-y-4">
                    {conversationLogs.filter(log => log.role !== 'system').map((log, idx) => (
                      <div key={idx} className={`flex ${log.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          log.role === 'user' 
                            ? 'bg-primary/20 text-foreground' 
                            : 'bg-slate-700 text-foreground'
                        }`}>
                          <p className="text-xs text-muted-foreground mb-1">
                            {log.role === 'user' ? 'Candidate' : 'Interviewer'}
                          </p>
                          <p className="whitespace-pre-wrap text-sm">{log.content}</p>
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
