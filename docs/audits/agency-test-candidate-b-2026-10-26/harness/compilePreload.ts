// DRESS ONLY: answers the preparer's single Luna compile with the scripted
// vendor (as workerKill.rehearsal.ts does), so step 2 runs its real compile
// path and writes the compile's ledger row. Nothing leaves the machine.
const tree = Deno.env.get("DRESS_TREE")!;
const { vendorResponder } = await import(`file://${tree}/tests/db-contract/lib/discoveryScenario.ts`);
const vendor = vendorResponder({ label: "kickoff-compile" }, { trace: { requests: [], model_stages: [] }, vendorRequests: [], isCompiled: () => false });
let calls = 0;
globalThis.fetch = ((u: RequestInfo | URL, i?: RequestInit) => {
  const url = new URL(u instanceof Request ? u.url : String(u));
  if (url.hostname !== "api.openai.com") throw new Error(`dress: refused ${url.host}`);
  calls++;
  Deno.writeTextFileSync(Deno.env.get("DRESS_COMPILE_LOG")!, `compile call ${calls}: ${url.pathname}\n`, { append: true });
  return vendor(url, i, null);
}) as typeof fetch;
