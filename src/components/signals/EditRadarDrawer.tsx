// Edit Radar drawer — chip inputs for radar preferences saved to
// company_brain.profile.signal_preferences (no migration).
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mergePreferences, type SignalPreferences } from "@/lib/signalPreferences";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string | null;
  brainProfile: Record<string, any> | null;
  onSaved?: (prefs: SignalPreferences) => void;
}

function ChipInput({ label, value, onChange, placeholder }: {
  label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) { setDraft(""); return; }
    onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
            {v}
            <button onClick={() => onChange(value.filter((x) => x !== v))} className="hover:text-white">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? "Add and press Enter"}
          className="h-8 text-[12px]"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} className="h-8 text-[11px]">Add</Button>
      </div>
    </div>
  );
}

export default function EditRadarDrawer({ open, onOpenChange, workspaceId, brainProfile, onSaved }: Props) {
  const [prefs, setPrefs] = useState<SignalPreferences>(() => mergePreferences(brainProfile as any, brainProfile?.signal_preferences ?? null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setPrefs(mergePreferences(brainProfile as any, brainProfile?.signal_preferences ?? null));
  }, [open, brainProfile]);

  const save = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const next = { ...(brainProfile ?? {}), signal_preferences: prefs };
      const { error } = await (supabase as any)
        .from("company_brain")
        .upsert({ workspace_id: workspaceId, profile: next, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
      if (error) throw error;
      toast.success("Radar settings saved");
      onSaved?.(prefs);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save radar settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[#F0F6FC]">Edit Radar</SheetTitle>
          <SheetDescription className="text-neutral-400 text-[12px]">
            Tell Scout what to watch. Stored in your Company Brain.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <ChipInput label="Industries" value={prefs.industries} onChange={(v) => setPrefs({ ...prefs, industries: v })} placeholder="B2B SaaS" />
          <ChipInput label="Target geographies" value={prefs.geographies} onChange={(v) => setPrefs({ ...prefs, geographies: v })} placeholder="United States" />
          <ChipInput label="Competitors to watch" value={prefs.competitors} onChange={(v) => setPrefs({ ...prefs, competitors: v })} placeholder="Clay" />
          <ChipInput label="Keywords / topics" value={prefs.keywords} onChange={(v) => setPrefs({ ...prefs, keywords: v })} placeholder="AI SDR" />
          <ChipInput label="LinkedIn intent topics" value={prefs.linkedin_topics} onChange={(v) => setPrefs({ ...prefs, linkedin_topics: v })} placeholder="lead generation" />
          <ChipInput label="Hiring roles to watch" value={prefs.hiring_roles} onChange={(v) => setPrefs({ ...prefs, hiring_roles: v })} placeholder="Founder's Associate" />
          <ChipInput label="Workflow topics" value={prefs.workflow_topics} onChange={(v) => setPrefs({ ...prefs, workflow_topics: v })} placeholder="Claude Code" />
          <ChipInput label="Pain points" value={prefs.pain_points} onChange={(v) => setPrefs({ ...prefs, pain_points: v })} placeholder="manual outreach" />
          <ChipInput label="Disqualifiers" value={prefs.disqualifiers} onChange={(v) => setPrefs({ ...prefs, disqualifiers: v })} placeholder="crypto" />

          <div className="flex items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2">
            <div>
              <div className="text-[12px] text-[#F0F6FC]">Strict geography</div>
              <div className="text-[11px] text-neutral-500">Reject signals outside listed geographies</div>
            </div>
            <Switch checked={prefs.strict_geography} onCheckedChange={(v) => setPrefs({ ...prefs, strict_geography: v })} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-neutral-400">Default mix (per scan)</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["hiring", "linkedin_intent", "competitors", "workflows", "people"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5">
                  <span className="text-[11px] text-neutral-400 capitalize">{k.replace(/_/g, " ")}</span>
                  <Input
                    type="number" min={0} max={10}
                    value={prefs.default_mix[k]}
                    onChange={(e) => setPrefs({ ...prefs, default_mix: { ...prefs.default_mix, [k]: Math.max(0, Number(e.target.value) || 0) } })}
                    className="h-7 w-14 text-[12px] text-right"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <SheetFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save radar"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
