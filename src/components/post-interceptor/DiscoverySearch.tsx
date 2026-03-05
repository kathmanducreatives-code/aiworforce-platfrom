import { useState } from 'react';
import { Search, ChevronDown, Zap, TrendingUp } from 'lucide-react';
import PostCard from './PostCard';
import type { PostSearchResult } from '@/types/outreach';

interface DiscoverySearchProps {
    onIntercept: (post: PostSearchResult) => void;
    onSearch: (keywords: string, dateFilter: string) => Promise<PostSearchResult[]>;
}

const DATE_OPTIONS = [
    { label: 'Past 24 hours', value: 'day' },
    { label: 'Past week', value: 'week' },
    { label: 'Past month', value: 'month' },
];

const DiscoverySearch = ({ onIntercept, onSearch }: DiscoverySearchProps) => {
    const [keywords, setKeywords] = useState('');
    const [dateFilter, setDateFilter] = useState('week');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<PostSearchResult[]>([]);
    const [searched, setSearched] = useState(false);
    const [interceptingId, setInterceptingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!keywords.trim()) return;
        setLoading(true);
        setError(null);
        try {
            const posts = await onSearch(keywords.trim(), dateFilter);
            setResults(posts);
            setSearched(true);
        } catch (err: any) {
            setError(err.message || 'Search failed. Check your webhook URL.');
            setResults([]);
            setSearched(true);
        } finally {
            setLoading(false);
        }
    };

    const handleIntercept = async (post: PostSearchResult) => {
        setInterceptingId(post.id || post.post_url);
        onIntercept(post);
    };

    return (
        <div className="min-h-full flex flex-col">
            {/* Hero Search Section */}
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                {/* Icon badge */}
                <div className="mb-6 flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Discovery Engine
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3 tracking-tight">
                    What are your buyers{' '}
                    <span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">
                        complaining about
                    </span>{' '}
                    today?
                </h1>
                <p className="text-muted-foreground text-base max-w-lg mb-10">
                    Find viral LinkedIn posts in your niche, intercept the commenters who are your buyers, and get AI-generated personalised DMs — in under 60 seconds.
                </p>

                {/* Search form */}
                <form
                    onSubmit={handleSearch}
                    className="w-full max-w-2xl bg-card/80 border border-border backdrop-blur-sm rounded-2xl p-4 shadow-xl shadow-black/20 flex flex-col sm:flex-row gap-3"
                >
                    {/* Keyword input */}
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            value={keywords}
                            onChange={e => setKeywords(e.target.value)}
                            placeholder='e.g. "recruitment agency fees"'
                            className="w-full pl-9 pr-3 py-2.5 bg-background/60 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all"
                        />
                    </div>

                    {/* Timeframe dropdown */}
                    <div className="relative">
                        <select
                            value={dateFilter}
                            onChange={e => setDateFilter(e.target.value)}
                            className="appearance-none pl-3 pr-8 py-2.5 bg-background/60 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all cursor-pointer h-full"
                        >
                            {DATE_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    </div>

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={loading || !keywords.trim()}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 hover:shadow-[0_0_16px_-2px_hsl(var(--primary)/0.5)] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                        <Zap className="h-4 w-4" />
                        {loading ? 'Searching...' : 'Find Viral Posts'}
                    </button>
                </form>
            </div>

            {/* Results */}
            {(loading || searched) && (
                <div className="flex-1 px-6 pb-10 max-w-7xl mx-auto w-full">
                    {loading ? (
                        /* Skeleton grid */
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="rounded-2xl border border-border bg-card/40 p-5 animate-pulse space-y-3">
                                    <div className="flex gap-3">
                                        <div className="w-10 h-10 rounded-full bg-muted" />
                                        <div className="flex-1 space-y-2">
                                            <div className="h-3 bg-muted rounded w-3/4" />
                                            <div className="h-3 bg-muted rounded w-1/2" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="h-3 bg-muted rounded" />
                                        <div className="h-3 bg-muted rounded w-5/6" />
                                        <div className="h-3 bg-muted rounded w-4/6" />
                                    </div>
                                    <div className="h-8 bg-muted rounded-lg mt-4" />
                                </div>
                            ))}
                        </div>
                    ) : error ? (
                        <div className="text-center py-16">
                            <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto mb-4">
                                <Search className="h-6 w-6 text-destructive" />
                            </div>
                            <p className="text-base font-medium text-foreground mb-1">Search failed</p>
                            <p className="text-sm text-muted-foreground max-w-sm mx-auto">{error}</p>
                        </div>
                    ) : results.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="w-14 h-14 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-4">
                                <Search className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <p className="text-base font-medium text-foreground mb-1">No posts found</p>
                            <p className="text-sm text-muted-foreground">Try different keywords or a wider timeframe.</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-5">
                                <p className="text-sm text-muted-foreground">
                                    Found <span className="text-foreground font-semibold">{results.length}</span> viral posts
                                </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {results.map((post) => (
                                    <PostCard
                                        key={post.id || post.post_url}
                                        post={post}
                                        onIntercept={handleIntercept}
                                        isIntercepting={interceptingId === (post.id || post.post_url)}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Idle empty state */}
            {!loading && !searched && (
                <div className="flex-1 flex items-start justify-center px-6 pb-10">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full">
                        {[
                            { emoji: '🔍', label: 'Search keywords', desc: 'Find posts where your buyers vent' },
                            { emoji: '⚡', label: 'Intercept & Analyze', desc: 'AI scores every commenter for buying intent' },
                            { emoji: '💬', label: 'Send personalized DMs', desc: 'One-click copy with Claude-crafted messages' },
                        ].map((step) => (
                            <div key={step.label} className="rounded-xl border border-border bg-card/30 p-4 text-center">
                                <div className="text-2xl mb-2">{step.emoji}</div>
                                <p className="text-sm font-medium text-foreground">{step.label}</p>
                                <p className="text-xs text-muted-foreground mt-1">{step.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default DiscoverySearch;
