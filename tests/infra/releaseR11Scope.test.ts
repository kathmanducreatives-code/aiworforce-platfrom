// R1.1 · the production deploy script's SCOPE: pilot-chat only, no secret writes,
// no database, backup validated before the one deploy, rollback from the backup.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const SCRIPT = await Deno.readTextFile(`${ROOT}/scripts/release/deploy-r11-pilot-chat.sh`);
const lines = SCRIPT.split("\n");
const code = lines.filter((l) => !/^\s*#/.test(l)).join("\n");

Deno.test("R1.1 script writes no secret and touches no database", () => {
  assert(!/\bp secrets (set|unset)\b/.test(code), "no secret writes");
  assert(!/\bp db\b|migration|psql/.test(code), "no database step");
  assert(!/functions delete/.test(code));
});

Deno.test("R1.1 script deploys exactly one function, pilot-chat, from the built workdir or the backup", () => {
  const deploys = lines.filter((l) => /\bp functions deploy\b/.test(l)).map((l) => l.trim());
  assertEquals(deploys, [
    'p functions deploy pilot-chat --use-api --workdir "$BK"',
    'p functions deploy pilot-chat --use-api --workdir "$OUT"',
  ]);
});

Deno.test("the backup is validated and manifested before the deploy", () => {
  const deployAt = lines.findIndex((l) => l.includes('p functions deploy pilot-chat --use-api --workdir "$OUT"'));
  for (const re of [/p functions download pilot-chat --use-api --workdir "\$BK"/, /has no source files/, /implausibly small/,
    /no server entry point/, /changed the repository's supabase\/functions/, /MANIFEST\.sha256"$/]) {
    const i = lines.findIndex((l) => re.test(l));
    assert(i > 0 && i < deployAt, `${re} must precede the deploy`);
  }
});

Deno.test("required flags are checked by NAME and never set; R1 functions must stay unmoved", () => {
  for (const k of ["AGENTORY_DELEGATION_ENABLED", "AGENTORY_ORION_EVIDENCE_CONTEXT", "MODEL_SPEND_CEILING_USD", "OPENAI_API_KEY"]) assertStringIncludes(SCRIPT, k);
  for (const fn of ["daily-brief", "generate-company-brain-draft", "setup-company-brain", "company-brain-memory", "run-agent", "orchestrate"]) {
    assertStringIncludes(SCRIPT, `[${fn}]=`);
  }
  assertStringIncludes(SCRIPT, "kept_ok || ok=0");
});

Deno.test("the bundle must be stamped with the approved app SHA and be an R1.1 build", () => {
  assertStringIncludes(SCRIPT, 'grep -Eq "\\"sha\\": ?\\"$APP_SHA\\""');
  for (const m of ["orion-intelligence-v1", "orion-draft-v1", "orion-workspace-facts-v1"]) assertStringIncludes(SCRIPT, m);
  assertStringIncludes(SCRIPT, 'git worktree add --detach "$BUILD_TREE" "$APP_SHA"');
});

Deno.test("rollback refuses a backup whose files do not match its manifest", () => {
  assertStringIncludes(SCRIPT, 'diff -q - "$BK/MANIFEST.sha256"');
});
