// Shared fixtures for the Company Brain V1 memory contract tests.
//
// Real Postgres + PostgREST + the real supabase-js client. Users, sessions and
// memberships are seeded with direct SQL (the lane has no GoTrue); every write
// under test goes through PostgREST exactly as an edge function sends it.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./harness.ts";

export const opts = { sanitizeResources: false, sanitizeOps: false };

// The lane's shim has no auth.sessions; create the columns the writers read,
// only when missing (never altered when a real table exists).
await sql`create table if not exists auth.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  not_after timestamptz
)`;

const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};

export async function as(role: "service_role" | "authenticated" | "anon", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  return createClient(REST_URL, jwt, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: gatewayFetch },
  });
}

export interface Person { id: string; session: string }

export async function person(): Promise<Person> {
  const id = uuid(); const session = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id.slice(0, 8)}@memory.contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
  return { id, session };
}

export async function join(ws: string, p: Person, role: string): Promise<void> {
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${p.id}, ${role})`;
}

/** A workspace with an owner, an editor and a viewer, and a Brain row. */
export async function team(profile: Record<string, unknown> = { company: { name: "Northwind Robotics" } }) {
  const ws = await seedWorkspace();
  const owner = await person(); const editor = await person(); const viewer = await person();
  await join(ws, owner, "owner"); await join(ws, editor, "editor"); await join(ws, viewer, "viewer");
  await sql`insert into public.company_brain (workspace_id, profile) values (${ws}, ${sql.json(profile as never)})`;
  return { ws, owner, editor, viewer };
}

export const key = () => `test-${uuid()}`;

type Json = Record<string, unknown>;

export async function memoryWrite(ws: string, p: Person, op: string, payload: Json, idem = key()): Promise<Json> {
  const svc = await as("service_role");
  const { data, error } = await svc.rpc("company_brain_memory_write", {
    p_workspace_id: ws, p_actor_id: p.id, p_session_id: p.session, p_op: op, p_payload: payload, p_idempotency_key: idem,
  });
  if (error) throw new Error(error.message);
  return data as Json;
}

export async function propose(ws: string, agent: string, payload: Json): Promise<Json> {
  const svc = await as("service_role");
  const { data, error } = await svc.rpc("company_brain_proposal_submit", { p_workspace_id: ws, p_agent: agent, p_payload: payload });
  if (error) throw new Error(error.message);
  return data as Json;
}

export async function review(ws: string, p: Person, proposalId: string, action: string, extra: {
  corrected?: unknown; note?: string; expectedVersion?: number | null; idem?: string;
} = {}): Promise<Json> {
  const svc = await as("service_role");
  const { data, error } = await svc.rpc("company_brain_proposal_review", {
    p_workspace_id: ws, p_actor_id: p.id, p_session_id: p.session, p_proposal_id: proposalId, p_action: action,
    p_corrected_value: extra.corrected === undefined ? null : extra.corrected, p_note: extra.note ?? null,
    p_expected_memory_version: extra.expectedVersion ?? null, p_idempotency_key: extra.idem ?? key(),
  });
  if (error) throw new Error(error.message);
  return data as Json;
}

export const sizePref = (min: number, max: number, extra: Json = {}) => ({
  kind: "preference", category: "icp", fact_key: "icp.company_size",
  value_type: "number_range", value: { min, max }, ...extra,
});

export const competitorProposal = (domain: string, extra: Json = {}) => ({
  kind: "fact", category: "competitors", fact_key: `competitor:${domain}`,
  value_type: "object", value: { name: domain.split(".")[0], domain },
  rationale: `${domain} is a tracked competitor monitoring subject not listed in the Company Brain`,
  evidence: [{ source_ref: `monitoring_subject:${domain}`, observed_at: "2026-11-01T00:00:00Z" }],
  source_type: "agent_suggestion", confidence: "medium", ...extra,
});

export { sql, uuid };
