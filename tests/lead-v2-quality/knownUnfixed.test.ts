// The quality suite runs in CI (ci.yml, "Lead V2 quality regressions"). A case whose root
// cause is still open is marked `knownUnfixed` and skipped there (named "[KNOWN UNFIXED]",
// counted as ignored, runnable with LEAD_V2_QUALITY_ALL=1). This pins exactly which cases
// are skipped, so one cannot be quietly added. When a root cause is fixed: delete its
// `knownUnfixed` and remove it from the list below.
//
// Read from the sources (not by importing the test files, which would run them twice).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const DIR = new URL("./", import.meta.url);

Deno.test("known-unfixed quality cases are exactly the documented ones", async () => {
  const found: string[] = [];
  for await (const e of Deno.readDir(DIR)) {
    if (!e.isFile || !e.name.endsWith(".test.ts") || e.name === "knownUnfixed.test.ts") continue;
    const src = await Deno.readTextFile(new URL(e.name, DIR));
    // Each case: qcase({ id: "…", rc: "…", … }) — its own text runs to the next qcase( or EOF.
    const parts = src.split(/(?=qcase\(\{)/).filter((p) => p.startsWith("qcase({"));
    for (const p of parts) {
      const m = /^qcase\(\{\s*id:\s*"([^"]+)",\s*rc:\s*"([^"]+)"/.exec(p);
      const own = p.slice(0, p.indexOf("})") + 2);
      if (m && /knownUnfixed:\s*"/.test(own)) found.push(`${m[2]} ${m[1]}`);
    }
    // Every skipped test must be a marked case (no bare ignore in the quality suite).
    const ignores = (src.match(/ignore:\s*skipUnfixed\(\)/g) ?? []).length;
    const marked = (src.match(/knownUnfixed:\s*"/g) ?? []).length;
    assertEquals(ignores, marked, `${e.name}: every skipUnfixed() test must carry a knownUnfixed note`);
  }
  assertEquals(found.sort(), ["RC02 L03"]);
});
