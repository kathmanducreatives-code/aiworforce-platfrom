import { Plus, Sparkles } from "lucide-react";
import { DOCK_AGENTS, deptColor } from "@/data/dockAgents";
import { openAgentBuilder } from "@/hooks/useAgentBuilder";

// Pilot is the orchestrator — exists conceptually but isn't in the dock list. Render as the first card.
const PILOT_CARD = {
  id: "pilot",
  name: "Pilot",
  role: "Orchestrates your AI workforce",
  department: "operations" as const,
  recentActivity: [{ time: "Live", text: "Routes every message to the right agent." }],
  currentTask: "Standing by",
};

const dispatchChat = (text: string) => {
  window.dispatchEvent(new CustomEvent("chat:send", { detail: { text } }));
};

export default function Agents() {
  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight">AI Team</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Your AI workforce. Each agent has a role, recent activity, and can take tasks from chat.
            </p>
          </div>
          <button
            onClick={() => openAgentBuilder()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> New Agent
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AgentCard agent={PILOT_CARD as any} />
          {DOCK_AGENTS.map((a) => <AgentCard key={a.id} agent={a} />)}
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: any }) {
  const colors = deptColor[agent.department as keyof typeof deptColor] ?? deptColor.operations;
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${colors.bg} border ${colors.border}`}>
          <Sparkles className={`h-4 w-4 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{agent.name}</p>
          <p className="text-xs text-muted-foreground line-clamp-1">{agent.role}</p>
        </div>
      </div>

      {agent.currentTask && (
        <p className="text-xs text-muted-foreground border-l-2 border-border pl-2">{agent.currentTask}</p>
      )}

      {agent.recentActivity?.length > 0 && (
        <div className="space-y-1 mt-1">
          {agent.recentActivity.slice(0, 2).map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums shrink-0">{r.time}</span>
              <span className="truncate">{r.text}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => dispatchChat(`${agent.name}, what should we work on next?`)}
        className="mt-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-foreground transition-colors self-start"
      >
        Start task
      </button>
    </div>
  );
}
