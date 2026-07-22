// Read-model integration for verified contact-to-account association:
// once contacts carry account_id, the canonical Lead Library view must surface
// them across ALL of an account's plan-scoped rows, exclude other accounts'
// contacts, and keep the selected recipient stable.
//
// Synthetic fixtures only; no network/db/provider/model.

import { describe, it, expect } from "vitest";
import { deriveCanonicalLeadView, type CanonicalAccount, type CanonicalContact } from "./canonicalLeadView";

const WS = "ws-1";
const ACC = "acc-1";
const account: CanonicalAccount = { id: ACC, workspace_id: WS, name: "Harmonic", domain: "harmonic.security", created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-20T00:00:00Z" };

// Four plan-scoped lead rows; the OPENER (representative) is on l3, but the
// account-associated contact was discovered on l1.
const leads = ["l1", "l2", "l3", "l4"].map((id) => ({ id, workspace_id: WS, account_id: ACC, plan_id: `plan-${id}`, updated_at: "2026-07-20T14:00:00Z", raw: id === "l3" ? { agentory_workbench: { outreach: { status: "succeeded", last_success: { status: "succeeded", opener: "Hi Kenneth", generated_at: "2026-07-20T14:00:00Z", sent: false, selected_contact_id: "c-ken", selected_recipient_name: "Kenneth" } } } } : {} }));

const contacts: CanonicalContact[] = [
  { id: "c-ken", workspace_id: WS, account_id: ACC, full_name: "Kenneth", email: "ken@harmonic.security" },
  { id: "c-foreign", workspace_id: WS, account_id: "other-acc", full_name: "Amy", email: "amy@x.com" },
];

describe("verified contact association in the read model", () => {
  const view = deriveCanonicalLeadView({ workspaceId: WS, account, leadCandidates: leads, contacts });

  it("27. account-associated contact appears regardless of the representative plan row", () => {
    // Kenneth (account_id = ACC) is available even though the representative row
    // (l3) is not where he was discovered.
    expect(view.contacts.verifiedContacts.map((c) => c.fullName)).toContain("Kenneth");
  });

  it("28. a contact from another account is excluded", () => {
    expect(view.contacts.verifiedContacts.map((c) => c.fullName)).not.toContain("Amy");
  });

  it("29. contact count is deduplicated across the four plan rows (one canonical contact)", () => {
    expect(view.contacts.verifiedContacts.length).toBe(1);
    expect(view.leadRows.duplicatePlanRowCount).toBe(4);
  });

  it("30. the selected recipient stays the one recorded with the message", () => {
    expect(view.contacts.selectedRecipient?.fullName).toBe("Kenneth");
    expect(view.contacts.selectedRecipientSource).toBe("persisted_outreach");
  });

  it("contacts with account_id = null are not surfaced as verified account contacts", () => {
    const withNull = deriveCanonicalLeadView({ workspaceId: WS, account, leadCandidates: leads, contacts: [{ id: "c-null", workspace_id: WS, account_id: null, full_name: "Unlinked", email: "u@x.com" }] });
    expect(withNull.contacts.verifiedContacts.length).toBe(0);
  });
});
