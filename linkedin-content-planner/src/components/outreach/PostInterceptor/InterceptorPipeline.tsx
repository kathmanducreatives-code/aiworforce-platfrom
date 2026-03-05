import React, { useState, useRef } from 'react';
import DiscoveryEngine from './DiscoveryEngine';
import InterceptionLoader from './InterceptionLoader';
import LeadCommandCenter from './LeadCommandCenter';
import { searchPosts, scrapePost } from '../../../services/interceptorService';
import type { PostSearchResult, Lead } from '../../../services/interceptorService';
import { toast } from 'sonner';

type Step = 'discovery' | 'interception' | 'results';

const InterceptorPipeline: React.FC = () => {
    const [currentStep, setCurrentStep] = useState<Step>('discovery');
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState<PostSearchResult[]>([]);
    const [selectedPost, setSelectedPost] = useState<PostSearchResult | null>(null);
    const [leads, setLeads] = useState<Lead[]>([]);
    // Hold the in-flight scrape promise so the loader can await it
    const scrapePromiseRef = useRef<Promise<Lead[]> | null>(null);

    const handleSearch = async (keywords: string, timeframe: string) => {
        setIsLoading(true);
        try {
            const posts = await searchPosts(keywords, timeframe);
            setResults(posts);
        } catch (error) {
            console.error(error);
            toast.error('Search failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleIntercept = (post: PostSearchResult) => {
        setSelectedPost(post);
        // Kick off the real scrape IMMEDIATELY — concurrent with the loader animation
        scrapePromiseRef.current = scrapePost(post.url);
        setCurrentStep('interception');
    };

    // Called when the loader animation finishes — by then the API call is likely done
    const handleInterceptionComplete = async () => {
        if (!scrapePromiseRef.current) return;
        try {
            const interceptedLeads = await scrapePromiseRef.current;
            scrapePromiseRef.current = null;
            if (interceptedLeads.length === 0) {
                toast.error('No qualifying leads found in this post.');
                setCurrentStep('discovery');
                return;
            }
            setLeads(interceptedLeads);
            setCurrentStep('results');
        } catch (error) {
            console.error(error);
            toast.error('Failed to intercept post. Please try again.');
            setCurrentStep('discovery');
        }
    };

    return (
        <div style={{ minHeight: '100%', backgroundColor: '#0a0a0b', color: 'white' }}>
            {currentStep === 'discovery' && (
                <DiscoveryEngine
                    onSearch={handleSearch}
                    isLoading={isLoading}
                    results={results}
                    onIntercept={handleIntercept}
                />
            )}

            {currentStep === 'interception' && selectedPost && (
                <InterceptionLoader
                    post={selectedPost}
                    onComplete={handleInterceptionComplete}
                />
            )}

            {currentStep === 'results' && leads.length > 0 && (
                <LeadCommandCenter leads={leads} />
            )}
        </div>
    );
};

export default InterceptorPipeline;
