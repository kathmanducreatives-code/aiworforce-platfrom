import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Copy, Plus, X, Briefcase, Check, Sparkles, Share2, DownloadCloud, AlertCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import DistributeJobDialog from "@/components/distribution/DistributeJobDialog";
import { firecrawl } from "@/lib/firecrawl";

interface CreateJobFormProps {
  onJobCreated: () => void;
  onCancel?: () => void;
  /** When true, hides the collapsible header wrapper (used inside full-screen mobile dialog) */
  embedded?: boolean;
}

const generateSlug = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => chars[v % chars.length]).join('');
};

const CreateJobForm = ({ onJobCreated, onCancel, embedded }: CreateJobFormProps) => {
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
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Firecrawl states
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [showImportReview, setShowImportReview] = useState(false);
  const [isImportExpanded, setIsImportExpanded] = useState(false);

  const [isFetchingMarketData, setIsFetchingMarketData] = useState(false);
  const [marketData, setMarketData] = useState<any>(null);
  const [showMarketData, setShowMarketData] = useState(false);

  const handleImport = async () => {
    if (!importUrl || !user) return;
    setIsImporting(true);
    setShowImportReview(false);

    try {
      const response = await (firecrawl as any).scrapeUrl(importUrl, {
        formats: ['extract'],
        extract: {
          prompt: "Extract: job title, company name, full job description, required skills as array, nice to have skills as array, years of experience required, salary min, salary max, location, employment type, remote policy"
        }
      });

      const result = response?.data || response;
      if (result?.extract) {
        if (result.extract.job_title) setTitle(result.extract.job_title);
        if (result.extract.company_name) setCompanyName(result.extract.company_name);
        if (result.extract.job_description) setDescription(result.extract.job_description);
        if (result.extract.required_skills) setSkills(Array.isArray(result.extract.required_skills) ? result.extract.required_skills : []);
        if (result.extract.years_of_experience) {
          setRequiredYears(parseInt(result.extract.years_of_experience) || 0);
        }
        if (result.extract.salary_min) setSalaryMin(result.extract.salary_min.toString());
        if (result.extract.salary_max) setSalaryMax(result.extract.salary_max.toString());

        setShowImportReview(true);
        setIsImportExpanded(false); // collapse on success
        toast.success("Job details imported successfully! Please review.");

        await (supabase as any).from("firecrawl_scrape_logs").insert({
          user_id: user.id,
          feature: 'job_importer',
          url: importUrl,
          status: 'success',
          response_summary: 'Successfully extracted job details'
        });
      } else {
        throw new Error("Extraction failed or returned empty format");
      }
    } catch (error) {
      console.error(error);
      toast.error("Could not import from that URL — please fill in manually");
      await (supabase as any).from("firecrawl_scrape_logs").insert({
        user_id: user.id,
        feature: 'job_importer',
        url: importUrl,
        status: 'failed',
        response_summary: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Debounced Market Intelligence
  useEffect(() => {
    const fetchMarketData = async () => {
      if (!title.trim() || title.trim().length <= 3 || !user) return;
      setIsFetchingMarketData(true);
      setShowMarketData(true); // show skeletons
      try {
        // 1. Check Cache
        const exactMatchTerm = title.trim();
        const { data: cached } = await (supabase as any).from("job_market_intelligence")
          .select("*")
          .ilike("query_keyword", exactMatchTerm)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (cached) {
          setMarketData({
            salaryRange: cached.raw_data?.average_salary_range || cached.raw_data?.salary_range || `$${cached.avg_salary_min}-${cached.avg_salary_max}`,
            skills: cached.top_required_skills || [],
            experience: cached.raw_data?.common_years_of_experience_required || "N/A",
            remote: cached.remote_percentage ? `${cached.remote_percentage}%` : "N/A",
            parsedMin: cached.avg_salary_min || 0,
            parsedMax: cached.avg_salary_max || 0
          });
          setIsFetchingMarketData(false);
          return;
        }

        // 2. Firecrawl Search
        const response = await (firecrawl as any).search(`${exactMatchTerm} average salary requirements 2026`, {
          limit: 3,
          scrapeOptions: {
            formats: ['extract'],
            extract: { prompt: "Extract: average salary range, most required skills, common years of experience required, remote vs onsite percentage" }
          }
        });

        const result = response?.data?.[0]?.extract || response?.[0]?.extract || response?.extract;
        if (result) {
          const avgScale = String(result.average_salary_range || result.salary_range || "N/A");
          let sMin = 0; let sMax = 0;
          const numbers = avgScale.replace(/,/g, '').match(/\d+/g);
          if (numbers && numbers.length >= 2) {
            sMin = parseInt(numbers[0]) < 1000 ? parseInt(numbers[0]) * 1000 : parseInt(numbers[0]);
            sMax = parseInt(numbers[1]) < 1000 ? parseInt(numbers[1]) * 1000 : parseInt(numbers[1]);
          }

          const parsedSkills = typeof result.most_required_skills === 'string' ? result.most_required_skills.split(',') : result.most_required_skills;

          setMarketData({
            salaryRange: avgScale,
            skills: parsedSkills || [],
            experience: result.common_years_of_experience_required || "N/A",
            remote: result.remote_vs_onsite_percentage || "N/A",
            parsedMin: sMin,
            parsedMax: sMax
          });

          await (supabase as any).from("job_market_intelligence").insert({
            user_id: user.id,
            query_keyword: exactMatchTerm,
            avg_salary_min: sMin || null,
            avg_salary_max: sMax || null,
            top_required_skills: parsedSkills || [],
            remote_percentage: parseInt(result.remote_vs_onsite_percentage) || null,
            raw_data: result
          });
        } else {
          setShowMarketData(false);
        }
      } catch (e) {
        setShowMarketData(false);
      } finally {
        setIsFetchingMarketData(false);
      }
    };

    const handler = setTimeout(() => {
      fetchMarketData();
    }, 800);

    return () => clearTimeout(handler);
  }, [title, user]);

  const handleAddSkillFromMarket = (skill: string) => {
    const s = skill.trim();
    if (!skills.includes(s)) setSkills([...skills, s]);
  };

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
    const { data: insertedData, error } = await supabase.from("screening_jobs").insert({
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
    }).select("id").single();
    setLoading(false);
    if (error) {
      toast.error("Failed to create screening job");
      return;
    }
    const url = `${window.location.origin}/apply/${slug}`;
    setCreatedUrl(url);
    if (insertedData?.id) setCreatedJobId(insertedData.id);
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
          <div className="flex items-center gap-2">
            {createdJobId && (
              <Button variant="outline" size="sm" className="border-primary/30 hover:bg-primary/10" onClick={() => setDistributeOpen(true)}>
                <Share2 className="h-4 w-4 mr-1" /> Distribute to Platforms
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setCreatedUrl(null); setCreatedJobId(null); setTitle(""); setDescription(""); setSkills([]); setCustomQuestions([]); setIsExpanded(false); }}>
              Create Another Job
            </Button>
          </div>
          {createdJobId && (
            <DistributeJobDialog
              open={distributeOpen}
              onOpenChange={setDistributeOpen}
              jobId={createdJobId}
              jobTitle={title}
              onDistributed={() => { }}
            />
          )}
        </div>
      </div>
    );
  }

  // The actual form content
  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-6 flex flex-col w-full">

      {/* Import from URL Component - Collapsible */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden transition-all duration-300">
        <button
          type="button"
          onClick={() => setIsImportExpanded(!isImportExpanded)}
          className="w-full flex justify-between items-center p-4 hover:bg-primary/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <DownloadCloud className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Import from Job URL</h3>
          </div>
          {isImportExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        <div className={`overflow-hidden transition-all duration-300 ${isImportExpanded ? 'max-h-40 px-4 pb-4 opacity-100' : 'max-h-0 opacity-0'}`}>
          <p className="text-xs text-muted-foreground mb-3">Paste a link to any active job posting (LinkedIn, Indeed, company site) to auto-fill this form.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              placeholder="https://example.com/careers/job-123"
              className="bg-background/80 border-border/60"
              disabled={isImporting}
            />
            <Button type="button" onClick={handleImport} disabled={isImporting || !importUrl} variant="default" className="bg-primary text-primary-foreground">
              {isImporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Auto-filling...</> : "Scan & Fill"}
            </Button>
          </div>
        </div>
      </div>

      {showImportReview && (
        <div className="p-3 rounded-md border border-emerald-500/50 bg-emerald-500/10 flex items-start gap-3 animate-in fade-in zoom-in-95 duration-500">
          <Check className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="text-sm text-emerald-700 dark:text-emerald-400">
            <strong className="block mb-0.5 font-semibold">Job imported!</strong>
            <p>We've auto-filled the form below from the URL. Please verify everything is accurate before saving.</p>
          </div>
        </div>
      )}

      {/* Step 1: Basics */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-full bg-primary/20 border border-primary/30 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Basics</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-7">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium">Job Title <span className="text-destructive">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Frontend Engineer" className="border-border/60 bg-background/60 focus:border-primary/50" />

            {/* Inline Market Intelligence Widget */}
            {showMarketData && title.trim().length > 3 && (
              <div className="mt-2 p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-semibold text-primary flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <Sparkles className="h-3.5 w-3.5" /> Live Market Intelligence
                  </h4>
                  <button type="button" onClick={() => setShowMarketData(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {isFetchingMarketData ? (
                  <div className="flex items-center justify-center p-4 text-xs text-muted-foreground gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Analyzing job market...
                  </div>
                ) : marketData ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                      <div className="bg-background/80 p-2 rounded border border-border/50">
                        <span className="text-muted-foreground block mb-0.5 font-medium">Avg Salary</span>
                        <span className="font-semibold font-mono">{marketData.salaryRange}</span>
                      </div>
                      <div className="bg-background/80 p-2 rounded border border-border/50">
                        <span className="text-muted-foreground block mb-0.5 font-medium">Remote %</span>
                        <span className="font-semibold">{marketData.remote}</span>
                      </div>
                    </div>
                    <div className="bg-background/80 p-2 rounded border border-border/50 text-xs">
                      <span className="text-muted-foreground block mb-1 font-medium">Suggested Skills (click to add)</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {Array.isArray(marketData.skills)
                          ? marketData.skills.map((s: string) => (
                            <Badge key={s} variant="secondary" className="cursor-pointer hover:bg-primary hover:text-primary-foreground font-normal" onClick={() => handleAddSkillFromMarket(s)}>
                              {s}
                            </Badge>
                          ))
                          : <span className="text-muted-foreground">{marketData.skills}</span>}
                      </div>
                    </div>
                    {marketData.parsedMin > 0 && marketData.parsedMax > 0 && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSalaryMin(marketData.parsedMin.toString());
                          setSalaryMax(marketData.parsedMax.toString());
                          toast.success("Salary range applied to form!");
                        }}
                        className="w-full mt-2 bg-primary/10 text-primary hover:bg-primary/20 h-8 text-xs font-semibold"
                      >
                        Apply Average Salary to Form
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground italic p-2">No market data available for this role.</div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium">Company Name <span className="text-destructive">*</span></Label>
            <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" className="border-border/60 bg-background/60 focus:border-primary/50" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-medium">Job Description <span className="text-destructive">*</span></Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the role, responsibilities, and what you're looking for..." rows={4} className="border-border/60 bg-background/60 focus:border-primary/50 resize-y" />
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

      {/* Submit */}
      <div className="flex gap-3 pt-2 border-t border-border/40 pb-4">
        <Button type="submit" disabled={loading} className="flex-1 sm:flex-none sm:px-8">
          {loading ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Creating...</span>
          ) : (
            <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Create Screening Link</span>
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel || (() => setIsExpanded(false))}>Cancel</Button>
      </div>
    </form>
  );

  // Embedded mode: render form directly without collapsible wrapper
  if (embedded) {
    return formContent;
  }

  // Default: collapsible wrapper
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden">
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
        <div className="border-t border-border/40 px-5 pb-6 pt-5 animate-in fade-in slide-in-from-top-4 duration-500">
          {formContent}
        </div>
      )}
    </div>
  );
};

export default CreateJobForm;
