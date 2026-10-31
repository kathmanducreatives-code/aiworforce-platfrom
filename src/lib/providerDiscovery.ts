// Provider discovery in the browser: the flag, the calls, and the words.
//
// Off unless VITE_PROVIDER_DISCOVERY === 'true' (and the server's own flags —
// the edge functions answer 404 while PROVIDER_DISCOVERY_ENABLED is off).
//
// NO API KEY LIVES HERE. A key the user types goes once, over HTTPS, to the
// `provider-connections` function, which verifies it and stores it in Vault;
// nothing here keeps it, and no response ever carries it back.
//
// Pure (the network call is injected). No React.

export type ProviderId = 'apollo' | 'leadocean' | 'apify';
export const PROVIDERS: { id: ProviderId; label: string; blurb: string }[] = [
  { id: 'leadocean', label: 'LeadOcean', blurb: 'People and company search, enrichment and contact discovery.' },
  { id: 'apollo', label: 'Apollo', blurb: 'Prospect discovery. Searching is free; contact data is not included.' },
  { id: 'apify', label: 'Apify', blurb: 'Web research and signal verification on company sites.' },
];

export function providerDiscoveryUiEnabled(env: Record<string, unknown> = (import.meta as { env?: Record<string, unknown> }).env ?? {}): boolean {
  return env.VITE_PROVIDER_DISCOVERY === 'true';
}

export type Invoke = <T>(name: string, body: unknown) => Promise<{ data: T | null; error: (Error & { context?: Response }) | null }>;

export interface UsageView { plan: string | null; used: number | null; limit: number | null; remaining: number | null; resetsAt: string | null; checkedAt: string }
export interface ConnectionView {
  provider: ProviderId; label: string;
  status: 'not_connected' | 'connected' | 'invalid' | 'error';
  enabled: boolean; commercialTermsConfirmed: boolean;
  capabilities: string[]; keyFingerprint: string | null; usage: UsageView | null;
  lastVerifiedAt: string | null; lastError: string | null;
}

async function errorMessage(e: (Error & { context?: Response }) | null): Promise<string> {
  try {
    const j = await e?.context?.clone().json();
    if (j && typeof j.error === 'string') return j.error;
  } catch { /* fall through */ }
  return 'The connection service is unavailable.';
}

export type Result<T> = { ok: true; value: T; error?: undefined } | { ok: false; value?: undefined; error: string };

export async function listConnections(invoke: Invoke, workspaceId: string): Promise<Result<ConnectionView[]>> {
  const r = await invoke<{ connections: ConnectionView[] }>('provider-connections', { action: 'list', workspace_id: workspaceId });
  return r.data?.connections ? { ok: true, value: r.data.connections } : { ok: false, error: await errorMessage(r.error) };
}

export async function connectionAction(
  invoke: Invoke, workspaceId: string, provider: ProviderId,
  action: 'connect' | 'verify' | 'usage' | 'disconnect', apiKey?: string,
): Promise<Result<ConnectionView>> {
  const body: Record<string, unknown> = { action, workspace_id: workspaceId, provider };
  if (action === 'connect') body.api_key = apiKey ?? '';
  const r = await invoke<{ connection: ConnectionView }>('provider-connections', body);
  return r.data?.connection ? { ok: true, value: r.data.connection } : { ok: false, error: await errorMessage(r.error) };
}

// ── Plans ───────────────────────────────────────────────────────────────────

export type Selection = 'auto' | ProviderId[];
export interface PlanRequirement { criterionId: string; key: string; label: string; handling: 'native' | 'post_verify' | 'verify_via' | 'unsupported'; via?: ProviderId }
export interface PlanStepView { provider: ProviderId; kind: string; role: 'primary' | 'fallback'; requirements: PlanRequirement[]; maxRecords: number; maxPages: number; estimatedCredits: number; costUnit: string; allowanceLimited: boolean }
export interface PlanView {
  status: 'ready' | 'blocked'; blockedReason: string | null;
  steps: PlanStepView[];
  verification: { provider: ProviderId; keys: string[]; maxRuns: number; estimatedCredits: number } | null;
  refused: { provider: ProviderId; reason: string; unsupported: { label: string }[] }[];
  unsupportedRequirements: { label: string }[];
  estimatedCredits: Partial<Record<ProviderId, number>>;
  requiresApproval: boolean; planHash: string;
}
export interface RunView {
  status: 'completed' | 'partial' | 'blocked' | 'failed'; reason: string | null;
  counts: { qualified: number; needsVerification: number; rejected: number };
  steps: { provider: ProviderId; status: string; reason: string | null; rows: number; credits: number }[];
  credits: Partial<Record<ProviderId, number>>;
}

export async function planDiscovery(invoke: Invoke, workspaceId: string, messageId: string, selection: Selection): Promise<Result<PlanView>> {
  const r = await invoke<{ plan: PlanView }>('provider-discovery', { action: 'plan', workspace_id: workspaceId, message_id: messageId, selection });
  return r.data?.plan ? { ok: true, value: r.data.plan } : { ok: false, error: await errorMessage(r.error) };
}

/** Run exactly the plan the user approved: its hash and its per-provider ceilings. */
export async function runApprovedDiscovery(invoke: Invoke, workspaceId: string, messageId: string, selection: Selection, plan: PlanView): Promise<Result<{ run: RunView; written: number }>> {
  const r = await invoke<{ run: RunView; written: number }>('provider-discovery', {
    action: 'run', workspace_id: workspaceId, message_id: messageId, selection,
    approval: plan.requiresApproval ? { plan_hash: plan.planHash, max_credits: plan.estimatedCredits } : null,
  });
  return r.data?.run ? { ok: true, value: r.data } : { ok: false, error: await errorMessage(r.error) };
}

// ── Words ───────────────────────────────────────────────────────────────────

export const HANDLING_LABEL: Record<PlanRequirement['handling'], string> = {
  native: 'Filtered by provider',
  post_verify: 'Checked by Agentory',
  verify_via: 'Verified on the web',
  unsupported: 'Not supported',
};

export function statusLabel(c: Pick<ConnectionView, 'status' | 'enabled' | 'commercialTermsConfirmed'>): { text: string; tone: 'ok' | 'warn' | 'muted' | 'bad' } {
  if (!c.enabled) return { text: 'Not available yet', tone: 'muted' };
  if (!c.commercialTermsConfirmed) return { text: 'Pending terms review', tone: 'muted' };
  if (c.status === 'connected') return { text: 'Connected', tone: 'ok' };
  if (c.status === 'invalid') return { text: 'Key rejected', tone: 'bad' };
  if (c.status === 'error') return { text: 'Check failed', tone: 'warn' };
  return { text: 'Not connected', tone: 'muted' };
}

export function usageLine(u: UsageView | null): string | null {
  if (!u) return null;
  if (u.remaining !== null && u.limit !== null) return `${u.remaining.toLocaleString()} of ${u.limit.toLocaleString()} credits left`;
  if (u.used !== null) return `${u.used.toLocaleString()} credits used`;
  return null;
}

export function creditsLine(plan: Pick<PlanView, 'estimatedCredits' | 'requiresApproval'>): string {
  const parts = Object.entries(plan.estimatedCredits).filter(([, n]) => (n ?? 0) > 0).map(([p, n]) => `${PROVIDERS.find((x) => x.id === p)?.label ?? p}: up to ${n}`);
  return plan.requiresApproval && parts.length ? parts.join(' · ') : 'No provider credits';
}

// ── Attribution on a lead (raw.agentory_discovery, written by the backend) ──

export type VerificationTone = 'evidence' | 'attested' | 'unverified';
export interface LeadAttribution {
  status: 'qualified' | 'needs_verification';
  verification: 'evidence' | 'provider_attested' | null;
  providers: { provider: string; retrievedAt: string | null; providerUpdatedAt: string | null }[];
  checks: { label: string; outcome: string; note: string; sources: string[] }[];
  conflicts: string[];
  discoveredAt: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function readLeadAttribution(raw: unknown): LeadAttribution | null {
  const a = (raw as { agentory_discovery?: Record<string, unknown> } | null)?.agentory_discovery;
  if (!a || a.version !== 'provider-discovery-v1') return null;
  const status = a.status === 'qualified' || a.status === 'needs_verification' ? a.status : null;
  if (!status) return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    status,
    verification: a.verification === 'evidence' || a.verification === 'provider_attested' ? a.verification : null,
    providers: arr(a.providers).map((p) => ({ provider: String((p as { provider?: unknown }).provider ?? ''), retrievedAt: str((p as { retrieved_at?: unknown }).retrieved_at), providerUpdatedAt: str((p as { provider_updated_at?: unknown }).provider_updated_at) })),
    checks: arr(a.checks).map((c) => ({
      label: String((c as { label?: unknown }).label ?? ''), outcome: String((c as { outcome?: unknown }).outcome ?? 'unknown'),
      note: String((c as { note?: unknown }).note ?? ''),
      sources: [...new Set(arr((c as { evidence?: unknown }).evidence).map((e) => String((e as { provider?: unknown }).provider ?? '')))].filter(Boolean),
    })),
    conflicts: arr(a.conflicts).map((c) => String((c as { field?: unknown }).field ?? '')).filter(Boolean),
    discoveredAt: str(a.discovered_at),
  };
}

export function verificationBadge(a: Pick<LeadAttribution, 'status' | 'verification'>): { text: string; tone: VerificationTone } {
  if (a.status !== 'qualified') return { text: 'Needs verification', tone: 'unverified' };
  return a.verification === 'evidence' ? { text: 'Verified against returned data', tone: 'evidence' } : { text: 'Provider-filtered', tone: 'attested' };
}

/** A phone from discovery is never shown as verified. */
export function phoneLabel(verification: string | null | undefined): string | null {
  if (!verification) return null;
  if (verification === 'independently_verified') return 'Phone verified';
  if (verification === 'provider_flagged') return 'Phone flagged by provider';
  return 'Phone from provider · unverified';
}
