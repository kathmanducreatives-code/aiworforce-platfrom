import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Brain, Briefcase, MapPin, Award } from "lucide-react";

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

  return (
    <Card
      className={`group border-2 transition-all duration-300 hover:shadow-lg ${
        isSelected
          ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
          : 'border-border/50 hover:border-primary/50 bg-card/50'
      } backdrop-blur-sm hover:-translate-y-1`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Custom Checkbox with better styling */}
          <div className="flex items-center pt-1">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelect(id, checked as boolean)}
              className={`h-5 w-5 transition-all duration-200 ${
                isSelected ? 'scale-110' : ''
              }`}
            />
          </div>

          {/* Avatar */}
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
              isSelected
                ? 'bg-gradient-to-br from-primary to-cyan-500'
                : 'bg-gradient-to-br from-gray-400 to-gray-500'
            } transition-all duration-300`}
          >
            {getInitials(name)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
                  {name}
                </h3>
                {type === 'linkedin' ? (
                  <p className="text-muted-foreground text-sm flex items-center gap-1 mt-0.5">
                    {title && (
                      <>
                        <Briefcase className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{title}</span>
                      </>
                    )}
                    {company && title && <span className="text-muted-foreground/50">•</span>}
                    {company && <span className="truncate">{company}</span>}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm truncate">
                    {recruitmentName || "General recruitment"}
                  </p>
                )}
              </div>
              
              {isAnalyzed && (
                <Badge variant="secondary" className="gap-1 flex-shrink-0">
                  <Brain className="w-3 h-3" />
                  Analyzed
                </Badge>
              )}
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {type === 'linkedin' && (
                <>
                  {experienceLevel && (
                    <Badge variant="outline" className="text-xs capitalize">
                      <Award className="w-3 h-3 mr-1" />
                      {experienceLevel}
                    </Badge>
                  )}
                  {location && (
                    <Badge variant="outline" className="text-xs">
                      <MapPin className="w-3 h-3 mr-1" />
                      {location}
                    </Badge>
                  )}
                  {linkedinUrl && (
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
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
                      className={`text-xs ${
                        fitScore >= 70 
                          ? 'bg-green-50 text-green-700 border-green-200' 
                          : fitScore >= 50 
                          ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                          : 'bg-gray-50 text-gray-700 border-gray-200'
                      }`}
                    >
                      Fit: {fitScore}%
                    </Badge>
                  )}
                  {currentStage && (
                    <Badge variant="outline" className="text-xs capitalize">
                      {currentStage.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {email && (
                    <Badge variant="outline" className="text-xs">
                      Email Available
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
