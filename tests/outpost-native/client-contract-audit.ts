// Metadata-only READ ONLY transaction against this harness's disposable DB.
import { RESOURCES } from "../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
import { closeHarness, sql } from "../db-contract/lib/harness.ts";
import {
  inspectClientCatalog,
  type Relation,
} from "./lib/clientBoundaryCatalog.ts";
try {
  const resources = [...Object.values(RESOURCES), "messages"];
  const targets = [
    ...resources.map((name) => "public." + name),
    "public.client_accounts",
    "public.client_access_grants",
    "public.client_company_brain",
    "outpost_private.clients",
  ];
  const report = await sql.begin("read only", async (tx) => {
    const [mode] =
      await tx`select current_setting('transaction_read_only') as read_only`;
    if (mode.read_only !== "on") {
      throw new Error("catalog audit must be read only");
    }
    const rows =
      await tx`select n.nspname||'.'||c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
      coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull) order by a.attnum)
        from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb) as columns,
      coalesce((select jsonb_agg(jsonb_build_object('kind',k.contype::text,'validated',k.convalidated,
        'columns',array(select a.attname from unnest(k.conkey) with ordinality col(num,ord) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=col.num order by col.ord),
        'target',(select rn.nspname||'.'||rc.relname from pg_class rc join pg_namespace rn on rn.oid=rc.relnamespace where rc.oid=k.confrelid),
        'target_columns',array(select a.attname from unnest(k.confkey) with ordinality col(num,ord) join pg_attribute a on a.attrelid=k.confrelid and a.attnum=col.num order by col.ord)))
        from pg_constraint k where k.conrelid=c.oid and k.contype in ('f','p','u')),'[]'::jsonb) as keys,
      (has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) as browser_write,
      coalesce((select jsonb_agg(to_jsonb(p)) from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname),'[]'::jsonb) as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and n.nspname||'.'||c.relname in ${
        tx(targets)
      } order by 1`;
    return {
      read_only: mode.read_only,
      registry: RESOURCES,
      ...inspectClientCatalog(rows as unknown as Relation[], resources),
      catalog: rows,
    };
  });
  console.log("CLIENT_CONTRACT_JSON_BEGIN");
  console.log(JSON.stringify(report, null, 2));
  console.log("CLIENT_CONTRACT_JSON_END");
  // Exit2 denotes an undelivered prerequisite, not a successful isolation test.
  Deno.exitCode = report.structural_prerequisites === "FAIL"
    ? 1
    : report.structural_prerequisites === "BLOCKED"
    ? 2
    : 0;
} finally {
  await closeHarness();
}
