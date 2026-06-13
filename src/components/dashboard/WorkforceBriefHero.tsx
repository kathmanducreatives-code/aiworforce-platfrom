import { useNavigate } from "react-router-dom";
import { Inbox, Radar, Workflow, Moon, Sun } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import NotificationCenter from "@/components/shared/NotificationCenter";

interface Props {
  signals: number;
  drafts: number;
  approvals: number;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function sendChat(text: string) {
  window.dispatchEvent(new CustomEvent("chat:send", { detail: { text } }));
}

export default function WorkforceBriefHero({ signals, drafts, approvals }: Props) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const firstName = profile?.full_name?.split(" ")[0] || "there";

  const hasActivity = signals + drafts + approvals > 0;
  const brief = hasActivity
    ? `Your AI workforce surfaced ${signals} signal${signals === 1 ? "" : "s"}, prepared ${drafts} draft${drafts === 1 ? "" : "s"}, and needs approval on ${approvals} item${approvals === 1 ? "" : "s"}.`
    : "Your AI workforce is ready. Start by finding signals or completing Company Brain.";

  return (
    <div className="mb-6 rounded-2xl border border-border bg-gradient-to-br from-card/80 via-card/50 to-card/30 p-6 lg:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            {profile?.logo_url && (
              <img src={profile.logo_url} alt="Logo" className="h-8 w-auto opacity-90" />
            )}
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">
              Today's AI Workforce Brief
            </span>
          </div>
          <h1 className="text-[26px] lg:text-[30px] font-semibold text-foreground tracking-tight leading-tight">
            {greeting()}, {firstName}
          </h1>
          <p className="text-[14px] text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            {brief}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-full border border-border-subtle hover:border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <NotificationCenter />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => navigate("/awaiting-you")}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Inbox className="h-4 w-4" />
          Review approvals
          {approvals > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-md bg-primary-foreground/20 text-[11px] font-bold">
              {approvals}
            </span>
          )}
        </button>
        <button
          onClick={() => navigate("/signals")}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm font-semibold hover:bg-muted/50 transition-colors"
        >
          <Radar className="h-4 w-4 text-primary" />
          Open Signal Feed
        </button>
        <button
          onClick={() => sendChat("Run my weekly growth workflow.")}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm font-semibold hover:bg-muted/50 transition-colors"
        >
          <Workflow className="h-4 w-4 text-primary" />
          Run growth workflow
        </button>
      </div>
    </div>
  );
}
