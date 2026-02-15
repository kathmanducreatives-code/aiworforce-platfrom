import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Users, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import ApplicantCard from "@/components/screening/ApplicantCard";
import ApplicantDetailModal from "@/components/screening/ApplicantDetailModal";

const JobApplicants = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  const filtered = filter === "all" ? applications : applications.filter(a => a.match_category === filter);
  const counts = {
    total: applications.length,
    strong: applications.filter(a => a.match_category === "strong_fit").length,
    good: applications.filter(a => a.match_category === "good_fit").length,
    maybe: applications.filter(a => a.match_category === "maybe").length,
    not_qualified: applications.filter(a => a.match_category === "not_qualified").length,
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!job) return <div className="p-6 text-muted-foreground">Job not found</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/screening-jobs")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-bold text-foreground truncate">{job.title}</h1>
          <p className="text-sm text-muted-foreground">{job.company_name}</p>
        </div>
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

      {/* Filters */}
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

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">No applicants in this category.</p>
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
