import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, logScrape } from '../types';

export async function analyzeHiringPatterns(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'competitor_hiring_patterns' };

  try {
    const { data: competitors } = await (supabase as any)
      .from('competitor_companies')
      .select('*')
      .eq('user_id', userId);

    if (!competitors?.length) return result;

    for (const comp of competitors) {
      try {
        const { data: jobs } = await (supabase as any)
          .from('competitor_job_postings')
          .select('*')
          .eq('competitor_id', comp.id)
          .order('scraped_at', { ascending: false });

        if (!jobs?.length) {
          // Pattern D: Contraction
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'new_job_posting',
            signal_title: `${comp.company_name}: No open roles detected`,
            signal_summary: 'No open roles detected — possible contraction or hiring freeze. Opportunity to approach their customers.',
            signal_data: { total_roles: 0, patterns: ['contraction'] },
            signal_date: new Date().toISOString(),
            importance: 'HIGH',
          });
          result.signalsCreated++;
          continue;
        }

        // Group by department
        const departments: Record<string, any[]> = {};
        const locations = new Set<string>();
        for (const job of jobs) {
          const dept = job.department || 'Other';
          if (!departments[dept]) departments[dept] = [];
          departments[dept].push(job);
          if (job.location) locations.add(job.location);
        }

        const patterns: string[] = [];

        // Pattern A: Product scaling
        const engRoles = (departments['Engineering'] || []).length;
        if (engRoles >= 3) {
          patterns.push(`${engRoles} engineering roles open — product scaling likely`);
        }

        // Pattern C: AI Pivot
        const aiRoles = jobs.filter((j: any) =>
          /ai|machine learning|ml engineer|data scientist|llm/i.test(j.job_title || '')
        );
        if (aiRoles.length >= 2) {
          patterns.push(`${aiRoles.length} AI/ML roles — AI feature development incoming (expect announcement in 60-90 days)`);
        }

        // Pattern B: Geographic expansion
        if (locations.size >= 3) {
          patterns.push(`Hiring across ${locations.size} locations — geographic expansion into ${Array.from(locations).slice(0, 3).join(', ')}`);
        }

        // Pattern E: GTM shift
        const salesRoles = (departments['Sales'] || []).length;
        if (salesRoles >= 3) {
          patterns.push(`${salesRoles} sales roles — aggressive GTM expansion`);
        }

        if (patterns.length > 0) {
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'new_job_posting',
            signal_title: `${comp.company_name} hiring patterns: ${jobs.length} open roles`,
            signal_summary: patterns.join('. '),
            signal_data: {
              total_roles: jobs.length,
              by_department: Object.fromEntries(
                Object.entries(departments).map(([k, v]) => [k, (v as any[]).length])
              ),
              locations: Array.from(locations),
              patterns,
            },
            signal_date: new Date().toISOString(),
            importance: patterns.some(p => /scaling|AI|expansion|contraction/i.test(p)) ? 'HIGH' : 'MEDIUM',
          });
          result.signalsCreated++;
        }

        // Update profile headcount
        await (supabase as any).from('competitor_profiles').upsert({
          user_id: userId,
          competitor_id: comp.id,
          engineering_headcount_estimate: engRoles,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'competitor_id' }).eq('user_id', userId);

      } catch (e: any) {
        result.errors.push(`${comp.company_name}: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(e.message);
  }

  await logScrape(supabase, userId, result.feature, result.errors.length ? 'partial' : 'completed', result.signalsCreated, result.errors.join('; '));
  return result;
}
