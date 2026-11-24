// A CLIENT's Company Brain through the existing Brain actions (Phase 3c, held).
//
// generate-company-brain-draft hands a request here only when it explicitly
// asked for a client (`scope: "client"` + `client_id`, resolveBrainScope) AND
// COMPANY_BRAIN_CLIENTS_ENABLED=true. Everything else stays on the agency
// path, unchanged. Nothing here reads or writes the agency Brain.
//
// The save is the agency save, scope for scope: the same origin-aware save
// boundary (resolveOriginAwareSave), the same normalizer and activation rule
// (applyBrainSave), the same onboarding progress record (onboardingProgress)
// and the same manual-edit plan (planBrainUpdate). What differs:
//   - authorization is role ∧ an active grant for this client, checked before
//     anything is read and again by the locked writer (_shared/clientBrain.ts);
//   - the version is the client Brain's integer `version`, and EVERY client
//     save names the version it builds on (`expected_version`): there is no
//     unversioned overwrite of a client Brain;
//   - activation writes no workspace activity-feed row (that feed is visible to
//     every member, and a client's name is client information — O1).
import { applyBrainSave, type CompanyBrainV2Patch } from "./companyBrainV2Save.ts";
import { resolveOriginAwareSave } from "./companyBrainOriginSave.ts";
import { parseSetupProgress, withSetupProgress, withoutSetupProgress } from "./onboardingProgress.ts";
import { planBrainUpdate } from "./companyBrainUpdate.ts";
import { buildActivationSuggestions } from "./companyBrainResearch/activationSuggestions.ts";
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";
import { computeCompanyBrainCompleteness } from "./companyBrainCompleteness.ts";
import { clientBrainAuthorization, clientBrainRefusal, readClientBrain, writeClientBrain, type ClientBrainActor } from "./clientBrain.ts";
import type { SourceRole } from "./companyBrainSourceRole.ts";

type AnyObj = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };
type Admin = { rpc: (fn: string, args: Record<string, unknown>, opts?: { get?: boolean }) => PromiseLike<RpcResult> };

export interface ClientBrainActionContext {
  admin: Admin;
  action: string;
  body: AnyObj;
  workspaceId: string;
  clientId: string;
  actorId: string;
  sessionId: string | null;
  now?: () => string;
}
export type ClientBrainResponse = { status: number; body: AnyObj };

/** The actions a client scope supports. Research, drafting and the setup wizard stay agency-only for now. */
export const CLIENT_BRAIN_ACTIONS: readonly string[] = ["status", "update", "save_draft", "activate"];

const refused = (o: Parameters<typeof clientBrainRefusal>[0]): ClientBrainResponse => clientBrainRefusal(o);
const expectedVersionOf = (body: AnyObj): number | null =>
  typeof body.expected_version === "number" && Number.isInteger(body.expected_version) && body.expected_version >= 1 ? body.expected_version : null;
// planBrainUpdate / resolveOriginAwareSave compare opaque version strings.
const token = (v: number | null): string | null => (v == null ? null : String(v));

export async function handleClientBrainAction(c: ClientBrainActionContext): Promise<ClientBrainResponse> {
  const now = c.now ?? (() => new Date().toISOString());
  const actor: ClientBrainActor = { workspaceId: c.workspaceId, clientId: c.clientId, actorId: c.actorId, sessionId: c.sessionId };
  const scope = { scope: "client", client_id: c.clientId };

  if (!CLIENT_BRAIN_ACTIONS.includes(c.action)) {
    return { status: 400, body: { error: "client_scope_not_supported", action: c.action } };
  }

  // ── read-only status: the client's Brain, only on an authorized read ──────
  if (c.action === "status") {
    const r = await readClientBrain(c.admin, actor);
    if (r.outcome !== "ok") return refused(r.outcome);
    const profile = r.brain.profile ?? {};
    return {
      status: 200,
      body: {
        ok: true, ...scope, profile: r.brain.profile, version: r.brain.version,
        onboarding_completed: r.brain.onboarding_completed,
        completeness: computeCompanyBrainCompleteness(normalizeCompanyBrain(profile)),
      },
    };
  }

  const permission = c.action === "activate" ? "activate" : "edit";
  // Authorize BEFORE reading anything: a caller without the grant learns
  // nothing about this client, not even whether it has a Brain.
  const pre = await clientBrainAuthorization(c.admin, actor, permission);
  if (pre !== "ok") return refused(pre);
  const current = await readClientBrain(c.admin, actor);
  if (current.outcome !== "ok") return refused(current.outcome);
  const existing = (current.brain.profile ?? {}) as AnyObj;
  const currentVersion = current.brain.version;
  const expected = expectedVersionOf(c.body);

  const write = (profile: AnyObj, p: "edit" | "activate", activate = false) =>
    writeClientBrain(c.admin, {
      ...actor, permission: p, profile, activate,
      mode: currentVersion == null ? "insert" : "cas", expectedVersion: currentVersion,
    });
  // Lost the race at the locked write: hand back the copy that won (read
  // under the same authorization), so the page merges into it instead of
  // guessing. A refusal on that read is returned as the refusal.
  const staleDuringSave = async (): Promise<ClientBrainResponse> => {
    const latest = await readClientBrain(c.admin, actor);
    if (latest.outcome !== "ok") return refused(latest.outcome);
    return { status: 409, body: { ok: false, ...scope, rejected_reason: "stale", detail: "changed during save",
      current_version: latest.brain.version, profile: latest.brain.profile ?? {} } };
  };

  // ── manual edit (the Brain page) ──────────────────────────────────────────
  if (c.action === "update") {
    const plan = planBrainUpdate({
      existing: current.brain.version == null ? null : existing,
      currentUpdatedAt: token(currentVersion),
      expectedUpdatedAt: token(expected),
      patch: c.body.patch,
      alreadyActive: current.brain.onboarding_completed,
    });
    if (!plan.ok) {
      const status = plan.reason === "stale" ? 409 : plan.reason === "brain_not_found" ? 404 : 400;
      return { status, body: { ok: false, ...scope, rejected_reason: plan.reason, detail: plan.detail ?? null, current_version: currentVersion } };
    }
    const w = await write(plan.profile as AnyObj, "edit");
    if (w.outcome === "stale") return await staleDuringSave();
    if (w.outcome !== "ok") return refused(w.outcome);
    return { status: 200, body: { ok: true, ...scope, profile: plan.profile, version: w.version, applied_paths: plan.applied_paths } };
  }

  // ── save draft / autosave / activate ──────────────────────────────────────
  const setup = c.body.setup === undefined ? null : parseSetupProgress(c.body.setup);
  if (setup && !setup.ok) return { status: 400, body: { ok: false, ...scope, rejected_reason: "invalid_setup", detail: setup.reason } };
  // Every client save is versioned: it lands only on the version it was built
  // from. A stale save gets the current copy back so the page merges the
  // user's unsaved text into it (onboardingAutosave.mergeStale) and retries.
  if (expected !== currentVersion) {
    return { status: 409, body: { ok: false, ...scope, rejected_reason: "stale", current_version: currentVersion, profile: existing } };
  }

  const patch = (c.body.patch ?? {}) as CompanyBrainV2Patch;
  const saveDecision = resolveOriginAwareSave({
    existing,
    patch: patch as Record<string, unknown>,
    origin: c.body.change_origin,
    sourceRole: c.body.source_role as SourceRole | undefined,
    approvedPaths: Array.isArray(c.body.approved_paths) ? (c.body.approved_paths as string[]) : undefined,
    confirmedPaths: Array.isArray(c.body.confirmed_paths) ? (c.body.confirmed_paths as string[]) : undefined,
    expectedUpdatedAt: token(expected),
    currentUpdatedAt: token(currentVersion),
  });
  if (!saveDecision.ok) {
    return { status: 409, body: { ok: false, ...scope, rejected_reason: saveDecision.rejected_reason, effective_origin: saveDecision.effective_origin } };
  }

  const result = applyBrainSave(existing, saveDecision.safe_patch as CompanyBrainV2Patch, { activate: c.action === "activate" });
  if (setup) result.profile = withSetupProgress(result.profile, setup, now());

  if (c.action === "activate" && !result.onboarding_completed) {
    // Same as the agency: keep the draft, refuse to mark a half-built Brain ready.
    const blocked = await write(result.profile as AnyObj, "activate");
    if (blocked.outcome === "stale") return await staleDuringSave();
    if (blocked.outcome !== "ok") return refused(blocked.outcome);
    return {
      status: 200,
      body: {
        ok: false, ...scope, activated: false, blocked_reasons: result.blocked_reasons, version: blocked.version,
        completeness: result.completeness, profile: result.profile,
        suggested_fixes: buildActivationSuggestions(result.normalized, result.completeness),
        effective_origin: saveDecision.effective_origin, applied_paths: saveDecision.applied_paths,
        pending_review: saveDecision.pending_review,
      },
    };
  }

  if (result.onboarding_completed) result.profile = withoutSetupProgress(result.profile);
  const saved = await write(result.profile as AnyObj, permission, result.onboarding_completed === true);
  if (saved.outcome === "stale") return await staleDuringSave();
  if (saved.outcome !== "ok") return refused(saved.outcome);
  return {
    status: 200,
    body: {
      ok: true, ...scope, activated: result.onboarding_completed, version: saved.version,
      completeness: result.completeness, profile: result.profile,
      effective_origin: saveDecision.effective_origin, applied_paths: saveDecision.applied_paths,
      pending_review: saveDecision.pending_review,
    },
  };
}
