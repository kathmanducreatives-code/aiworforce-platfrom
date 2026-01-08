import { useEffect, useState } from "react";
import { Users, Clock, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

  useEffect(() => {
    const fetchStats = async () => {
      // Fetch total leads
      const { count: leadsCount } = await supabase
        .from("linkedin_leads")
        .select("*", { count: "exact", head: true });
      
      // Fetch recent scrapes (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { count: sessionsCount } = await supabase
        .from("scraping_sessions")
        .select("*", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo.toISOString());
      
      // Fetch success rate
      const { data: sessions } = await supabase
        .from("scraping_sessions")
        .select("status");
      
      const completed = sessions?.filter(s => s.status === "completed").length || 0;
      const total = sessions?.length || 1;
      const rate = Math.round((completed / total) * 100);

      setTotalLeads(leadsCount || 0);
      setRecentScrapes(sessionsCount || 0);
      setSuccessRate(rate);
    };

    fetchStats();

    // Set up realtime subscription for updates
    const channel = supabase
      .channel("stats-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "linkedin_leads" },
        () => fetchStats()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scraping_sessions" },
        () => fetchStats()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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