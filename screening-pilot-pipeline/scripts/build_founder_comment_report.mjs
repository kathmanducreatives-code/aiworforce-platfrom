import fs from 'node:fs/promises';

const inputPath = 'screening-pilot-pipeline/output/requested_50_leads_with_contacts.json';
const mdOut = 'screening-pilot-pipeline/output/founder_pain_posts_report.md';
const csvOut = 'screening-pilot-pipeline/output/founder_pain_comments_with_contacts.csv';

const data = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const postMap = new Map((data.top_source_posts || []).map(p => [p.post_url, p]));

const leads = (data.linkedin_hot_leads || [])
  .filter(l => l.decision_maker)
  .filter(l => l.hasBuyingSignal || l.hasHiringSignal || l.isFrustrated)
  .sort((a, b) => b.score - a.score);

const painLabel = (l) => {
  const labels = [];
  if (l.hasBuyingSignal) labels.push('agency fee/cost pain');
  if (l.hasHiringSignal) labels.push('active hiring pain');
  if (l.isFrustrated) labels.push('frustration with process');
  return labels.join(' + ') || 'general hiring pain';
};

const grouped = new Map();
for (const lead of leads) {
  const key = lead.source_post_url || 'unknown';
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(lead);
}

let md = '# Founder/Decision-Maker Pain-Point Posts + Comments + Contact\n\n';
md += `Generated: ${new Date().toISOString()}\n\n`;
md += `Total relevant comments: ${leads.length}\n\n`;

for (const [postUrl, comments] of grouped.entries()) {
  const post = postMap.get(postUrl);
  const excerpt = post?.post_text ? post.post_text.replace(/\s+/g, ' ').slice(0, 600) : 'Post text not in top_source_posts capture.';
  md += `## Post\n`;
  md += `- URL: ${postUrl}\n`;
  md += `- Author: ${post?.post_author || 'Unknown'}\n`;
  md += `- Engagement: ${post?.engagement_count ?? 'n/a'}\n`;
  md += `- Content excerpt: ${excerpt}\n\n`;

  md += `### Relevant founder/decision-maker comments\n`;
  for (const c of comments) {
    md += `- Name: ${c.commenter_name || ''}\n`;
    md += `- Title: ${c.commenter_title || ''}\n`;
    md += `- Company: ${c.commenter_company || ''}\n`;
    md += `- Pain point: ${painLabel(c)}\n`;
    md += `- Comment: ${(c.comment_excerpt || c.comment_text || '').replace(/\s+/g, ' ').trim()}\n`;
    md += `- Contact: email=${c.decision_maker_email || 'n/a'} | phone=${c.decision_maker_phone || 'n/a'} | LinkedIn=${c.commenter_profile_url || 'n/a'}\n\n`;
  }
}

const csvLines = [];
csvLines.push('post_url,post_author,post_engagement,post_content_excerpt,name,title,company,pain_point,comment,email,phone,linkedin_url');
for (const lead of leads) {
  const post = postMap.get(lead.source_post_url || '');
  const esc = (v) => '"' + String(v ?? '').replaceAll('"', '""').replace(/\n/g, ' ') + '"';
  csvLines.push([
    esc(lead.source_post_url || ''),
    esc(post?.post_author || ''),
    esc(post?.engagement_count ?? ''),
    esc((post?.post_text || '').slice(0, 500)),
    esc(lead.commenter_name || ''),
    esc(lead.commenter_title || ''),
    esc(lead.commenter_company || ''),
    esc(painLabel(lead)),
    esc((lead.comment_excerpt || lead.comment_text || '').slice(0, 500)),
    esc(lead.decision_maker_email || ''),
    esc(lead.decision_maker_phone || ''),
    esc(lead.commenter_profile_url || ''),
  ].join(','));
}

await fs.writeFile(mdOut, md);
await fs.writeFile(csvOut, csvLines.join('\n'));

console.log(`Relevant founder/decision-maker comments: ${leads.length}`);
console.log(`Markdown report: ${mdOut}`);
console.log(`CSV report: ${csvOut}`);
