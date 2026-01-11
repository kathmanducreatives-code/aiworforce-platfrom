import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, Briefcase, MapPin, Award, ExternalLink, Sparkles } from "lucide-react";
import { useCallback, KeyboardEvent } from "react";

interface CandidateCardProps {
  id: string;
  name: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  experienceLevel?: string | null;
  fitScore?: number;
  currentStage?: string | null;
  email?: string | null;
  recruitmentName?: string | null;
  linkedinUrl?: string | null;
  isSelected: boolean;
  isAnalyzed?: boolean;
  onSelect: (id: string, checked: boolean) => void;
  type: 'linkedin' | 'resume';
}

export const CandidateCard = ({
  id,
  name,
  title,
  company,
  location,
  experienceLevel,
  fitScore,
  currentStage,
  email,
  recruitmentName,
  linkedinUrl,
  isSelected,
  isAnalyzed,
  onSelect,
  type
}: CandidateCardProps) => {
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onSelect(id, !isSelected);
    }
  }, [id, isSelected, onSelect]);

  const handleCardClick = useCallback(() => {
    onSelect(id, !isSelected);
  }, [id, isSelected, onSelect]);

  const getFitScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 50) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-muted-foreground bg-muted/50 border-muted';
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Card
        className={`group relative border-2 transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
          isSelected
            ? 'border-primary bg-primary/5 shadow-lg shadow-primary/15 scale-[1.02]'
            : 'border-border/50 hover:border-primary/40 hover:bg-card/80 bg-card/50'
        } backdrop-blur-sm hover:-translate-y-1 hover:shadow-xl`}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="checkbox"
        aria-checked={isSelected}
        aria-label={`Select ${name} for deep search analysis`}
      >
        {/* Selection indicator bar */}
        <div 
          className={`absolute top-0 left-0 right-0 h-1 rounded-t-lg transition-all duration-300 ${
            isSelected 
              ? 'bg-gradient-to-r from-primary to-cyan-500' 
              : 'bg-transparent group-hover:bg-primary/20'
          }`} 
        />

        {/* Analyzed badge - positioned absolutely */}
        {isAnalyzed && (
          <div className="absolute -top-2 -right-2 z-10">
            <Badge 
              variant="default" 
              className="gap-1 bg-gradient-to-r from-primary to-cyan-500 text-white shadow-lg animate-fade-in"
            >
              <Brain className="w-3 h-3" />
              Analyzed
            </Badge>
          </div>
        )}

        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Checkbox with larger click area */}
            <div 
              className="flex items-center pt-1"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) => onSelect(id, checked as boolean)}
                className={`h-5 w-5 transition-all duration-200 cursor-pointer ${
                  isSelected ? 'scale-110' : 'group-hover:scale-105'
                }`}
                aria-label={`Select ${name}`}
              />
            </div>

            {/* Avatar with hover effect */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 transition-all duration-300 ${
                    isSelected
                      ? 'bg-gradient-to-br from-primary to-cyan-500 shadow-lg shadow-primary/30'
                      : 'bg-gradient-to-br from-muted-foreground/80 to-muted-foreground/60 group-hover:from-primary/80 group-hover:to-cyan-500/80'
                  }`}
                >
                  {getInitials(name)}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{name}</p>
                  {type === 'linkedin' && (
                    <>
                      {title && <p className="text-muted-foreground">{title}</p>}
                      {company && <p className="text-muted-foreground">at {company}</p>}
                    </>
                  )}
                  {type === 'resume' && recruitmentName && (
                    <p className="text-muted-foreground">{recruitmentName}</p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
                    {name}
                  </h3>
                  {type === 'linkedin' ? (
                    <p className="text-muted-foreground text-sm flex items-center gap-1.5 mt-0.5">
                      {title && (
                        <>
                          <Briefcase className="w-3 h-3 flex-shrink-0 text-primary/60" />
                          <span className="truncate">{title}</span>
                        </>
                      )}
                      {company && title && <span className="text-border">•</span>}
                      {company && <span className="truncate text-muted-foreground/80">{company}</span>}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm truncate mt-0.5">
                      {recruitmentName || "General recruitment"}
                    </p>
                  )}
                </div>

                {/* Quick action buttons - visible on hover */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {type === 'linkedin' && linkedinUrl && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-blue-50 hover:text-blue-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(linkedinUrl, '_blank');
                          }}
                          aria-label="View LinkedIn profile"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View LinkedIn</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {type === 'linkedin' && (
                  <>
                    {experienceLevel && (
                      <Badge variant="outline" className="text-xs capitalize bg-card/80">
                        <Award className="w-3 h-3 mr-1 text-primary/70" />
                        {experienceLevel}
                      </Badge>
                    )}
                    {location && (
                      <Badge variant="outline" className="text-xs bg-card/80">
                        <MapPin className="w-3 h-3 mr-1 text-primary/70" />
                        {location}
                      </Badge>
                    )}
                    {linkedinUrl && (
                      <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-200/50">
                        LinkedIn
                      </Badge>
                    )}
                  </>
                )}
                
                {type === 'resume' && (
                  <>
                    {fitScore !== undefined && fitScore !== null && (
                      <Badge 
                        variant="outline" 
                        className={`text-xs font-medium ${getFitScoreColor(fitScore)}`}
                      >
                        <Sparkles className="w-3 h-3 mr-1" />
                        Fit: {fitScore}%
                      </Badge>
                    )}
                    {currentStage && (
                      <Badge variant="outline" className="text-xs capitalize bg-card/80">
                        {currentStage.replace(/_/g, ' ')}
                      </Badge>
                    )}
                    {email && (
                      <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-200/50">
                        Email Available
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Selection hint */}
          <div 
            className={`absolute bottom-2 right-2 text-[10px] text-muted-foreground transition-opacity duration-200 ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
            }`}
          >
            {isSelected ? 'Selected ✓' : 'Click to select'}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};
