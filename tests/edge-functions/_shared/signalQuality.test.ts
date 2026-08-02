import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateSignalQuality,
  resolveSignalMix,
  dedupeSignals,
  signalDedupeKey,
  DEFAULT_SIGNAL_MIX,
} from "../../supabase/functions/_shared/signalQuality.ts";

const brain = {
  icp: {
    industries: ["B2B SaaS"],
    buyer_roles: ["Founder", "CEO"],
    geography: "United States",
    pain_points: ["manual outreach"],
    disqualifiers: ["crypto"],
  },
  competitors: { known: ["Clay", "Lindy"], adjacent: ["Zapier"] },
};

Deno.test("default mix totals 10", () => {
  const m = resolveSignalMix(null);
  const total = m.hiring + m.linkedin_intent + m.competitor + m.workflow_trend + m.people;
  assertEquals(total, 10);
  assertEquals(m.hiring, DEFAULT_SIGNAL_MIX.hiring);
});

Deno.test("hiring signal scored on matching role", () => {
  const r = evaluateSignalQuality({
    signal: {
      title: "Acme is hiring a Founder's Associate",
      role_title: "Founder's Associate",
      account_name: "Acme",
      created_at: new Date().toISOString(),
    },
    companyBrain: brain,
    signalPreferences: { hiring_roles: ["Founder's Associate"] },
    sourceType: "hiring",
  });
  assert(r.accepted);
  assert(r.score >= 45);
  assertEquals(r.next_action, "Find decision-maker");
});

Deno.test("competitor mention boosts competitor signal", () => {
  const r = evaluateSignalQuality({
    signal: {
      title: "Looking for an alternative to Clay for prospecting",
      created_at: new Date().toISOString(),
    },
    companyBrain: brain,
    signalPreferences: {},
    sourceType: "competitor",
  });
  assert(r.accepted);
  assert(r.matched_icp.some((m) => m.startsWith("competitor:")));
});

Deno.test("workflow trend extraction from text", () => {
  const r = evaluateSignalQuality({
    signal: {
      title: "Built a Claude Code workflow to automate SDR research",
      created_at: new Date().toISOString(),
    },
    companyBrain: brain,
    signalPreferences: { workflow_topics: ["Claude Code", "automate"] },
    sourceType: "workflow_trend",
  });
  assert(r.accepted);
});

Deno.test("disqualifier rejects signal", () => {
  const r = evaluateSignalQuality({
    signal: { title: "Crypto launchpad raises seed", created_at: new Date().toISOString() },
    companyBrain: brain,
    signalPreferences: {},
    sourceType: "linkedin_intent",
  });
  assertEquals(r.accepted, false);
  assert(r.reason.toLowerCase().includes("disqualifier"));
});

Deno.test("empty signal rejected", () => {
  const r = evaluateSignalQuality({
    signal: {},
    companyBrain: brain,
    signalPreferences: {},
    sourceType: "linkedin_intent",
  });
  assertEquals(r.accepted, false);
});

Deno.test("strict geography mismatch rejects", () => {
  const r = evaluateSignalQuality({
    signal: {
      title: "Founder hiring SDR in Berlin Germany",
      created_at: new Date().toISOString(),
      role_title: "SDR",
    },
    companyBrain: brain,
    signalPreferences: { strict_geography: true, geographies: ["United States"], hiring_roles: ["SDR"] },
    sourceType: "hiring",
  });
  assertEquals(r.accepted, false);
});

Deno.test("dedupe by source_url", () => {
  const existing = new Set([signalDedupeKey({ source_url: "https://x.com/a" })]);
  const candidates = [
    { source_url: "https://x.com/a", title: "dup" },
    { source_url: "https://x.com/b", title: "new" },
    { source_url: "https://x.com/b", title: "new again" },
  ];
  const out = dedupeSignals(candidates, existing);
  assertEquals(out.length, 1);
  assertEquals(out[0].source_url, "https://x.com/b");
});

Deno.test("ICP keyword influence increases score", () => {
  const lo = evaluateSignalQuality({
    signal: { title: "Random post about gardening", created_at: new Date().toISOString() },
    companyBrain: brain,
    signalPreferences: {},
    sourceType: "linkedin_intent",
  });
  const hi = evaluateSignalQuality({
    signal: { title: "Founder looking for B2B SaaS prospecting help, frustrated with manual outreach", created_at: new Date().toISOString() },
    companyBrain: brain,
    signalPreferences: {},
    sourceType: "linkedin_intent",
  });
  assert(hi.score > lo.score);
});
