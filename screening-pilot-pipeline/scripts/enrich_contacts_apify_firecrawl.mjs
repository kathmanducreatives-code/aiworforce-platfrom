import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');
if (!FIRECRAWL_API_KEY) throw new Error('Missing FIRECRAWL_API_KEY');

const INPUT = 'screening-pilot-pipeline/output/requested_50_leads.json';
const OUT_JSON = 'screening-pilot-pipeline/output/requested_50_leads_with_contacts.json';
const OUT_CSV = 'screening-pilot-pipeline/output/requested_50_leads_with_contacts.csv';

const canonicalLinkedIn = (url) => {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(url).trim().toLowerCase().replace(/\/+$/, '');
  }
};

const runApifySync = async (actorSlug, input) => {
  const url = `https://api.apify.com/v2/acts/${actorSlug.replace('/', '~')}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify ${actorSlug} failed ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
};

const firecrawlScrape = async (url) => {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({ url, formats: ['markdown'] })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 300)}`);
  const json = text ? JSON.parse(text) : {};
  if (!json.success || !json.data?.markdown) throw new Error(`Firecrawl scrape failed for ${url}`);
  return json.data.markdown;
};

const extractEmails = (text) => {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const blocked = /example\.com|ycombinator\.com|linkedin\.com|sentry\.io|wix\.com/i;
  return [...new Set(m.map(s => s.trim().toLowerCase()).filter(e => !blocked.test(e)))];
};

const extractPhones = (text) => {
  const lines = text.split('\n');
  const hits = [];

  const telMatches = [...text.matchAll(/tel:([+\d][\d().\-\s]{6,20})/gi)].map(m => m[1]);
  hits.push(...telMatches);

  for (const line of lines) {
    if (!/(phone|tel|call|whatsapp|\+\d)/i.test(line)) continue;
    const candidates = line.match(/\+?\d[\d().\-\s]{8,}\d/g) || [];
    hits.push(...candidates);
  }

  const normalized = hits
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => /[+\-().\s]/.test(x))
    .filter(x => {
      const digits = x.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 15;
    })
    .filter(x => !/https?:\/\//i.test(x));

  return [...new Set(normalized)];
};

const extractLikelyWebsiteFromYcPage = (markdown) => {
  const links = [...markdown.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
  const filtered = links.filter((u) => {
    const x = u.toLowerCase();
    return !(
      x.includes('ycombinator.com') ||
      x.includes('workatastartup.com') ||
      x.includes('bookface-images') ||
      x.includes('linkedin.com') ||
      x.includes('twitter.com') ||
      x.includes('x.com') ||
      x.includes('account.ycombinator.com')
    );
  });
  return filtered[0] || '';
};

const safeJoin = (base, path) => {
  try {
    return new URL(path, base).toString();
  } catch {
    return '';
  }
};

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';

const pickFounderEmail = (emails, contextText, founderNames = []) => {
  if (!emails.length) return '';

  const lc = contextText.toLowerCase();
  const prioritized = emails.filter(e => /founder|ceo|hello|team|contact|info/.test(e.split('@')[0] || ''));
  if (prioritized.length) return prioritized[0];

  for (const name of founderNames) {
    const fn = firstName(name).toLowerCase();
    if (!fn) continue;
    const hit = emails.find(e => e.split('@')[0].includes(fn));
    if (hit) return hit;
  }

  if (lc.includes('founder') || lc.includes('co-founder')) return emails[0];
  return emails[0];
};

const extractFounderNames = (text) => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const names = [];
  for (const line of lines) {
    if (!/founder|co-founder|ceo/i.test(line)) continue;
    if (/active founders|before|at amazon|at google|at meta|linkedin/i.test(line.toLowerCase())) continue;
    const m = line.match(/([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g);
    if (m) {
      for (const n of m) {
        if (n.length < 5) continue;
        names.push(n);
      }
    }
  }
  return [...new Set(names)].slice(0, 5);
};

async function enrichLinkedinLeads(leads) {
  const urls = [...new Set(leads.map(l => l.commenter_profile_url).filter(Boolean))];
  if (!urls.length) return leads;

  const rows = await runApifySync('dev_fusion/Linkedin-Profile-Scraper', {
    profileUrls: urls,
    maxItems: urls.length
  });

  const byUrl = new Map();
  for (const r of rows) {
    const keys = [r.linkedinUrl, r.linkedinPublicUrl].filter(Boolean).map(canonicalLinkedIn);
    for (const k of keys) byUrl.set(k, r);
  }

  return leads.map((lead) => {
    const key = canonicalLinkedIn(lead.commenter_profile_url);
    const hit = byUrl.get(key) || null;

    return {
      ...lead,
      decision_maker_email: hit?.email || '',
      decision_maker_phone: hit?.mobileNumber || '',
      decision_maker_company_size: hit?.companySize || '',
      decision_maker_company_website: hit?.companyWebsite || '',
      decision_maker_scrape_status: hit ? 'found' : 'not_found'
    };
  });
}

async function enrichFirecrawlLeads(leads) {
  const output = [];

  for (const lead of leads) {
    const sourceUrls = [];
    let aggregate = '';
    let founderNames = [];
    let inferredSite = '';

    try {
      const ycMd = await firecrawlScrape(lead.company_url);
      aggregate += `\n\n# SOURCE ${lead.company_url}\n${ycMd}`;
      sourceUrls.push(lead.company_url);

      founderNames = extractFounderNames(ycMd);
      inferredSite = extractLikelyWebsiteFromYcPage(ycMd);

      const pages = [];
      if (inferredSite) {
        pages.push(inferredSite, safeJoin(inferredSite, '/about'), safeJoin(inferredSite, '/contact'), safeJoin(inferredSite, '/team'));
      }

      for (const p of pages.filter(Boolean)) {
        try {
          const md = await firecrawlScrape(p);
          aggregate += `\n\n# SOURCE ${p}\n${md}`;
          sourceUrls.push(p);
        } catch {
          // ignore page failures
        }
      }

      const emails = extractEmails(aggregate);
      const phones = extractPhones(aggregate);
      const founderEmail = pickFounderEmail(emails, aggregate, founderNames);
      const founderPhone = phones[0] || '';

      output.push({
        ...lead,
        founder_names_detected: founderNames,
        founder_email: founderEmail,
        founder_phone: founderPhone,
        all_detected_emails: emails.slice(0, 10),
        all_detected_phones: phones.slice(0, 10),
        inferred_company_site: inferredSite,
        firecrawl_contact_sources: sourceUrls,
        founder_scrape_status: founderEmail || founderPhone ? 'found' : 'not_found'
      });
    } catch (e) {
      output.push({
        ...lead,
        founder_names_detected: [],
        founder_email: '',
        founder_phone: '',
        all_detected_emails: [],
        all_detected_phones: [],
        inferred_company_site: inferredSite,
        firecrawl_contact_sources: sourceUrls,
        founder_scrape_status: 'error',
        founder_scrape_error: String(e)
      });
    }
  }

  return output;
}

async function main() {
  const raw = JSON.parse(await fs.readFile(INPUT, 'utf8'));

  const linkedin = await enrichLinkedinLeads(raw.linkedin_hot_leads || []);
  const firecrawl = await enrichFirecrawlLeads(raw.firecrawl_hiring_leads || []);

  const out = {
    ...raw,
    contact_enrichment_generated_at: new Date().toISOString(),
    linkedin_hot_leads: linkedin,
    firecrawl_hiring_leads: firecrawl,
    enrichment_summary: {
      linkedin_with_email_or_phone: linkedin.filter(x => x.decision_maker_email || x.decision_maker_phone).length,
      firecrawl_with_founder_email_or_phone: firecrawl.filter(x => x.founder_email || x.founder_phone).length
    }
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2));

  const rows = [];
  rows.push('group,company,contact_name,title,linkedin_url,email,phone,source_url,status,dm_text');
  for (const l of linkedin) {
    rows.push([
      'linkedin_decision_maker',
      (l.commenter_company || '').replaceAll(',', ' '),
      (l.commenter_name || '').replaceAll(',', ' '),
      (l.commenter_title || '').replaceAll(',', ' '),
      (l.commenter_profile_url || '').replaceAll(',', ' '),
      (l.decision_maker_email || '').replaceAll(',', ' '),
      (l.decision_maker_phone || '').replaceAll(',', ' '),
      (l.source_post_url || '').replaceAll(',', ' '),
      (l.decision_maker_scrape_status || '').replaceAll(',', ' '),
      (l.dm_text || '').replaceAll(',', ' ')
    ].join(','));
  }
  for (const l of firecrawl) {
    rows.push([
      'firecrawl_founder_contact',
      (l.company_name || '').replaceAll(',', ' '),
      (l.founder_names_detected?.[0] || '').replaceAll(',', ' '),
      'Founder/CEO (detected)',
      '',
      (l.founder_email || '').replaceAll(',', ' '),
      (l.founder_phone || '').replaceAll(',', ' '),
      (l.job_url || '').replaceAll(',', ' '),
      (l.founder_scrape_status || '').replaceAll(',', ' '),
      (l.dm_text || '').replaceAll(',', ' ')
    ].join(','));
  }

  await fs.writeFile(OUT_CSV, rows.join('\n'));

  console.log(`LinkedIn enriched: ${linkedin.length}`);
  console.log(`LinkedIn with email/phone: ${out.enrichment_summary.linkedin_with_email_or_phone}`);
  console.log(`Firecrawl enriched: ${firecrawl.length}`);
  console.log(`Firecrawl with founder email/phone: ${out.enrichment_summary.firecrawl_with_founder_email_or_phone}`);
  console.log(`Output JSON: ${OUT_JSON}`);
  console.log(`Output CSV: ${OUT_CSV}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
