import { useEffect, useState } from "react";
import { Users, Clock, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
}

const StatCard = ({ icon, label, value, suffix }: StatCardProps) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 800;
    const increment = end / (duration / 16);

    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setDisplayValue(end);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm p-4 lg:p-5 hover:border-primary/30 hover:shadow-md transition-all duration-200 group">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs lg:text-sm text-muted-foreground font-medium truncate">{label}</p>
          <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold mt-1 text-foreground tabular-nums">
            {displayValue.toLocaleString()}{suffix}
          </h3>
        </div>
        <div className="h-9 w-9 sm:h-10 sm:w-10 lg:h-12 lg:w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
          {icon}
        </div>
      </div>
    </div>
  );
};

export const StatsCards = () => {
  const [totalLeads, setTotalLeads] = useState(0);
  const [recentScrapes, setRecentScrapes] = useState(0);
  const [successRate, setSuccessRate] = useState(0);

  const fetchStats = async () => {
    // Estimated count: uses Postgres pg_class stats (sub-millisecond, no scan).
    const { count: leadsCount } = await supabase
      .from("linkedin_leads")
      .select("*", { count: "estimated", head: true });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count: sessionsCount } = await supabase
      .from("scraping_sessions")
      .select("*", { count: "estimated", head: true })
      .gte("created_at", sevenDaysAgo.toISOString());

    // Success rate: two head-only count queries instead of full table scan.
    const [{ count: completedCount }, { count: totalCount }] = await Promise.all([
      supabase
        .from("scraping_sessions")
        .select("*", { count: "estimated", head: true })
        .eq("status", "completed"),
      supabase
        .from("scraping_sessions")
        .select("*", { count: "estimated", head: true }),
    ]);

    const rate = totalCount && totalCount > 0
      ? Math.round(((completedCount || 0) / totalCount) * 100)
      : 0;

    setTotalLeads(leadsCount || 0);
    setRecentScrapes(sessionsCount || 0);
    setSuccessRate(rate);
  };

  const debouncedFetch = useDebouncedCallback(fetchStats, 500);

  useEffect(() => {
    fetchStats();

    // Realtime: refetch only on INSERT (debounced) — coalesces burst writes.
    const channel = supabase
      .channel("stats-updates")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "linkedin_leads" },
        () => debouncedFetch(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scraping_sessions" },
        () => debouncedFetch(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [debouncedFetch]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
      <StatCard
        icon={<Users className="w-4 h-4 lg:w-5 lg:h-5 text-primary" />}
        label="Total Leads"
        value={totalLeads}
      />
      <StatCard
        icon={<Clock className="w-4 h-4 lg:w-5 lg:h-5 text-primary" />}
        label="Recent Scrapes"
        value={recentScrapes}
      />
      <StatCard
        icon={<TrendingUp className="w-4 h-4 lg:w-5 lg:h-5 text-primary" />}
        label="Success Rate"
        value={successRate}
        suffix="%"
      />
    </div>
  );
};
