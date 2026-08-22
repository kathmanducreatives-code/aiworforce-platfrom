// SEVEN FACTS PER LEAD, EACH WITH A FALLBACK CHAIN THAT HAS TO BE RIGHT.
//
// The card replaces a fourteen-column table behind a horizontal scroll, in
// which FIT WAS COLUMN 12 AND STATUS COLUMN 14 — the two facts a reader most
// needs, past four padlocked columns and off the right edge at any normal
// panel width.
//
// Each field has a fallback chain (`why_this_lead` → `fit_reason` →
// matched-ICP). Written inline in JSX those are invisible and untestable, and
// the card silently renders an empty region when the first choice is missing.
//
// ZERO network, ZERO React.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLeadCard, fitLabelFor, websiteParts,
} from "../../src/lib/workbench/leadCard.ts";

/** A row that clears every qualification gate. */
const QUALIFIED = {
  quota_eligible: true,
  decision_maker_status: "verified",
  contact_status: "verified",
  company_name: "Acme Robotics",
};

// ═══ 1. THE WEBSITE ACTUALLY NAVIGATES ═════════════════════════════════════

Deno.test("1. a bare host is displayed bare and linked absolutely", () => {
  // A bare host in an `href` resolves against the app's OWN origin — which is
  // how a "website" link lands the user back on Agentory.
  const w = websiteParts("acme.com");
  assertEquals(w.label, "acme.com");
  assertEquals(w.href, "https://acme.com");
});

Deno.test("2. a full URL is shown as its host, not as the whole path", () => {
  const w = websiteParts("https://www.acme-robotics.com/careers/eng?utm=x");
  assertEquals(w.label, "acme-robotics.com", "www. and the path are noise in a list");
  assertEquals(w.href, "https://www.acme-robotics.com/careers/eng?utm=x",
    "…but the link keeps every part the row supplied");
});

Deno.test("3. an unparseable value shows text and links to NOTHING", () => {
  // A broken link is worse than no link: it looks checked.
  const w = websiteParts("not a url at all!!");
  assertEquals(w.label, "not a url at all!!");
  assertEquals(w.href, null);
});

Deno.test("4. no website is not an empty string", () => {
  for (const v of [null, undefined, "", "   "]) {
    assertEquals(websiteParts(v), { label: null, href: null });
  }
});

// ═══ 2. FIT: UNSCORED IS NOT ZERO ══════════════════════════════════════════

Deno.test("5. a missing score is null, NEVER 0", () => {
  // `0` reads as "we scored it and it is terrible" — a different and far
  // stronger claim than "nothing scored it".
  const c = buildLeadCard({ ...QUALIFIED, fit_score: null });
  assertEquals(c.fit, null);
  assertEquals(c.fitLabel, null, "and no band is claimed either");
});

Deno.test("6. a real zero survives", () => {
  const c = buildLeadCard({ ...QUALIFIED, fit_score: 0 });
  assertEquals(c.fit, 0, "a scored zero is a fact and must not be hidden");
  assertEquals(c.fitLabel, "Possible match");
});

Deno.test("7. the score is clamped and rounded", () => {
  assertEquals(buildLeadCard({ ...QUALIFIED, fit_score: 91.6 }).fit, 92);
  assertEquals(buildLeadCard({ ...QUALIFIED, fit_score: 140 }).fit, 100);
  assertEquals(buildLeadCard({ ...QUALIFIED, fit_score: -5 }).fit, 0);
  assertEquals(buildLeadCard({ ...QUALIFIED, fit_score: NaN }).fit, null);
});

Deno.test("8. the band replaces Tier A/B/C", () => {
  assertEquals(fitLabelFor(92), "Strong match");
  assertEquals(fitLabelFor(85), "Strong match");
  assertEquals(fitLabelFor(70), "Good match");
  assertEquals(fitLabelFor(40), "Possible match");
  assertEquals(fitLabelFor(null), null);
});

// ═══ 3. WHY IT WAS ACCEPTED — THE FALLBACK CHAIN ═══════════════════════════

Deno.test("9. the most specific reason wins", () => {
  const c = buildLeadCard({
    ...QUALIFIED,
    why_this_lead: "Hiring three ML engineers in your target market",
    fit_reason: "Matches ICP",
    matched_icp: ["US", "AI"],
  });
  assertEquals(c.reason, "Hiring three ML engineers in your target market");
});

Deno.test("10. …then fit_reason, then the matched criteria", () => {
  assertEquals(
    buildLeadCard({ ...QUALIFIED, fit_reason: "Matches ICP", matched_icp: ["US"] }).reason,
    "Matches ICP",
  );
  assertEquals(
    buildLeadCard({ ...QUALIFIED, matched_icp: ["US", "AI", "hiring", "seed"] }).reason,
    "Matched US, AI, hiring",
    "joined into a sentence and capped — a tag dump is not a reason",
  );
});

Deno.test("11. blank strings do not satisfy the chain", () => {
  // `''` and `'   '` are present-but-empty and would end the chain early,
  // leaving the card with a blank region where a reason belongs.
  const c = buildLeadCard({
    ...QUALIFIED, why_this_lead: "   ", fit_reason: "", matched_icp: ["US"],
  });
  assertEquals(c.reason, "Matched US");
});

Deno.test("12. nothing to say is null, not an empty sentence", () => {
  assertEquals(buildLeadCard({ ...QUALIFIED, matched_icp: [] }).reason, null);
});

// ═══ 4. THE SIGNAL ═════════════════════════════════════════════════════════

Deno.test("13. the title beats the summary", () => {
  // The title is the specific fact; the summary is prose about it.
  const c = buildLeadCard({
    ...QUALIFIED,
    signal_title: "Hiring 3 senior ML engineers",
    signal_summary: "This company appears to be growing its ML team.",
  });
  assertEquals(c.signal, "Hiring 3 senior ML engineers");
});

Deno.test("14. the summary is used when there is no title", () => {
  const c = buildLeadCard({ ...QUALIFIED, signal_summary: "Raised a Series B" });
  assertEquals(c.signal, "Raised a Series B");
});

Deno.test("15. the source link is repaired like the website", () => {
  const c = buildLeadCard({ ...QUALIFIED, signal_source_url: "linkedin.com/jobs/123" });
  assertEquals(c.signalHref, "https://linkedin.com/jobs/123");
});

// ═══ 5. STATE AND NEXT STEP ════════════════════════════════════════════════

Deno.test("16. accepted WITH a contact is ready", () => {
  const c = buildLeadCard({ ...QUALIFIED, contact_name: "Dana Reyes" });
  assertEquals(c.state, "ready");
  assertEquals(c.stateLabel, "Ready to contact");
  assertEquals(c.nextStep, null,
    "a finished lead needs no suggestion; the action bar owns what happens next");
});

Deno.test("17. accepted WITHOUT a contact says exactly what is missing", () => {
  const c = buildLeadCard(QUALIFIED);
  assertEquals(c.state, "needs_contact");
  assertEquals(c.stateLabel, "No contact yet");
  assertEquals(c.nextStep, "Find decision-makers");
});

Deno.test("18. AN UNACCEPTED ROW IS `still checking`, NEVER READY", () => {
  // The scar: `level !== 'not_qualified'` once reported 20 qualified companies
  // for a run that qualified none. A row with no decision-maker status has not
  // been accepted, however much else it carries.
  const c = buildLeadCard({
    company_name: "Beta Corp", contact_name: "Someone", fit_score: 99,
  });
  assertEquals(c.state, "in_review");
  assertEquals(c.stateLabel, "Still checking");
  assert(c.state !== "ready", "a high score is not an acceptance");
});

Deno.test("19. the three states have three distinct labels", () => {
  const labels = ["ready", "needs_contact", "in_review"].map((s) =>
    buildLeadCard(
      s === "ready" ? { ...QUALIFIED, contact_name: "X" }
      : s === "needs_contact" ? QUALIFIED
      : { company_name: "C" },
    ).stateLabel
  );
  assertEquals(new Set(labels).size, 3);
});

// ═══ 6. WORDING ════════════════════════════════════════════════════════════

Deno.test("20. no internal vocabulary on the card", () => {
  const src = Deno.readTextFileSync(new URL(
    "../../src/lib/workbench/leadCard.ts", import.meta.url));
  // Only the strings the card RETURNS — the file's comments explain what these
  // terms were, which is exactly the mistake that failed three of my earlier
  // assertions.
  const returned = (src.slice(src.indexOf("const STATE_LABEL")).match(/'[^']{4,}'/g) ?? []).join(" ");
  for (const jargon of ["contact-ready", "Tier A", "Company Brain", "decision-maker status"]) {
    assert(!returned.toLowerCase().includes(jargon.toLowerCase()),
      `"${jargon}" is machinery, not the reader's situation: ${returned}`);
  }
});

Deno.test("21. an unknown company is named, not blank", () => {
  assertEquals(buildLeadCard({}).company, "Unknown company");
});

// ═══ 7. THE SEVEN FACTS ACTUALLY REACH THE SCREEN ══════════════════════════

Deno.test("22. every required field is rendered by the card", () => {
  const card = Deno.readTextFileSync(new URL(
    "../../src/components/chat/workspace/workbench/leadTable/LeadCard.tsx", import.meta.url));
  for (const [field, token] of [
    ["company", "model.company"],
    ["website", "model.websiteLabel"],
    ["strongest signal", "model.signal"],
    ["fit", "model.fit"],
    ["why it was accepted", "model.reason"],
    ["current status", "model.stateLabel"],
    ["next step", "model.nextStep"],
  ] as const) {
    assert(card.includes(token), `the card must render ${field} (${token})`);
  }
});

Deno.test("23. and NOTHING scrolls horizontally", () => {
  // `w-max min-w-full` on the old table is what put Fit and Status off the
  // right edge. A card that reintroduces it reintroduces the whole defect.
  const list = Deno.readTextFileSync(new URL(
    "../../src/components/chat/workspace/workbench/leadTable/LeadCardList.tsx", import.meta.url));
  const card = Deno.readTextFileSync(new URL(
    "../../src/components/chat/workspace/workbench/leadTable/LeadCard.tsx", import.meta.url));
  // COMMENTS STRIPPED. These tests describe what was removed, so the prose
  // explaining the fix names the very class the fix deletes — the fourth time
  // in this redesign that a source-reading assertion failed on its own
  // commentary. Read code, never the explanation of the code.
  const code = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [name, src] of [["list", code(list)], ["card", code(card)]] as const) {
    assert(!/w-max/.test(src), `${name} must not size to its content`);
    assert(!/overflow-x/.test(src), `${name} must not scroll sideways`);
  }
});

Deno.test("24. the fourteen-column table is GONE, not merely unused", () => {
  // 484 lines of unreachable UI would only rot. Its one real guarantee — that
  // the unlock affordance advertises no price it does not charge — moved to
  // `lockedCellCost.test.ts`, which now reads the card.
  for (const p of ["LeadTable.tsx", "LockedCell.tsx"]) {
    let exists = true;
    try {
      Deno.readTextFileSync(new URL(
        `../../src/components/chat/workspace/workbench/leadTable/${p}`, import.meta.url));
    } catch {
      exists = false;
    }
    assert(!exists, `${p} must be deleted, not left importing nothing`);
  }
});

Deno.test("25. the detail those padlocks gated is still reachable", () => {
  // Decision-makers, contact hints, enrichment and drafts live in the drawer,
  // which every card opens. It was always the better home: a drawer shows one
  // company properly; a locked cell showed a padlock and a price.
  const drawer = Deno.readTextFileSync(new URL(
    "../../src/components/chat/workspace/workbench/leadTable/LeadDetailDrawer.tsx", import.meta.url));
  for (const section of ["Decision-makers", "Contact hint", "Enrichment"]) {
    assert(drawer.includes(section), `the drawer must still show "${section}"`);
  }
  const list = Deno.readTextFileSync(new URL(
    "../../src/components/chat/workspace/workbench/leadTable/LeadCardList.tsx", import.meta.url));
  assert(list.includes("onOpen(row)"), "and every card opens it");
});
