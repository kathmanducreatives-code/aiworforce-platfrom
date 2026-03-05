import { useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import DiscoverySearch from '@/components/post-interceptor/DiscoverySearch';
import InterceptionLoader from '@/components/post-interceptor/InterceptionLoader';
import LeadCommandCenter from '@/components/post-interceptor/LeadCommandCenter';
import type { PostSearchResult, InterceptionStep } from '@/types/outreach';
import { searchPosts, scrapePost } from '@/services/interceptorService';
import { toast } from 'sonner';

const PostInterceptor = () => {
    const [step, setStep] = useState<InterceptionStep>('search');
    const [selectedPost, setSelectedPost] = useState<PostSearchResult | null>(null);

    const handleSearch = useCallback(async (keywords: string, dateFilter: string) => {
        return searchPosts(keywords, dateFilter as 'day' | 'week' | 'month');
    }, []);

    const handleIntercept = useCallback(async (post: PostSearchResult) => {
        setSelectedPost(post);
        setStep('loading');

        try {
            await scrapePost(post.post_url);
            toast.success('Post sent to n8n for scraping! Analyzing comments...', {
                description: 'This usually takes 15–60 seconds.',
            });
        } catch (err: any) {
            toast.error('Failed to send post for scraping', {
                description: err.message,
            });
            // Still advance to leads view — n8n may have already queued the job
        }
    }, []);

    const handleLoaderComplete = useCallback(() => {
        setStep('leads');
    }, []);

    const handleBack = () => {
        setStep('search');
        setSelectedPost(null);
    };

    return (
        <div className="min-h-screen bg-background">
            {/* Sticky step header */}
            <div className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
                    {step !== 'search' && (
                        <button
                            onClick={handleBack}
                            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back
                        </button>
                    )}

                    {/* Step breadcrumb */}
                    <div className="flex items-center gap-2 text-sm">
                        {[
                            { id: 'search', label: '1. Discovery' },
                            { id: 'loading', label: '2. Intercept' },
                            { id: 'leads', label: '3. Leads' },
                        ].map((s, i, arr) => (
                            <span key={s.id} className="flex items-center gap-2">
                                <span className={
                                    step === s.id
                                        ? 'text-foreground font-semibold'
                                        : (arr.indexOf(arr.find(x => x.id === step)!) > i
                                            ? 'text-primary cursor-pointer hover:text-primary/80'
                                            : 'text-muted-foreground/50')
                                }>
                                    {s.label}
                                </span>
                                {i < arr.length - 1 && <span className="text-muted-foreground/30">→</span>}
                            </span>
                        ))}
                    </div>

                    {selectedPost && step !== 'search' && (
                        <div className="ml-auto hidden sm:block">
                            <p className="text-xs text-muted-foreground truncate max-w-xs">
                                Post by: <span className="text-foreground">{selectedPost.author_name}</span>
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Step content */}
            {step === 'search' && (
                <DiscoverySearch onSearch={handleSearch} onIntercept={handleIntercept} />
            )}

            {step === 'loading' && (
                <InterceptionLoader onComplete={handleLoaderComplete} />
            )}

            {step === 'leads' && (
                <LeadCommandCenter postUrl={selectedPost?.post_url} />
            )}
        </div>
    );
};

export default PostInterceptor;
