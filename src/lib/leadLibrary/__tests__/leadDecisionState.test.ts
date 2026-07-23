// Deterministic tests for the canonical Lead Library decision layer.
//
// These verify the rules that the previous surface got wrong — poor fit
// accounts with a legacy draft never become "qualified", buyer alone never
// promotes to draft-ready, engagement progression overrides preparation
// stages, and readiness counters strictly cascade. Runnable under vitest
// when the harness is configured.

import { describe, expect, it } from "vitest";
import type { LeadRow } from "../types";
import {
  deriveLeadDecisionState,
  countByKey,
  sortRows,
  fitBandFromScore,
} from "../leadDecisionState";

function baseRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: overrides.id ?? "row-1",
    workspaceId: "ws-1",
    name: "Acme",
    domain: "acme.io",
    websiteUrl: null,
    linkedinUrl: null,
    industry: null,
    employeeCount: null,
    location: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    accountStatus: "new",
    contactReadiness: "no_contact",
    outreachStatus: "not_generated",
    engagementStatus: "not_contacted",
    linkedinStatus: "not_started",
    emailStatus: "unavailable",
    phoneStatus: "not_attempted",
    fitScore: 70,
    fitTier: "good",
    whySelected: null,
    sources: [],
    strongestSource: null,
    searchRunIds: [],
    selectedRecipient: null,
    alternateRecipients: [],
    opener: null,
    lastActivity: null,
    primaryChannel: null,
    lists: [],
    tags: [],
    followUpAt: null,
    owner: null,
    possibleDuplicateOf: null,
    ...overrides,
  };
}

describe("fit band", () => {
  it("maps score ranges", () => {
    expect(fitBandFromScore(85)).toBe("strong");
    expect(fitBandFromScore(65)).toBe("good");
    expect(fitBandFromScore(45)).toBe("soft");
    expect(fitBandFromScore(20)).toBe("poor");
    expect(fitBandFromScore(null)).toBe("unknown");
  });
});

describe("decision rules", () => {
  it("poor fit + draft does not become qualified", () => {
    const r = baseRow({
      fitScore: 28,
      accountStatus: "soft_mismatch",
      opener: {
        id: "o1", bodyPreview: "...", fullBody: "...",
        recipientName: "X", status: "draft_ready", generatedAt: null,
        evidenceCount: 1, personalizationDepth: "specific",
      },
      strongestSource: {
        discoveryMethod: "manual", sourceType: "note", headline: "Legacy",
        url: null, author: null, publishedAt: null, observedAt: null,
        freshness: null, confidence: null, searchQuery: null, searchRunId: null,
      },
    });
    const s = deriveLeadDecisionState(r);
    expect(s.decision).toBe("watch");
    expect(s.lifecycle).not.toBe("qualified");
    expect(s.nextAction).toBe("review_evidence");
  });

  it("verified buyer alone does not become qualified", () => {
    const r = baseRow({
      accountStatus: "researching",
      contactReadiness: "verified",
      selectedRecipient: { id: "r", fullName: "A", title: "T", linkedinUrl: null, email: "a@a.com", phone: null, verified: true },
      strongestSource: {
        discoveryMethod: "job", sourceType: "job_posting", headline: "Hiring",
        url: null, author: null, publishedAt: null, observedAt: null,
        freshness: null, confidence: null, searchQuery: null, searchRunId: null,
      },
    });
    const s = deriveLeadDecisionState(r);
    expect(s.lifecycle).toBe("discovered");
  });

  it("qualified + verified buyer + draft ⇒ awaiting approval when approved", () => {
    const r = baseRow({
      accountStatus: "qualified",
      contactReadiness: "verified",
      selectedRecipient: { id: "r", fullName: "A", title: "T", linkedinUrl: null, email: "a@a.com", phone: null, verified: true },
      opener: { id: "o", bodyPreview: "...", fullBody: "...", recipientName: "A", status: "approved", generatedAt: null, evidenceCount: 2, personalizationDepth: "deep" },
      strongestSource: {
        discoveryMethod: "job", sourceType: "job_posting", headline: "Hiring",
        url: null, author: null, publishedAt: null, observedAt: null,
        freshness: "fresh", confidence: "verified", searchQuery: null, searchRunId: null,
      },
    });
    const s = deriveLeadDecisionState(r);
    expect(s.lifecycle).toBe("awaiting_approval");
    expect(s.nextAction).toBe("approve_draft");
    expect(s.decision).toBe("contact");
  });

  it("contacted overrides preparation stages", () => {
    const r = baseRow({
      engagementStatus: "contacted",
      accountStatus: "qualified",
      strongestSource: {
        discoveryMethod: "engagement", sourceType: "reply", headline: "Replied",
        url: null, author: null, publishedAt: null, observedAt: null,
        freshness: null, confidence: null, searchQuery: null, searchRunId: null,
      },
    });
    expect(deriveLeadDecisionState(r).lifecycle).toBe("contacted");
  });

  it("archived ⇒ skip", () => {
    expect(deriveLeadDecisionState(baseRow({ accountStatus: "archived" })).decision).toBe("skip");
  });
});

describe("counter invariants", () => {
  const rows = [
    baseRow({ id: "1", accountStatus: "qualified", contactReadiness: "verified",
      selectedRecipient: { id: "x", fullName: "X", title: null, linkedinUrl: null, email: null, phone: null, verified: true },
      opener: { id: "o", bodyPreview: "", fullBody: "", recipientName: "X", status: "approved", generatedAt: null, evidenceCount: 1, personalizationDepth: null },
      strongestSource: { discoveryMethod: "j", sourceType: "job", headline: "h", url: null, author: null, publishedAt: null, observedAt: null, freshness: null, confidence: null, searchQuery: null, searchRunId: null },
    }),
    baseRow({ id: "2", fitScore: 25, accountStatus: "soft_mismatch",
      opener: { id: "o2", bodyPreview: "", fullBody: "", recipientName: null, status: "draft_ready", generatedAt: null, evidenceCount: 0, personalizationDepth: null },
      strongestSource: { discoveryMethod: "m", sourceType: "n", headline: "l", url: null, author: null, publishedAt: null, observedAt: null, freshness: null, confidence: null, searchQuery: null, searchRunId: null },
    }),
    baseRow({ id: "3" }),
  ];
  const states = rows.map(deriveLeadDecisionState);

  it("readiness counters strictly cascade", () => {
    const all = countByKey(states, "all");
    const q = countByKey(states, "qualified");
    const b = countByKey(states, "buyer_ready");
    const d = countByKey(states, "draft_ready");
    const a = countByKey(states, "awaiting_approval");
    expect(all).toBeGreaterThanOrEqual(q);
    expect(q).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(d);
    expect(d).toBeGreaterThanOrEqual(a);
  });

  it("poor-fit watch does not inflate qualified", () => {
    expect(countByKey(states, "qualified")).toBe(1);
  });
});

describe("sorting", () => {
  it("Contact strong+buyer beats Watch even with a fresher draft", () => {
    const strong = baseRow({ id: "strong", fitScore: 90, accountStatus: "qualified",
      contactReadiness: "verified",
      selectedRecipient: { id: "s", fullName: "S", title: null, linkedinUrl: null, email: null, phone: null, verified: true },
      strongestSource: { discoveryMethod: "j", sourceType: "job", headline: "h", url: null, author: null, publishedAt: null, observedAt: null, freshness: null, confidence: null, searchQuery: null, searchRunId: null },
      updatedAt: "2026-07-01T00:00:00Z",
    });
    const watch = baseRow({ id: "watch", fitScore: 22, accountStatus: "soft_mismatch",
      opener: { id: "o", bodyPreview: "", fullBody: "", recipientName: null, status: "draft_ready", generatedAt: null, evidenceCount: 0, personalizationDepth: null },
      updatedAt: "2026-07-22T00:00:00Z",
    });
    const rows = [watch, strong];
    const states = new Map(rows.map((r) => [r.id, deriveLeadDecisionState(r)]));
    const sorted = sortRows(rows, states, "recommended");
    expect(sorted[0].id).toBe("strong");
  });
});
