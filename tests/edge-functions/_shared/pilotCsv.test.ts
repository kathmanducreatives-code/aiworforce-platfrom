// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CsvRefusal,
  parsePilotCsv,
} from "../../../supabase/functions/_shared/pilot/pilotCsv.ts";
import { previewCsv } from "../../../supabase/functions/_shared/pilot/pilotImportContract.ts";
const basic = "Company,Website\nSynthetic,synthetic-co.com";
const mapping = { Company: "company_name", Website: "company_domain" };
Deno.test("P3 parser BOM, CRLF, quoted comma/newline and escaped quotes", () => {
  assertEquals(
    parsePilotCsv(
      '\uFEFFCompany,Website,Notes\r\n"Synth, Inc",synthetic-co.com,"line 1\nline 2 ""quoted"""\r\n',
    ),
    {
      headers: ["Company", "Website", "Notes"],
      rows: [["Synth, Inc", "synthetic-co.com", 'line 1\nline 2 "quoted"']],
    },
  );
});
for (
  const [name, csv] of [
    ["empty", ""],
    ["header only", "a,b\n"],
    ["unclosed", 'a,b\nx,"bad'],
    ["partial quote", 'a,b\nx,b"ad'],
    ["quote suffix", 'a,b\nx,"bad" x'],
    ["duplicate header", "Company,company\na,b"],
    ["empty header", "a,\nx,y"],
    ["short row", "a,b\nx"],
    ["long row", "a,b\nx,y,z"],
    ["empty row", "a,b\n,"],
    ["bare CR", "a,b\rx,y"],
    ["null", "a,b\nx,\u0000"],
    ["bidi", "a,b\nx,\u202e"],
    ["replacement", "a,b\nx,\ufffd"],
    ["formula", "a,b\nx, =SUM(A1)"],
    ["plus", "a,b\nx,+danger"],
    ["minus", "a,b\nx,-danger"],
    ["at", "a,b\nx,@danger"],
    ["ownership ignored", "Company,Workspace ID\na,b"],
    ["client contamination", "Client Name,Website\na,b"],
    ["oversize cell", "a,b\nx," + "a".repeat(2049)],
    ["oversize file", "a".repeat(250001)],
    ["26 rows", "a,b\n" + Array(26).fill("x,y").join("\n")],
    ["41 columns", Array(41).fill("a").join(",") + "\nx,y"],
  ] as const
) {
  Deno.test(`P3 malformed CSV rejects: ${name}`, () => {
    assertThrows(() => parsePilotCsv(csv), CsvRefusal);
  });
}
for (
  const bad of [
    null,
    [],
    {},
    { ...mapping, hidden: null },
    { Company: "company_name" },
    { Company: "workspace_id", Website: "company_domain" },
    { Company: "company_name", Website: "company_name" },
    { Company: null, Website: "company_domain" },
  ]
) {
  Deno.test(`P3 unsafe/incomplete mapping rejects: ${JSON.stringify(bad)}`, async () => {
    await assertRejects(() => previewCsv(basic, bad), CsvRefusal);
  });
}
for (
  const value of [
    "http://127.0.0.1",
    "http://localhost",
    "https://x.internal",
    "https://x.com:8080",
    "https://user:pass@x.com",
    "javascript:alert(1)",
    "https://x.com/?token=secret",
    "https://x.com/path",
    "https://x.com/#hash",
    "https://-bad.com",
  ]
) {
  Deno.test(`P3 invalid/unsafe company URL: ${value}`, async () => {
    await assertRejects(
      () => previewCsv("Company,Website\nSynthetic," + value, mapping),
      CsvRefusal,
    );
  });
}
Deno.test("P3 exact duplicates collapse, retain record ordinals, opaque IDs and explicit omissions", async () => {
  const csv = await Deno.readTextFile(
    "tests/fixtures/pilot-csv/apollo-synthetic.csv",
  );
  const r = await previewCsv(csv, {
    ...mapping,
    "First Name": "first_name",
    "Last Name": "last_name",
    Title: "contact_title",
    Email: "contact_email",
    "Apollo Contact Id": "apollo_contact_id",
    "Apollo Account Id": "apollo_account_id",
    Updated: "source_updated_at",
    Notes: null,
  });
  assertEquals(r.rows.length, 1);
  assertEquals(r.input_rows, 2);
  assertEquals(r.duplicate_rows, 1);
  assertEquals(r.rows[0].source_rows, [2, 3]);
  assertEquals(r.omitted_headers, ["Notes"]);
  assertEquals(r.rows[0].normalized.apollo_contact_id, "person-synthetic-1");
  assertEquals(r.rows[0].normalized.source_updated_at, "2026-01-01T12:00:00Z");
});
Deno.test("P3 missing source dates stay missing, no freshness or verified employer claim", async () => {
  const r = await previewCsv(basic, mapping);
  assertEquals(r.rows[0].normalized.source_updated_at, undefined);
  assertEquals(r.rows[0].warnings.includes("source_timestamp_missing"), true);
  assertEquals(
    r.rows[0].warnings.includes("employer_association_unverified"),
    true,
  );
});
for (
  const [name, csv, map] of [
    [
      "same person different employer",
      "Company,Website,Person,Name\nA,aaa.com,p1,Ada\nB,bbb.com,p1,Ada",
      { ...mapping, Person: "apollo_contact_id", Name: "contact_name" },
    ],
    [
      "same email conflicting fields",
      "Company,Website,Email,Name\nA,aaa.com,a@aaa.com,Ada\nA,aaa.com,a@aaa.com,Other",
      { ...mapping, Email: "contact_email", Name: "contact_name" },
    ],
    [
      "account mismatched identity",
      "Company,Website,Account\nA,aaa.com,a1\nB,bbb.com,a1",
      { ...mapping, Account: "apollo_account_id" },
    ],
    ["invalid email", "Company,Website,Email\nA,aaa.com,noemail", {
      ...mapping,
      Email: "contact_email",
    }],
    [
      "invalid timestamp",
      "Company,Website,Date\nA,aaa.com,2026-02-30T00:00:00Z",
      { ...mapping, Date: "source_updated_at" },
    ],
    ["ambiguous name", "Company,Website,Full,First\nA,aaa.com,Ada,Ada", {
      ...mapping,
      Full: "contact_name",
      First: "first_name",
    }],
    [
      "person linkedin wrong kind",
      "Company,Website,Linkedin\nA,aaa.com,https://www.linkedin.com/company/a",
      { ...mapping, Linkedin: "contact_linkedin_url" },
    ],
  ] as const
) {
  Deno.test(`P3 identity ambiguity rejects: ${name}`, async () => {
    await assertRejects(() => previewCsv(csv, map), CsvRefusal);
  });
}
Deno.test("P3 positive company-only provisional record and LinkedIn-only company identity", async () => {
  const r = await previewCsv(
    "Company,LinkedIn\nSynthetic,https://linkedin.com/company/synthetic/",
    { Company: "company_name", LinkedIn: "company_linkedin_url" },
  );
  assertEquals(
    r.rows[0].normalized.company_linkedin_url,
    "https://www.linkedin.com/company/synthetic",
  );
  assertEquals(
    r.rows[0].warnings.includes("no_apollo_contact_writeback_identity"),
    true,
  );
});

Deno.test("P3 compact scope headers and invalid lone Unicode surrogates reject", () => {
  for (
    const csv of [
      "Company,WorkspaceId\nA,B",
      "Company,ClientId\nA,B",
      "Company,Website\nA,\ud800",
    ]
  ) assertThrows(() => parsePilotCsv(csv), CsvRefusal);
});
