import { useState, useEffect } from 'react';
import { Users, Filter } from 'lucide-react';
import LeadRow from '@/components/post-interceptor/LeadRow';
import type { OutreachLead } from '@/types/outreach';
import { fetchAllLeads, markAsSent } from '@/services/interceptorService';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const TABS = [
    { id: 'all', label: 'All Leads' },
    { id: 'hot', label: '🔥 Hot (4+)' },
    { id: 'warm', label: '👋 Warm (2–3)' },
    { id: 'sent', label: '✅ DM Sent' },
] as const;

type Tab = typeof TABS[number]['id'];

const LeadCRM = () => {
    const [leads, setLeads] = useState<OutreachLead[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<Tab>('all');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchAllLeads()
            .then(setLeads)
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const handleMarkSent = async (id: string) => {
        await markAsSent(id);
        setLeads(prev => prev.map(l => l.id === id ? { ...l, dm_sent: true } : l));
        toast.success('Lead marked as sent!');
    };

    const filtered = leads.filter(l => {
        if (activeTab === 'hot') return l.commenter_score >= 4 && !l.dm_sent;
        if (activeTab === 'warm') return l.commenter_score >= 2 && l.commenter_score < 4 && !l.dm_sent;
        if (activeTab === 'sent') return l.dm_sent;
        return true;
    });

    const count = (tab: Tab) => leads.filter(l => {
        if (tab === 'hot') return l.commenter_score >= 4 && !l.dm_sent;
        if (tab === 'warm') return l.commenter_score >= 2 && l.commenter_score < 4 && !l.dm_sent;
        if (tab === 'sent') return l.dm_sent;
        return true;
    }).length;

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
                            <Users className="h-6 w-6 text-primary" />
                            Lead CRM
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            All intercepted leads from competitor post activity
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Filter className="h-4 w-4" />
                        {leads.length} total leads
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border border-border w-fit mb-6">
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
                            {tab.label}
                            <span className={cn(
                                'ml-1 text-xs px-1.5 py-0.5 rounded-full font-semibold',
                                activeTab === tab.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                            )}>
                                {count(tab.id)}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Content */}
                {loading ? (
                    <div className="space-y-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="rounded-2xl border border-border bg-card/40 p-5 animate-pulse h-36" />
                        ))}
                    </div>
                ) : error ? (
                    <div className="text-center py-20">
                        <p className="text-sm font-medium text-foreground mb-1">Failed to load leads</p>
                        <p className="text-xs text-muted-foreground">{error}</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-20 rounded-2xl border border-dashed border-border">
                        <div className="text-4xl mb-3">📭</div>
                        <p className="text-sm font-medium text-foreground mb-1">No leads here yet</p>
                        <p className="text-xs text-muted-foreground">
                            Use the <span className="text-primary font-medium">Post Interceptor</span> to start capturing leads from competitor posts.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filtered.map(lead => (
                            <LeadRow key={lead.id} lead={lead} onMarkSent={handleMarkSent} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LeadCRM;
