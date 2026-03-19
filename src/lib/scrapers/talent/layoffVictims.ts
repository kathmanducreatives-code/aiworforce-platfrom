import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, logScrape } from '../types';

export async function scrapeLayoffVictims(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_layoff_victims' };

  try {
    // Scrape layoffs.fyi for recent layoffs
    const res = await firecrawl.scrapeUrl('https://layoffs.fyi', {
      formats: ['markdown'],
      onlyMainContent: true,
    });

    const markdown = res?.data?.markdown || res?.markdown || '';

    // Parse layoff entries from markdown table
    const lines = markdown.split('\n').filter((l: string) => l.includes('|') && !l.includes('---'));
    const signals: TalentSignalInsert[] = [];

    for (const line of lines.slice(0, 30)) { // Top 30 entries
      const cols = line.split('|').map((c: string) => c.trim()).filter(Boolean);
      if (cols.length < 3) continue;

      const companyName = cols[0]?.replace(/\[|\]/g, '').replace(/\(.*?\)/g, '').trim();
      const dateStr = cols[1]?.trim();
      const numLaidOff = cols[2]?.trim();

      if (!companyName || companyName.toLowerCase() === 'company') continue;

      // Check if any existing candidates work at this company
      const { data: existingCandidates } = await (supabase as any)
        .from('candidate_profiles')
        .select('id, name, current_company, linkedin_url')
        .ilike('current_company', `%${companyName}%`)
        .limit(5);

      if (existingCandidates?.length) {
        for (const candidate of existingCandidates) {
          signals.push({
            user_id: userId,
            candidate_name: candidate.name || companyName + ' employee',
            candidate_linkedin_url: candidate.linkedin_url,
            candidate_company: companyName,
            signal_type: 'layoff_victim',
            signal_title: `${candidate.name || 'Candidate'} may be affected by ${companyName} layoffs`,
            signal_summary: `${companyName} announced layoffs${numLaidOff ? ` affecting ${numLaidOff} employees` : ''}${dateStr ? ` on ${dateStr}` : ''}. This candidate works there.`,
            signal_source_url: 'https://layoffs.fyi',
            signal_score: 15,
            tier: 'HOT',
          });
        }
      } else {
        // Generic signal for the company layoff
        signals.push({
          user_id: userId,
          candidate_company: companyName,
          signal_type: 'layoff_victim',
          signal_title: `${companyName} layoffs — ${numLaidOff || 'unknown'} affected`,
          signal_summary: `${companyName} announced layoffs${numLaidOff ? ` affecting ${numLaidOff} employees` : ''}${dateStr ? ` on ${dateStr}` : ''}.`,
          signal_source_url: 'https://layoffs.fyi',
          signal_score: 15,
          tier: 'HOT',
        });
      }
    }

    if (signals.length > 0) {
      const { error } = await (supabase as any).from('talent_signals').insert(signals);
      if (error) result.errors.push(error.message);
      else result.signalsCreated = signals.length;
    }
  } catch (e: any) {
    result.errors.push(e.message);
  }

  await logScrape(supabase, userId, result.feature, result.errors.length ? 'partial' : 'completed', result.signalsCreated, result.errors.join('; '));
  return result;
}
