import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Briefcase, Sparkles } from "lucide-react";

export interface RequirementsData {
  free_text: string;
  role_title: string;
  industry: string;
  experience_level: string;
  required_skills: string[];
  culture_keywords: string[];
}

interface RequirementsFormProps {
  value: RequirementsData;
  onChange: (value: RequirementsData) => void;
}

const INDUSTRIES = [
  "Technology/SaaS",
  "Healthcare",
  "Finance",
  "Real Estate",
  "Retail",
  "Manufacturing",
  "Consulting",
  "Education",
  "Other",
];

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
  { value: "senior", label: "Senior (5+ years)" },
];

export function RequirementsForm({ value, onChange }: RequirementsFormProps) {
  const handleTraitToggle = (traitId: string) => {
    const newSkills = value.required_skills.includes(traitId)
      ? value.required_skills.filter(t => t !== traitId)
      : [...value.required_skills, traitId];
    onChange({ ...value, required_skills: newSkills });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="w-4 h-4 text-primary" />
        <span>Describe what you need — AI will generate tailored screening questions.</span>
      </div>

      {/* Free text */}
      <div className="space-y-2">
        <Label htmlFor="free_text">What are you looking for in this candidate?</Label>
        <Textarea
          id="free_text"
          placeholder="e.g., I need someone who can handle pressure, work independently, and has strong leadership skills for a fast-paced startup environment"
          value={value.free_text}
          onChange={(e) => onChange({ ...value, free_text: e.target.value })}
          rows={4}
          className="resize-none"
        />
      </div>

      {/* Role Title */}
      <div className="space-y-2">
        <Label htmlFor="req_role_title">Role Title *</Label>
        <Input
          id="req_role_title"
          placeholder="e.g., Senior Software Engineer"
          value={value.role_title}
          onChange={(e) => onChange({ ...value, role_title: e.target.value })}
        />
      </div>

      {/* Industry + Experience side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Industry</Label>
          <Select value={value.industry} onValueChange={(v) => onChange({ ...value, industry: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select industry" />
            </SelectTrigger>
            <SelectContent>
              {INDUSTRIES.map((ind) => (
                <SelectItem key={ind} value={ind}>{ind}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Experience Level</Label>
          <Select value={value.experience_level} onValueChange={(v) => onChange({ ...value, experience_level: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              {EXPERIENCE_LEVELS.map((lvl) => (
                <SelectItem key={lvl.value} value={lvl.value}>{lvl.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Key Skills / Traits */}
      <div className="space-y-3">
        <Label>Key Skills to Evaluate</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {KEY_TRAITS.map((trait) => (
            <label
              key={trait.id}
              htmlFor={`req_${trait.id}`}
              className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <Checkbox
                id={`req_${trait.id}`}
                checked={value.required_skills.includes(trait.id)}
                onCheckedChange={() => handleTraitToggle(trait.id)}
              />
              <span className="text-sm font-medium">{trait.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Culture Keywords */}
      <div className="space-y-2">
        <Label htmlFor="culture_keywords">Culture Keywords (optional)</Label>
        <Input
          id="culture_keywords"
          placeholder="e.g., innovation, transparency, ownership"
          value={value.culture_keywords.join(", ")}
          onChange={(e) => onChange({
            ...value,
            culture_keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
          })}
        />
        <p className="text-xs text-muted-foreground">Comma-separated values that describe your team culture</p>
      </div>
    </div>
  );
}
