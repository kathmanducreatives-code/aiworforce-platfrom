import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Sliders } from "lucide-react";
import type { GeneratedQuestion } from "./QuestionPreview";

export interface InterviewSettings {
  questionCount: number;
  enabledTypes: string[];
}

interface InterviewSettingsFormProps {
  value: InterviewSettings;
  onChange: (value: InterviewSettings) => void;
  questions: GeneratedQuestion[];
}

const QUESTION_TYPES = [
  { id: "accountability", label: "Ownership / Accountability" },
  { id: "culture_fit", label: "Culture Fit" },
  { id: "red_flag", label: "Red Flag Detectors" },
  { id: "skill", label: "Skill-based Behavioral" },
];

function isSkillCategory(cat: string) {
  return !["accountability", "culture_fit", "red_flag"].includes(cat);
}

export function InterviewSettingsForm({ value, onChange, questions }: InterviewSettingsFormProps) {
  const toggleType = (typeId: string) => {
    const next = value.enabledTypes.includes(typeId)
      ? value.enabledTypes.filter(t => t !== typeId)
      : [...value.enabledTypes, typeId];
    onChange({ ...value, enabledTypes: next });
  };

  const matchesFilter = (q: GeneratedQuestion) => {
    if (isSkillCategory(q.category)) {
      return value.enabledTypes.includes("skill");
    }
    return value.enabledTypes.includes(q.category);
  };

  const includedQuestions = questions.filter(matchesFilter);
  const displayCount = Math.min(value.questionCount, includedQuestions.length);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sliders className="w-4 h-4 text-primary" />
        <span>Configure which types and how many questions to include.</span>
      </div>

      {/* Slider */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>How many questions to ask?</Label>
          <span className="text-lg font-semibold text-primary">{value.questionCount}</span>
        </div>
        <Slider
          min={5}
          max={15}
          step={1}
          value={[value.questionCount]}
          onValueChange={([v]) => onChange({ ...value, questionCount: v })}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>5 min</span>
          <span>15 max</span>
        </div>
      </div>

      {/* Type checkboxes */}
      <div className="space-y-3">
        <Label>Question Types</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {QUESTION_TYPES.map((type) => (
            <label
              key={type.id}
              className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <Checkbox
                checked={value.enabledTypes.includes(type.id)}
                onCheckedChange={() => toggleType(type.id)}
              />
              <span className="text-sm font-medium">{type.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Included Questions Preview</Label>
          <Badge variant="secondary" className="text-xs">
            {displayCount} of {questions.length} will be asked
          </Badge>
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {questions.map((q, idx) => {
            const included = matchesFilter(q);
            return (
              <div
                key={idx}
                className={`flex items-start gap-2 p-2 rounded text-sm transition-opacity ${
                  included ? "opacity-100" : "opacity-30 line-through"
                }`}
              >
                <span className="text-xs font-mono text-muted-foreground mt-0.5">{idx + 1}.</span>
                <span className="flex-1 text-xs leading-relaxed">{q.question_text}</span>
              </div>
            );
          })}
        </div>
        {displayCount < value.questionCount && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Only {includedQuestions.length} questions match your filters — slider set to {value.questionCount}.
          </p>
        )}
      </div>
    </div>
  );
}
