import React, { useState } from 'react';
import { Search, Zap, MessageCircle, Heart, Rocket } from 'lucide-react';
import { Button } from '../../ui/Button';

interface DiscoveryEngineProps {
    onSearch: (keywords: string, timeframe: string) => void;
    isLoading: boolean;
    results: any[];
    onIntercept: (post: any) => void;
}

const DiscoveryEngine: React.FC<DiscoveryEngineProps> = ({ onSearch, isLoading, results, onIntercept }) => {
    const [query, setQuery] = useState('');
    const [timeframe, setTimeframe] = useState('Past Week');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) onSearch(query, timeframe);
    };

    return (
        <div className="flex flex-col items-center w-full max-w-5xl mx-auto px-6 py-12 animate-fade-in">
            {/* Hero search */}
            <div className="w-full max-w-2xl text-center mb-14">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-xs font-bold mb-6">
                    <Rocket size={12} />
                    Discovery Engine v2.0
                </div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-3">
                    What are your buyers complaining about today?
                </h1>
                <p className="text-slate-400 text-base mb-8">
                    Find viral posts from competitors and intercept their frustrated customers.
                </p>

                <form onSubmit={handleSubmit} className="flex gap-3">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                        <input
                            type="text"
                            placeholder='Try "recruitment agency fees" or "software pricing"'
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            className={[
                                'w-full pl-10 pr-4 py-3.5 rounded-2xl text-sm text-white placeholder-slate-600',
                                'bg-white/[0.04] border border-white/[0.10] outline-none',
                                'focus:border-blue-500/50 focus:bg-white/[0.06]',
                                'transition-all duration-200',
                            ].join(' ')}
                        />
                    </div>

                    <select
                        value={timeframe}
                        onChange={e => setTimeframe(e.target.value)}
                        className="px-4 bg-white/[0.04] border border-white/[0.10] rounded-2xl text-sm text-white outline-none cursor-pointer hover:bg-white/[0.07] transition-colors"
                    >
                        <option value="Past 24h">Past 24h</option>
                        <option value="Past Week">Past Week</option>
                        <option value="Past Month">Past Month</option>
                    </select>

                    <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        loading={isLoading}
                        icon={<Zap size={16} fill="white" />}
                    >
                        {isLoading ? 'Searching...' : 'Find Posts'}
                    </Button>
                </form>
            </div>

            {/* Results */}
            {results.length > 0 && (
                <div className="w-full">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
                        {results.length} posts found
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {results.map((post, idx) => (
                            <div
                                key={idx}
                                className="flex flex-col gap-4 p-6 bg-white/[0.03] border border-white/[0.08] rounded-2xl hover:border-violet-500/30 hover:bg-white/[0.05] transition-all duration-200 animate-fade-in-up"
                                style={{ animationDelay: `${idx * 0.05}s` }}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center font-semibold text-sm shrink-0">
                                        {post.author?.[0] ?? '?'}
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-white">{post.author}</p>
                                        <p className="text-xs text-slate-500">{post.time}</p>
                                    </div>
                                </div>

                                <p className="text-sm text-slate-300 leading-relaxed line-clamp-3">{post.text}</p>

                                <div className="flex items-center justify-between pt-3 border-t border-white/[0.05]">
                                    <div className="flex items-center gap-4 text-slate-500 text-xs">
                                        <span className="flex items-center gap-1.5"><Heart size={13} /> {post.likes?.toLocaleString()}</span>
                                        <span className="flex items-center gap-1.5"><MessageCircle size={13} /> {post.comments?.toLocaleString()}</span>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => onIntercept(post)}
                                    >
                                        Intercept
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isLoading && results.length === 0 && (
                <div className="text-center text-slate-600 mt-8 p-12 border border-dashed border-white/[0.06] rounded-2xl w-full max-w-lg">
                    <Search size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Search for posts to begin intercepting leads</p>
                </div>
            )}
        </div>
    );
};

export default DiscoveryEngine;
