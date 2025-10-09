import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

export interface EmailStep {
  id: string;
  stepNumber: number;
  subject: string;
  content: string;
  delayDays: number;
  delayUnit: 'days' | 'hours';
}

interface EmailStepCardProps {
  step: EmailStep;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (field: keyof EmailStep, value: string | number) => void;
  showDelete: boolean;
}

const EmailStepCard = ({ step, isActive, onSelect, onDelete, onUpdate, showDelete }: EmailStepCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card 
      className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
        isActive ? 'border-primary border-2 shadow-md' : 'border-border'
      }`}
      onClick={onSelect}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">
              Step {step.stepNumber}
            </span>
            {showDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="h-6 w-6 p-0"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Preview */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Subject</p>
          <p className="text-sm font-medium truncate">
            {step.subject || "No subject yet"}
          </p>
        </div>

        {/* Expanded View */}
        {isExpanded && (
          <div className="space-y-3 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Delay</Label>
                <Input
                  type="number"
                  min="0"
                  value={step.delayDays}
                  onChange={(e) => onUpdate('delayDays', parseInt(e.target.value) || 0)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Select 
                  value={step.delayUnit} 
                  onValueChange={(value) => onUpdate('delayUnit', value as 'days' | 'hours')}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Delay Badge */}
        {!isExpanded && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>⏱</span>
            <span>{step.delayDays} {step.delayUnit}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EmailStepCard;
