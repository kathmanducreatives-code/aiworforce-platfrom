// TEST_DB_URL, CHECKED BEFORE psql EVER SEES IT. Never prints the password or the URL.
//
//   deno run --allow-env=TEST_DB_URL scripts/test-project/canary/db-url-check.ts
//
// psql parses its first argument as a connection URI only when it begins
// exactly with `postgresql://` or `postgres://`. Anything else — a leading
// space or newline, surrounding quotes, a pasted `psql "…"` command, a `jdbc:`
// prefix, no scheme — is taken as a DATABASE NAME, and psql silently falls
// back to a local Unix socket ("connection to server on socket
// /var/run/postgresql/.s.PGSQL.5432 failed"). This names exactly which part of
// the secret is wrong, so it can be fixed in GitHub without anyone seeing it.
//
// It also pins the target: the isolated project only, through Supabase's
// SESSION pooler (port 5432, user postgres.<ref>) or the direct host
// (db.<ref>.supabase.co, user postgres), database `postgres`. The transaction
// pooler (6543) is refused: it does not keep a session setting across
// statements, so the read-only sessions of verify/prepare/reconcile
// (default_transaction_read_only) would not hold.

export const CANARY_PROJECT_REF = "tlvnfrxzjhsjgdofwehb";
const PRODUCTION_REFS = ["ohsdatpvfdjdemstoiuj", "wqnigjhcwjxtmordrwno"];

export interface UrlCheck { id: string; ok: boolean; detail: string }

/**
 * `allowLocalhost`: the local rehearsal only (CANARY_LOCAL_REHEARSAL=1, never set
 * by the workflow — tests/infra/canaryWorkflow.test.ts). It accepts a loopback
 * host and any database name; a loopback host can never be another project.
 */
export function checkDbUrl(raw: string | undefined, ref = CANARY_PROJECT_REF, allowLocalhost = false): UrlCheck[] {
  const out: UrlCheck[] = [];
  const c = (id: string, ok: boolean, detail: string) => out.push({ id, ok, detail });
  if (!raw) { c("U01", false, "TEST_DB_URL is empty or not passed to this step"); return out; }

  // Nothing about the value itself is printed; only lengths and fixed labels.
  const lead = raw.length - raw.trimStart().length, trail = raw.length - raw.trimEnd().length;
  c("U01", lead === 0 && trail === 0, lead || trail
    ? `remove ${lead} leading and ${trail} trailing whitespace character(s) (spaces or newlines) from the secret`
    : "no surrounding whitespace");
  const v = raw.trim();
  const quoted = /^["'`].*["'`]$/s.test(v);
  c("U02", !quoted, quoted ? "remove the quotes around the value: store the bare postgresql://… URI" : "not quoted");
  const bare = v.replace(/^["'`]|["'`]$/g, "");
  const at = bare.search(/postgres(ql)?:\/\//);
  const prefix = at > 0 ? bare.slice(0, at) : "";
  const kind = /^\s*psql\b/.test(prefix) ? "a pasted psql command (psql \"…\")"
    : /jdbc:$/i.test(prefix) ? "a jdbc: prefix (JDBC form)"
    : /^[A-Z_]+=$/.test(prefix) ? "a NAME= prefix (the variable name was pasted with the value)"
    : `${prefix.length} character(s) before the scheme`;
  c("U03", at === 0, at === 0 ? "begins with the postgresql:// scheme"
    : at > 0 ? `the value starts with ${kind}; keep only the part from postgresql:// onward`
    : /^host=|\s(host|user|dbname)=/.test(bare) ? "this is a key=value conninfo string; use the URI form from Supabase → Connect → Session pooler"
    : "no postgresql:// scheme: use the URI from Supabase → Connect → Session pooler");
  if (at !== 0) return out;

  // libpq ends the user:password part at the FIRST '@' (a WHATWG URL parser uses
  // the last), so an unencoded '@', '/', '#' or '?' in the password breaks psql
  // even where new URL() would accept it.
  const authority = bare.slice(bare.indexOf("://") + 3);
  const firstAt = authority.indexOf("@");
  const userinfo = firstAt >= 0 ? authority.slice(0, authority.lastIndexOf("@")) : "";
  const unsafe = (authority.match(/@/g) ?? []).length > 1 || /[/#?]/.test(userinfo);
  if (unsafe) {
    c("U04", false, "the password contains an unencoded special character: URL-encode it (@ → %40, # → %23, / → %2F, ? → %3F, : → %3A)");
    return out;
  }
  let u: URL;
  try { u = new URL(bare.replace(/^postgres(ql)?:/, "http:")); }
  catch { c("U04", false, "the URI does not parse: URL-encode special characters in the password (@ → %40, # → %23, / → %2F, : → %3A, ? → %3F)"); return out; }
  const user = decodeURIComponent(u.username), host = u.hostname, port = u.port || "5432", db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const pw = u.password;
  c("U04", pw.length > 0 && !/YOUR-PASSWORD|\[.*\]/i.test(decodeURIComponent(pw)),
    !pw ? "no password in the URI" : /YOUR-PASSWORD|\[.*\]/i.test(decodeURIComponent(pw))
      ? "the password is still Supabase's [YOUR-PASSWORD] placeholder" : `password present (${decodeURIComponent(pw).length} characters, not shown)`);
  c("U05", !PRODUCTION_REFS.some((p) => bare.includes(p)), PRODUCTION_REFS.some((p) => bare.includes(p))
    ? "the URI names a PRODUCTION project: never use it here" : "names no production project");
  if (allowLocalhost && (host === "127.0.0.1" || host === "localhost")) {
    c("U06", user === `postgres.${ref}`, `local rehearsal on ${host}, user ${user}`);
    c("U07", true, `local port ${port}`);
    c("U08", true, "local rehearsal database");
    return out;
  }
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && user === `postgres.${ref}`;
  const direct = host === `db.${ref}.supabase.co` && user === "postgres";
  c("U06", pooler || direct, pooler ? `Supabase session pooler ${host}, user postgres.${ref}`
    : direct ? `direct host db.${ref}.supabase.co, user postgres`
    : /pooler\.supabase\.com$/.test(host)
      ? `pooler host ${host} with user '${user}': the user must be exactly postgres.${ref}`
      : `host ${host || "(none)"} with user '${user}' is not the isolated project ${ref} (session pooler user postgres.${ref}, or db.${ref}.supabase.co)`);
  c("U07", port === "5432", port === "6543"
    ? "port 6543 is the TRANSACTION pooler: use the SESSION pooler (port 5432) so read-only sessions hold"
    : port === "5432" ? "port 5432" : `port ${port}: use 5432`);
  c("U08", db === "postgres", db === "postgres" ? "database postgres" : `database '${db}': use postgres`);
  return out;
}

if (import.meta.main) {
  const checks = checkDbUrl(Deno.env.get("TEST_DB_URL"), CANARY_PROJECT_REF, Deno.env.get("CANARY_LOCAL_REHEARSAL") === "1");
  for (const x of checks) console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.id} TEST_DB_URL ${x.detail}`);
  Deno.exit(checks.every((x) => x.ok) && checks.length >= 8 ? 0 : 1);
}
