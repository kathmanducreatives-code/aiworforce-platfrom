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
        ${getStatusColor() === 'green' ? 'bg-green-50 border-green-200 text-green-700' : ''}
        ${getStatusColor() === 'yellow' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : ''}
        ${getStatusColor() === 'gray' ? 'bg-gray-50 border-gray-200 text-gray-700' : ''}
        inline-flex items-center gap-2 animate-verified-check
      `}
    >
      {getIcon()}
      <span>Intelligence: {score}/10</span>
      {verificationStatus === 'verified' && <span className="font-bold">✓</span>}
    </Badge>
  );
};
