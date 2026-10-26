// Test-only structural prerequisite checker. Never authorizes application access.
export interface Key {
  kind: string;
  columns: string[];
  target: string | null;
  target_columns: string[];
  validated: boolean;
}
export interface Relation {
  name: string;
  rls: boolean;
  forced: boolean;
  columns: { name: string; type: string; nullable: boolean }[];
  keys: Key[];
  browser_write: boolean;
  policies: unknown[];
}
export function canonicalForeignKey(
  row: Relation,
  mapping: Record<string, string>,
): boolean {
  return row.keys.some((key) =>
    key.kind === "f" && key.validated &&
    key.target === "public.client_accounts" &&
    key.columns.length === Object.keys(mapping).length &&
    key.columns.every((name, i) =>
      Object.hasOwn(mapping, name) && mapping[name] === key.target_columns[i]
    ) &&
    new Set(key.columns).size === key.columns.length
  );
}
export function inspectClientCatalog(rows: Relation[], resources: string[]) {
  if (new Set(rows.map((row) => row.name)).size !== rows.length) {
    throw new Error("ambiguous catalog rows");
  }
  const byName = new Map(rows.map((row) => [row.name, row]));
  const definitions = [
    {
      table: "public.client_accounts",
      columns: ["id", "workspace_id", "status"],
      foreign: false,
      browser: false,
    },
    {
      table: "public.client_access_grants",
      columns: [
        "workspace_id",
        "client_id",
        "user_id",
        "granted_by",
        "revoked_at",
      ],
      foreign: true,
      browser: true,
    },
    {
      table: "public.client_company_brain",
      columns: ["workspace_id", "client_id", "profile", "version"],
      foreign: true,
      browser: true,
    },
  ];
  const prerequisites = definitions.map((spec) => {
    const row = byName.get(spec.table);
    if (!row) {
      return {
        table: spec.table,
        status: "BLOCKED",
        reasons: ["owner schema not delivered"],
      };
    }
    const reasons: string[] = [];
    if (spec.columns.some((col) => !row.columns.some((c) => c.name === col))) {
      reasons.push("required contract columns missing");
    }
    if (!row.rls) reasons.push("RLS disabled");
    if (
      spec.foreign &&
      !canonicalForeignKey(row, {
        workspace_id: "workspace_id",
        client_id: "id",
      })
    ) reasons.push("validated same-workspace canonical FK missing");
    if (
      !spec.foreign &&
      !row.keys.some((key) =>
        ["p", "u"].includes(key.kind) && key.validated &&
        key.columns.length === 2 && key.columns.includes("workspace_id") &&
        key.columns.includes("id")
      )
    ) reasons.push("canonical composite parent key missing");
    if (spec.browser && row.browser_write) {
      reasons.push(
        "effective browser DML privilege exists (including PUBLIC/inherited)",
      );
    }
    return {
      table: spec.table,
      status: reasons.length ? "FAIL" : "STRUCTURAL_ONLY",
      reasons,
    };
  });
  const bridge = byName.get("outpost_private.clients");
  const pilotBridge = {
    table: "outpost_private.clients",
    canonical_fk: !!bridge &&
      canonicalForeignKey(bridge, {
        workspace_id: "workspace_id",
        client_binding_id: "id",
      }),
  };
  const descendants = [...new Set(resources)].sort().map((name) => {
    const row = byName.get("public." + name);
    return {
      table: "public." + name,
      present: !!row,
      workspace_column: row?.columns.find((c) => c.name === "workspace_id") ??
        null,
      client_column: row?.columns.find((c) => c.name === "client_id") ?? null,
      direct_canonical_fk: !!row &&
        canonicalForeignKey(row, {
          workspace_id: "workspace_id",
          client_id: "id",
        }),
      parent_keys: row?.keys.filter((k) => k.kind === "f") ?? [],
      rls: row?.rls ?? false,
      behavioral_isolation: "NOT_TESTED",
    };
  });
  return {
    prerequisites,
    pilot_bridge: pilotBridge,
    descendants,
    structural_prerequisites: prerequisites.some((p) => p.status === "FAIL")
      ? "FAIL"
      : prerequisites.some((p) => p.status === "BLOCKED") ||
          !pilotBridge.canonical_fk
      ? "BLOCKED"
      : "STRUCTURAL_ONLY",
    // Catalog shape alone NEVER proves policies, role/grant semantics, indirect
    // ownership, original sessions, revocation locks or two-client behavior.
    same_workspace_isolation: "NOT_TESTED",
    grant_generation_contract: "PENDING_OWNER_CONFIRMATION",
    phase_1: "FAIL",
    customer_pilot_ready: false,
  };
}
