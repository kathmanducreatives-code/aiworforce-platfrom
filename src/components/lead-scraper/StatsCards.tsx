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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <h3 className="text-3xl font-bold mt-1.5 text-foreground">
            {displayValue.toLocaleString()}{suffix}
          </h3>
        </div>
        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
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
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <StatCard
        icon={<Users className="w-5 h-5 text-primary" />}
        label="Total Leads"
        value={totalLeads}
      />
      <StatCard
        icon={<Clock className="w-5 h-5 text-primary" />}
        label="Recent Scrapes"
        value={recentScrapes}
      />
      <StatCard
        icon={<TrendingUp className="w-5 h-5 text-primary" />}
        label="Success Rate"
        value={successRate}
        suffix="%"
      />
    </div>
  );
};