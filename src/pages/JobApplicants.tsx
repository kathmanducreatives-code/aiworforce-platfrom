import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Users, CheckCircle2, AlertTriangle, XCircle, Search, Download, ArrowUpDown } from "lucide-react";
import ApplicantCard from "@/components/screening/ApplicantCard";
import ApplicantDetailModal from "@/components/screening/ApplicantDetailModal";
import { toast } from "sonner";

type SortKey = "score_desc" | "score_asc" | "date_desc" | "date_asc" | "name_asc" | "name_desc";

const JobApplicants = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score_desc");

  const fetchData = async () => {
    if (!jobId) return;
    const [{ data: jobData }, { data: appsData }] = await Promise.all([
      supabase.from("screening_jobs").select("*").eq("id", jobId).single(),
      supabase.from("screening_applications").select("*").eq("job_id", jobId).eq("is_archived", false).order("created_at", { ascending: false }),
    ]);
    setJob(jobData);
    setApplications(appsData || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [jobId]);

  const counts = {
    total: applications.length,
    strong: applications.filter(a => a.match_category === "strong_fit").length,
    good: applications.filter(a => a.match_category === "good_fit").length,
    maybe: applications.filter(a => a.match_category === "maybe").length,
    not_qualified: applications.filter(a => a.match_category === "not_qualified").length,
  };

  const filtered = useMemo(() => {
    let result = filter === "all" ? applications : applications.filter(a => a.match_category === filter);

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => {
        const name = ((a.extracted_data as any)?.name || "").toLowerCase();
        const email = ((a.extracted_data as any)?.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case "score_desc": return (b.match_score ?? -1) - (a.match_score ?? -1);
        case "score_asc": return (a.match_score ?? -1) - (b.match_score ?? -1);
        case "date_desc": return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "date_asc": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name_asc": {
          const nameA = ((a.extracted_data as any)?.name || "").toLowerCase();
          const nameB = ((b.extracted_data as any)?.name || "").toLowerCase();
          return nameA.localeCompare(nameB);
        }
        case "name_desc": {
          const nameA = ((a.extracted_data as any)?.name || "").toLowerCase();
          const nameB = ((b.extracted_data as any)?.name || "").toLowerCase();
          return nameB.localeCompare(nameA);
        }
        default: return 0;
      }
    });

    return result;
  }, [applications, filter, searchQuery, sortKey]);

  const handleExportCSV = () => {
    if (applications.length === 0) {
      toast.info("No applicants to export");
      return;
    }

    const headers = ["Name", "Email", "Phone", "Score", "Category", "Applied Date", "Time (min)", "Tab Switches", "Strengths", "Red Flags"];
    const rows = applications.map(a => {
      const ext = (a.extracted_data as any) || {};
      return [
        ext.name || "Unknown",
        ext.email || "",
        ext.phone || "",
        a.match_score ?? "",
        a.match_category || "pending",
        new Date(a.created_at).toLocaleDateString(),
        Math.round((a.total_time_seconds || 0) / 60),
        a.tab_switches || 0,
        (a.strengths || []).map((s: any) => typeof s === "string" ? s : s?.text || "").join("; "),
        (a.red_flags || []).map((r: any) => typeof r === "string" ? r : r?.text || "").join("; "),
      ];
    });

    const csvContent = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${job?.title || "applicants"}_export.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!job) return <div className="p-6 text-muted-foreground">Job not found</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/screening-jobs")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-foreground truncate">{job.title}</h1>
            <p className="text-sm text-muted-foreground">{job.company_name}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCSV} className="shrink-0">
          <Download className="h-4 w-4 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <Card><CardContent className="p-3 md:p-4 text-center">
          <Users className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-xl md:text-2xl font-bold text-foreground">{counts.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </CardContent></Card>
        <Card className="border-emerald-500/30"><CardContent className="p-3 md:p-4 text-center">
          <CheckCircle2 className="h-5 w-5 mx-auto text-emerald-400 mb-1" />
          <p className="text-xl md:text-2xl font-bold text-emerald-400">{counts.strong}</p>
          <p className="text-xs text-muted-foreground">Strong</p>
        </CardContent></Card>
        <Card className="border-amber-500/30"><CardContent className="p-3 md:p-4 text-center">
          <AlertTriangle className="h-5 w-5 mx-auto text-amber-400 mb-1" />
          <p className="text-xl md:text-2xl font-bold text-amber-400">{counts.good}</p>
          <p className="text-xs text-muted-foreground">Good</p>
        </CardContent></Card>
        <Card className="border-destructive/30"><CardContent className="p-3 md:p-4 text-center">
          <XCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
          <p className="text-xl md:text-2xl font-bold text-destructive">{counts.not_qualified}</p>
          <p className="text-xs text-muted-foreground">Not Qualified</p>
        </CardContent></Card>
      </div>

      {/* Filters + Search + Sort */}
      <div className="space-y-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="w-max md:w-full md:grid md:grid-cols-5">
              <TabsTrigger value="all" className="text-xs md:text-sm">All ({counts.total})</TabsTrigger>
              <TabsTrigger value="strong_fit" className="text-xs md:text-sm">Strong ({counts.strong})</TabsTrigger>
              <TabsTrigger value="good_fit" className="text-xs md:text-sm">Good ({counts.good})</TabsTrigger>
              <TabsTrigger value="maybe" className="text-xs md:text-sm">Maybe ({counts.maybe})</TabsTrigger>
              <TabsTrigger value="not_qualified" className="text-xs md:text-sm whitespace-nowrap">Not Qualified ({counts.not_qualified})</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or email..."
              className="pl-9"
            />
          </div>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <ArrowUpDown className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score_desc">Score: High → Low</SelectItem>
              <SelectItem value="score_asc">Score: Low → High</SelectItem>
              <SelectItem value="date_desc">Newest First</SelectItem>
              <SelectItem value="date_asc">Oldest First</SelectItem>
              <SelectItem value="name_asc">Name: A → Z</SelectItem>
              <SelectItem value="name_desc">Name: Z → A</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {searchQuery ? `No applicants matching "${searchQuery}"` : "No applicants in this category."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(app => (
            <ApplicantCard key={app.id} application={app} onViewDetails={() => setSelectedApp(app)} />
          ))}
        </div>
      )}

      {selectedApp && (
        <ApplicantDetailModal
          application={selectedApp}
          job={job}
          open={!!selectedApp}
          onOpenChange={open => { if (!open) setSelectedApp(null); }}
          onUpdate={() => { fetchData(); setSelectedApp(null); }}
        />
      )}
    </div>
  );
};

export default JobApplicants;
