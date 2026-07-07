import { Calendar } from "lucide-react";
import { useState } from "react";
import { sendAgentCommand } from "@/lib/agentCommand";

const dispatchChat = (text: string) =>
  void sendAgentCommand(text, { success: "Sent to Pilot", action_source: "content_action" });

const DEFAULT_PLAN = [
  { day: "Mon", pillar: "Founder POV" },
  { day: "Tue", pillar: "Signal-based post" },
  { day: "Wed", pillar: "Comment engagement" },
  { day: "Thu", pillar: "Product update" },
  { day: "Fri", pillar: "Lessons learned" },
];

export default function ContentLoopPreview({ hasLoop = false }: { hasLoop?: boolean }) {
  const [configuring, setConfiguring] = useState(false);
  const [freq, setFreq] = useState("3x/week");
  const [topics, setTopics] = useState("");
  const [icp, setIcp] = useState("");
  const [tone, setTone] = useState("Direct, founder-led");
  const [pillars, setPillars] = useState("");

  if (!hasLoop && !configuring) {
    return (
      <div className="rounded-xl border border-border/70 bg-background/40 p-5 text-center">
        <Calendar className="h-5 w-5 text-primary mx-auto mb-2" />
        <p className="text-[15px] font-semibold text-foreground">No content loop yet.</p>
        <p className="text-[14px] text-muted-foreground mt-1">
          Build a weekly content system from your signals, product updates, and founder POV.
        </p>
        <button
          onClick={() => setConfiguring(true)}
          className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-primary text-primary-foreground hover:opacity-90"
        >
          Build content loop
        </button>
      </div>
    );
  }

  if (configuring) {
    return (
      <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-3">
        <p className="text-[15px] font-semibold text-foreground">Configure content loop</p>
        <Field label="Posting frequency"><input value={freq} onChange={(e) => setFreq(e.target.value)} className={inputCls} /></Field>
        <Field label="Topics"><input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="e.g. AI hiring, founder ops" className={inputCls} /></Field>
        <Field label="ICP"><input value={icp} onChange={(e) => setIcp(e.target.value)} placeholder="e.g. Seed to Series A founders" className={inputCls} /></Field>
        <Field label="Tone"><input value={tone} onChange={(e) => setTone(e.target.value)} className={inputCls} /></Field>
        <Field label="Content pillars"><input value={pillars} onChange={(e) => setPillars(e.target.value)} placeholder="POV · Product · Playbooks" className={inputCls} /></Field>
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => {
              dispatchChat(`Scribe, build a weekly content loop. Frequency: ${freq}. Topics: ${topics}. ICP: ${icp}. Tone: ${tone}. Pillars: ${pillars}. Draft only.`);
              setConfiguring(false);
            }}
            className="px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-primary text-primary-foreground hover:opacity-90"
          >Prepare loop plan</button>
          <button onClick={() => setConfiguring(false)} className="px-3 py-1.5 rounded-lg text-[14px] font-medium border border-border/70 text-foreground hover:bg-muted/40">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/70 bg-background/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[15px] font-semibold text-foreground">This week</p>
        <button onClick={() => setConfiguring(true)} className="text-[13px] text-primary hover:underline">Edit</button>
      </div>
      <ul className="space-y-2">
        {DEFAULT_PLAN.map((d) => (
          <li key={d.day} className="flex items-center justify-between text-[14px]">
            <span className="text-muted-foreground w-10">{d.day}</span>
            <span className="text-foreground flex-1">{d.pillar}</span>
            <button onClick={() => dispatchChat(`Scribe, draft ${d.day}'s ${d.pillar} — draft only.`)} className="text-[12px] text-primary hover:underline">Draft</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const inputCls = "w-full rounded-lg bg-background/60 border border-border/70 px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
