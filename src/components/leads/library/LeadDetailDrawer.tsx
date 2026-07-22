import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatDistanceToNowStrict } from "date-fns";
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
import {
  X, ExternalLink, Copy, RefreshCcw, Building2, Target, User, Mail,
  Activity as ActivityIcon, Code2, Sparkles, Tag, ListChecks, Search,
  Linkedin,
} from "lucide-react";

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

  const updateManual = (
    patch: (aug: ReturnType<typeof loadLocalAug>) => void,
    activity: { type: string; detail: string },
  ) => {
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

  const src = lead.strongestSource;

  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[640px] max-w-full p-0 bg-[#0a0d12] border-l border-white/[0.08] overflow-y-auto"
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-[#7D8590]">Lead detail</div>
            <div className="text-[16px] font-medium text-[#F0F6FC] truncate">{lead.name}</div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Chip tone="info">{ACCOUNT_STATUS_LABEL[lead.accountStatus]}</Chip>
              <Chip tone={lead.contactReadiness === "verified" ? "success" : "muted"}>
                {CONTACT_READINESS_LABEL[lead.contactReadiness]}
              </Chip>
              <Chip tone={lead.engagementStatus === "replied" ? "success" : "muted"}>
                {ENGAGEMENT_STATUS_LABEL[lead.engagementStatus]}
              </Chip>
              {lead.possibleDuplicateOf && <Chip tone="warning">Possible duplicate</Chip>}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11.5px] text-[#7D8590]">
              {lead.domain && (
                <a href={`https://${lead.domain}`} target="_blank" rel="noreferrer"
                   className="hover:text-emerald-300 inline-flex items-center gap-1">
                  {lead.domain}<ExternalLink className="h-3 w-3" />
                </a>
              )}
              {lead.linkedinUrl && (
                <a href={lead.linkedinUrl} target="_blank" rel="noreferrer"
                   className="hover:text-sky-300 inline-flex items-center gap-1">
                  <Linkedin className="h-3 w-3" /> LinkedIn
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 text-xs text-[#9aa4af] hover:text-[#F0F6FC]" onClick={onRefresh}>
              <RefreshCcw className="h-3 w-3 mr-1" />Refresh
            </Button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-white/[0.06] text-[#9aa4af] hover:text-[#F0F6FC]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Account overview */}
        <Section icon={Building2} title="Account overview">
          <Field k="Industry" v={lead.industry} />
          <Field k="Employees" v={lead.employeeCount != null ? `${lead.employeeCount}` : null} />
          <Field k="Location" v={lead.location} />
          <Field k="Website" v={lead.websiteUrl ? <Link href={lead.websiteUrl} label={lead.websiteUrl.replace(/^https?:\/\//, "")} /> : null} />
          <Field
            k="Fit score"
            v={lead.fitScore != null ? `${lead.fitScore}/100 · ${fitTierLabel(lead.fitTier)}` : null}
          />
          {lead.whySelected && <Field k="Why" v={lead.whySelected} />}
        </Section>

        {/* Why this lead appeared */}
        <Section icon={Target} title="Why this lead appeared">
          {src ? (
            <>
              <Field k="Signal" v={src.headline ?? src.sourceType} />
              <Field k="Source" v={[src.sourceType, src.discoveryMethod].filter(Boolean).join(" · ") || null} />
              {src.searchQuery && <Field k="Query" v={src.searchQuery} />}
              {src.url && <Field k="Link" v={<Link href={src.url} label="Open source" />} />}
              {src.observedAt && <Field k="Observed" v={`${formatDistanceToNowStrict(new Date(src.observedAt))} ago`} />}
              {src.confidence && <Field k="Confidence" v={src.confidence} />}
            </>
          ) : (
            <Empty text="Original discovery source was not recorded." />
          )}
        </Section>

        {/* Selected recipient */}
        <Section icon={User} title="Selected recipient">
          {lead.selectedRecipient ? (
            <>
              <Field k="Name" v={lead.selectedRecipient.fullName} />
              <Field k="Title" v={lead.selectedRecipient.title} />
              <Field k="Email" v={lead.selectedRecipient.email ?? <span className="text-amber-200/80 italic">Email unavailable</span>} />
              <Field k="Phone" v={lead.selectedRecipient.phone} />
              <Field
                k="LinkedIn"
                v={lead.selectedRecipient.linkedinUrl
                  ? <Link href={lead.selectedRecipient.linkedinUrl} label="profile" />
                  : null}
              />
              <Field
                k="Status"
                v={lead.selectedRecipient.verified
                  ? <span className="text-emerald-300">Verified buyer</span>
                  : <span className="text-amber-200/80">Needs review</span>}
              />
              {lead.alternateRecipients.length > 0 && (
                <div className="text-[11.5px] text-[#7D8590]">
                  {lead.alternateRecipients.length} alternative contact{lead.alternateRecipients.length === 1 ? "" : "s"} available.
                </div>
              )}
            </>
          ) : (
            <Empty text="No verified buyer found. Run Find decision-makers." />
          )}
        </Section>

        {/* Personalized opener */}
        <Section icon={Sparkles} title="Personalized opener">
          {lead.opener ? (
            <>
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#C9D1D9] bg-white/[0.02] rounded p-3 border border-white/[0.06]">
                {lead.opener.fullBody}
              </pre>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Chip tone="muted">Recipient: {lead.opener.recipientName ?? "—"}</Chip>
                {lead.opener.personalizationDepth && <Chip tone="info">{lead.opener.personalizationDepth}</Chip>}
                <Chip tone="muted">{lead.opener.evidenceCount} evidence</Chip>
                <Chip tone="warning">Approval required · Nothing sent</Chip>
              </div>
              <div className="mt-2">
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs bg-transparent border-white/[0.1] text-[#C9D1D9] hover:bg-white/[0.06]"
                  onClick={() => { navigator.clipboard.writeText(lead.opener!.fullBody); toast.success("Opener copied"); }}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>
              {lead.opener.generatedAt && (
                <div className="text-[10px] text-[#7D8590] mt-1">Generated {formatDistanceToNowStrict(new Date(lead.opener.generatedAt))} ago</div>
              )}
            </>
          ) : (
            <Empty text={!src ? "Complete research first." : !lead.selectedRecipient?.verified ? "Complete research and select a verified buyer first." : "No opener generated."} />
          )}
        </Section>

        {/* Contact tracking */}
        <Section icon={Mail} title="Contact tracking">
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
          <p className="mt-1 text-[10.5px] text-[#7D8590] italic">
            Delivery/open/reply and LinkedIn Connected are integration-confirmed only.
          </p>
        </Section>

        {/* Next step */}
        <Section icon={ListChecks} title="Next step">
          <Chip tone="info">{nextStepFor(lead)}</Chip>
        </Section>

        {/* Activity */}
        <Section icon={ActivityIcon} title="Activity">
          <ActivityList lead={lead} />
        </Section>

        {/* Lists & tags */}
        <Section icon={Tag} title="Lists & tags">
          {lead.lists.length === 0 && lead.tags.length === 0 ? (
            <div className="text-[11.5px] text-[#7D8590] italic">No lists or tags yet.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {lead.lists.map((l) => <Chip key={l} tone="info">List · {l}</Chip>)}
              {lead.tags.map((t) => <Chip key={t} tone="muted">#{t}</Chip>)}
            </div>
          )}
        </Section>

        {/* Source history */}
        <Section icon={Search} title="Source history">
          {lead.sources.length === 0 ? (
            <Empty text="No source history recorded." />
          ) : (
            <ul className="space-y-2">
              {lead.sources.map((s, i) => (
                <li key={i} className="rounded border border-white/[0.06] bg-white/[0.02] p-2">
                  <div className="text-[12.5px] text-[#F0F6FC]">{s.headline ?? s.sourceType ?? "Source"}</div>
                  <div className="text-[10.5px] text-[#7D8590]">{[s.discoveryMethod, s.sourceType].filter(Boolean).join(" · ")}</div>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[10.5px] text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 mt-1">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Technical source data */}
        <Section icon={Code2} title="Technical source data">
          <pre className="whitespace-pre-wrap text-[10.5px] text-[#7D8590] bg-black/40 rounded p-2 border border-white/[0.06] max-h-64 overflow-auto">
{JSON.stringify({ id: lead.id, searchRunIds: lead.searchRunIds }, null, 2)}
          </pre>
        </Section>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- helpers ---------- */

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] px-6 py-5">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-[#7D8590] mb-3">
        <Icon className="h-4 w-4 text-emerald-300/70" />
        {title}
      </div>
      <div className="text-[14px] leading-relaxed text-[#C9D1D9] space-y-2">{children}</div>
    </section>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11.5px] uppercase tracking-wider text-[#7D8590] w-24 shrink-0">{k}</span>
      <span className="text-[14px] leading-relaxed text-[#C9D1D9] min-w-0 break-words">{v}</span>
    </div>
  );
}

function Link({ href, label }: { href?: string | null; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1">
      {label}<ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded border border-dashed border-white/[0.08] p-3 text-[12px] text-[#7D8590] italic">{text}</div>;
}

type ChipTone = "info" | "success" | "warning" | "muted";
function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const cls: Record<ChipTone, string> = {
    info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    muted: "border-white/[0.1] bg-white/[0.04] text-[#9aa4af]",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-wide ${cls[tone]}`}>
      {children}
    </span>
  );
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
    <div className="rounded border border-white/[0.06] bg-white/[0.02] p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[#7D8590]">{label}</span>
        <Chip tone="muted">{current}</Chip>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onPick(v)}
            className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] text-[#C9D1D9] hover:bg-emerald-400/10 hover:border-emerald-400/30 hover:text-emerald-200"
          >
            {l}
          </button>
        ))}
        {blockedOptions.map((v) => (
          <span key={v} title="Requires connected integration"
                className="rounded border border-dashed border-white/[0.08] px-2 py-0.5 text-[11px] text-[#7D8590] opacity-60">
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
    ...(lead.strongestSource?.observedAt
      ? [{ id: `${lead.id}-src`, at: lead.strongestSource.observedAt, type: `Signal · ${lead.strongestSource.headline ?? "source"}`, manual: false }]
      : []),
    ...(lead.opener?.generatedAt
      ? [{ id: `${lead.id}-opener`, at: lead.opener.generatedAt, type: "Personalized opener generated", manual: false }]
      : []),
    ...items.map((i) => ({ id: i.id, at: i.at, type: i.type, manual: true as const })),
  ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  if (base.length === 0) return <Empty text="No activity yet." />;
  return (
    <ul className="space-y-2">
      {base.map((e) => (
        <li key={e.id} className="rounded border border-white/[0.06] bg-white/[0.02] p-2">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-[#F0F6FC]">{e.type}</span>
            <span className="text-[10.5px] text-[#7D8590]">
              {e.at ? `${formatDistanceToNowStrict(new Date(e.at))} ago` : "—"}
            </span>
          </div>
          {e.manual && <Chip tone="muted">Marked manually</Chip>}
        </li>
      ))}
    </ul>
  );
}
