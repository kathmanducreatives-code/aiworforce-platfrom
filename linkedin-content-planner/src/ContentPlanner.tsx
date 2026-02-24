import { useState, useEffect, useCallback } from "react";
import {
    Calendar,
    Sparkles,
    Loader2,
    RefreshCw,
    Send,
    Linkedin,
    ChevronRight,
    Upload,
    BookOpen,
    BarChart2,
    Film,
    Zap,
    MessageSquare,
    Flame,
    LayoutGrid,
    List
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "./lib/supabase";
import DayCard from "./components/DayCard";
import StatCard from "./components/StatCard";
import GeminiChat from "./components/GeminiChat";
import type { DayPlan, VideoIdea } from "./types";

const WEBHOOK_GENERATE_MONTHLY = "https://n8n.prasidha.me/webhook/content-generate-monthly";
const WEBHOOK_SCHEDULE = import.meta.env.VITE_N8N_CONTENT_SCHEDULE_WEBHOOK || "https://n8n.prasidha.me/webhook/schedule-linkedin";

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

const MonthlyOverviewGrid = ({ plan }: { plan: DayPlan[] }) => (
    <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(10, 1fr)",
        gap: "6px", marginBottom: "24px",
        background: "#141414", borderRadius: "16px",
        border: "1px solid #2a2a2a", padding: "16px",
    }}>
        {plan.map((day, i) => {
            const format = day.contentFormat || "Hot Take";
            const hero = HERO_FORMAT[format] || HERO_FORMAT["Hot Take"];
            const isScheduled = day.status === "Posted";
            const dotColor = isScheduled ? "#00e5a0" : (day.postCaption ? "#f59e0b" : "#333");
            return (
                <div key={day.id} style={{
                    aspectRatio: "1/1",
                    background: isScheduled ? "rgba(0,229,160,0.05)" : "#1a1a1a",
                    border: `1px solid ${isScheduled ? "#00e5a033" : "#2a2a2a"}`,
                    borderRadius: "8px",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: "4px", position: "relative",
                    transition: "all 0.2s"
                }}>
                    <span style={{ fontSize: "9px", fontWeight: 700, color: "#555" }}>{i + 1}</span>
                    <hero.icon size={12} color={hero.color} />
                    <div style={{
                        position: "absolute", bottom: "4px", right: "4px",
                        width: "5px", height: "5px", borderRadius: "50%",
                        background: dotColor,
                    }} />
                </div>
            );
        })}
    </div>
);

const ContentPlanner = () => {
    const [campaignGoal, setCampaignGoal] = useState("");
    const [plan, setPlan] = useState<DayPlan[]>([]);
    const [generating, setGenerating] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [scheduling, setScheduling] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

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
                    supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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
                        media: p.mediaBase64,
                        mediaType: p.mediaType,
                        format: p.contentFormat
                    })),
                    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
                    supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
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
        <div style={{ minHeight: "100vh", background: "#0d0d0d" }}>
            <header style={{
                position: "sticky", top: 0, zIndex: 30,
                background: "rgba(13,13,13,0.92)",
                backdropFilter: "blur(16px)",
                borderBottom: "1px solid #1e1e1e",
                padding: "0 24px", height: "64px",
                display: "flex", alignItems: "center", gap: "14px",
            }}>
                <div style={{
                    width: "40px", height: "40px", borderRadius: "12px",
                    background: "linear-gradient(135deg, #a855f7, #7c3aed)",
                    display: "flex", alignItems: "center", justifyContent: "center"
                }}>
                    <Calendar size={20} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                    <h1 style={{ fontSize: "17px", fontWeight: 700, color: "#fff" }}>Monthly Content Commander</h1>
                    <p style={{ fontSize: "11px", color: "#555" }}>30-Day Automated Pipeline</p>
                </div>
            </header>

            <main style={{ maxWidth: "1600px", margin: "0 auto", padding: "28px 24px" }}>
                <section style={{
                    background: "#141414", border: "1px solid #2a2a2a", borderRadius: "20px",
                    padding: "24px", marginBottom: "32px"
                }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: 700, color: "#a855f7", textTransform: "uppercase", marginBottom: "12px" }}>
                        <Sparkles size={14} /> Global Monthly Strategy
                    </label>
                    <textarea
                        value={campaignGoal}
                        onChange={(e) => setCampaignGoal(e.target.value)}
                        placeholder="Define your 30-day empire goal..."
                        style={{
                            width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a",
                            borderRadius: "12px", padding: "16px", color: "#fff", fontSize: "14px",
                            outline: "none", resize: "none"
                        }}
                        rows={3}
                    />
                    <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
                        <button
                            onClick={handleGenerateMonthly}
                            disabled={generating}
                            style={{
                                background: "linear-gradient(135deg, #a855f7, #7c3aed)",
                                color: "#fff", border: "none", padding: "12px 24px",
                                borderRadius: "10px", fontWeight: 700, cursor: "pointer"
                            }}>
                            {generating ? "Initializing Strategy..." : "Generate 30-Day Plan"}
                        </button>
                        <button
                            onClick={handleScheduleAll}
                            disabled={scheduling}
                            style={{
                                background: "linear-gradient(135deg, #00e5a0, #00c08b)",
                                color: "#000", border: "none", padding: "12px 24px",
                                borderRadius: "10px", fontWeight: 700, cursor: "pointer"
                            }}>
                            {scheduling ? "Scheduling..." : "Bulk Schedule Plan"}
                        </button>
                        <button
                            onClick={fetchPlan}
                            style={{ background: "#222", color: "#888", border: "1px solid #333", padding: "12px 20px", borderRadius: "10px", cursor: "pointer" }}>
                            <RefreshCw size={16} className={fetching ? "animate-spin" : ""} />
                        </button>
                    </div>
                </section>

                <MonthlyOverviewGrid plan={plan} />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "32px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "20px" }}>
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
                            />
                        ))}
                    </div>
                    <div style={{ position: "sticky", top: "88px", height: "calc(100vh - 120px)" }}>
                        <GeminiChat />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ContentPlanner;
