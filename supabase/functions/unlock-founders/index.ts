// UNLOCK ONE COMPANY'S DECISION-MAKERS — the first endpoint that spends money.
//
// THE ORDER OF OPERATIONS IS THE SAFETY PROPERTY.
//
//   authenticate → own the task → prove the company is in THIS run's results
//   → resolve its identity → reserve → run the provider → finalize → persist
//
// Every refusal that can be decided without spending is decided BEFORE the
// reservation, because the cheapest failed unlock is the one that never
// reserved. Nothing after the reservation can raise the price: `p_actual` is
// capped at the reserved amount by the ledger itself.
//
// WHAT THE CALLER MAY SAY: which task, which company, which unlock type. That
// is all. No workspace id (it comes from the session), no price (server
// catalogue), no company payload (the verified task row), no idempotency key
// (derived, so a replay is a replay by construction rather than by good
// behaviour).
//
// A BROWSER PRESENTING A SERVICE-ROLE TOKEN IS REFUSED, as in continue-workflow:
// this endpoint exists so the frontend never needs one.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideWorkspaceAccess } from "../_shared/workspaceAccessGuard.ts";
import {
  authorizeUnlock, findCompletedUnlock, parseUnlockRequest,
  UNLOCK_REFUSAL_MESSAGE, UNLOCK_REFUSAL_STATUS, UNLOCK_RESULT_KEY,
  readUnlockedPeople,
  type UnlockRefusal,
} from "../_shared/founderUnlockContract.ts";
import { computeUnlockCharge } from "../_shared/pricing.ts";
import { runFounderUnlock } from "../_shared/founderUnlockRunner.ts";
import {
  runContactEnrichment, type ResolvedPerson,
} from "../_shared/contactEnrichmentRunner.ts";
import { readCheckpointCompanies } from "../_shared/leadResumeState.ts";
import { readPersistedLeadMission } from "../_shared/leadMissionRuntime.ts";
import { runTool } from "../_shared/toolRegistry.ts";
import {
  employerGatePasses, verifyCurrentEmployer,
} from "../_shared/employerVerification.ts";
import {
  readProviderResultItems, resolveResponseKind,
} from "../_shared/providerResponseContract.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
const refuse = (r: UnlockRefusal, extra: Record<string, unknown> = {}) =>
  json({ error: r, message: UNLOCK_REFUSAL_MESSAGE[r], ...extra },
    UNLOCK_REFUSAL_STATUS[r]);

/** Used only when the run's mission did not name any. */
const DEFAULT_ROLES = ["Founder", "Co-Founder", "CEO", "Owner"];

/**
 * Record one completed unlock against its task, WITHOUT clobbering the rest.
 *
 * ── READ-MODIFY-WRITE, AND WHY IT CANNOT BE A BLIND UPDATE ─────────────────
 *
 * `update({ result })` replaces the whole jsonb column. A blind write here
 * deletes the Workbench pool this unlock was authorised against — the pool the
 * NEXT unlock's `company_not_in_pool` check reads. So the prior value is read,
 * merged at three levels (task result → all unlocks → this company), and
 * written back.
 *
 * Shared by the founder and contact paths deliberately: two copies of a
 * read-modify-write over the same column is how one of them eventually forgets
 * a level and erases the other's result.
 */
// deno-lint-ignore no-explicit-any
type UnlockDb = { from: (table: string) => any };

async function persistUnlock(
  admin: UnlockDb,
  request: { task_id: string; company_key: string; unlock_type: string },
  row: { company_name?: string | null },
  unlockRecord: Record<string, unknown>,
): Promise<void> {
  void row;
  const db = admin;
  const { data: cur } = await db.from("tasks")
    .select("result").eq("id", request.task_id).maybeSingle();
  const prior = (cur?.result && typeof cur.result === "object")
    ? cur.result as Record<string, unknown> : {};
  const allUnlocks = (prior[UNLOCK_RESULT_KEY] && typeof prior[UNLOCK_RESULT_KEY] === "object")
    ? prior[UNLOCK_RESULT_KEY] as Record<string, unknown> : {};
  const forCompany = (allUnlocks[request.company_key] &&
    typeof allUnlocks[request.company_key] === "object")
    ? allUnlocks[request.company_key] as Record<string, unknown> : {};
  await db.from("tasks").update({
    result: {
      ...prior,
      [UNLOCK_RESULT_KEY]: {
        ...allUnlocks,
        [request.company_key]: { ...forCompany, [request.unlock_type]: unlockRecord },
      },
    },
  }).eq("id", request.task_id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: unknown;
  try { body = await req.json(); } catch { return refuse("invalid_json_body"); }

  const parsed = parseUnlockRequest(body);
  if (!parsed.ok) return refuse(parsed.refusal);
  const request = parsed.request;

  // ── 1. WHO IS ASKING ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (bearer && bearer === SERVICE_ROLE) {
    return json({
      error: "service_role_not_accepted",
      message: "Call this as the signed-in user, not with a service key.",
    }, 403);
  }
  let userId: string | null = null;
  try {
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await userClient.auth.getUser(bearer);
    userId = data?.user?.id ?? null;
  } catch { userId = null; }
  if (!userId) return json({ error: "unauthorized" }, 401);

  // ── 2. THE RUN THEY NAME, AND WHETHER IT IS THEIRS ────────────────────────
  const { data: task } = await admin.from("tasks")
    .select("id, workspace_id, plan_id, agent_id, agent_slug, user_id, result")
    .eq("id", request.task_id).maybeSingle();
  if (!task) return refuse("task_not_found");

  const workspaceId = String((task as { workspace_id?: unknown }).workspace_id ?? "");
  if (!workspaceId) return refuse("task_not_found");

  const { data: member } = await admin.from("workspace_members")
    .select("workspace_id").eq("workspace_id", workspaceId)
    .eq("user_id", userId).maybeSingle();
  const access = decideWorkspaceAccess({
    bearerIsServiceRole: false, authenticatedUserId: userId, isMember: !!member,
  });
  // A TASK ID IS NOT A CAPABILITY. Task ids travel — in URLs, in logs, in
  // screenshots — so ownership is checked before the row is used for anything.
  if (!access.ok) return refuse("forbidden_workspace");

  const taskResult = (task as { result?: unknown }).result ?? null;

  // ── 3. ALREADY BOUGHT? Return it. Do not run, do not charge. ──────────────
  //
  // This is the replay path, and it is checked BEFORE the reservation so a
  // repeated request cannot buy a second provider run at the price of nothing.
  const already = findCompletedUnlock(taskResult, request.company_key, request.unlock_type);
  if (already) {
    return json({
      ok: true, replayed: true, unlock: already,
      message: "Already unlocked on this run; nothing was charged again.",
    });
  }

  // ── 4. MAY THIS COMPANY BE UNLOCKED, AND FOR HOW MUCH? ────────────────────
  const auth = authorizeUnlock({
    request, taskResult,
    founderUnlockCompleted:
      findCompletedUnlock(taskResult, request.company_key, "founder_unlock") !== null,
  });
  if (!auth.ok) return refuse(auth.refusal);
  const { price, idempotency_key, row } = auth.authorization;

  // ── 5. CAN IT EVEN BE RUN? Decided before money moves. ────────────────────
  //
  // The company's LinkedIn identity comes from the verified checkpoint on this
  // task, never from the request. Without one there is nothing to search
  // against, and reserving first would mean taking credits for work that was
  // always going to be impossible.
  const identity = readCheckpointCompanies(taskResult)
    .find((c) => c.company_key === request.company_key);
  const companyUrl = identity?.linkedin_company_url ?? null;
  if (!companyUrl) {
    return refuse("company_not_unlockable", {
      detail: "this run never resolved a company identity to search against",
    });
  }

  // The roles the run itself was looking for, so an unlock finds the same kind
  // of person the mission was about.
  let roles: string[] = DEFAULT_ROLES;
  try {
    const { data: plan } = await admin.from("task_plans")
      .select("steps").eq("id", (task as { plan_id?: string }).plan_id ?? "")
      .maybeSingle();
    const steps = (plan as { steps?: unknown[] } | null)?.steps ?? [];
    for (const s of steps) {
      const mission = readPersistedLeadMission(
        (s as Record<string, unknown>)?.tool_input, undefined);
      if (mission && mission.decision_makers?.roles?.length) {
        roles = [...mission.decision_makers.roles];
        break;
      }
    }
  } catch { /* the default stands */ }

  // ── 6. RESERVE ────────────────────────────────────────────────────────────
  const { data: reserved, error: reserveError } = await admin.rpc("credits_reserve", {
    p_workspace: workspaceId,
    p_amount: price,
    p_idempotency_key: idempotency_key,
    p_kind: request.unlock_type,
    p_task_id: request.task_id,
    p_company_key: request.company_key,
  });
  if (reserveError) {
    console.error("[unlock-founders][reserve-error]", String(reserveError.message));
    return json({ error: "ledger_unavailable" }, 503);
  }
  const res = (reserved ?? {}) as Record<string, unknown>;
  if (res.ok !== true) {
    if (res.error === "insufficient_credits") {
      return refuse("insufficient_credits", {
        balance: res.balance ?? 0, needed: res.needed ?? price,
      });
    }
    return json({ error: String(res.error ?? "reservation_failed") }, 400);
  }
  const transactionId = String(res.transaction_id ?? "");
  console.log("[unlock-founders][reserved]", {
    task_id: request.task_id, company_key: request.company_key,
    kind: request.unlock_type, price, transaction_id: transactionId,
    replayed: res.replayed === true,
  });

  // ── 7. THE PAID WORK ──────────────────────────────────────────────────────
  const ctx = {
    admin,
    workspace_id: workspaceId,
    agent_slug: (task as { agent_slug?: string }).agent_slug ?? "lead-agent",
    agent_id: (task as { agent_id?: string }).agent_id ?? null,
    agent_name: "founder-unlock",
    plan_id: (task as { plan_id?: string }).plan_id ?? null,
    task_id: request.task_id,
    user_id: (task as { user_id?: string }).user_id ?? userId,
  };

  // ── 7. RUN THE THING THAT WAS ACTUALLY BOUGHT ────────────────────────────
  //
  // THE DEFECT THIS BRANCH FIXES.
  //
  // `unlock_type` was read in four places — the replay lookup, the ledger kind,
  // a log line and the stored record — and never once decided what ran. So
  // `contact_unlock` charged 2 credits and called `runFounderUnlock`, the same
  // people SEARCH `founder_unlock` had just run for 3. `UnlockedPerson` carries
  // no email and no phone, so the second purchase could not have produced a
  // contact method under any circumstances, and `founder_unlock_required_first`
  // made it mandatory rather than optional.
  //
  // Contact enrichment is a different Actor doing a different job: it takes the
  // person the founder unlock already resolved and looks up their business
  // email. It cannot search, so it is only reachable in this order — which is
  // what `founder_unlock_required_first` was always trying to express.
  if (request.unlock_type === "contact_unlock") {
    const priorPeople = readUnlockedPeople(taskResult, request.company_key);
    const person: ResolvedPerson | null = priorPeople[0] ?? null;

    const enrichment = await runContactEnrichment(
      { person, emailLookupAuthorized: true, existing: null },
      {
        invoke: async (call) => {
          const rr = await runTool("source_with_apify", {
            selected_actor_key: call.actorKey,
            actor_id: call.actorId,
            compiled_actor_input: true,
            capability_key: call.actorKey,
            input: call.input as Record<string, unknown>,
            compiled_input_hash: call.inputHash,
            persistence_authority: "contact_unlock" as const,
          }, ctx as never);
          if (!rr.ok || !rr.data) throw new Error(rr.error ?? "contact_actor_failed");
          const kind = resolveResponseKind({
            actorKey: call.actorKey, actorId: call.actorId,
            sourceType: (rr.data as { normalized_source_type?: string })
              .normalized_source_type ?? null,
          });
          return readProviderResultItems(
            rr.data as Record<string, unknown>, kind) as Record<string, unknown>[];
        },
      },
    );

    // ── BILLING FOLLOWS THE SAME RULE AS THE FOUNDER UNLOCK ────────────────
    //
    // `providerRan: false` covers every refusal — no resolved person, no usable
    // profile id — and those are charged zero because nothing was spent on the
    // user's behalf. A lookup that RAN and found nothing is a different case:
    // the provider billed us for the search, so `verifiedCount` counts the
    // answer rather than the address, and an honest `not_found` is charged.
    // Selling an attempt and refunding every miss would make the miss free and
    // the hit subsidise it.
    const answered = enrichment.record.status === "email_found" ||
      enrichment.record.status === "not_found";
    const contactCharge = computeUnlockCharge({
      reserved: price,
      providerRan: enrichment.provider_ran,
      verifiedCount: answered ? 1 : 0,
    });
    await admin.rpc("credits_finalize", {
      p_transaction_id: transactionId,
      p_actual: contactCharge.actual,
      p_status: contactCharge.status,
      p_reason: contactCharge.reason,
    });
    console.log("[unlock-founders][contact-finalized]", {
      transaction_id: transactionId, charged: contactCharge.actual,
      status: enrichment.record.status, refusal: enrichment.refusal,
    });

    await persistUnlock(admin, request, row, {
      version: "contact-unlock-v1",
      transaction_id: transactionId,
      unlock_type: request.unlock_type,
      company_key: request.company_key,
      company_name: row.company_name,
      contact: enrichment.record,
      charged_credits: contactCharge.actual,
      charge_status: contactCharge.status,
      unlocked_at: new Date().toISOString(),
    });

    return json({
      ok: enrichment.record.status !== "refused",
      unlock_type: "contact_unlock",
      contact: enrichment.record,
      charged_credits: contactCharge.actual,
      message: enrichment.record.reason,
    }, enrichment.record.status === "refused" ? 409 : 200);
  }

  let outcome;
  try {
    outcome = await runFounderUnlock({
      invoke: async (call) => {
        const rr = await runTool("source_with_apify", {
          selected_actor_key: call.actorKey,
          actor_id: call.actorId,
          compiled_actor_input: true,
          capability_key: call.actorKey,
          input: call.input as Record<string, unknown>,
          compiled_input_hash: call.inputHash,
          persistence_authority: "founder_unlock" as const,
        }, ctx as never);
        if (!rr.ok || !rr.data) throw new Error(rr.error ?? "unlock_actor_failed");
        const kind = resolveResponseKind({
          actorKey: call.actorKey, actorId: call.actorId,
          sourceType: (rr.data as { normalized_source_type?: string })
            .normalized_source_type ?? null,
        });
        return readProviderResultItems(
          rr.data as Record<string, unknown>, kind) as Record<string, unknown>[];
      },
      verifyEmployer: (person, url) => {
        const v = verifyCurrentEmployer(
          {
            title: person.title,
            currentCompany: person.current_employer,
            currentCompanyLinkedinUrl: person.current_employer_linkedin_url,
            isCurrent: person.current_employer_is_current ?? null,
          },
          { name: null, normalizedName: null, canonicalDomain: null,
            linkedinUrl: url, linkedinCompanyId: null, location: null,
            dedupeKey: url, dedupeKeyKind: "linkedin_url" } as never,
        );
        return { verified: employerGatePasses(v.outcome), outcome: String(v.outcome) };
      },
      log: (m, meta) => console.log("[unlock-founders]", m, meta),
    }, { companyLinkedInUrl: companyUrl, roles, maxPeople: 3 });
  } catch (e) {
    // A THROWN PROVIDER IS A FULL RELEASE. The user asked, we failed, they keep
    // their credits.
    console.error("[unlock-founders][provider-threw]", String(e));
    await admin.rpc("credits_finalize", {
      p_transaction_id: transactionId, p_actual: 0,
      p_status: "not_charged", p_reason: "provider failed",
    });
    return json({ error: "unlock_failed", message: "Nothing was charged." }, 502);
  }

  // ── 8. FINALIZE — the charge is computed here and nowhere else ────────────
  const charge = computeUnlockCharge({
    reserved: price,
    providerRan: outcome.providerRan,
    verifiedCount: outcome.people.length,
  });
  const { data: finalized } = await admin.rpc("credits_finalize", {
    p_transaction_id: transactionId,
    p_actual: charge.actual,
    p_status: charge.status,
    p_reason: charge.reason,
  });
  console.log("[unlock-founders][finalized]", {
    transaction_id: transactionId, charged: charge.actual,
    status: charge.status, verified: outcome.people.length,
  });

  // ── 9. PERSIST, READ-MODIFY-WRITE ─────────────────────────────────────────
  // `update({result})` REPLACES the whole jsonb, so a blind write here would
  // delete the Workbench pool this unlock was authorised against.
  const unlockRecord = {
    version: "founder-unlock-v1",
    transaction_id: transactionId,
    unlock_type: request.unlock_type,
    company_key: request.company_key,
    company_name: row.company_name,
    people: outcome.people,
    candidates_returned: outcome.candidatesReturned,
    charged_credits: charge.actual,
    charge_status: charge.status,
    unlocked_at: new Date().toISOString(),
  };
  try {
    const { data: cur } = await admin.from("tasks")
      .select("result").eq("id", request.task_id).maybeSingle();
    void cur;
    await persistUnlock(admin, request, row, unlockRecord);
  } catch (e) {
    console.error("[unlock-founders][persist-error]", String(e));
  }

  return json({
    ok: true,
    replayed: false,
    unlock: unlockRecord,
    charged_credits: charge.actual,
    charge_status: charge.status,
    charge_reason: charge.reason,
    refunded_credits: (finalized as Record<string, unknown> | null)?.refunded_credits ?? 0,
  });
});
