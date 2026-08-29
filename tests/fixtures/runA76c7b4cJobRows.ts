// THE 84 PAID JOB ROWS OF TASK a76c7b4c, FROZEN.
//
// Production run a76c7b4c-86b4-4171-b0cf-22991e59c267, 2026-08-29 07:53–07:56.
// Mission: "Find 5 recruiting or staffing companies that fit my ICP and are
// actively hiring sales roles." Two paid `harvestapi/linkedin-job-search`
// calls, both SUCCEEDED inside the same slice — no pending run, no adoption:
//
//   trO1fr5ug9QypaIeg  dataset xwplzitZRhdyrYnxM   7 rows  $0.026
//     asked about: sotalentjobs, storm4, atlas-search
//   4FMrYDNdMXzZ8ffYz  dataset 9PmBd3YDE6fdBCZyl  77 rows  $0.066
//     asked about: storm3, pursuit-sales-solutions
//
// The engine RECEIVED both — `capability_execution_state.provider_attempts`
// records `rows: 7` and `rows: 77`, outcome `ok`. It then reported
// `hiring_verification: rows 0, "no company had a relevant commercial role"`
// and resolved all five companies to `hiring: "not_verified"`.
//
// Read back from the Apify datasets and projected to exactly the fields
// `normalizeLinkedInJob` and `normalizeApifyJobRow` read. Nothing invented,
// nothing renamed: this is the provider's own row shape.

/** One row as the Actor's dataset holds it. */
export interface FrozenJobRow {
  id: string;
  title: string;
  linkedinUrl: string | null;
  workplaceType?: string | null;
  postedDate?: string | null;
  location: { linkedinText: string | null };
  company: { id: string | null; name: string | null; linkedinUrl: string | null };
}

/** What each paid call asked about, in the order the engine batched them. */
export const RUN_A76C7B4C_BATCHES: ReadonlyArray<{
  run_id: string; dataset_id: string; companies: readonly string[];
}> = [
  {
    run_id: "trO1fr5ug9QypaIeg", dataset_id: "xwplzitZRhdyrYnxM",
    companies: [
      "https://www.linkedin.com/company/sotalentjobs",
      "https://www.linkedin.com/company/storm4",
      "https://www.linkedin.com/company/atlas-search",
    ],
  },
  {
    run_id: "4FMrYDNdMXzZ8ffYz", dataset_id: "9PmBd3YDE6fdBCZyl",
    companies: [
      "https://www.linkedin.com/company/storm3",
      "https://www.linkedin.com/company/pursuit-sales-solutions",
    ],
  },
];

/** The 20 job titles both calls carried — `hiringSearchTitles(role_vocabulary)`. */
export const RUN_A76C7B4C_SEARCH_TITLES: readonly string[] = [
  "sales roles", "sdr", "bdr", "sales development representative",
  "account executive", "founding sdr", "founding ae", "head of sales",
  "growth", "gtm", "go to market", "business development",
  "demand generation", "revenue", "salesperson", "sales representative",
  "territory sales manager", "ae", "enterprise ae", "seller",
];

/** Dataset xwplzitZRhdyrYnxM — 7 rows. */
export const RUN_A76C7B4C_BATCH_1_ROWS: readonly FrozenJobRow[] = [
  {
    "id": "4457350203",
    "title": "Sales Director",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4457350203/",
    "workplaceType": "remote",
    "postedDate": "2026-08-21T12:58:47.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "71303127",
      "name": "Storm4",
      "linkedinUrl": "https://www.linkedin.com/company/storm4"
    }
  },
  {
    "id": "4458230555",
    "title": "Sales Director",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458230555/",
    "workplaceType": "remote",
    "postedDate": "2026-08-24T15:25:34.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "71303127",
      "name": "Storm4",
      "linkedinUrl": "https://www.linkedin.com/company/storm4"
    }
  },
  {
    "id": "4456929214",
    "title": "IR and BD Specialist ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4456929214/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-25T13:46:13.000Z",
    "location": {
      "linkedinText": "Boston, MA"
    },
    "company": {
      "id": "4872007",
      "name": "Atlas Search",
      "linkedinUrl": "https://www.linkedin.com/company/atlas-search"
    }
  },
  {
    "id": "4457703588",
    "title": "Accountant",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4457703588/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-26T22:49:29.000Z",
    "location": {
      "linkedinText": "Irving, TX"
    },
    "company": {
      "id": "106203357",
      "name": "SoTalent",
      "linkedinUrl": "https://www.linkedin.com/company/sotalentjobs"
    }
  },
  {
    "id": "4459306153",
    "title": "Senior Originator",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459306153/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-26T13:04:48.000Z",
    "location": {
      "linkedinText": "Texas, United States"
    },
    "company": {
      "id": "71303127",
      "name": "Storm4",
      "linkedinUrl": "https://www.linkedin.com/company/storm4"
    }
  },
  {
    "id": "4459306153",
    "title": "Senior Originator",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459306153/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-26T13:04:48.000Z",
    "location": {
      "linkedinText": "Texas, United States"
    },
    "company": {
      "id": "71303127",
      "name": "Storm4",
      "linkedinUrl": "https://www.linkedin.com/company/storm4"
    }
  },
  {
    "id": "4453114358",
    "title": "Inside Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4453114358/",
    "workplaceType": "remote",
    "postedDate": "2026-08-12T12:09:59.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "71303127",
      "name": "Storm4",
      "linkedinUrl": "https://www.linkedin.com/company/storm4"
    }
  }
];

/** Dataset 9PmBd3YDE6fdBCZyl — 77 rows. */
export const RUN_A76C7B4C_BATCH_2_ROWS: readonly FrozenJobRow[] = [
  {
    "id": "4454055125",
    "title": "Medical Sales Specialist",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4454055125/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-24T14:39:41.000Z",
    "location": {
      "linkedinText": "Richmond, VA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4459045687",
    "title": "Entry Level Outside Sales",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459045687/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-26T13:03:37.000Z",
    "location": {
      "linkedinText": "San Antonio, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4455378670",
    "title": "Entry Level Outside Sales",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4455378670/",
    "workplaceType": "remote",
    "postedDate": "2026-08-17T22:00:58.000Z",
    "location": {
      "linkedinText": "San Antonio, Texas Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4437679834",
    "title": "Strategic Sales Specialist",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4437679834/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-26T13:26:02.000Z",
    "location": {
      "linkedinText": "Lewisville, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4433890041",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4433890041/",
    "workplaceType": "remote",
    "postedDate": "2026-08-19T01:55:08.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449922186",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449922186/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-18T15:36:51.000Z",
    "location": {
      "linkedinText": "Dallas-Fort Worth Metroplex"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4437454870",
    "title": "Business Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4437454870/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-04T15:10:49.000Z",
    "location": {
      "linkedinText": "Fort Worth, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4433890041",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4433890041/",
    "workplaceType": "remote",
    "postedDate": "2026-08-19T01:55:08.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449922186",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449922186/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-18T15:36:51.000Z",
    "location": {
      "linkedinText": "Dallas-Fort Worth Metroplex"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4457502979",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4457502979/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-21T22:20:34.000Z",
    "location": {
      "linkedinText": "Dallas, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4448889945",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4448889945/",
    "workplaceType": "remote",
    "postedDate": "2026-08-04T15:54:20.000Z",
    "location": {
      "linkedinText": "Greater Seattle Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4458265865",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458265865/",
    "workplaceType": "remote",
    "postedDate": "2026-08-24T19:13:09.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4445959727",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4445959727/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-24T16:13:14.000Z",
    "location": {
      "linkedinText": "Dallas, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4460523249",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4460523249/",
    "workplaceType": "remote",
    "postedDate": "2026-08-28T21:37:01.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4456342691",
    "title": "Enterprise Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4456342691/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-19T17:27:57.000Z",
    "location": {
      "linkedinText": "Columbus, OH"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4455347794",
    "title": "Enterprise Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4455347794/",
    "workplaceType": "remote",
    "postedDate": "2026-08-17T18:35:49.000Z",
    "location": {
      "linkedinText": "Illinois, United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4456363415",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4456363415/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-19T19:10:57.000Z",
    "location": {
      "linkedinText": "Austin, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4451441618",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4451441618/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-10T20:11:21.000Z",
    "location": {
      "linkedinText": "New York City Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4450626437",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4450626437/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-06T19:27:15.000Z",
    "location": {
      "linkedinText": "Dallas, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4458516364",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458516364/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-24T22:09:00.000Z",
    "location": {
      "linkedinText": "Toledo, Ohio Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4416238171",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4416238171/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-10T21:22:49.000Z",
    "location": {
      "linkedinText": "Los Angeles Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4456363874",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4456363874/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-19T19:59:26.000Z",
    "location": {
      "linkedinText": "Washington, DC"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4437415619",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4437415619/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-03T20:22:31.000Z",
    "location": {
      "linkedinText": "Riverside County, CA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4455309342",
    "title": "Enterprise Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4455309342/",
    "workplaceType": "remote",
    "postedDate": "2026-08-17T15:15:33.000Z",
    "location": {
      "linkedinText": "Chicago, IL"
    },
    "company": {
      "id": "70915780",
      "name": "Storm3",
      "linkedinUrl": "https://www.linkedin.com/company/storm3"
    }
  },
  {
    "id": "4442128872",
    "title": "Territory Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4442128872/",
    "workplaceType": "remote",
    "postedDate": "2026-08-24T21:11:29.000Z",
    "location": {
      "linkedinText": "Suffern, NY"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449918088",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449918088/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-05T21:17:40.000Z",
    "location": {
      "linkedinText": "Cleveland, OH"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4423520810",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4423520810/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-24T13:41:18.000Z",
    "location": {
      "linkedinText": "Austin, Texas Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4442173656",
    "title": "Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4442173656/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-13T14:41:48.000Z",
    "location": {
      "linkedinText": "Dallas, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4427647913",
    "title": "Strategic Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4427647913/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-09T20:24:24.000Z",
    "location": {
      "linkedinText": "San Francisco, CA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4433890041",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4433890041/",
    "workplaceType": "remote",
    "postedDate": "2026-08-19T01:55:08.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449922186",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449922186/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-18T15:36:51.000Z",
    "location": {
      "linkedinText": "Dallas-Fort Worth Metroplex"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4433348938",
    "title": "Sales Director",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4433348938/",
    "workplaceType": "on_site",
    "postedDate": "2026-07-23T10:32:20.000Z",
    "location": {
      "linkedinText": "New York City Metropolitan Area"
    },
    "company": {
      "id": "70915780",
      "name": "Storm3",
      "linkedinUrl": "https://www.linkedin.com/company/storm3"
    }
  },
  {
    "id": "4440321087",
    "title": "Director of Sales",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4440321087/",
    "workplaceType": "remote",
    "postedDate": "2026-08-10T13:41:26.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4456323163",
    "title": "Enterprise Sales Director",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4456323163/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-19T13:54:54.000Z",
    "location": {
      "linkedinText": "New York, NY"
    },
    "company": {
      "id": "70915780",
      "name": "Storm3",
      "linkedinUrl": "https://www.linkedin.com/company/storm3"
    }
  },
  {
    "id": "4459392728",
    "title": "Chief Revenue Officer",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459392728/",
    "workplaceType": "remote",
    "postedDate": "2026-08-27T22:03:52.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "70915780",
      "name": "Storm3",
      "linkedinUrl": "https://www.linkedin.com/company/storm3"
    }
  },
  {
    "id": "4446835778",
    "title": "New Home Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4446835778/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-19T13:35:44.000Z",
    "location": {
      "linkedinText": "Tulsa Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449000118",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449000118/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-04T14:27:27.000Z",
    "location": {
      "linkedinText": "Los Angeles Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4447072996",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4447072996/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-28T20:20:08.000Z",
    "location": {
      "linkedinText": "Atlanta Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4456369872",
    "title": "Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4456369872/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-19T20:02:30.000Z",
    "location": {
      "linkedinText": "Washington DC-Baltimore Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449673030",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449673030/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-05T17:03:03.000Z",
    "location": {
      "linkedinText": "Nashville, TN"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4458766613",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458766613/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-25T14:00:27.000Z",
    "location": {
      "linkedinText": "Raleigh, NC"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4458776690",
    "title": "Respiratory Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458776690/",
    "workplaceType": "remote",
    "postedDate": "2026-08-25T15:58:37.000Z",
    "location": {
      "linkedinText": "Rockwall, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4450644078",
    "title": "Respiratory Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4450644078/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-25T13:58:42.000Z",
    "location": {
      "linkedinText": "New Orleans, LA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4459025124",
    "title": "Media Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459025124/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-25T19:27:00.000Z",
    "location": {
      "linkedinText": "Albany, New York Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4453157098",
    "title": "Respiratory Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4453157098/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-12T16:29:32.000Z",
    "location": {
      "linkedinText": "Atlanta, GA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4459319270",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459319270/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-26T15:28:30.000Z",
    "location": {
      "linkedinText": "Los Angeles Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4459392028",
    "title": "Respiratory Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459392028/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-26T20:30:20.000Z",
    "location": {
      "linkedinText": "Albuquerque, NM"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4459835940",
    "title": "Respiratory Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459835940/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-27T16:09:45.000Z",
    "location": {
      "linkedinText": "Tucson, AZ"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4455307689",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4455307689/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-17T16:12:55.000Z",
    "location": {
      "linkedinText": "Arizona, United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4459051091",
    "title": "Media Account Executive",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4459051091/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-25T21:37:47.000Z",
    "location": {
      "linkedinText": "Charlotte, NC"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4446219203",
    "title": "Sales Representative - Trade Show Exhibit Design (REMOTE)",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4446219203/",
    "workplaceType": "remote",
    "postedDate": "2026-08-03T13:47:55.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4453376049",
    "title": "Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4453376049/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-12T20:45:58.000Z",
    "location": {
      "linkedinText": "Atlanta, GA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449007114",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449007114/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-04T16:06:29.000Z",
    "location": {
      "linkedinText": "Pikesville, MD"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4458793852",
    "title": "Respiratory Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458793852/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-25T17:01:57.000Z",
    "location": {
      "linkedinText": "Grand Rapids, MI"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4458796400",
    "title": "Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458796400/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-25T16:39:27.000Z",
    "location": {
      "linkedinText": "Albany, NY"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4448610083",
    "title": "Outside Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4448610083/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-24T14:39:49.000Z",
    "location": {
      "linkedinText": "Kansas City Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4454284616",
    "title": "Senior Technical Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4454284616/",
    "workplaceType": "remote",
    "postedDate": "2026-08-17T14:30:48.000Z",
    "location": {
      "linkedinText": "New Jersey, United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4458213883",
    "title": "Outside Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4458213883/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-24T14:30:42.000Z",
    "location": {
      "linkedinText": "Greater Albany, Georgia Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4446835778",
    "title": "New Home Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4446835778/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-19T13:35:44.000Z",
    "location": {
      "linkedinText": "Tulsa Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4433890041",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4433890041/",
    "workplaceType": "remote",
    "postedDate": "2026-08-19T01:55:08.000Z",
    "location": {
      "linkedinText": "United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449000118",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449000118/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-04T14:27:27.000Z",
    "location": {
      "linkedinText": "Los Angeles Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4456369872",
    "title": "Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4456369872/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-19T20:02:30.000Z",
    "location": {
      "linkedinText": "Washington DC-Baltimore Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449922186",
    "title": "Sales Development Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449922186/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-18T15:36:51.000Z",
    "location": {
      "linkedinText": "Dallas-Fort Worth Metroplex"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4449673030",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4449673030/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-05T17:03:03.000Z",
    "location": {
      "linkedinText": "Nashville, TN"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4453143065",
    "title": "Medical Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4453143065/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-12T13:55:09.000Z",
    "location": {
      "linkedinText": "New Jersey, United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4453157098",
    "title": "Respiratory Sales Representative ",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4453157098/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-12T16:29:32.000Z",
    "location": {
      "linkedinText": "Atlanta, GA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4450775958",
    "title": "Medical Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4450775958/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-18T15:36:57.000Z",
    "location": {
      "linkedinText": "Chicago, IL"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4457535111",
    "title": "Medical Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4457535111/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-21T23:02:22.000Z",
    "location": {
      "linkedinText": "Dallas-Fort Worth Metroplex"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4380395863",
    "title": "Medical Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4380395863/",
    "workplaceType": "hybrid",
    "postedDate": "2026-04-28T19:17:08.000Z",
    "location": {
      "linkedinText": "Albuquerque-Santa Fe Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4455307689",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4455307689/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-17T16:12:55.000Z",
    "location": {
      "linkedinText": "Arizona, United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4453644351",
    "title": "Outside Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4453644351/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-13T04:45:39.000Z",
    "location": {
      "linkedinText": "Detroit Metropolitan Area"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4460510894",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4460510894/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-28T21:07:28.000Z",
    "location": {
      "linkedinText": "Brooklyn, NY"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4452609310",
    "title": "Outside Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4452609310/",
    "workplaceType": "on_site",
    "postedDate": "2026-08-11T18:11:08.000Z",
    "location": {
      "linkedinText": "Nassau County, NY"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4450600752",
    "title": "Outside Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4450600752/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-06T17:50:03.000Z",
    "location": {
      "linkedinText": "Orange County, CA"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4448608406",
    "title": "Outside Sales Representative",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4448608406/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-03T19:16:38.000Z",
    "location": {
      "linkedinText": "Dallas, TX"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4448318154",
    "title": "Territory Manager",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4448318154/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-03T16:01:51.000Z",
    "location": {
      "linkedinText": "Georgia, United States"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  },
  {
    "id": "4455317955",
    "title": "Territory Sales Manager- Medical Sales",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/4455317955/",
    "workplaceType": "hybrid",
    "postedDate": "2026-08-17T16:50:00.000Z",
    "location": {
      "linkedinText": "Charlotte, NC"
    },
    "company": {
      "id": "6592912",
      "name": "Pursuit",
      "linkedinUrl": "https://www.linkedin.com/company/pursuit-sales-solutions"
    }
  }
];

/** All 84, in call order. */
export const RUN_A76C7B4C_ROWS: readonly FrozenJobRow[] = [
  ...RUN_A76C7B4C_BATCH_1_ROWS, ...RUN_A76C7B4C_BATCH_2_ROWS,
];
