import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatDistanceToNowStrict } from "date-fns";
import { StatusPill } from "./StatusPill";
import {
  type LeadRow,
  ACCOUNT_STATUS_LABEL,
  CONTACT_READINESS_LABEL,
  ENGAGEMENT_STATUS_LABEL,
  LINKEDIN_STATUS_LABEL,
  EMAIL_STATUS_LABEL,
  INTEGRATION_ONLY_LINKEDIN,
  INTEGRATION_ONLY_EMAIL,
  type LinkedInStatus,
  type EmailStatus,
  type EngagementStatus,
  fitTierLabel,
  nextStepFor,
} from "@/lib/leadLibrary/types";
import { loadLocalAug, saveLocalAug } from "@/hooks/leadLibrary/useLeadLibrary";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Copy, RefreshCcw } from "lucide-react";

export function LeadDetailDrawer({
  lead,
  onClose,
  onRefresh,
}: {
  lead: LeadRow | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const qc = useQueryClient();

  if (!lead) return null;

  const updateManual = (patch: (aug: ReturnType<typeof loadLocalAug>) => void, activity: { type: string; detail: string }) => {
    const aug = loadLocalAug(lead.workspaceId);
    patch(aug);
    aug.activity.unshift({
      id: crypto.randomUUID(),
      leadId: lead.id,
      at: new Date().toISOString(),
      type: activity.type,
      detail: activity.detail,
      owner: null,
      manual: true,
    });
    saveLocalAug(lead.workspaceId, aug);
    qc.invalidateQueries({ queryKey: ["lead-library", lead.workspaceId] });
    toast.success("Marked manually");
  };

  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto bg-card/95 backdrop-blur-xl border-border/60">
        <SheetHeader className="pb-4 border-b border-border/40">
          <SheetTitle className="text-lg">{lead.name}</SheetTitle>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <StatusPill label={ACCOUNT_STATUS_LABEL[lead.accountStatus]} tone="info" />
            <StatusPill label={CONTACT_READINESS_LABEL[lead.contactReadiness]} tone={lead.contactReadiness === "verified" ? "success" : "muted"} />
            <StatusPill label={ENGAGEMENT_STATUS_LABEL[lead.engagementStatus]} tone={lead.engagementStatus === "replied" ? "success" : "muted"} />
            {lead.possibleDuplicateOf && <StatusPill label="Possible duplicate" tone="warning" />}
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            {lead.domain && <a href={`https://${lead.domain}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{lead.domain} <ExternalLink className="h-3 w-3" /></a>}
            {lead.linkedinUrl && <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="hover:text-primary">LinkedIn</a>}
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={onRefresh}><RefreshCcw className="h-3 w-3 mr-1" />Refresh</Button>
          </div>
        </SheetHeader>

        <div className="mt-5 space-y-5 text-sm">
          <Section title="Account overview">
            <Grid>
              <Field label="Industry" value={lead.industry} />
              <Field label="Employees" value={lead.employeeCount} />
              <Field label="Location" value={lead.location} />
              <Field label="Fit score" value={lead.fitScore != null ? `${lead.fitScore} · ${fitTierLabel(lead.fitTier)}` : null} />
            </Grid>
          </Section>

          <Section title="Why this lead appeared">
            {lead.strongestSource ? (
              <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-1.5 text-xs">
                <div className="text-foreground text-sm">{lead.strongestSource.headline ?? "Signal"}</div>
                <div className="text-muted-foreground">{[lead.strongestSource.sourceType, lead.strongestSource.discoveryMethod].filter(Boolean).join(" · ")}</div>
                {lead.strongestSource.searchQuery && <div className="text-muted-foreground">Search query: <span className="text-foreground">{lead.strongestSource.searchQuery}</span></div>}
                {lead.strongestSource.url && (
                  <a href={lead.strongestSource.url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                    Open source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {lead.strongestSource.observedAt && <div className="text-muted-foreground">Observed {formatDistanceToNowStrict(new Date(lead.strongestSource.observedAt))} ago</div>}
              </div>
            ) : <Empty text="Original discovery source was not recorded." />}
          </Section>

          <Section title="Selected recipient">
            {lead.selectedRecipient ? (
              <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs">
                <div className="text-sm font-medium text-foreground">{lead.selectedRecipient.fullName}</div>
                <div className="text-muted-foreground">{lead.selectedRecipient.title}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {lead.selectedRecipient.verified ? <StatusPill label="Verified buyer" tone="success" /> : <StatusPill label="Needs review" tone="warning" />}
                  {lead.selectedRecipient.linkedinUrl && <StatusPill label="LinkedIn ✓" tone="info" />}
                  {lead.selectedRecipient.email ? <StatusPill label={lead.selectedRecipient.email} tone="info" /> : <StatusPill label="Email unavailable" tone="muted" />}
                  {lead.selectedRecipient.phone && <StatusPill label={lead.selectedRecipient.phone} tone="info" />}
                </div>
              </div>
            ) : <Empty text="No verified buyer found. Run Find decision-makers." />}
            {lead.alternateRecipients.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                {lead.alternateRecipients.length} alternative contact{lead.alternateRecipients.length === 1 ? "" : "s"} available.
              </div>
            )}
          </Section>

          <Section title="Personalized opener">
            {lead.opener ? (
              <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs space-y-2">
                <div className="whitespace-pre-wrap text-foreground text-sm">{lead.opener.fullBody}</div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusPill label={`Recipient: ${lead.opener.recipientName ?? "—"}`} tone="muted" />
                  {lead.opener.personalizationDepth && <StatusPill label={lead.opener.personalizationDepth} tone="info" />}
                  <StatusPill label={`${lead.opener.evidenceCount} evidence`} tone="muted" />
                  <StatusPill label="Approval required · Nothing sent" tone="warning" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { navigator.clipboard.writeText(lead.opener!.fullBody); toast.success("Opener copied"); }}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                </div>
              </div>
            ) : <Empty text={!lead.strongestSource ? "Complete research first." : !lead.selectedRecipient?.verified ? "Complete research and select a verified buyer first." : "No opener generated."} />}
          </Section>

          <Section title="Contact tracking">
            <div className="grid grid-cols-1 gap-2 text-xs">
              <ManualRow
                label="Engagement"
                current={ENGAGEMENT_STATUS_LABEL[lead.engagementStatus]}
                options={[
                  ["not_contacted", "Not contacted"],
                  ["contacted", "Contacted"],
                  ["meeting", "Meeting booked"],
                  ["opportunity", "Opportunity"],
                  ["won", "Won"],
                  ["lost", "Lost"],
                ]}
                onPick={(v) =>
                  updateManual((aug) => { aug.manualEngagement[lead.id] = v; }, {
                    type: `Engagement marked ${ENGAGEMENT_STATUS_LABEL[v as EngagementStatus]}`,
                    detail: "manual",
                  })
                }
              />
              <ManualRow
                label="LinkedIn"
                current={LINKEDIN_STATUS_LABEL[lead.linkedinStatus]}
                options={[
                  ["not_started", "Not started"],
                  ["viewed", "Profile viewed"],
                  ["requested", "Connection requested"],
                  ["messaged", "Message sent"],
                  ["not_interested", "Not interested"],
                ]}
                blockedOptions={INTEGRATION_ONLY_LINKEDIN}
                onPick={(v) =>
                  updateManual((aug) => { aug.manualLinkedIn[lead.id] = v; }, {
                    type: `LinkedIn ${LINKEDIN_STATUS_LABEL[v as LinkedInStatus]}`,
                    detail: "manual",
                  })
                }
              />
              <ManualRow
                label="Email"
                current={EMAIL_STATUS_LABEL[lead.emailStatus]}
                options={[
                  ["unavailable", "Email unavailable"],
                  ["draft", "Draft created"],
                  ["sent", "Sent"],
                ]}
                blockedOptions={INTEGRATION_ONLY_EMAIL}
                onPick={(v) =>
                  updateManual((aug) => { aug.manualEmail[lead.id] = v; }, {
                    type: `Email ${EMAIL_STATUS_LABEL[v as EmailStatus]}`,
                    detail: "manual",
                  })
                }
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Delivery/open/reply and LinkedIn Connected are integration-confirmed only. They can't be set manually.
            </p>
          </Section>

          <Section title="Next step">
            <StatusPill label={nextStepFor(lead)} tone="info" />
          </Section>

          <Section title="Activity">
            <ActivityList lead={lead} />
          </Section>

          <Section title="Lists & tags">
            <div className="flex flex-wrap gap-1.5">
              {lead.lists.length === 0 && lead.tags.length === 0 && <span className="text-xs text-muted-foreground">No lists or tags yet.</span>}
              {lead.lists.map((l) => <StatusPill key={l} label={`List · ${l}`} tone="info" />)}
              {lead.tags.map((t) => <StatusPill key={t} label={`#${t}`} tone="muted" />)}
            </div>
          </Section>

          <Section title="Source history">
            {lead.sources.length === 0 ? <Empty text="No source history recorded." /> : (
              <ul className="space-y-2 text-xs">
                {lead.sources.map((s, i) => (
                  <li key={i} className="rounded border border-border/40 bg-background/30 p-2">
                    <div className="text-foreground">{s.headline ?? s.sourceType ?? "Source"}</div>
                    <div className="text-muted-foreground">{[s.discoveryMethod, s.sourceType].filter(Boolean).join(" · ")}</div>
                    {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Technical source data</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-background/50 p-2">{JSON.stringify({ id: lead.id, searchRunIds: lead.searchRunIds }, null, 2)}</pre>
          </details>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{title}</h3>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded border border-border/40 bg-background/30 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value ?? <span className="text-muted-foreground italic">—</span>}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border/50 p-3 text-xs text-muted-foreground italic">{text}</div>;
}

function ManualRow({
  label, current, options, blockedOptions = [], onPick,
}: {
  label: string;
  current: string;
  options: [string, string][];
  blockedOptions?: string[];
  onPick: (v: string) => void;
}) {
  return (
    <div className="rounded border border-border/40 bg-background/30 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <StatusPill label={current} tone="muted" />
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onPick(v)}
            className="rounded border border-border/40 bg-background/50 px-2 py-0.5 text-[11px] hover:bg-primary/10 hover:border-primary/30"
          >
            {l}
          </button>
        ))}
        {blockedOptions.map((v) => (
          <span key={v} title="Requires connected integration" className="rounded border border-dashed border-border/40 px-2 py-0.5 text-[11px] text-muted-foreground opacity-60">
            {v} · integration-only
          </span>
        ))}
      </div>
    </div>
  );
}

function ActivityList({ lead }: { lead: LeadRow }) {
  const aug = typeof window !== "undefined" ? loadLocalAug(lead.workspaceId) : null;
  const items = (aug?.activity ?? []).filter((a) => a.leadId === lead.id);
  const base = [
    { id: `${lead.id}-created`, at: lead.createdAt, type: "Lead discovered", manual: false },
    ...(lead.strongestSource?.observedAt ? [{ id: `${lead.id}-src`, at: lead.strongestSource.observedAt, type: `Signal · ${lead.strongestSource.headline ?? "source"}`, manual: false }] : []),
    ...(lead.opener?.generatedAt ? [{ id: `${lead.id}-opener`, at: lead.opener.generatedAt, type: "Personalized opener generated", manual: false }] : []),
    ...items.map((i) => ({ id: i.id, at: i.at, type: i.type, manual: true as const })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (base.length === 0) return <Empty text="No activity yet." />;
  return (
    <ul className="space-y-2">
      {base.map((e) => (
        <li key={e.id} className="rounded border border-border/40 bg-background/30 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-foreground">{e.type}</span>
            <span className="text-muted-foreground">{formatDistanceToNowStrict(new Date(e.at))} ago</span>
          </div>
          {e.manual && <StatusPill className="mt-1" label="Marked manually" tone="muted" />}
        </li>
      ))}
    </ul>
  );
}
