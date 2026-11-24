// Stands in for worker/main.ts in tests/infra/testWorkerZeroApify.test.ts: it
// reports the Apify token's and the OpenAI key's presence and the network permissions Deno granted.
// It makes no request.
const q = async (host: string) => (await Deno.permissions.query({ name: "net", host })).state;
console.log("PROBE " + JSON.stringify({
  token: Deno.env.get("APIFY_API_TOKEN") ?? null, openai_key: Deno.env.get("OPENAI_API_KEY") ?? null,
  apify: await q("api.apify.com:443"), openai: await q("api.openai.com:443"),
  project: await q("zeroapifyref.supabase.co:443"), other: await q("example.com:443"),
}));
