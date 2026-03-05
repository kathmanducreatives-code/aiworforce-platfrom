import { useState, useEffect, useCallback } from 'react';
import { Flame, Users, Archive, RefreshCw, AlertCircle } from 'lucide-react';
import LeadRow from './LeadRow';
import type { OutreachLead, LeadFilter } from '@/types/outreach';
import { fetchLeads, markAsSent } from '@/services/interceptorService';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface LeadCommandCenterProps {
    postUrl?: string;
}

const TABS: { id: LeadFilter; label: string; icon: React.ReactNode; filter: (l: OutreachLead) => boolean }[] = [
    {
        id: 'hot',
        label: 'Hot Leads',
        icon: <Flame className="h-3.5 w-3.5 text-rose-400" />,
        filter: l => l.commenter_score >= 4 && !l.dm_sent,
    },
    {
        id: 'warm',
        label: 'Warm Leads',
        icon: <Users className="h-3.5 w-3.5 text-amber-400" />,
        filter: l => l.commenter_score >= 2 && l.commenter_score < 4 && !l.dm_sent,
    },
    {
        id: 'archived',
        label: 'Archived / Skip',
        icon: <Archive className="h-3.5 w-3.5 text-muted-foreground" />,
        filter: l => l.dm_sent || l.commenter_score < 2,
    },
];

const LeadCommandCenter = ({ postUrl }: LeadCommandCenterProps) => {
    const [leads, setLeads] = useState<OutreachLead[]>([]);
    const [activeTab, setActiveTab] = useState<LeadFilter>('hot');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadLeads = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchLeads(postUrl);
            setLeads(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load leads.');
        } finally {
            setLoading(false);
        }
    }, [postUrl]);

    useEffect(() => {
        loadLeads();
    }, [loadLeads]);

    const handleMarkSent = async (leadId: string) => {
        await markAsSent(leadId);
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, dm_sent: true } : l));
        toast.success('Lead marked as sent!');
    };

    const activeTabConfig = TABS.find(t => t.id === activeTab)!;
    const filteredLeads = leads.filter(activeTabConfig.filter);

    const tabCount = (tab: typeof TABS[0]) => leads.filter(tab.filter).length;

    return (
        <div className="flex flex-col gap-5 px-6 pb-10 max-w-7xl mx-auto w-full pt-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-foreground">Lead Command Center</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {leads.length} leads found{postUrl ? ' from this post' : ' total'}
                    </p>
                </div>
                <button
                    onClick={loadLeads}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                    Refresh
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border border-border w-fit">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                            activeTab === tab.id
                                ? 'bg-card border border-border text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {tab.icon}
                        {tab.label}
                        <span className={cn(
                            'ml-1 text-xs px-1.5 py-0.5 rounded-full font-semibold',
                            activeTab === tab.id
                                ? 'bg-primary/15 text-primary'
                                : 'bg-muted text-muted-foreground'
                        )}>
                            {tabCount(tab)}
                        </span>
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading ? (
                <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-2xl border border-border bg-card/40 p-5 animate-pulse">
                            <div className="flex gap-4">
                                <div className="w-11 h-11 rounded-full bg-muted flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-3 bg-muted rounded w-40" />
                                    <div className="h-3 bg-muted rounded w-28" />
                                    <div className="h-3 bg-muted rounded w-16 mt-3" />
                                </div>
                                <div className="w-32 h-20 bg-muted rounded-xl" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="text-center py-16">
                    <div className="w-12 h-12 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto mb-3">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">Failed to load leads</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">{error}</p>
                    <button onClick={loadLeads} className="mt-4 text-sm text-primary hover:text-primary/80 transition-colors">
                        Try again →
                    </button>
                </div>
            ) : filteredLeads.length === 0 ? (
                <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/20">
                    <div className="text-3xl mb-3">
                        {activeTab === 'hot' ? '🔍' : activeTab === 'warm' ? '☕' : '📦'}
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">
                        {activeTab === 'hot'
                            ? 'No hot leads found for this post'
                            : activeTab === 'warm'
                                ? 'No warm leads at the moment'
                                : 'Nothing archived yet'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {activeTab === 'hot'
                            ? 'Try intercepting another viral post with more engagement.'
                            : activeTab === 'warm'
                                ? 'Check back after the AI finishes processing.'
                                : 'Leads marked as sent or skipped will appear here.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredLeads.map(lead => (
                        <LeadRow key={lead.id} lead={lead} onMarkSent={handleMarkSent} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default LeadCommandCenter;
