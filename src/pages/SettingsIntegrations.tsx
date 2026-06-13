import { Link } from "react-router-dom";
import { Mail, Calendar, Plug } from "lucide-react";

const ITEMS = [
  { to: "/email-sequences", icon: Mail, title: "Email Sequences", desc: "Configure outreach sequences and reply tracking." },
  { to: "/interview-scheduler", icon: Calendar, title: "Interviews", desc: "Calendar sync and scheduling (legacy hiring tool)." },
];

export default function SettingsIntegrations() {
  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[960px] mx-auto px-6 lg:px-8 py-6">
        <header className="mb-6">
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Integrations</h1>
          <p className="text-[13px] text-muted-foreground mt-1">Connect Agentory to the tools your team already uses.</p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ITEMS.map((it) => (
            <Link key={it.to} to={it.to}
              className="rounded-2xl border border-border bg-card/50 p-5 hover:bg-card/70 transition-colors flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary"><it.icon className="h-4 w-4" /></div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{it.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{it.desc}</p>
              </div>
            </Link>
          ))}
          <div className="rounded-2xl border border-dashed border-border bg-card/20 p-5 flex items-start gap-3 text-muted-foreground">
            <div className="p-2 rounded-lg bg-muted/50"><Plug className="h-4 w-4" /></div>
            <div>
              <p className="text-sm font-semibold text-foreground">More coming soon</p>
              <p className="text-xs mt-0.5">Slack, HubSpot, Notion and more.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
