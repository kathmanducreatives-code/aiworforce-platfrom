// P1 only: server/operator enrollment, not client-editable policy or a secret store.
export const PILOT_MODE = "draft_only" as const;
export const PILOT_POLICY_ENV = "OUTPOST_PILOT_SCOPE_POLICY";
export const PILOT_ENABLED_ENV = "OUTPOST_PILOT_SCOPE_ENABLED";
export const PILOT_SIGNING_ENV = "OUTPOST_PILOT_SCOPE_SIGNING_KEY";
// Accept all UUID versions in existing workspace/task records, not only v4.
export function validId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    );
}
export class PilotRefusal extends Error {
  constructor(public readonly code: string, public readonly status = 403) {
    super(code);
  }
}
export interface CredentialBinding {
  id: string;
  provider: "openai" | "anthropic";
  purpose: "call_brief";
  // Opaque trusted reference only. This layer never reads or returns a secret.
  reference: string;
}
export interface DestinationBinding {
  id: string;
  kind: "manual_csv";
}
export interface PilotEnrollment {
  workspace_id: string;
  client_binding_id: string;
  seller_domain: string;
  version: number;
  mode: typeof PILOT_MODE;
  credentials: CredentialBinding[];
  destinations: DestinationBinding[];
}
export type EnvRead = (key: string) => string | undefined;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PilotRefusal("invalid_scope_data", 400);
  }
  return value as Record<string, unknown>;
}
function exact(o: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(o).some((k) => !keys.includes(k))) {
    throw new Error("unknown field");
  }
}
export function loadPilotEnrollments(read: EnvRead): PilotEnrollment[] {
  if (read(PILOT_ENABLED_ENV) !== "true") {
    throw new PilotRefusal("pilot_disabled", 503);
  }
  try {
    const raw = read(PILOT_POLICY_ENV);
    if (!raw || raw.length > 65536) throw new Error("policy missing");
    const doc = object(JSON.parse(raw));
    exact(doc, ["version", "workspaces"]);
    if (
      doc.version !== 1 || !Array.isArray(doc.workspaces) ||
      doc.workspaces.length === 0 || doc.workspaces.length > 100
    ) throw new Error("invalid policy");
    const ws = new Set<string>(), clients = new Set<string>();
    const entries: PilotEnrollment[] = doc.workspaces.map((value) => {
      const p = object(value);
      exact(p, [
        "workspace_id",
        "client_binding_id",
        "seller_domain",
        "version",
        "mode",
        "credentials",
        "destinations",
      ]);
      if (
        !validId(p.workspace_id) || !validId(p.client_binding_id) ||
        ws.has(p.workspace_id) || clients.has(p.client_binding_id)
      ) throw new Error("ambiguous enrollment");
      ws.add(p.workspace_id);
      clients.add(p.client_binding_id);
      if (
        p.mode !== PILOT_MODE || !Number.isSafeInteger(p.version) ||
        Number(p.version) < 1 || typeof p.seller_domain !== "string" ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(
          p.seller_domain,
        )
      ) throw new Error("invalid identity");
      if (
        !Array.isArray(p.credentials) || !Array.isArray(p.destinations) ||
        p.credentials.length > 8 || p.destinations.length > 8
      ) throw new Error("invalid bindings");
      const ids = new Set<string>();
      for (const value of p.credentials) {
        const c = object(value);
        exact(c, ["id", "provider", "purpose", "reference"]);
        if (
          !validId(c.id) || ids.has(c.id) ||
          !["openai", "anthropic"].includes(String(c.provider)) ||
          c.purpose !== "call_brief" || typeof c.reference !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(c.reference)
        ) throw new Error("invalid credential");
        ids.add(c.id);
      }
      for (const value of p.destinations) {
        const d = object(value);
        exact(d, ["id", "kind"]);
        if (!validId(d.id) || ids.has(d.id) || d.kind !== "manual_csv") {
          throw new Error("invalid destination");
        }
        ids.add(d.id);
      }
      return p as unknown as PilotEnrollment;
    });
    return structuredClone(entries);
  } catch (e) {
    if (e instanceof PilotRefusal && e.code === "pilot_scope_unavailable") {
      throw e;
    }
    throw new PilotRefusal("pilot_policy_invalid", 503);
  }
}
export function loadPilotEnrollment(
  read: EnvRead,
  workspace: string,
  client: string,
): PilotEnrollment {
  const entry = loadPilotEnrollments(read).find((p) =>
    p.workspace_id === workspace && p.client_binding_id === client
  );
  if (!entry) throw new PilotRefusal("pilot_scope_unavailable", 403);
  return entry;
}
export function pilotSigningKey(read: EnvRead): string {
  const value = read(PILOT_SIGNING_ENV);
  if (!value || value.length < 32 || value.length > 512 || !value.trim()) {
    throw new PilotRefusal("pilot_signing_unavailable", 503);
  }
  return value;
}
// Same roles as existing membership records; deliberately narrower for pilot writes.
export function canUsePilot(role: unknown): boolean {
  return role === "owner" || role === "admin";
}
