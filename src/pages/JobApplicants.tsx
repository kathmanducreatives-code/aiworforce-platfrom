import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, CheckCircle2, AlertTriangle, XCircle, Download, Briefcase } from "lucide-react";
import ApplicantCard from "@/components/screening/ApplicantCard";
import ApplicantDetailModal from "@/components/screening/ApplicantDetailModal";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import FilterBar from "@/components/shared/FilterBar";
import EmptyState from "@/components/shared/EmptyState";
import SkeletonCard from "@/components/shared/SkeletonCard";
import StatusBadge from "@/components/shared/StatusBadge";

type SortKey = "score_desc" | "score_asc" | "date_desc" | "date_asc" | "name_asc" | "name_desc";

const sortOptions = [
  { label: "Score: High → Low", value: "score_desc" },
  { label: "Score: Low → High", value: "score_asc" },
  { label: "Newest First", value: "date_desc" },
  { label: "Oldest First", value: "date_asc" },
  { label: "Name: A → Z", value: "name_asc" },
  { label: "Name: Z → A", value: "name_desc" },
];

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
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => {
        const name = ((a.extracted_data as any)?.name || "").toLowerCase();
        const email = ((a.extracted_data as any)?.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }
    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case "score_desc": return (b.match_score ?? -1) - (a.match_score ?? -1);
        case "score_asc": return (a.match_score ?? -1) - (b.match_score ?? -1);
        case "date_desc": return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "date_asc": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name_asc": return ((a.extracted_data as any)?.name || "").localeCompare((b.extracted_data as any)?.name || "");
        case "name_desc": return ((b.extracted_data as any)?.name || "").localeCompare((a.extracted_data as any)?.name || "");
        default: return 0;
      }
    });
    return result;
  }, [applications, filter, searchQuery, sortKey]);

  const handleExportCSV = () => {
    if (applications.length === 0) { toast.info("No applicants to export"); return; }
    const headers = ["Name", "Email", "Phone", "Score", "Category", "Applied Date", "Time (min)", "Tab Switches", "Strengths", "Red Flags"];
    const rows = applications.map(a => {
      const ext = (a.extracted_data as any) || {};
      return [
        ext.name || "Unknown", ext.email || "", ext.phone || "",
        a.match_score ?? "", a.match_category || "pending",
        new Date(a.created_at).toLocaleDateString(),
        Math.round((a.total_time_seconds || 0) / 60), a.tab_switches || 0,
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

  if (loading) return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      <SkeletonCard variant="metric" count={4} className="grid grid-cols-2 md:grid-cols-4 gap-4" />
      <SkeletonCard variant="card" count={6} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" />
    </div>
  );

  if (!job) return <div className="p-6 text-muted-foreground">Job not found</div>;

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <PageHeader
        title={job.title}
        subtitle={job.company_name}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Job Screening', href: '/screening-jobs' },
          { label: job.title },
        ]}
        primaryAction={{
          label: 'Export CSV',
          onClick: handleExportCSV,
          icon: <Download className="h-4 w-4" />,
        }}
      >
        <StatusBadge status={job.status === 'active' ? 'active' : 'paused'} />
      </PageHeader>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total" value={counts.total} icon={<Users className="h-4 w-4 text-blue-500" />} />
        <MetricCard label="Strong Fit" value={counts.strong} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} />
        <MetricCard label="Good Fit" value={counts.good} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} />
        <MetricCard label="Not Qualified" value={counts.not_qualified} icon={<XCircle className="h-4 w-4 text-red-500" />} />
      </div>

      {/* Filter Tabs */}
      <Tabs value={filter} onValueChange={setFilter}>
        <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <TabsList className="w-max md:w-full md:grid md:grid-cols-5 bg-card/60 border border-border p-1 rounded-lg">
            <TabsTrigger value="all" className="text-xs md:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">All ({counts.total})</TabsTrigger>
            <TabsTrigger value="strong_fit" className="text-xs md:text-sm data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-600">Strong ({counts.strong})</TabsTrigger>
            <TabsTrigger value="good_fit" className="text-xs md:text-sm data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-600">Good ({counts.good})</TabsTrigger>
            <TabsTrigger value="maybe" className="text-xs md:text-sm">Maybe ({counts.maybe})</TabsTrigger>
            <TabsTrigger value="not_qualified" className="text-xs md:text-sm data-[state=active]:bg-red-500/15 data-[state=active]:text-red-600">Not Fit ({counts.not_qualified})</TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {/* Search + Sort */}
      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by name or email..."
        sortOptions={sortOptions}
        currentSort={sortKey}
        onSortChange={(v) => setSortKey(v as SortKey)}
      />

      {/* Applicant Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7 text-muted-foreground/60" />}
          title={searchQuery ? `No results for "${searchQuery}"` : "No applicants in this category"}
          description="Try adjusting your filters or search query."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((app, index) => (
            <div key={app.id} className="animate-in fade-in-0 slide-in-from-bottom-2" style={{ animationDelay: `${index * 40}ms` }}>
              <ApplicantCard application={app} onViewDetails={() => setSelectedApp(app)} />
            </div>
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
