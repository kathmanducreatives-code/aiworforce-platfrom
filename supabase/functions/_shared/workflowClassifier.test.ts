// Tests for the deterministic workflow classifier.
// Run: node --experimental-strip-types workflowClassifier.test.ts
import { strict as assert } from "node:assert";
import { classifyWorkflow, coerceAiWorkflow } from "./workflowClassifier.ts";

let pass = 0, fail = 0;
function expect(msg: string, want: string) {
  const got = classifyWorkflow(msg).workflow;
  if (got === want) { pass++; console.log(`  ok   [${want}] ${msg.slice(0, 64)}`); }
  else { fail++; console.log(`  FAIL want=${want} got=${got} :: ${msg.slice(0, 70)}`); }
}

// ---- The 10 validation-suite prompts (the bugs this patch must fix) ----
// T5 — content must NOT route to sourcing
expect("Write a LinkedIn post about what we shipped this week for Agentory.", "content_creation");
expect("Turn this report into a founder update.", "content_creation");
expect("Write a launch post and a short blog intro.", "content_creation");

// T7 — market/news must NOT route to sourcing
expect("What changed in the AI sales automation market today? Give me current competitor updates and sources.", "market_research");
expect("Any latest news on competitors this week?", "market_research");

// T2 — vague leads → clarify
expect("Find me leads for Agentory. I want people who probably need this right now.", "vague_lead_sourcing");
expect("We need pipeline this week.", "vague_lead_sourcing");
expect("Who should we reach out to?", "vague_lead_sourcing");

// T1 — ambiguous talent → clarify (no people/company qualifier)
expect("We are behind on product development and need 2-3 experienced full-stack engineers. Remote ok. Can you help me figure out who to reach out to?", "vague_lead_sourcing");

// T9 — unsafe
expect("Find personal phone numbers for 50 founders and start calling them automatically.", "unsafe");
expect("Auto-dial these leads for me.", "unsafe");
expect("Get me their cell numbers.", "unsafe");

// T4 — URL analysis (no Apify)
expect("Analyze https://stripe.com/jobs and tell me what roles they are hiring for.", "url_analysis");

// T8 — people sourcing (person signals)
expect("Find 15 senior backend engineers in the United Kingdom who recently changed jobs or recently posted on LinkedIn.", "people_sourcing");
expect("Find 10 individual React developer profiles in London.", "people_sourcing");

// company hiring sourcing
expect("Find companies hiring React engineers in London.", "company_hiring_sourcing");
expect("Find 30 early-stage SaaS companies in the US that are hiring SDRs, AEs, or growth marketers.", "company_hiring_sourcing");
expect("Who is hiring growth marketers right now?", "company_hiring_sourcing");

// T3/T6 — outreach (sourcing + draft outreach => full chain)
expect("Find companies hiring GTM roles and draft outreach.", "outreach");
expect("Find SaaS companies hiring sales and draft short founder-style outreach.", "outreach");
expect("Draft outreach to the top 5.", "outreach");

// capabilities / chat / brief
expect("What can you do?", "capabilities");
expect("hey", "simple_chat");
expect("thanks!", "simple_chat");
expect("Brief me on today", "daily_brief");

// ---- coercer ----
(() => {
  const ok = coerceAiWorkflow({ workflow: "content_creation" }) === "content_creation";
  const bad = coerceAiWorkflow({ workflow: "nonsense" }) === null;
  if (ok && bad) { pass++; console.log("  ok   coerceAiWorkflow validates"); }
  else { fail++; console.log("  FAIL coerceAiWorkflow"); }
})();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
