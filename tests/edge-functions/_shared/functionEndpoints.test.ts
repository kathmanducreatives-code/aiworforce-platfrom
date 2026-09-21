// WHERE A HAND-OFF GOES — THE SWITCH THE WHOLE CUTOVER TURNS ON.
//
// Nine hard-coded `${SUPABASE_URL}/functions/v1/…` literals became one lookup.
// The value of that is entirely in these cases: that the default is "nothing
// moved", that one function can move without dragging the others, that a
// rollback is emptying a variable, and that a name the API cannot serve is
// never routed to it however the environment is written.

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  apiPathFor, functionUrl, functionsBaseUrl, isMigrated, migratedFunctions,
  RAILWAY_SERVED_FUNCTIONS,
} from "../../../supabase/functions/_shared/functionEndpoints.ts";

const SUPA = "https://proj.supabase.co";
const API = "https://api.agentory.app";
const env = (m: Record<string, string>) => (k: string) => m[k];

Deno.test("DEFAULT: with neither variable set, every URL is the Supabase one it replaced", () => {
  const read = env({ SUPABASE_URL: SUPA });
  for (const name of [...RAILWAY_SERVED_FUNCTIONS, "daily-brief", "run-lead-action"]) {
    assertEquals(functionUrl(name, read), `${SUPA}/functions/v1/${name}`);
  }
  assertEquals(migratedFunctions(read).size, 0);
});

Deno.test("A BASE URL ALONE MOVES NOTHING — the list is what moves a function", () => {
  const read = env({ SUPABASE_URL: SUPA, AGENTORY_API_URL: API });
  assertEquals(functionUrl("pilot-chat", read), `${SUPA}/functions/v1/pilot-chat`);
  assertEquals(migratedFunctions(read).size, 0);
});

Deno.test("ONE AT A TIME: naming a function moves only that function", () => {
  const read = env({ SUPABASE_URL: SUPA, AGENTORY_API_URL: API, AGENTORY_API_FUNCTIONS: "pilot-chat" });
  assertEquals(functionUrl("pilot-chat", read), `${API}/api/pilot-chat`);
  assertEquals(functionUrl("orchestrate", read), `${SUPA}/functions/v1/orchestrate`);
  assertEquals(functionUrl("run-agent", read), `${SUPA}/functions/v1/run-agent`);
  assertEquals([isMigrated("pilot-chat", read), isMigrated("run-agent", read)], [true, false]);
});

Deno.test("`*` moves every servable function, and still not an unservable one", () => {
  const read = env({ SUPABASE_URL: SUPA, AGENTORY_API_URL: API, AGENTORY_API_FUNCTIONS: "*" });
  for (const name of RAILWAY_SERVED_FUNCTIONS) {
    assertEquals(functionUrl(name, read), `${API}${apiPathFor(name)}`);
  }
  // daily-brief has no route on the API; `*` must not invent one.
  assertEquals(functionUrl("daily-brief", read), `${SUPA}/functions/v1/daily-brief`);
});

Deno.test("A NAME THE API CANNOT SERVE IS NEVER ROUTED TO IT", () => {
  // A typo, or an operator moving a function that was never migrated, would
  // otherwise produce a URL that 404s — a configuration mistake turned into a
  // broken hand-off at runtime.
  const read = env({
    SUPABASE_URL: SUPA, AGENTORY_API_URL: API,
    AGENTORY_API_FUNCTIONS: "daily-brief,pilot-chatt,run-lead-action",
  });
  assertEquals(migratedFunctions(read).size, 0);
  assertEquals(functionUrl("daily-brief", read), `${SUPA}/functions/v1/daily-brief`);
});

Deno.test("ROLLBACK is emptying the variable, not a deploy", () => {
  const moved = env({ SUPABASE_URL: SUPA, AGENTORY_API_URL: API, AGENTORY_API_FUNCTIONS: "run-agent" });
  assertEquals(functionUrl("run-agent", moved), `${API}/api/run-agent`);
  const rolledBack = env({ SUPABASE_URL: SUPA, AGENTORY_API_URL: API, AGENTORY_API_FUNCTIONS: "" });
  assertEquals(functionUrl("run-agent", rolledBack), `${SUPA}/functions/v1/run-agent`);
});

Deno.test("whitespace and trailing slashes do not make a second, different URL", () => {
  const read = env({
    SUPABASE_URL: `${SUPA}/`, AGENTORY_API_URL: `${API}///`,
    AGENTORY_API_FUNCTIONS: " pilot-chat , orchestrate ",
  });
  assertEquals(functionUrl("pilot-chat", read), `${API}/api/pilot-chat`);
  assertEquals(functionUrl("orchestrate", read), `${API}/api/orchestrate`);
  assertEquals(functionUrl("daily-brief", read), `${SUPA}/functions/v1/daily-brief`);
});

Deno.test("NO DESTINATION AT ALL IS AN ERROR, not a relative URL", () => {
  // A relative URL would be sent, fail late, and look like a provider outage.
  assertThrows(() => functionUrl("run-agent", env({})), Error, "neither SUPABASE_URL");
  assertEquals(functionsBaseUrl(env({})), null);
  assertEquals(functionsBaseUrl(env({ SUPABASE_URL: `${SUPA}/` })), `${SUPA}/functions/v1`);
});

Deno.test("a migrated function still resolves when SUPABASE_URL is absent", () => {
  // An api-only process need not know the Supabase function gateway exists.
  const read = env({ AGENTORY_API_URL: API, AGENTORY_API_FUNCTIONS: "*" });
  assertEquals(functionUrl("run-agent", read), `${API}/api/run-agent`);
  assertThrows(() => functionUrl("daily-brief", read));
});
