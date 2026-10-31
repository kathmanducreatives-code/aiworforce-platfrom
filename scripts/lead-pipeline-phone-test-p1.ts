// Phone-only test P1 — PROPOSED. Dry run unless approved.
//
//   deno run --allow-read --allow-env scripts/lead-pipeline-phone-test-p1.ts --report <test-e-report.json>   # dry run
//   deno run --allow-read --allow-write --allow-env --allow-net=api.leadocean.io \
//     scripts/lead-pipeline-phone-test-p1.ts --report <file> --execute --approve "leadocean=5,apify_usd=0" --key-injected --out <file>
//
// Looks up phone numbers for the top five eligible Test E prospects, nothing else:
//   * cohort = the five highest-ranked `queue` leads of the PRESERVED Test E report,
//     pinned by its sha256; each must be eligible, have the provider's phone flag,
//     no outreach blocker, and be a decision-maker
//   * free preflight: GET /v1/account (≥ 5 records left, not over limit) and the
//     phone-path auth probe (empty body → 400, rejected and not counted)
//   * wire guard: only GET /v1/account, the one empty-body probe, and POST
//     /v1/people/phone with exactly one of the five approved bodies, each once
//   * one shot: a lock file is created before the first lookup
//   * no Apify call, no database write, no message, no call
//   * numbers: the report holds class / type / masked only; full numbers are NOT
//     kept unless --keep-values <file> is passed (written 0600, outside the repo)
// Test E's own report, lock and results are only read, never modified.

import { assertLiveTestsEnabled } from "./_liveTestGate.ts";
import { memoryLedger } from "../supabase/functions/_shared/discoveryProviders/budget.ts";
import type { FetchLike } from "../supabase/functions/_shared/discoveryProviders/http.ts";
import { enrichPhones, leadOceanPhoneAuthProbe, LEADOCEAN_PHONE_PATH, redactPhoneRecord, type PhoneTarget } from "../supabase/functions/_shared/leadPipeline/phones.ts";
import { accountRecords } from "./lead-pipeline-test-e.ts";
import { sha256Hex } from "../supabase/functions/_shared/providerInputFingerprint.ts";

export const TEST_P1 = Object.freeze({ test: "P1", lookups: 5, apifyUsd: 0, reportSha256: "a5da3efc0deaffc02605d63b34ee0c29ce6388323989901a5479d6cc97564a76" });
export const P1_APPROVAL = `leadocean=${TEST_P1.lookups},apify_usd=${TEST_P1.apifyUsd}`;
const LO = "https://api.leadocean.io";
const WS = "00000000-0000-4000-8000-00000000e2e0";
const MISSION = "lp:test-e-1:phones-p1";

export class P1Refusal extends Error {}

interface ReportLead {
  leadKey: string; company: { domain: string | null }; rank: { score: number; lane: string };
  person: { key: string; providerPersonId: string | null; linkedinUrl: string | null; roleFamily: string; hasPhoneFlag: boolean | null } | null;
  statuses: { qualification: string }; outreachBlockers: string[];
}

/** The five targets, in rank order, with the exact body each lookup will send. */
export function p1Cohort(report: { queue: ReportLead[] }): { targets: PhoneTarget[]; bodies: string[]; companies: string[] } {
  const ok = report.queue
    .filter((l) => l.rank.lane === "queue" && l.statuses.qualification === "eligible" && l.person && l.person.hasPhoneFlag === true && !l.outreachBlockers.length && l.person.roleFamily !== "other")
    .sort((a, b) => b.rank.score - a.rank.score || a.leadKey.localeCompare(b.leadKey))
    .slice(0, TEST_P1.lookups);
  if (ok.length !== TEST_P1.lookups) throw new P1Refusal(`refused: ${ok.length} qualifying prospects, expected ${TEST_P1.lookups}`);
  const targets: PhoneTarget[] = ok.map((l) => ({
    personKey: l.person!.key, leadId: null, providerPersonId: l.person!.providerPersonId, linkedinUrl: l.person!.linkedinUrl,
    eligibility: "eligible", hasPhone: true, outreachBlocked: false,
    // The Test E row was LeadOcean's current experience at this company: the provider's word only.
    employment: { status: "provider_consistent", sources: ["leadocean"], checkedAt: null },
  }));
  // leadOceanFindPhone sends linkedin_url when present, else person_id (exactly one).
  const bodies = targets.map((t) => JSON.stringify(t.linkedinUrl ? { linkedin_url: t.linkedinUrl } : { person_id: t.providerPersonId }));
  return { targets, bodies, companies: ok.map((l) => l.company.domain ?? l.leadKey) };
}

/** Wire guard: the free account read, one empty-body probe, and each approved lookup body once. */
export function p1Guard(inner: FetchLike, bodies: readonly string[]) {
  const sent = new Set<string>();
  let probed = false;
  const log: { kind: string; status: number | null }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.origin !== LO) throw new P1Refusal(`refused: host ${u.host}`);
    let kind = "account";
    if (!(init.method === "GET" && u.pathname === "/v1/account" && !u.search)) {
      if (init.method !== "POST" || u.pathname !== LEADOCEAN_PHONE_PATH) throw new P1Refusal(`refused: ${init.method} ${u.pathname} is not part of P1`);
      if (init.body === "{}") {
        if (probed) throw new P1Refusal("refused: the auth probe was already sent");
        probed = true; kind = "probe";
      } else {
        if (!bodies.includes(init.body ?? "")) throw new P1Refusal("refused: lookup body is not one of the approved five");
        if (sent.has(init.body!)) throw new P1Refusal("refused: that lookup was already sent (no retries)");
        sent.add(init.body!); kind = "lookup";
      }
    }
    const res = await inner(url, init);
    log.push({ kind, status: res.status });
    return res;
  };
  return { fetch, log, lookups: () => sent.size };
}

async function main() {
  const args = Deno.args;
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const path = arg("--report");
  if (!path) throw new P1Refusal("refused: --report <preserved test E report> is required");
  const raw = await Deno.readTextFile(path);
  if (sha256Hex(raw) !== TEST_P1.reportSha256) throw new P1Refusal("refused: the Test E report is not the preserved one (sha256 mismatch)");
  const { targets, bodies, companies } = p1Cohort(JSON.parse(raw));
  console.log(`TEST P1 — phone lookups for the top ${targets.length} eligible Test E prospects`);
  companies.forEach((c, i) => console.log(`  ${i + 1}. ${c}  (lookup by ${targets[i].linkedinUrl ? "linkedin_url" : "person_id"})`));
  console.log(`  worst case: ${TEST_P1.lookups} LeadOcean records (1 per lookup, found or not), $0 Apify`);
  console.log(`  APPROVAL STRING: ${P1_APPROVAL}`);
  if (!args.includes("--execute")) { console.log("DRY RUN — nothing bought."); return; }
  assertLiveTestsEnabled();

  if (arg("--approve") !== P1_APPROVAL) throw new P1Refusal(`refused: --approve must equal "${P1_APPROVAL}"`);
  if (!args.includes("--key-injected")) throw new P1Refusal("refused: the key must be the proxy-injected Network Secret (--key-injected)");
  const g = p1Guard((u, i) => fetch(u, i), bodies);
  const deps = { apiKey: "injected-by-proxy", fetch: g.fetch };
  const before = accountRecords(await (await g.fetch(`${LO}/v1/account`, { method: "GET", headers: { "x-api-key": deps.apiKey } })).json());
  if (!before || before.remaining < TEST_P1.lookups || before.overLimit) throw new P1Refusal("refused: LeadOcean account cannot cover 5 records");
  const probe = await leadOceanPhoneAuthProbe(deps);
  if (!probe.ok) throw new P1Refusal(`refused: ${probe.reason}`);
  const lock = arg("--lock") ?? ".phone-test-p1.lock";
  try { await Deno.writeTextFile(lock, JSON.stringify({ test: "P1", reportSha256: TEST_P1.reportSha256, startedAt: new Date().toISOString() }), { createNew: true }); }
  catch { throw new P1Refusal(`refused: ${lock} exists — P1 already started once; reconcile first`); }

  const authorization = { kind: "enrichment" as const, workspaceId: WS, missionId: MISSION, personKeys: targets.map((t) => t.personKey), revealEmail: false, phones: true, maxCredits: TEST_P1.lookups, approvedBy: "owner (test P1)", approvedAt: new Date().toISOString() };
  // The probe already ran above: do not send a second one.
  const r = await enrichPhones({ workspaceId: WS, missionId: MISSION, authorization, targets, deps, ledger: memoryLedger(), probe: null });
  const after = accountRecords(await (await g.fetch(`${LO}/v1/account`, { method: "GET", headers: { "x-api-key": deps.apiKey } })).json());
  const classes: Record<string, number> = {};
  for (const x of r.records) classes[x.class] = (classes[x.class] ?? 0) + 1;
  const report = {
    test: "P1", reportSha256: TEST_P1.reportSha256, probe,
    reconciliation: { before: before.remaining, after: after?.remaining ?? null, charged: r.recordsCharged, lookupsSent: g.lookups(), cap: TEST_P1.lookups },
    stopped: r.stopped, skipped: r.skipped, classes,
    records: r.records.map((x, i) => ({ company: companies[targets.findIndex((t) => t.personKey === x.personKey)] ?? null, ...redactPhoneRecord(x), rank: i + 1 })),
    wire: g.log,
  };
  if (arg("--out")) await Deno.writeTextFile(arg("--out")!, JSON.stringify(report, null, 2));
  if (arg("--keep-values")) {
    await Deno.writeTextFile(arg("--keep-values")!, JSON.stringify(r.records.filter((x) => x.e164).map((x) => ({ personKey: x.personKey, e164: x.e164, class: x.class, type: x.type }))), { mode: 0o600, createNew: true });
  }
  console.log(JSON.stringify({ reconciliation: report.reconciliation, classes, stopped: r.stopped, wire: g.log }, null, 2));
}

if (import.meta.main) await main();
