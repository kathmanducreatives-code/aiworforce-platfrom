import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Briefcase } from "lucide-react";

export interface RoleBriefing {
  role_title: string;
  skills_expected: string;
  experience_required: string;
  key_traits: string[];
}

interface RoleBriefingFormProps {
  value: RoleBriefing;
  onChange: (value: RoleBriefing) => void;
}

const KEY_TRAITS = [
  { id: "problem_solving", label: "Problem Solving" },
  { id: "communication", label: "Communication" },
  { id: "leadership", label: "Leadership" },
  { id: "adaptability", label: "Adaptability" },
  { id: "attention_to_detail", label: "Attention to Detail" },
  { id: "teamwork", label: "Teamwork" },
  { id: "time_management", label: "Time Management" },
  { id: "decision_making", label: "Decision Making" },
];

const EXPERIENCE_LEVELS = [
  { value: "entry", label: "Entry Level (0-2 years)" },
  { value: "mid", label: "Mid Level (2-5 years)" },
  { value: "senior", label: "Senior (5-8 years)" },
  { value: "lead", label: "Lead/Manager (8+ years)" },
  { value: "executive", label: "Executive/Director" },
];

export function RoleBriefingForm({ value, onChange }: RoleBriefingFormProps) {
  const handleTraitToggle = (traitId: string) => {
    const newTraits = value.key_traits.includes(traitId)
      ? value.key_traits.filter(t => t !== traitId)
      : [...value.key_traits, traitId];
    onChange({ ...value, key_traits: newTraits });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Briefcase className="w-4 h-4" />
        <span>This context guides the AI interviewer but is not shown to the candidate.</span>
      </div>

      <div className="space-y-2 px-1">
        <Label htmlFor="role_title">Role Title *</Label>
        <Input
          id="role_title"
          placeholder="e.g., Senior Software Engineer"
          value={value.role_title}
          onChange={(e) => onChange({ ...value, role_title: e.target.value })}
        />
      </div>

      <div className="space-y-2 px-1">
        <Label htmlFor="skills_expected">Skills Expected</Label>
        <Textarea
          id="skills_expected"
          placeholder="e.g., TypeScript, React, System Design, Team Leadership"
          value={value.skills_expected}
          onChange={(e) => onChange({ ...value, skills_expected: e.target.value })}
          rows={2}
        />
      </div>

      <div className="space-y-2 px-1">
        <Label htmlFor="experience_required">Experience Required</Label>
        <Select
          value={value.experience_required}
          onValueChange={(exp) => onChange({ ...value, experience_required: exp })}
        >
          <SelectTrigger id="experience_required">
            <SelectValue placeholder="Select experience level" />
          </SelectTrigger>
          <SelectContent>
            {EXPERIENCE_LEVELS.map((level) => (
              <SelectItem key={level.value} value={level.value}>
                {level.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 px-1">
        <Label>Key Traits to Evaluate</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {KEY_TRAITS.map((trait) => (
            <label
              key={trait.id}
              htmlFor={trait.id}
              className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <Checkbox
                id={trait.id}
                checked={value.key_traits.includes(trait.id)}
                onCheckedChange={() => handleTraitToggle(trait.id)}
              />
              <span className="text-sm font-medium">
                {trait.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
