import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Copy, Plus, X, Briefcase, Check } from "lucide-react";

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
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 md:p-6 flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
            <Check className="h-6 w-6 text-primary" />
          </div>
          <p className="text-lg font-semibold text-foreground">Screening Link Ready!</p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full max-w-lg">
            <Input value={createdUrl} readOnly className="text-sm flex-1" />
            <Button onClick={handleCopy} variant="outline" className="sm:w-auto w-full flex items-center justify-center gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="sm:hidden">Copy Link</span>
            </Button>
          </div>
          <Button variant="ghost" onClick={() => { setCreatedUrl(null); setTitle(""); setDescription(""); setSkills([]); setCustomQuestions([]); }}>
            Create Another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          Create New Screening
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Job Title *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Frontend Engineer" />
            </div>
            <div className="space-y-2">
              <Label>Company Name *</Label>
              <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Job Description *</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the role, responsibilities, and what you're looking for..." rows={4} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Required Years of Experience</Label>
              <Input type="number" min={0} value={requiredYears} onChange={e => setRequiredYears(parseInt(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label>Education Requirement</Label>
              <Select value={education} onValueChange={setEducation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="high_school">High School</SelectItem>
                  <SelectItem value="bachelors">Bachelor's</SelectItem>
                  <SelectItem value="masters">Master's</SelectItem>
                  <SelectItem value="phd">PhD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Salary Range (optional)</Label>
              <div className="flex gap-2">
                <Input type="number" placeholder="Min" value={salaryMin} onChange={e => setSalaryMin(e.target.value)} />
                <Input type="number" placeholder="Max" value={salaryMax} onChange={e => setSalaryMax(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Required Skills (press Enter to add)</Label>
            <Input value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={handleAddSkill} placeholder="Type a skill and press Enter" />
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {skills.map(s => (
                  <Badge key={s} variant="secondary" className="gap-1">
                    {s}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setSkills(skills.filter(x => x !== s))} />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Custom Questions (optional, up to 3)</Label>
            {customQuestions.map((q, i) => (
              <div key={i} className="flex gap-2">
                <Input value={q} onChange={e => { const arr = [...customQuestions]; arr[i] = e.target.value; setCustomQuestions(arr); }} placeholder={`Question ${i + 1}`} />
                <Button type="button" variant="ghost" size="icon" onClick={() => setCustomQuestions(customQuestions.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {customQuestions.length < 3 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomQuestions([...customQuestions, ""])}>
                <Plus className="h-4 w-4 mr-1" /> Add Question
              </Button>
            )}
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating..." : "Create Screening Link"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default CreateJobForm;
