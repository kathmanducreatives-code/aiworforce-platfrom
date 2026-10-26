import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "../db-contract/lib/harness.ts";
import { runScenario } from "../db-contract/lib/discoveryScenario.ts";
Deno.test({name:"agency-only deployment profile: no canonical client schema or writers, no client execution",sanitizeOps:false,sanitizeResources:false,fn:async()=>{
 const [schema]=await sql`select to_regclass('public.client_accounts')::text clients,to_regclass('public.client_access_grants')::text grants,to_regclass('public.client_company_brain')::text brain`;
 assertEquals(schema,{clients:null,grants:null,brain:null},'run only with the explicit disposable agency profile');
 const r=await runScenario({label:'agency-no-client-schema',modelOnly:true,withoutApifyToken:true,effectFence:true});
 assertEquals(r.outcome.qualified.length,0);
 assertEquals(r.outcome.provider.length,0);
 assertEquals(r.outcome.polls,0);
 assert(r.outcome.models>0 && r.outcome.models<=4);
 assertEquals(r.outcome.terminal,['budget_exhausted']);
 console.log(JSON.stringify({profile:'agency-only/no-client-schema',models:r.outcome.models,provider:r.outcome.provider.length,qualified:r.outcome.qualified.length,terminal:r.outcome.terminal}));
}});
