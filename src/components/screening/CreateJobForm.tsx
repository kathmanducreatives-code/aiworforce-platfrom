import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Copy, Plus, X, Briefcase, Check, Sparkles } from "lucide-react";

interface CreateJobFormProps {
  onJobCreated: () => void;
}

const generateSlug = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => chars[v % chars.length]).join('');
};

const CreateJobForm = ({ onJobCreated }: CreateJobFormProps) => {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [requiredYears, setRequiredYears] = useState<number>(0);
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [education, setEducation] = useState("none");
  const [salaryMin, setSalaryMin] = useState<string>("");
  const [salaryMax, setSalaryMax] = useState<string>("");
  const [customQuestions, setCustomQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleAddSkill = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && skillInput.trim()) {
      e.preventDefault();
      if (!skills.includes(skillInput.trim())) {
        setSkills([...skills, skillInput.trim()]);
      }
      setSkillInput("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim() || !companyName.trim() || !description.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }
    setLoading(true);
    const slug = generateSlug();
    const { error } = await supabase.from("screening_jobs").insert({
      user_id: user.id,
      slug,
      title: title.trim(),
      company_name: companyName.trim(),
      description: description.trim(),
      required_years: requiredYears,
      required_skills: skills,
      education_requirement: education,
      salary_min: salaryMin ? parseInt(salaryMin) : null,
      salary_max: salaryMax ? parseInt(salaryMax) : null,
      custom_questions: customQuestions.filter(q => q.trim()) as any,
      status: "active",
    });
    setLoading(false);
    if (error) {
      toast.error("Failed to create screening job");
      return;
    }
    const url = `${window.location.origin}/apply/${slug}`;
    setCreatedUrl(url);
    toast.success("Screening link created!");
    onJobCreated();
  };

  const handleCopy = () => {
    if (createdUrl) {
      navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied!");
    }
  };

  if (createdUrl) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 backdrop-blur-sm overflow-hidden animate-fade-in">
        <div className="p-6 md:p-8 flex flex-col items-center gap-5 text-center">
          <div className="relative">
            <div className="h-16 w-16 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            </div>
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">Screening Link Ready!</p>
            <p className="text-sm text-muted-foreground mt-1">Share this link with candidates to start receiving AI-scored applications.</p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full max-w-lg">
            <code className="flex-1 bg-background/70 border border-border/60 rounded-lg px-3 py-2 text-sm text-foreground font-mono truncate">
              {createdUrl}
            </code>
            <Button onClick={handleCopy} variant="outline" className="sm:w-auto w-full border-primary/30 hover:bg-primary/10 hover:border-primary/50">
              {copied ? <Check className="h-4 w-4 mr-2 text-primary" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Copied!" : "Copy Link"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">💡 Share on LinkedIn, email campaigns, or embed on your careers page.</p>
          <Button variant="ghost" size="sm" onClick={() => { setCreatedUrl(null); setTitle(""); setDescription(""); setSkills([]); setCustomQuestions([]); setIsExpanded(false); }}>
            Create Another Job
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden">
      {/* Header — always visible, click to expand */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-5 hover:bg-muted/20 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
            <Briefcase className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground text-sm">Create New Screening</h2>
            <p className="text-xs text-muted-foreground">Configure a job and generate a shareable AI-screening link</p>
          </div>
        </div>
        <div className={`h-6 w-6 rounded-full border border-border/60 flex items-center justify-center transition-transform duration-200 ${isExpanded ? "rotate-45" : ""}`}>
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border/40 px-5 pb-6 pt-5 animate-fade-in">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Step 1: Basics */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-primary/20 border border-primary/30 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Basics</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-7">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Job Title <span className="text-destructive">*</span></Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Frontend Engineer" className="border-border/60 bg-background/60 focus:border-primary/50" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Company Name <span className="text-destructive">*</span></Label>
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" className="border-border/60 bg-background/60 focus:border-primary/50" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-medium">Job Description <span className="text-destructive">*</span></Label>
                  <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the role, responsibilities, and what you're looking for..." rows={4} className="border-border/60 bg-background/60 focus:border-primary/50 resize-none" />
                </div>
              </div>
            </div>

            {/* Step 2: Requirements */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-primary/20 border border-primary/30 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Requirements</span>
              </div>
              <div className="pl-7 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Years of Experience</Label>
                    <Input type="number" min={0} value={requiredYears} onChange={e => setRequiredYears(parseInt(e.target.value) || 0)} className="border-border/60 bg-background/60 focus:border-primary/50" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Education</Label>
                    <Select value={education} onValueChange={setEducation}>
                      <SelectTrigger className="border-border/60 bg-background/60"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="high_school">High School</SelectItem>
                        <SelectItem value="bachelors">Bachelor's</SelectItem>
                        <SelectItem value="masters">Master's</SelectItem>
                        <SelectItem value="phd">PhD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Salary Range (optional)</Label>
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Min" value={salaryMin} onChange={e => setSalaryMin(e.target.value)} className="border-border/60 bg-background/60 focus:border-primary/50" />
                      <Input type="number" placeholder="Max" value={salaryMax} onChange={e => setSalaryMax(e.target.value)} className="border-border/60 bg-background/60 focus:border-primary/50" />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Required Skills <span className="text-muted-foreground font-normal">(press Enter to add)</span></Label>
                  <Input value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={handleAddSkill} placeholder="Type a skill and press Enter..." className="border-border/60 bg-background/60 focus:border-primary/50" />
                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {skills.map(s => (
                        <span key={s} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                          {s}
                          <button type="button" onClick={() => setSkills(skills.filter(x => x !== s))} className="hover:text-destructive transition-colors ml-0.5">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 3: Custom Questions */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-muted/60 border border-border/50 text-muted-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Custom Questions <span className="normal-case font-normal">(optional, up to 3)</span></span>
              </div>
              <div className="pl-7 space-y-2">
                {customQuestions.map((q, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={q} onChange={e => { const arr = [...customQuestions]; arr[i] = e.target.value; setCustomQuestions(arr); }} placeholder={`Question ${i + 1}`} className="border-border/60 bg-background/60 focus:border-primary/50" />
                    <Button type="button" variant="ghost" size="icon" className="h-10 w-10 border border-border/40 hover:border-destructive/40 hover:text-destructive" onClick={() => setCustomQuestions(customQuestions.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {customQuestions.length < 3 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setCustomQuestions([...customQuestions, ""])} className="border-dashed border-border/60 hover:border-primary/40 text-muted-foreground hover:text-primary">
                    <Plus className="h-4 w-4 mr-1" /> Add Question
                  </Button>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2 border-t border-border/40">
              <Button type="submit" disabled={loading} className="flex-1 sm:flex-none sm:px-8">
                {loading ? (
                  <span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />Creating...</span>
                ) : (
                  <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Create Screening Link</span>
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsExpanded(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default CreateJobForm;
