// Static DDL relation recognition, not a replacement for native catalog/RLS tests.
// Keep the schema in the identity: private.widgets and public.widgets are distinct.
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)`;
const relation = String.raw`(${IDENT})(?:\s*\.\s*(${IDENT}))?`;
const decode = (s: string) =>
  s.startsWith('"') ? s.slice(1, -1).replaceAll('""', '"') : s.toLowerCase();
export const relationKey = (schema: string, table: string): string =>
  JSON.stringify([schema, table]);

export function rlsRelations(
  sql: string,
  kind: "created" | "enabled",
): Set<string> {
  const start = kind === "created"
    ? String
      .raw`\bcreate\s+(?:(?:unlogged|temporary|temp)\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:only\s+)?`
    : String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?`;
  const end = kind === "enabled"
    ? String.raw`\s+enable\s+row\s+level\s+security\b`
    : String.raw`(?![a-z0-9_$".])`;
  const regex = new RegExp(start + relation + end, "gi");
  return new Set(
    [...sql.matchAll(regex)].map((m) =>
      m[2]
        ? relationKey(decode(m[1]), decode(m[2]))
        : relationKey("public", decode(m[1]))
    ),
  );
}
