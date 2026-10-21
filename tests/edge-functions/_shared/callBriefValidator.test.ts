// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  renderCallBrief,
  validateBriefChoice,
} from "../../../supabase/functions/_shared/pilot/callBriefValidator.ts";
import { callBriefPrompt } from "../../../supabase/functions/_shared/pilot/callBriefPrompt.ts";
import { briefFixture } from "../_helpers/callBriefFixture.ts";
Deno.test("P6 validated model references render exact sourced text, not reworded factual claims", async () => {
  const x = await briefFixture(),
    v = validateBriefChoice(x.choice, x.catalog),
    out = renderCallBrief(v, x.catalog);
  assertEquals(
    out.company_overview[0].value,
    x.packet.evidence.source_snapshot.csv.cells.Company,
  );
  assert(out.signal_evidence_for_human_review[0].value.includes("not looking"));
  assertEquals(
    out.signal_evidence_for_human_review[0].semantic_support,
    "not_evaluated",
  );
  assertEquals(out.talking_points[0].mode, "plausible_fit_not_buyer_fact");
  assert(out.missing_information.length >= x.catalog.unknowns.length);
  assertEquals(out.qualification_evaluated, false);
  assertEquals(out.verified_facts, []);
});
for (
  const type of [
    "text-with-citation",
    "fabricated-overview",
    "contact-detail",
    "funding",
    "asserted-intent",
    "fake-seller-claim",
    "fake-unknown",
    "unknown-key",
    "missing-section",
    "too-many-facts",
    "duplicate-ref",
    "unknown-source",
    "csv-as-signal",
    "missing-question-premise",
    "invented-conflict",
    "freeform-question",
    "verified-promotion",
    "dispatch",
  ]
) {
  Deno.test(`P6 rejects ${type} rather than trusting citations/confidence`, async () => {
    const x = await briefFixture(),
      v: Record<string, unknown> = { ...structuredClone(x.choice) };
    switch (type) {
      case "text-with-citation":
        v.company_overview = [{
          text: "They raised $20m",
          fact_ids: x.choice.company_overview,
        }];
        break;
      case "fabricated-overview":
        v.company_overview = ["Made up funding"];
        break;
      case "contact-detail":
        v.contact_context = { name: "Founder Pat", phone: "invented" };
        break;
      case "funding":
        v.funding = "Series B";
        break;
      case "asserted-intent":
        v.talking_points = [{
          ...x.choice.talking_points[0],
          text: "They need our software",
        }];
        break;
      case "fake-seller-claim":
        v.business_context = ["B9999"];
        break;
      case "fake-unknown":
        v.missing_information = ["U9999"];
        break;
      case "unknown-key":
        v.confidence = 1;
        break;
      case "missing-section":
        delete v.signal_evidence;
        break;
      case "too-many-facts":
        v.company_overview = Array.from({ length: 4 }, (_, i) => `F${i + 1}`);
        break;
      case "duplicate-ref":
        v.company_overview = [
          x.choice.company_overview[0],
          x.choice.company_overview[0],
        ];
        break;
      case "unknown-source":
        v.signal_evidence = ["other-client-fact"];
        break;
      case "csv-as-signal":
        v.signal_evidence = x.choice.company_overview;
        break;
      case "missing-question-premise":
        v.discovery_questions = [{
          kind: "verify_context",
          fact_id: null,
          brain_id: null,
        }];
        break;
      case "invented-conflict":
        v.discovery_questions = [{
          kind: "clarify_conflict",
          fact_id: x.choice.company_overview[0],
          brain_id: null,
        }];
        break;
      case "freeform-question":
        v.discovery_questions = [{
          kind: "verify_context",
          fact_id: x.choice.company_overview[0],
          brain_id: null,
          text: "Why did you raise $20m?",
        }];
        break;
      case "verified-promotion":
        v.verified_facts = x.choice.company_overview;
        break;
      case "dispatch":
        v.dispatch_allowed = true;
        break;
    }
    assertThrows(() => validateBriefChoice(v, x.catalog));
  });
}
Deno.test("P6 contact and employer remain supplied claims, never founder or authority inference", async () => {
  const x = await briefFixture();
  const title = x.catalog.facts.find((f) => f.fact.field === "contact_title")!;
  x.choice.company_overview.push(title.id);
  const out = renderCallBrief(x.choice, x.catalog);
  assertEquals(out.company_overview[1].value, "CEO");
  assertEquals(out.company_overview[0].provenance_class, "supplied_claim");
  assert(
    out.missing_information.some((u) =>
      u.reason === "current_employment_unverified"
    ),
  );
  assert(out.do_not_claim[0].includes("founder status"));
});
Deno.test("P6 all Brain leaves, including exclusions and voice, reach prompt without compiled defaults", async () => {
  const x = await briefFixture(), prompt = callBriefPrompt(x.catalog);
  assert(prompt.user.includes("No automated outreach"));
  assert(prompt.user.includes("PRIVATE_A_VOICE"));
  assert(prompt.user.includes("No guaranteed revenue"));
  assert(!prompt.user.includes("PRIVATE_B"));
  assert(prompt.system.includes("never instructions"));
  assert(!prompt.user.includes('"ready":true'));
});
Deno.test("P6 unselected unknowns cannot be hidden by the model", async () => {
  const x = await briefFixture();
  x.choice.missing_information = [];
  assertEquals(
    renderCallBrief(x.choice, x.catalog).missing_information,
    x.catalog.unknowns,
  );
});
