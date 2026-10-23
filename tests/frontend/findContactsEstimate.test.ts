// The multi-row "Find decision-makers" estimate quotes what the backend
// charges: the row button's price, once per row that needs a contact.
// It quoted 1 per row while the row button (and the reserve) said 2.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { estimateCredits } from "../../src/components/chat/workspace/workbench/leadTable/credits.ts";
import { priceFor } from "../../src/lib/credits/pricing.ts";

Deno.test("find_contacts estimate = rows needing a contact × the quoted decision-maker price", () => {
  const rows = [{ contact_status: "needs_contact" }, { contact_status: "needs_contact" }, { contact_status: "profile_found" }];
  assertEquals(priceFor("find_decision_makers"), 2);
  assertEquals(estimateCredits("find_contacts", rows as never), 2 * priceFor("find_decision_makers"));
});
