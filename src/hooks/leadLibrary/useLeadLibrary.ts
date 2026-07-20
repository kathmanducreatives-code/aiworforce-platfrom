import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  type LeadRow,
  type LeadSource,
  type OpenerPreview,
  type SelectedRecipient,
  type OutreachStatus,
  fitTierFromScore,
  findDuplicates,
} from "@/lib/leadLibrary/types";

// Local-only augmentation store (lists/tags/manual statuses/follow-up).
// Documented gap: no dedicated tables today.
const LOCAL_KEY = (workspaceId: string) => `lead-library:aug:${workspaceId}`;

export interface LocalAug {
  lists: Record<string, string[]>;      // leadId -> list names
  tags: Record<string, string[]>;
  followUpAt: Record<string, string>;
  owner: Record<string, string>;
  manualLinkedIn: Record<string, string>;
  manualEmail: Record<string, string>;
  manualPhone: Record<string, string>;
  manualEngagement: Record<string, string>;
  notes: Record<string, string>;
  savedViews: Array<{ id: string; name: string; filters: unknown }>;
  activity: Array<{
    id: string;
    leadId: string;
    at: string;
    type: string;
    detail: string;
    owner: string | null;
    manual: true;
  }>;
}

export function loadLocalAug(workspaceId: string): LocalAug {
  if (typeof window === "undefined") return emptyAug();
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY(workspaceId));
    if (!raw) return emptyAug();
    return { ...emptyAug(), ...(JSON.parse(raw) as LocalAug) };
  } catch {
    return emptyAug();
  }
}

export function saveLocalAug(workspaceId: string, aug: LocalAug) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_KEY(workspaceId), JSON.stringify(aug));
}

function emptyAug(): LocalAug {
  return {
    lists: {},
    tags: {},
    followUpAt: {},
    owner: {},
    manualLinkedIn: {},
    manualEmail: {},
    manualPhone: {},
    manualEngagement: {},
    notes: {},
    savedViews: [],
    activity: [],
  };
}

function readJsonField<T = unknown>(raw: unknown, key: string): T | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return (raw as Record<string, T>)[key];
}

function mapDraftToOpener(draft: {
  id: string;
  body: string;
  status: string;
  updated_at: string;
  personalization_notes: string | null;
  raw: unknown;
  contact_id: string | null;
}, contactName: string | null): OpenerPreview {
  const status = (
    ["not_generated","generating","draft_ready","edited","approved","skipped","failed"].includes(draft.status)
      ? draft.status
      : "draft_ready"
  ) as OutreachStatus;
  const evidence = readJsonField<unknown[]>(draft.raw, "evidence") ?? [];
  const depth = (readJsonField<string>(draft.raw, "personalization_depth") ?? null) as
    | "generic" | "specific" | "deep" | null;
  return {
    id: draft.id,
    fullBody: draft.body,
    bodyPreview: draft.body.slice(0, 180),
    recipientName: contactName,
    status,
    generatedAt: draft.updated_at,
    evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
    personalizationDepth: depth,
  };
}

export function useLeadLibrary() {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: ["lead-library", workspaceId],
    enabled: !!workspaceId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<LeadRow[]> => {
      if (!workspaceId) return [];

      const [{ data: accounts, error: aErr }, { data: contacts, error: cErr }, { data: drafts, error: dErr }] =
        await Promise.all([
          supabase
            .from("accounts")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false })
            .limit(500),
          supabase
            .from("contacts")
            .select("*")
            .eq("workspace_id", workspaceId)
            .limit(2000),
          supabase
            .from("outreach_drafts")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("updated_at", { ascending: false })
            .limit(2000),
        ]);
      if (aErr) throw aErr;
      if (cErr) throw cErr;
      if (dErr) throw dErr;

      const contactsByAccount = new Map<string, typeof contacts>();
      for (const c of contacts ?? []) {
        if (!c.account_id) continue;
        const arr = contactsByAccount.get(c.account_id) ?? [];
        arr.push(c);
        contactsByAccount.set(c.account_id, arr);
      }
      const draftsByAccount = new Map<string, typeof drafts>();
      for (const d of drafts ?? []) {
        if (!d.account_id) continue;
        const arr = draftsByAccount.get(d.account_id) ?? [];
        arr.push(d);
        draftsByAccount.set(d.account_id, arr);
      }

      const aug = loadLocalAug(workspaceId);

      const rows: LeadRow[] = (accounts ?? []).map((a) => {
        const acctContacts = contactsByAccount.get(a.id) ?? [];
        const selected = acctContacts.find((c) => !!c.email || !!c.linkedin_url) ?? acctContacts[0] ?? null;
        const alternates = acctContacts.filter((c) => c.id !== selected?.id);
        const draft = (draftsByAccount.get(a.id) ?? [])[0];

        const selRecipient: SelectedRecipient | null = selected
          ? {
              id: selected.id,
              fullName: selected.full_name,
              title: selected.title,
              linkedinUrl: selected.linkedin_url,
              email: selected.email,
              phone: selected.phone,
              verified: !!selected.email,
            }
          : null;

        // Source signal reconstruction from `accounts.raw` (best-effort, truthful).
        const raw = a.raw as Record<string, unknown> | null;
        const signalTitle = (raw?.signal_title as string) ?? (raw?.headline as string) ?? null;
        const signalUrl = (raw?.source_url as string) ?? null;
        const searchQuery = (raw?.search_query as string) ?? null;
        const searchRunId = (raw?.search_run_id as string) ?? null;

        const sources: LeadSource[] = [];
        if (a.source || signalTitle || signalUrl) {
          sources.push({
            discoveryMethod: a.source,
            sourceType: (raw?.source_type as string) ?? null,
            headline: signalTitle,
            url: signalUrl,
            author: (raw?.source_author as string) ?? null,
            publishedAt: (raw?.published_at as string) ?? null,
            observedAt: a.created_at,
            freshness: null,
            confidence: null,
            searchQuery,
            searchRunId,
          });
        }

        const fitScore =
          typeof raw?.fit_score === "number" ? (raw.fit_score as number) : null;

        const opener: OpenerPreview | null = draft
          ? mapDraftToOpener(draft as never, selRecipient?.fullName ?? null)
          : null;

        const manualEng = aug.manualEngagement[a.id];
        const manualLi = aug.manualLinkedIn[a.id];
        const manualEmail = aug.manualEmail[a.id];
        const manualPhone = aug.manualPhone[a.id];

        const lastActivityFromAug = aug.activity
          .filter((x) => x.leadId === a.id)
          .sort((x, y) => y.at.localeCompare(x.at))[0];

        return {
          id: a.id,
          workspaceId: a.workspace_id,
          name: a.name,
          domain: a.domain,
          websiteUrl: a.website_url,
          linkedinUrl: a.linkedin_url,
          industry: a.industry,
          employeeCount: a.employee_count,
          location: a.location,
          createdAt: a.created_at,
          updatedAt: a.updated_at,

          accountStatus:
            (a.stage as LeadRow["accountStatus"]) ??
            (fitScore != null && fitScore >= 60 ? "qualified" : "new"),
          contactReadiness: selRecipient?.verified
            ? "verified"
            : selRecipient
              ? "needs_review"
              : "no_contact",
          outreachStatus: opener?.status ?? "not_generated",
          engagementStatus: (manualEng as LeadRow["engagementStatus"]) ?? "not_contacted",
          linkedinStatus: (manualLi as LeadRow["linkedinStatus"]) ?? "not_started",
          emailStatus:
            (manualEmail as LeadRow["emailStatus"]) ??
            (selRecipient?.email ? "draft" : "unavailable"),
          phoneStatus: (manualPhone as LeadRow["phoneStatus"]) ?? "not_attempted",

          fitScore,
          fitTier: fitTierFromScore(fitScore),
          whySelected:
            (raw?.why_selected as string) ??
            signalTitle ??
            a.description ??
            null,

          sources,
          strongestSource: sources[0] ?? null,
          searchRunIds: searchRunId ? [searchRunId] : [],

          selectedRecipient: selRecipient,
          alternateRecipients: alternates.map((c) => ({
            id: c.id,
            fullName: c.full_name,
            title: c.title,
            linkedinUrl: c.linkedin_url,
            email: c.email,
            phone: c.phone,
            verified: !!c.email,
          })),

          opener,

          lastActivity: lastActivityFromAug
            ? {
                id: lastActivityFromAug.id,
                type: lastActivityFromAug.type,
                at: lastActivityFromAug.at,
                channel: null,
                manual: true,
                owner: lastActivityFromAug.owner,
              }
            : null,
          primaryChannel: selRecipient?.email
            ? "email"
            : selRecipient?.linkedinUrl
              ? "linkedin"
              : null,

          lists: aug.lists[a.id] ?? [],
          tags: aug.tags[a.id] ?? [],
          followUpAt: aug.followUpAt[a.id] ?? null,
          owner: aug.owner[a.id] ?? null,
          possibleDuplicateOf: null,
        };
      });

      // dedupe pass
      const dupMap = findDuplicates(rows);
      for (const r of rows) {
        const of = dupMap.get(r.id);
        if (of) r.possibleDuplicateOf = of;
      }

      return rows;
    },
  });
}
