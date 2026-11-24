// THE `pilot-chat` DEPLOY BUNDLE STAYS UNDER THE API UPLOAD LIMIT.
//
// A raw `functions deploy pilot-chat --use-api` uploads ~5.7 MB of source and
// the Management API answers HTTP 413. orion-pilot-deploy.sh deploys one
// bundled file instead; this pins that the bundle builds, stays small, keeps
// only the two remote/built-in imports external, and names only TEST.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("pilot-chat bundle: one file, under 4 MB, only the expected externals, TEST-only workdir", async () => {
  // The temp dir is made and removed by `node` (the suite runs without --allow-write).
  const node = async (code: string) => {
    const o = await new Deno.Command("node", { args: ["-e", code], stdout: "piped" }).output();
    assert(o.success); return new TextDecoder().decode(o.stdout).trim();
  };
  const out = await node(`process.stdout.write(require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "pilot-chat-bundle-test-")))`);
  try {
    const r = await new Deno.Command("node", {
      args: ["scripts/test-project/build-pilot-chat-bundle.mjs", out], stdout: "piped", stderr: "piped",
    }).output();
    assert(r.success, new TextDecoder().decode(r.stderr));
    const info = JSON.parse(new TextDecoder().decode(r.stdout).trim().split("\n").pop()!);
    assert(info.bytes < 4_000_000, `bundle is ${info.bytes} bytes`);
    assertEquals(info.externals, ["https://esm.sh/@supabase/supabase-js@2", "node:async_hooks"]);
    const files: string[] = [];
    for await (const e of Deno.readDir(`${out}/supabase/functions/pilot-chat`)) files.push(e.name);
    assertEquals(files, ["index.ts"]);
    const cfg = await Deno.readTextFile(`${out}/supabase/config.toml`);
    assert(cfg.includes('project_id = "tlvnfrxzjhsjgdofwehb"'));
    assert(!cfg.includes("ohsdatpvfdjdemstoiuj"));
    const src = await Deno.readTextFile(`${out}/supabase/functions/pilot-chat/index.ts`);
    // OpenAI-only scope, evidence, and the import-only guard survive bundling.
    assert(src.includes("chatVendorScope.enterWith("));
    assert(src.includes("orion_openai_not_configured"));
    assert(src.includes("orionEvidenceEnabledFor("));
    assert(src.includes('Deno.env.get("PILOT_CHAT_IMPORT_ONLY")'));
  } finally {
    await node(`require("fs").rmSync(${JSON.stringify(out)}, { recursive: true, force: true })`);
  }
});

Deno.test("deploy script: TEST-pinned, bundled workdir, never writes secrets", async () => {
  const s = await Deno.readTextFile("scripts/test-project/orion-pilot-deploy.sh");
  assert(s.includes("REF=tlvnfrxzjhsjgdofwehb"));
  assert(s.includes("functions deploy pilot-chat --use-api --workdir"));
  assert(!/secrets (set|unset)/.test(s), "deploy-only: no secret changes");
  assert(!s.includes("ohsdatpvfdjdemstoiuj"));
});
