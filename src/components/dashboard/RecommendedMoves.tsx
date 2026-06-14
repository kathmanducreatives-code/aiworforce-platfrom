import { useNavigate } from "react-router-dom";
import { Eye, Mail, PenLine, ListOrdered, Sparkles, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

function sendChat(text: string) {
  window.dispatchEvent(new CustomEvent("chat:send", { detail: { text } }));
}

interface Move {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  accent: string;
}

export default function RecommendedMoves({ brainIncomplete }: { brainIncomplete: boolean }) {
  const navigate = useNavigate();
  // When Company Brain is incomplete, content/outreach moves route to onboarding
  // instead of dispatching a chat prompt — agents need context to be useful.
  const gated = (text: string) =>
    brainIncomplete ? () => navigate("/onboarding/company-brain") : () => sendChat(text);

  const moves: Move[] = [
    {
      icon: <Eye className="h-4 w-4" />,
      title: "Find competitor conversations",
      subtitle: "Hawk surfaces fresh discussions across the web.",
      onClick: () => sendChat("Find 5 competitor conversations for my company."),
      accent: "text-blue-400 bg-blue-500/10",
    },
    {
      icon: <Mail className="h-4 w-4" />,
      title: "Draft outreach for hot leads",
      subtitle: brainIncomplete
        ? "Finish Company Brain so Penn knows your voice."
        : "Penn prepares personalized messages for your approval.",
      onClick: gated("Draft outreach for my highest-priority saved leads."),
      accent: "text-teal-400 bg-teal-500/10",
    },
    {
      icon: <PenLine className="h-4 w-4" />,
      title: "Create a founder post",
      subtitle: brainIncomplete
        ? "Finish Company Brain so Scribe writes in your voice."
        : "Scribe drafts a LinkedIn post in your voice.",
      onClick: gated("Write a founder LinkedIn post based on this week's activity."),
      accent: "text-violet-400 bg-violet-500/10",
    },
    {
      icon: <ListOrdered className="h-4 w-4" />,
      title: "Rank saved signals",
      subtitle: "Aria scores fit and urgency across your saved signals.",
      onClick: () => sendChat("Rank my saved signals by fit and urgency."),
      accent: "text-emerald-400 bg-emerald-500/10",
    },
  ];


  if (brainIncomplete) {
    moves.push({
      icon: <Sparkles className="h-4 w-4" />,
      title: "Complete Company Brain",
      subtitle: "Unlock GTM and content workflows for your AI team.",
      onClick: () => navigate("/onboarding/company-brain"),
      accent: "text-primary bg-primary/10",
    });
  }

  return (
    <div className="mt-8">
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80 mb-1">
          Suggested
        </div>
        <h3 className="text-sm font-semibold text-foreground">Recommended next moves</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {moves.map((m, i) => (
          <button
            key={i}
            onClick={m.onClick}
            className="group text-left rounded-2xl border border-border-subtle bg-card/60 p-4 hover:border-border hover:bg-card hover:-translate-y-[1px] transition-all"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={"w-8 h-8 rounded-lg flex items-center justify-center " + m.accent}>
                {m.icon}
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </div>
            <div className="text-sm font-semibold text-foreground leading-snug">{m.title}</div>
            <div className="text-[12px] text-muted-foreground mt-1 leading-snug">{m.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
