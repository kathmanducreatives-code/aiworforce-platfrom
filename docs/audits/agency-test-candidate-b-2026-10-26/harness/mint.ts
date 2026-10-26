// Mint an HS256 JWT for a PostgREST role (dress rehearsal only).
const [secret, role] = Deno.args;
const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const head = enc({ alg: "HS256", typ: "JWT" }), body = enc({ role, exp: Math.floor(Date.now() / 1000) + 7200 });
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
console.log(`${head}.${body}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`);
