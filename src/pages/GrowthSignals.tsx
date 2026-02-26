import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Flame, Users, BarChart3 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import GrowthFilters from "@/components/growth/GrowthFilters";
import GrowthSignalTable from "@/components/growth/GrowthSignalTable";
import AgencyCostCalculator from "@/components/growth/AgencyCostCalculator";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Sample data generator for when no real data exists
const SAMPLE_COMPANIES = [
  { company_name: "Vercel", industry: "SaaS", funding_round: "Series D+", funding_amount: 250000000, funding_date: "2025-12-15", open_roles_count: 42, engineering_roles_count: 28, investors: ["Accel", "CRV", "GV"] },
  { company_name: "Linear", industry: "SaaS", funding_round: "Series B", funding_amount: 52000000, funding_date: "2026-01-10", open_roles_count: 18, engineering_roles_count: 12, investors: ["Sequoia", "01 Advisors"] },
  { company_name: "Replicate", industry: "AI/ML", funding_round: "Series B", funding_amount: 40000000, funding_date: "2026-01-22", open_roles_count: 15, engineering_roles_count: 11, investors: ["Andreessen Horowitz", "Y Combinator"] },
  { company_name: "Wiz", industry: "Cybersecurity", funding_round: "Series D+", funding_amount: 1000000000, funding_date: "2025-11-01", open_roles_count: 85, engineering_roles_count: 45, investors: ["Sequoia", "Index Ventures", "Insight Partners"] },
  { company_name: "Ramp", industry: "Fintech", funding_round: "Series C", funding_amount: 300000000, funding_date: "2025-12-05", open_roles_count: 60, engineering_roles_count: 30, investors: ["Founders Fund", "Stripe", "Goldman Sachs"] },
  { company_name: "Notion", industry: "SaaS", funding_round: "Series C", funding_amount: 275000000, funding_date: "2025-10-20", open_roles_count: 35, engineering_roles_count: 20, investors: ["Sequoia", "Index Ventures"] },
  { company_name: "Mistral AI", industry: "AI/ML", funding_round: "Series B", funding_amount: 468000000, funding_date: "2026-02-01", open_roles_count: 55, engineering_roles_count: 40, investors: ["Andreessen Horowitz", "Lightspeed"] },
  { company_name: "Vanta", industry: "Cybersecurity", funding_round: "Series C", funding_amount: 150000000, funding_date: "2025-11-15", open_roles_count: 28, engineering_roles_count: 16, investors: ["Sequoia", "Y Combinator"] },
  { company_name: "Deel", industry: "SaaS", funding_round: "Series D+", funding_amount: 680000000, funding_date: "2025-09-01", open_roles_count: 70, engineering_roles_count: 35, investors: ["Andreessen Horowitz", "Spark Capital"] },
  { company_name: "Cerebras", industry: "AI/ML", funding_round: "Series C", funding_amount: 250000000, funding_date: "2026-01-05", open_roles_count: 32, engineering_roles_count: 24, investors: ["Altimeter", "Benchmark"] },
  { company_name: "Brex", industry: "Fintech", funding_round: "Series D+", funding_amount: 300000000, funding_date: "2025-08-10", open_roles_count: 22, engineering_roles_count: 14, investors: ["Greenoaks", "Tiger Global"] },
  { company_name: "Airtable", industry: "SaaS", funding_round: "Series F", funding_amount: 735000000, funding_date: "2025-07-01", open_roles_count: 12, engineering_roles_count: 6, investors: ["Thrive Capital", "D1 Capital"] },
  { company_name: "Retool", industry: "SaaS", funding_round: "Series C", funding_amount: 152000000, funding_date: "2025-12-20", open_roles_count: 25, engineering_roles_count: 18, investors: ["Sequoia", "Stripe"] },
  { company_name: "Coursera", industry: "EdTech", funding_round: "Series F", funding_amount: 130000000, funding_date: "2025-06-15", open_roles_count: 8, engineering_roles_count: 3, investors: ["NEA", "Kleiner Perkins"] },
  { company_name: "Stripe", industry: "Fintech", funding_round: "Series I", funding_amount: 6500000000, funding_date: "2025-05-01", open_roles_count: 120, engineering_roles_count: 65, investors: ["Sequoia", "Andreessen Horowitz"] },
  { company_name: "Figma", industry: "SaaS", funding_round: "Series E", funding_amount: 200000000, funding_date: "2025-11-10", open_roles_count: 30, engineering_roles_count: 18, investors: ["Andreessen Horowitz", "Greylock"] },
  { company_name: "Snyk", industry: "Cybersecurity", funding_round: "Series G", funding_amount: 530000000, funding_date: "2025-04-01", open_roles_count: 4, engineering_roles_count: 2, investors: ["Addition", "Tiger Global"] },
  { company_name: "Loom", industry: "SaaS", funding_round: "Series C", funding_amount: 130000000, funding_date: "2025-10-01", open_roles_count: 10, engineering_roles_count: 5, investors: ["Andreessen Horowitz", "Sequoia"] },
  { company_name: "Canva", industry: "SaaS", funding_round: "Series F", funding_amount: 200000000, funding_date: "2026-02-10", open_roles_count: 50, engineering_roles_count: 30, investors: ["Blackbird Ventures", "Sequoia"] },
  { company_name: "Scale AI", industry: "AI/ML", funding_round: "Series E", funding_amount: 325000000, funding_date: "2025-12-01", open_roles_count: 45, engineering_roles_count: 30, investors: ["Tiger Global", "Greenoaks"] },
];

function computeScore(c: typeof SAMPLE_COMPANIES[0]): { growth_score: number; is_hot_lead: boolean } {
  let score = 0;
  const now = new Date();
  if (c.funding_date) {
    const fundDate = new Date(c.funding_date);
    const monthsAgo = (now.getTime() - fundDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsAgo <= 3) score += 40;
  }
  if (c.open_roles_count >= 5) score += 30;
  if (c.engineering_roles_count > 0) score += 20;
  if (c.industry === "SaaS") score += 10;
  return { growth_score: Math.min(score, 100), is_hot_lead: score > 70 };
}

const GrowthSignals = () => {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [industry, setIndustry] = useState("all");
  const [fundingStage, setFundingStage] = useState("all");
  const [scoreRange, setScoreRange] = useState([0]);
  const [hiringMin, setHiringMin] = useState("0");
  const [seeded, setSeeded] = useState(false);

  const fetchCompanies = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("growth_signal_companies" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("growth_score", { ascending: false });

    if (!error && data && (data as any[]).length > 0) {
      setCompanies(data as any[]);
    } else {
      // Use sample data locally (no DB insert needed for demo)
      const samples = SAMPLE_COMPANIES.map(c => {
        const { growth_score, is_hot_lead } = computeScore(c);
        return { ...c, id: crypto.randomUUID(), growth_score, is_hot_lead, user_id: user.id };
      });
      setCompanies(samples);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCompanies(); }, [user]);

  const seedToDb = async () => {
    if (!user || seeded) return;
    const records = SAMPLE_COMPANIES.map(c => {
      const { growth_score, is_hot_lead } = computeScore(c);
      return { ...c, growth_score, is_hot_lead, user_id: user.id };
    });
    await supabase.from("growth_signal_companies" as any).insert(records as any);
    setSeeded(true);
    toast.success("Sample data seeded to database!");
    fetchCompanies();
  };

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
        secondaryActions={!seeded && companies.length > 0 && !loading ? [{
          label: 'Save Sample Data',
          onClick: seedToDb,
        }] : []}
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
