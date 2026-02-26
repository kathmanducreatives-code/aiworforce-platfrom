import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Flame, Users, BarChart3 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import EmptyState from "@/components/shared/EmptyState";
import GrowthFilters from "@/components/growth/GrowthFilters";
import GrowthSignalTable from "@/components/growth/GrowthSignalTable";
import AgencyCostCalculator from "@/components/growth/AgencyCostCalculator";

const GrowthSignals = () => {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [industry, setIndustry] = useState("all");
  const [fundingStage, setFundingStage] = useState("all");
  const [scoreRange, setScoreRange] = useState([0]);
  const [hiringMin, setHiringMin] = useState("0");

  const fetchCompanies = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("growth_signal_companies" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("growth_score", { ascending: false });

    if (!error && data) {
      setCompanies(data as any[]);
    } else {
      setCompanies([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCompanies(); }, [user]);

  const filtered = useMemo(() => {
    return companies.filter(c => {
      if (industry !== "all" && c.industry !== industry) return false;
      if (fundingStage !== "all" && c.funding_round !== fundingStage) return false;
      if (c.growth_score < scoreRange[0]) return false;
      if (c.open_roles_count < parseInt(hiringMin)) return false;
      return true;
    });
  }, [companies, industry, fundingStage, scoreRange, hiringMin]);

  const stats = {
    total: companies.length,
    hotLeads: companies.filter(c => c.is_hot_lead).length,
    avgScore: companies.length > 0 ? Math.round(companies.reduce((a, c) => a + c.growth_score, 0) / companies.length) : 0,
    totalRoles: companies.reduce((a, c) => a + c.open_roles_count, 0),
  };

  return (
    <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 space-y-6">
      <PageHeader
        title="Growth Signals"
        subtitle="Hiring + funding intelligence for lead discovery"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Growth Signals' }]}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Companies" value={stats.total} icon={<Users className="h-4 w-4 text-blue-500" />} />
        <MetricCard label="Hot Leads" value={stats.hotLeads} icon={<Flame className="h-4 w-4 text-orange-500" />} />
        <MetricCard label="Avg Score" value={stats.avgScore} icon={<BarChart3 className="h-4 w-4 text-primary" />} />
        <MetricCard label="Total Roles" value={stats.totalRoles.toLocaleString()} icon={<TrendingUp className="h-4 w-4 text-emerald-500" />} />
      </div>

      {/* Filters */}
      <GrowthFilters
        industry={industry} setIndustry={setIndustry}
        fundingStage={fundingStage} setFundingStage={setFundingStage}
        scoreRange={scoreRange} setScoreRange={setScoreRange}
        hiringMin={hiringMin} setHiringMin={setHiringMin}
      />

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : companies.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="h-12 w-12" />}
          title="No growth signals yet"
          description="Growth signal data will appear here once companies are tracked. Integrate a data source or add companies manually to start discovering high-growth leads."
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-12 text-center">
          <TrendingUp className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="font-semibold text-lg">No matching companies</h3>
          <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters to see more results.</p>
        </div>
      ) : (
        <GrowthSignalTable companies={filtered} />
      )}

      {/* Agency Cost Calculator */}
      <AgencyCostCalculator />
    </div>
  );
};

export default GrowthSignals;
