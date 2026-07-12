import { describe, it, expect } from "vitest";
import { hiringCardVM, postCardVM, fundingCardVM, commentCardVM, competitorCardVM, cleanLabel } from "./radarCardPresenter";

describe("radar card presenters", () => {
  it("hiring card surfaces company + exact role + decision (role never buried)", () => {
    const vm = hiringCardVM({
      signal_type: "hiring", title: "Acme is hiring", source_url: "https://acme.com/jobs/1",
      raw: { source_details: { company: "Acme", job_title: "RevOps Manager", location: "US", posted_at: "2026-07-01" }, role_family: "exact", why_it_matters: "This matters because…", canonical_decision: "watch", can_draft_outreach: false },
    });
    expect(vm.company).toBe("Acme");
    expect(vm.role).toBe("RevOps Manager");
    expect(vm.role_family).toBe("exact");
    expect(vm.decision).toBe("watch");
    expect(vm.can_draft_outreach).toBe(false);
    expect(vm.evidence_url).toBe("https://acme.com/jobs/1");
  });

  it("post card never fabricates engagement (label absent when row has none)", () => {
    const vm = postCardVM({ signal_type: "linkedin_post", title: "AI GTM playbook", source_url: "https://linkedin.com/posts/1", raw: { source_details: { author: "Jane" } } });
    expect(vm.engagement_label).toBeNull(); // no "viral"/count invented
    expect(vm.author).toBe("Jane");
  });

  it("funding card shows round/amount/date only when present", () => {
    const none = fundingCardVM({ signal_type: "funding", title: "x", source_url: "https://n.com/a", raw: { source_details: { company: "Acme" } } });
    expect(none.amount).toBeNull();
    expect(none.round).toBeNull();
    expect(none.announced_date).toBeNull();
    const some = fundingCardVM({ signal_type: "funding", title: "x", source_url: "https://n.com/a", raw: { source_details: { company: "Acme", funding_amount: "$2M", funding_round: "Seed" } } });
    expect(some.amount).toBe("$2M");
    expect(some.round).toBe("Seed");
  });

  it("comment card preserves parent post evidence; competitor card carries class", () => {
    const c = commentCardVM({ signal_type: "linkedin_comment", title: "How did you build this?", source_url: null, raw: { source_details: { commenter: "Sam", parent_post_url: "https://linkedin.com/posts/9" }, intent: "implementation" } });
    expect(c.parent_post_url).toBe("https://linkedin.com/posts/9");
    expect(c.intent).toBe("implementation");
    const comp = competitorCardVM({ signal_type: "competitor", title: "x", source_url: "https://c.com/x", raw: { competitor_class: "direct", change_detected: "launched pricing" } });
    expect(comp.competitor_class).toBe("direct");
    expect(comp.change).toBe("launched pricing");
  });

  it("cleanLabel collapses duplicate labels", () => {
    expect(cleanLabel("Active hiring: Active hiring")).toBe("Active hiring");
    expect(cleanLabel("Funding")).toBe("Funding");
  });
});
