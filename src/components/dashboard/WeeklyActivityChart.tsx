import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Mail, MessageSquare, Calendar, UserPlus } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { ChartConfig, ChartContainer } from "@/components/ui/chart";

interface ActivityData {
  day: string;
  candidates: number;
  interviews: number;
  emails: number;
}

interface RecentActivity {
  id: string;
  type: "email" | "interview" | "candidate" | "reply";
  title: string;
  subtitle: string;
  time: string;
  badge?: string;
  badgeColor?: string;
}

const chartConfig = {
  candidates: {
    label: "Candidates",
    color: "hsl(var(--primary))",
  },
  interviews: {
    label: "Interviews",
    color: "hsl(var(--chart-4))",
  },
  emails: {
    label: "Emails",
    color: "hsl(160, 60%, 60%)",
  },
} satisfies ChartConfig;

const WeeklyActivityChart = () => {
  const [activityData, setActivityData] = useState<ActivityData[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivityData();
  }, []);

  const fetchActivityData = async () => {
    try {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const today = new Date();
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = subDays(today, -mondayOffset);

      // Fetch data for each day of the week
      const weekData: ActivityData[] = [];
      const activities: RecentActivity[] = [];

      for (let i = 0; i < 7; i++) {
        const currentDay = subDays(monday, -i);
        const dayStart = startOfDay(currentDay);
        const dayEnd = endOfDay(currentDay);

        // Fetch candidates for this day
        const { data: candidates } = await supabase
          .from("resume_analyses")
          .select("id, candidate_name, created_at")
          .gte("created_at", dayStart.toISOString())
          .lte("created_at", dayEnd.toISOString());

        // Fetch interviews for this day
        const { data: interviews } = await supabase
          .from("interviews")
          .select("id, candidate_name, scheduled_at")
          .gte("scheduled_at", dayStart.toISOString())
          .lte("scheduled_at", dayEnd.toISOString());

        // Fetch emails for this day
        const { data: emails } = await supabase
          .from("scheduled_emails")
          .select("id, candidate_name, send_time_utc")
          .gte("send_time_utc", dayStart.toISOString())
          .lte("send_time_utc", dayEnd.toISOString());

        weekData.push({
          day: days[i],
          candidates: candidates?.length || 0,
          interviews: interviews?.length || 0,
          emails: emails?.length || 0,
        });

        // Add to recent activity (only for today and recent days)
        if (i >= Math.max(0, 6 - 3)) {
          candidates?.forEach((c) => {
            activities.push({
              id: c.id,
              type: "candidate",
              title: `New candidate added`,
              subtitle: c.candidate_name,
              time: format(new Date(c.created_at), "h:mm a"),
            });
          });

          interviews?.forEach((interview) => {
            activities.push({
              id: interview.id,
              type: "interview",
              title: `Interview scheduled`,
              subtitle: interview.candidate_name,
              time: format(new Date(interview.scheduled_at), "h:mm a"),
            });
          });

          emails?.forEach((email) => {
            activities.push({
              id: email.id,
              type: "email",
              title: `Email scheduled`,
              subtitle: email.candidate_name,
              time: format(new Date(email.send_time_utc), "h:mm a"),
            });
          });
        }
      }

      setActivityData(weekData);
      setRecentActivity(activities.slice(0, 4));
    } catch (error) {
      console.error("Error fetching activity data:", error);
      // Set fallback data
      setActivityData([
        { day: "Mon", candidates: 0, interviews: 0, emails: 0 },
        { day: "Tue", candidates: 0, interviews: 0, emails: 0 },
        { day: "Wed", candidates: 0, interviews: 0, emails: 0 },
        { day: "Thu", candidates: 0, interviews: 0, emails: 0 },
        { day: "Fri", candidates: 0, interviews: 0, emails: 0 },
        { day: "Sat", candidates: 0, interviews: 0, emails: 0 },
        { day: "Sun", candidates: 0, interviews: 0, emails: 0 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "email":
        return <Mail className="h-4 w-4" />;
      case "interview":
        return <Calendar className="h-4 w-4" />;
      case "candidate":
        return <UserPlus className="h-4 w-4" />;
      case "reply":
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <Mail className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 px-4 sm:px-0">
        <Card className="lg:col-span-2 p-6 bg-card/50 backdrop-blur-sm border-border/30">
          <div className="animate-pulse h-64 bg-muted/20 rounded-lg"></div>
        </Card>
        <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/30">
          <div className="animate-pulse h-64 bg-muted/20 rounded-lg"></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 px-4 sm:px-0 animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
      {/* Weekly Activity Chart */}
      <Card className="lg:col-span-2 p-4 sm:p-6 bg-card/50 backdrop-blur-sm border-border/30 hover:border-primary/50 transition-all duration-300">
        <CardHeader className="px-0 pt-0 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Weekly Activity</CardTitle>
              <p className="text-sm text-muted-foreground">Candidates, interviews, and emails</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>
                <span className="text-muted-foreground">Candidates</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "hsl(280, 60%, 60%)" }}></div>
                <span className="text-muted-foreground">Interviews</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "hsl(160, 60%, 60%)" }}></div>
                <span className="text-muted-foreground">Emails</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <ChartContainer config={chartConfig} className="h-[200px] sm:h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="candidatesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="interviewsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(280, 60%, 60%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(280, 60%, 60%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="emailsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(160, 60%, 60%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(160, 60%, 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
                <XAxis 
                  dataKey="day" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Area
                  type="monotone"
                  dataKey="candidates"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#candidatesGradient)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="interviews"
                  stroke="hsl(280, 60%, 60%)"
                  strokeWidth={2}
                  fill="url(#interviewsGradient)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="emails"
                  stroke="hsl(160, 60%, 60%)"
                  strokeWidth={2}
                  fill="url(#emailsGradient)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card className="p-4 sm:p-6 bg-card/50 backdrop-blur-sm border-border/30 hover:border-primary/50 transition-all duration-300">
        <CardHeader className="px-0 pt-0 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-foreground">Recent Activity</CardTitle>
            <button className="text-xs text-primary hover:text-primary/80 transition-colors">
              View all
            </button>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0 space-y-4">
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No recent activity</p>
          ) : (
            recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg border border-primary/20 text-primary">
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {activity.title}
                    {activity.badge && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${activity.badgeColor || 'bg-primary/20 text-primary'}`}>
                        {activity.badge}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{activity.subtitle}</p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{activity.time}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WeeklyActivityChart;
