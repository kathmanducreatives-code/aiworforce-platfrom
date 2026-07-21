import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  type LeadRow,
  findDuplicates,
} from "@/lib/leadLibrary/types";
import { deriveCanonicalLeadView, type CanonicalLeadCandidate } from "@/lib/leadLibrary/canonicalLeadView";
import { canonicalToLeadRow, type RowAug } from "@/lib/leadLibrary/canonicalLeadRow";

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

export function useLeadLibrary() {
  const { workspaceId } = useWorkspace();

  return useQuery({
    // Bumped to canonical-v1: rows now derive from the same JSONB stages the
    // Workbench reads, so a cache from the old (accounts+drafts only) shape must
    // not be reused.
    queryKey: ["lead-library", workspaceId, "canonical-v1"],
    enabled: !!workspaceId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<LeadRow[]> => {
      if (!workspaceId) return [];

      // One batched, workspace-scoped read per table — no N+1 per account.
      const [
        { data: accounts, error: aErr },
        { data: leadCandidates, error: lErr },
        { data: contacts, error: cErr },
        { data: drafts, error: dErr },
      ] = await Promise.all([
        supabase.from("accounts").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
        supabase.from("lead_candidates").select("id, workspace_id, account_id, plan_id, status, fit_score, priority, next_action, updated_at, created_at, raw").eq("workspace_id", workspaceId).limit(2000),
        supabase.from("contacts").select("*").eq("workspace_id", workspaceId).limit(2000),
        supabase.from("outreach_drafts").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(2000),
      ]);
      if (aErr) throw aErr;
      if (lErr) throw lErr;
      if (cErr) throw cErr;
      if (dErr) throw dErr;

      // Group inputs by account_id once.
      const leadsByAccount = new Map<string, CanonicalLeadCandidate[]>();
      for (const l of leadCandidates ?? []) {
        if (!l.account_id) continue;
        const arr = leadsByAccount.get(l.account_id) ?? [];
        arr.push(l as unknown as CanonicalLeadCandidate);
        leadsByAccount.set(l.account_id, arr);
      }
      const contactsByAccount = new Map<string, typeof contacts>();
      for (const c of contacts ?? []) {
        if (!c.account_id) continue;
        const arr = contactsByAccount.get(c.account_id) ?? [];
        arr.push(c);
        contactsByAccount.set(c.account_id, arr);
      }
      const draftsByAccount = new Map<string, typeof drafts>();
      for (const d of drafts ?? []) {
        const key = d.account_id ?? "";
        if (!key) continue;
        const arr = draftsByAccount.get(key) ?? [];
        arr.push(d);
        draftsByAccount.set(key, arr);
      }
      // Drafts linked by lead_candidate_id (covers account-less-but-lead-linked rows).
      const draftsByLead = new Map<string, typeof drafts>();
      for (const d of drafts ?? []) {
        if (!d.lead_candidate_id) continue;
        const arr = draftsByLead.get(d.lead_candidate_id) ?? [];
        arr.push(d);
        draftsByLead.set(d.lead_candidate_id, arr);
      }

      const aug = loadLocalAug(workspaceId);

      const rows: LeadRow[] = (accounts ?? []).map((a) => {
        const acctLeads = leadsByAccount.get(a.id) ?? [];
        const acctLeadIds = new Set(acctLeads.map((l) => l.id));
        const acctDrafts = [
          ...(draftsByAccount.get(a.id) ?? []),
          ...(drafts ?? []).filter((d) => d.lead_candidate_id && acctLeadIds.has(d.lead_candidate_id) && d.account_id !== a.id),
        ];

        const view = deriveCanonicalLeadView({
          workspaceId,
          account: a as never,
          leadCandidates: acctLeads,
          contacts: (contactsByAccount.get(a.id) ?? []) as never,
          outreachDrafts: acctDrafts as never,
          activity: aug.activity
            .filter((x) => x.leadId === a.id)
            .map((x) => ({ id: x.id, at: x.at, type: x.type, detail: x.detail, owner: x.owner, channel: null })),
        });

        const rowAug: RowAug = {
          lists: aug.lists[a.id] ?? [],
          tags: aug.tags[a.id] ?? [],
          followUpAt: aug.followUpAt[a.id] ?? null,
          owner: aug.owner[a.id] ?? null,
          manualEngagement: aug.manualEngagement[a.id] as LeadRow["engagementStatus"] | undefined,
          manualLinkedIn: aug.manualLinkedIn[a.id] as LeadRow["linkedinStatus"] | undefined,
          manualEmail: aug.manualEmail[a.id] as LeadRow["emailStatus"] | undefined,
          manualPhone: aug.manualPhone[a.id] as LeadRow["phoneStatus"] | undefined,
        };

        return canonicalToLeadRow(view, a as never, rowAug);
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
