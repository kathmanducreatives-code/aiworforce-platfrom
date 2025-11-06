import { Brain, ShieldCheck, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface IntelligenceBadgeProps {
  score: number;
  verificationStatus?: 'verified' | 'needs_review' | 'pending';
  size?: 'sm' | 'md' | 'lg';
}

export const IntelligenceBadge = ({ 
  score, 
  verificationStatus = 'pending',
  size = 'md' 
}: IntelligenceBadgeProps) => {
  const getStatusColor = () => {
    if (score >= 8 && verificationStatus === 'verified') return 'green';
    if (score >= 5) return 'yellow';
    return 'gray';
  };

  const getIcon = () => {
    if (verificationStatus === 'verified') return <ShieldCheck className="h-4 w-4" />;
    if (verificationStatus === 'needs_review') return <AlertTriangle className="h-4 w-4" />;
    return <Brain className="h-4 w-4" />;
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-2'
  };

  return (
    <Badge 
      className={`
        ${sizeClasses[size]} 
        ${getStatusColor() === 'green' ? 'bg-success/10 border-success/30 text-success' : ''}
        ${getStatusColor() === 'yellow' ? 'bg-warning/10 border-warning/30 text-warning' : ''}
        ${getStatusColor() === 'gray' ? 'bg-muted border-border text-muted-foreground' : ''}
        inline-flex items-center gap-2 font-medium
      `}
    >
      {getIcon()}
      <span>Intelligence: {score}/10</span>
      {verificationStatus === 'verified' && <span className="font-semibold">✓</span>}
    </Badge>
  );
};
