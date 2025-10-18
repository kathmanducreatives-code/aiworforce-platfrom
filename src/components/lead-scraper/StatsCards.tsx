import { useEffect, useState } from "react";
import { Users, Clock, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  gradient: string;
}

const StatCard = ({ icon, label, value, gradient }: StatCardProps) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1000;
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
    <Card className="relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
      <div className={`absolute inset-0 opacity-5 ${gradient}`} />
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground font-medium">{label}</p>
            <h3 className="text-3xl font-bold mt-2 bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-transparent">
              {displayValue.toLocaleString()}
            </h3>
          </div>
          <div className={`p-3 rounded-xl ${gradient}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <StatCard
        icon={<Users className="w-6 h-6 text-white" />}
        label="Total Leads"
        value={totalLeads}
        gradient="bg-gradient-to-br from-primary to-cyan-500"
      />
      <StatCard
        icon={<Clock className="w-6 h-6 text-white" />}
        label="Recent Scrapes"
        value={recentScrapes}
        gradient="bg-gradient-to-br from-purple-500 to-pink-500"
      />
      <StatCard
        icon={<TrendingUp className="w-6 h-6 text-white" />}
        label="Success Rate"
        value={successRate}
        gradient="bg-gradient-to-br from-emerald-500 to-teal-500"
      />
    </div>
  );
};
