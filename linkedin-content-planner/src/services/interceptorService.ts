// Interceptor Service for n8n webhooks and Supabase lead management

const INTERCEPTOR_WEBHOOK_URL = import.meta.env.VITE_INTERCEPTOR_WEBHOOK_URL;

export interface PostSearchResult {
    id: string;
    author: string;
    time: string;
    text: string;
    likes: number;
    comments: number;
    url: string;
}

export interface Lead {
    id: string;
    name: string;
    title: string;
    company: string;
    avatar?: string;
    comment: string;
    score: number;
    signals: string[];
    generatedDM: string;
    status: 'new' | 'sent' | 'archived';
}

export async function searchPosts(keywords: string, timeframe: string): Promise<PostSearchResult[]> {
    console.log(`Searching for posts with keywords: ${keywords}, timeframe: ${timeframe}`);

    try {
        const response = await fetch(INTERCEPTOR_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'search_posts',
                keywords,
                timeframe,
                maxPosts: 10
            })
        });

        if (!response.ok) throw new Error('Failed to fetch posts from n8n');

        const data = await response.json();
        return data.posts || [];
    } catch (error) {
        console.error('Search Posts Error:', error);
        // Return mock data for demo purposes if webhook fails
        return [
            {
                id: '1',
                author: 'Marc Lou',
                time: '2d ago',
                text: 'I just launched my 12th SaaS this year. It cost me $0 in marketing but 100 hours of coding. Honestly, the biggest issue is finding qualified developers who don\'t charge agency fees.',
                likes: 1240,
                comments: 156,
                url: 'https://linkedin.com/posts/marc-lou-1'
            },
            {
                id: '2',
                author: 'Justin Welsh',
                time: '5h ago',
                text: 'The creator economy is booming. But solo creators are struggling with expensive software stacks. We need better tools for content distribution that don\'t break the bank.',
                likes: 3500,
                comments: 420,
                url: 'https://linkedin.com/posts/justin-welsh-1'
            },
            {
                id: '3',
                author: 'Sales Tea',
                time: '1d ago',
                text: 'Most recruitment agencies are just resume forwarding services. Why are we still paying 20% commission for someone who doesn\'t even screen the candidate?',
                likes: 890,
                comments: 210,
                url: 'https://linkedin.com/posts/sales-tea-1'
            }
        ];
    }
}

export async function scrapePost(postUrl: string): Promise<Lead[]> {
    console.log(`Scraping post: ${postUrl}`);

    try {
        const response = await fetch(INTERCEPTOR_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'scrape_post',
                postUrl
            })
        });

        if (!response.ok) throw new Error('Failed to scrape post from n8n');

        const data = await response.json();
        return data.leads || [];
    } catch (error) {
        console.error('Scrape Post Error:', error);
        // Return mock leads for demo purposes
        return [
            {
                id: 'l1',
                name: 'Alexander Volkov',
                title: 'Founder & CEO',
                company: 'CloudScale AI',
                comment: 'I am so frustrated with our current agency. They keep sending us juniors while charging senior fees. Anyone have recommendations for a better partner?',
                score: 5,
                signals: ['Frustrated', 'Decision Maker', 'Budget Owner'],
                generatedDM: "Hi Alexander, saw your comment on Marc's post about agency fees. I built a system that cut our recruitment costs by 60% using AI screening. Would love to show you how we're doing it if you're open to a quick chat?",
                status: 'new'
            },
            {
                id: 'l2',
                name: 'Sarah Jenkins',
                title: 'Head of Growth',
                company: 'FintechFlow',
                comment: 'Agreed. The pricing model for most of these tools is just not sustainable for startups.',
                score: 3,
                signals: ['Startup', 'Cost Sensitive'],
                generatedDM: "Hi Sarah, saw your point about sustainable pricing for startups. We just launched a founder-friendly plan for our outbound engine. Worth a look?",
                status: 'new'
            },
            {
                id: 'l3',
                name: 'Michael Chen',
                title: 'Talent Acquisition',
                company: 'Stripe',
                comment: 'Resumes are dead. We need better signals.',
                score: 2,
                signals: ['Hiring', 'Tech'],
                generatedDM: "Hi Michael, interesting point about resumes. We're experimenting with behavioral data for screening. Love to connect.",
                status: 'new'
            }
        ];
    }
}
