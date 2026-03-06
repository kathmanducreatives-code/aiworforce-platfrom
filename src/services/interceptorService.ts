import { supabase } from '@/integrations/supabase/client';
import type { OutreachLead, PostSearchResult } from '@/types/outreach';

// Webhook URL — set VITE_INTERCEPTOR_WEBHOOK_URL in .env.local
const WEBHOOK_URL =
    import.meta.env.VITE_INTERCEPTOR_WEBHOOK_URL ||
    'https://n8n.prasidha.me/webhook/competitor-post-interceptor';

async function callWebhook<T = any>(payload: Record<string, unknown>): Promise<T> {
    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Webhook error ${res.status}: ${text}`);
    }

    return res.json();
}

/** Step 1 — Search for viral posts by keyword */
export async function searchPosts(
    keywords: string,
    dateFilter: 'day' | 'week' | 'month' = 'week',
    maxPosts: number = 50
): Promise<PostSearchResult[]> {
    const data = await callWebhook<PostSearchResult[] | { posts: PostSearchResult[] }>({
        action: 'search_posts',
        keywords: [keywords],
        dateFilter,
        maxPosts,
    });

    // Handle both flat array and wrapped { posts: [...] } response shapes
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as any).posts)) return (data as any).posts;
    return [];
}

/** Step 2 — Trigger scraping + AI analysis for a specific post */
export async function scrapePost(postUrl: string): Promise<{ job_id?: string }> {
    return callWebhook<{ job_id?: string }>({
        action: 'scrape_post',
        postUrl,
    });
}

/** Step 3 — Fetch leads from Supabase */
export async function fetchLeads(postUrl?: string): Promise<OutreachLead[]> {
    let query = supabase
        .from('outreach_leads')
        .select('*')
        .eq('discovery_source', 'competitor_post_intercept')
        .order('commenter_score', { ascending: false });

    if (postUrl) {
        query = query.eq('post_url', postUrl);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data || []).map((row: any) => ({
        ...row,
        score_signals: Array.isArray(row.score_signals)
            ? row.score_signals
            : typeof row.score_signals === 'string'
                ? (() => { try { return JSON.parse(row.score_signals); } catch { return []; } })()
                : [],
    })) as unknown as OutreachLead[];
}

/** Fetch all outreach leads (for CRM page) */
export async function fetchAllLeads(): Promise<OutreachLead[]> {
    const { data, error } = await supabase
        .from('outreach_leads')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []) as unknown as OutreachLead[];
}

/** Update dm_sent flag after copying a DM */
export async function markAsSent(leadId: string): Promise<void> {
    const { error } = await supabase
        .from('outreach_leads')
        .update({ dm_sent: true })
        .eq('id', leadId);

    if (error) throw new Error(error.message);
}

/** Fetch outbound dashboard metrics from Supabase */
export async function fetchOutboundMetrics() {
    const { data, error } = await supabase
        .from('outreach_leads')
        .select('commenter_score, dm_sent, created_at, discovery_source');

    if (error) throw new Error(error.message);

    const rows = data || [];
    const total = rows.length;
    const hotPending = rows.filter(r => r.commenter_score >= 4 && !r.dm_sent).length;
    const dmsSent = rows.filter(r => r.dm_sent).length;

    // Last 7 days volume
    const now = new Date();
    const last7: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const count = rows.filter(r => r.created_at?.slice(0, 10) === key).length;
        last7.push({ date: key, count });
    }

    return { total, hotPending, dmsSent, last7 };
}
