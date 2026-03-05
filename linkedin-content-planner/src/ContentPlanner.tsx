import { useState, useEffect, useCallback } from "react";
import {
    Calendar,
    Sparkles,
    RefreshCw,
    BookOpen,
    BarChart2,
    Film,
    Zap,
    MessageSquare,
    Flame,
    Clock,
    TrendingUp,
    Rocket,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "./lib/supabase";
import DayCard from "./components/DayCard";
import GeminiChat from "./components/GeminiChat";
import { generateSmartSchedule, getEngagementScore, getTimingInsight } from "./lib/postingEngine";
import type { DayPlan, VideoIdea } from "./types";
import { Card, CardHeader } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { PageHeader } from "./components/ui/PageHeader";

const WEBHOOK_GENERATE_MONTHLY = import.meta.env.VITE_N8N_CONTENT_GENERATE_MONTHLY_WEBHOOK;
const WEBHOOK_SCHEDULE = import.meta.env.VITE_N8N_CONTENT_SCHEDULE_WEBHOOK;

export const HERO_FORMAT: Record<string, { label: string; color: string; icon: any }> = {
    "Comic Strip": { label: "Comic Strip", color: "#7c3aed", icon: BookOpen },
    "Data Visual": { label: "Data Visual", color: "#f97316", icon: BarChart2 },
    "Carousel": { label: "Carousel", color: "#00e5a0", icon: Zap },
    "Founder Story": { label: "Founder Story", color: "#3b82f6", icon: MessageSquare },
    "Short Video": { label: "Short Video", color: "#ef4444", icon: Film },
    "Hot Take": { label: "Hot Take", color: "#eab308", icon: Flame },
};

const parseVideoIdea = (raw: any): VideoIdea | null => {
    if (!raw) return null;
    if (typeof raw === "string") {
        return { concept: raw, hookLine: "", scriptOutline: "", closingCTA: "" };
    }
    return raw as VideoIdea;
};

/* ── Content Calendar with Engagement Scores ── */
const ContentCalendar = ({ plan }: { plan: DayPlan[] }) => {
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Group posts by week
    const weeks: DayPlan[][] = [];
    for (let i = 0; i < plan.length; i += 7) {
        weeks.push(plan.slice(i, Math.min(i + 7, plan.length)));
    }

    return (
        <Card className="mb-8">
            <CardHeader
                icon={<Calendar size={16} className="text-violet-400" />}
                title="Content Calendar"
                subtitle={
                    <span className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider">
                        <TrendingUp size={10} />
                        Engagement score shown per cell
                    </span>
                }
            />

            <div className="flex flex-col gap-1.5">
                {/* Week day headers */}
                <div className="grid grid-cols-7 gap-1.5 mb-1">
                    {weekDays.map(d => (
                        <div key={d} className={`
                            text-center text-[10px] font-bold uppercase tracking-widest
                            ${d === 'Tue' || d === 'Wed' || d === 'Thu' ? 'text-emerald-500' : 'text-slate-600'}
                        `}>
                            {d}
                        </div>
                    ))}
                </div>

                {/* Week rows */}
                {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1.5">
                        {week.map((day, di) => {
                            const globalIdx = wi * 7 + di;
                            const format = day.contentFormat || 'Hot Take';
                            const hero = HERO_FORMAT[format] || HERO_FORMAT['Hot Take'];
                            const isScheduled = day.status === 'Posted';
                            const hasContent = !!day.postCaption;
                            const hasDate = !!day.scheduledDate;

                            // Engagement score
                            let engScore = 5;
                            let engLabel = '';
                            if (hasDate) {
                                const dateObj = new Date(day.scheduledDate + 'T00:00:00');
                                const result = getEngagementScore(dateObj);
                                engScore = result.score;
                                engLabel = getTimingInsight(day.scheduledTime || '08:00', dateObj.getDay());
                            }

                            const scoreColorClass = engScore >= 8 ? 'text-emerald-400 bg-emerald-400/10' : engScore >= 6 ? 'text-amber-400 bg-amber-400/10' : 'text-red-400 bg-red-400/10';
                            const statusColor = isScheduled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : hasContent ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-slate-700';

                            return (
                                <div key={day.id} className={`
                                    aspect-square rounded-xl flex flex-col items-center justify-center gap-1 relative transition-all duration-200 group
                                    ${isScheduled ? 'bg-emerald-500/5 border-emerald-500/20' : hasContent ? 'bg-white/5 border-white/10' : 'bg-white/[0.02] border-white/[0.04]'}
                                    border hover:border-white/30 cursor-default
                                `}
                                    title={hasDate ? `${day.scheduledDate} at ${day.scheduledTime}\nScore: ${engScore}/10\n${engLabel}` : `Day ${globalIdx + 1}`}
                                >
                                    <span className="text-[10px] font-black text-slate-600 group-hover:text-slate-400 transition-colors uppercase">{globalIdx + 1}</span>
                                    <hero.icon size={14} style={{ color: hero.color }} className="drop-shadow-sm" />

                                    {/* Engagement score badge */}
                                    {hasDate && (
                                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${scoreColorClass}`}>
                                            {engScore}
                                        </span>
                                    )}

                                    {/* Status dot */}
                                    <div className={`absolute bottom-2 right-2 w-1.5 h-1.5 rounded-full ${statusColor}`} />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </Card>
    );
};

const ContentPlanner = () => {
    const [campaignGoal, setCampaignGoal] = useState("");
    const [plan, setPlan] = useState<DayPlan[]>([]);
    const [generating, setGenerating] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [scheduling, setScheduling] = useState(false);
    const [copiedId, _setCopiedId] = useState<string | null>(null);

    const fetchPlan = useCallback(async () => {
        try {
            setFetching(true);
            const { data, error } = await supabase
                .from('linkedin_posts')
                .select('*')
                .order('created_at', { ascending: true });

            if (error) throw error;

            if (data) {
                setPlan(data.map((row: any, i: number) => ({
                    id: row.id,
                    day: row.day,
                    contentFormat: row.content_format || "Hot Take",
                    postCaption: row.post_caption || "",
                    imagePrompt: row.image_prompt || "",
                    videoIdea: parseVideoIdea(row.video_idea),
                    carouselScript: [],
                    comicScript: null,
                    dataVisual: null,
                    hotTake: null,
                    poll: null,
                    status: (row.status === "Posted" ? "Posted" : "Planned") as "Planned" | "Posted",
                    rowIndex: i,
                    mediaBase64: null,
                    mediaName: null,
                    mediaType: null,
                    scheduledTime: row.scheduled_time || "08:00",
                    scheduledDate: row.scheduled_date || null,
                })));
            }
        } catch (err) {
            console.error("Fetch plan error:", err);
        } finally {
            setFetching(false);
        }
    }, []);

    useEffect(() => {
        fetchPlan();

        // REAL-TIME: Listen for updates to content
        const channel = supabase.channel('content-updates')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'linkedin_posts' }, (payload) => {
                toast.success(`Generated: ${payload.new.day} Content ✨`);
                fetchPlan();
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'linkedin_posts' }, () => {
                fetchPlan();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchPlan]);

    const handleGenerateMonthly = async () => {
        if (!campaignGoal.trim()) {
            toast.error("Enter a campaign goal first");
            return;
        }
        try {
            setGenerating(true);
            const res = await fetch(WEBHOOK_GENERATE_MONTHLY, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chatInput: campaignGoal,
                    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
                    supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                    workspaceDir: "/Users/prasidha/screeningpilot/screeningpilot/linkedin-content-planner"
                }),
            });
            if (!res.ok) throw new Error("Generation failed");
            toast.success("30-day strategy is being generated in the background...");
        } catch (err) {
            console.error("Generate error:", err);
            toast.error("Failed to trigger generation");
        } finally {
            setGenerating(false);
        }
    };

    const handleScheduleAll = async () => {
        const postsToSchedule = plan.filter(p => p.postCaption && p.status !== "Posted");

        if (postsToSchedule.length === 0) {
            toast.error("No new drafts to schedule!");
            return;
        }

        try {
            setScheduling(true);
            const loadingToast = toast.loading("Queuing posts for LinkedIn distribution...");

            const res = await fetch(WEBHOOK_SCHEDULE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    posts: postsToSchedule.map(p => ({
                        id: p.id,
                        caption: p.postCaption,
                        scheduledTime: p.scheduledTime,
                        scheduledDate: p.scheduledDate,
                        media: p.mediaBase64,
                        mediaType: p.mediaType,
                        format: p.contentFormat
                    })),
                    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
                    supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY
                }),
            });

            if (!res.ok) throw new Error("Scheduling failed");

            toast.dismiss(loadingToast);
            toast.success(`Successfully queued ${postsToSchedule.length} posts!`);
        } catch (err) {
            console.error("Scheduling error:", err);
            toast.error("Failed to connect to scheduler");
        } finally {
            setScheduling(false);
        }
    };

    const handleSmartSchedule = async () => {
        if (plan.length === 0) {
            toast.error("Generate a plan first!");
            return;
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const formats = plan.map(p => p.contentFormat || '');
        const slots = generateSmartSchedule(tomorrow, plan.length, formats, false);

        const newPlan = [...plan];
        const updates: Promise<any>[] = [];

        for (let i = 0; i < plan.length && i < slots.length; i++) {
            const slot = slots[i];
            newPlan[i] = {
                ...newPlan[i],
                scheduledDate: slot.date,
                scheduledTime: slot.time,
            };

            updates.push(
                (async () => {
                    await supabase.from('linkedin_posts').update({
                        scheduled_date: slot.date,
                        scheduled_time: slot.time,
                    }).eq('id', plan[i].id);
                })()
            );
        }

        setPlan(newPlan);

        // Batch update Supabase
        await Promise.all(updates);

        const avgScore = slots.reduce((acc, s) => acc + s.score, 0) / slots.length;
        toast.success(
            `⚡ Smart-scheduled ${plan.length} posts! Avg engagement score: ${avgScore.toFixed(1)}/10`,
            { duration: 5000 }
        );
    };

    const handleFileChange = (index: number, base64: string, name: string, type: "image" | "video") => {
        const newPlan = [...plan];
        newPlan[index] = { ...newPlan[index], mediaBase64: base64, mediaName: name, mediaType: type };
        setPlan(newPlan);
    };

    const handleRemoveFile = (index: number) => {
        const newPlan = [...plan];
        newPlan[index] = { ...newPlan[index], mediaBase64: null, mediaName: null, mediaType: null };
        setPlan(newPlan);
    };

    const handleStatusToggle = async (index: number) => {
        const post = plan[index];
        const newStatus = post.status === "Planned" ? "Posted" : "Planned";
        await supabase.from('linkedin_posts').update({ status: newStatus }).eq('id', post.id);
    };

    const handleDateChange = async (index: number, date: string) => {
        const post = plan[index];
        const newPlan = [...plan];
        newPlan[index] = { ...newPlan[index], scheduledDate: date };
        setPlan(newPlan);
        await supabase.from('linkedin_posts').update({ scheduled_date: date }).eq('id', post.id);
        toast.success(`Scheduled for ${date}`);
    };

    const handleTimeChange = async (index: number, time: string) => {
        const post = plan[index];
        const newPlan = [...plan];
        newPlan[index] = { ...post, scheduledTime: time };
        setPlan(newPlan);

        // Persist to Supabase if it exists in DB
        if (post.id) {
            await supabase
                .from('linkedin_posts')
                .update({ scheduled_time: time })
                .eq('id', post.id);
        }
    };

    return (
        <div className="flex flex-col flex-1 bg-[#0a0a0b] animate-fade-in overflow-hidden">
            <PageHeader
                title="Content Planner"
                subtitle="30-Day Automated Pipeline"
                badge="Premium"
                actions={
                    <Button variant="secondary" size="md" onClick={fetchPlan} loading={fetching}>
                        <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
                        <span className="ml-2">Sync</span>
                    </Button>
                }
            />

            <main className="flex-1 overflow-auto px-6 pb-8">
                <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pt-2">
                    {/* Strategy Section */}
                    <Card className="p-6 overflow-visible relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-violet-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                        <div className="flex items-center gap-2 mb-4">
                            <Sparkles size={16} className="text-violet-400" />
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-violet-400">Monthly Strategy</h3>
                        </div>

                        <textarea
                            value={campaignGoal}
                            onChange={(e) => setCampaignGoal(e.target.value)}
                            placeholder="Define your 30-day empire goal (e.g., Launching a new B2B AI tool, targeting CTOs with controversial takes)..."
                            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-500/50 focus:bg-white/[0.05] transition-all resize-none mb-6"
                            rows={3}
                        />

                        <div className="flex flex-wrap gap-3">
                            <Button
                                variant="primary"
                                size="lg"
                                onClick={handleGenerateMonthly}
                                loading={generating}
                                className="!bg-gradient-to-r !from-violet-600 !to-blue-600 !border-violet-400/20"
                            >
                                <Rocket size={16} className="mr-2" />
                                Initiate 30-Day Strategy
                            </Button>

                            <Button
                                variant="secondary"
                                onClick={handleSmartSchedule}
                                className="group hover:!border-amber-500/50 hover:!text-amber-400"
                            >
                                <Clock size={16} className="mr-2 group-hover:scale-110 transition-transform" />
                                Smart Schedule (Viral Times)
                            </Button>

                            <Button
                                variant="secondary"
                                onClick={handleScheduleAll}
                                loading={scheduling}
                                className="group hover:!border-emerald-500/50 hover:!text-emerald-400"
                            >
                                <RefreshCw size={16} className={`mr-2 ${scheduling ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
                                Push to LinkedIn
                            </Button>
                        </div>
                    </Card>

                    <ContentCalendar plan={plan} />

                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-8">
                        {/* Day Cards Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {plan.map((day, idx) => (
                                <DayCard
                                    key={day.id}
                                    day={day}
                                    dayShort={`Day ${idx + 1}`}
                                    index={idx}
                                    copiedId={copiedId}
                                    onStatusToggle={handleStatusToggle}
                                    onCopy={() => { }}
                                    onFileChange={handleFileChange}
                                    onRemoveFile={handleRemoveFile}
                                    onTimeChange={handleTimeChange}
                                    onDateChange={handleDateChange}
                                />
                            ))}
                        </div>

                        {/* Sidebar Chat */}
                        <div className="hidden xl:block">
                            <div className="sticky top-4 h-[calc(100vh-160px)]">
                                <GeminiChat />
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ContentPlanner;
