import { useState, useMemo } from 'react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import LeadTable from './LeadTable';
import FilterBar from './FilterBar';
import BulkActions from './BulkActions';
import LeadImportModal from './LeadImportModal';
import LeadDiscoverModal from './LeadDiscoverModal';
import LeadDetailDrawer from './LeadDetailDrawer';
import { Search } from 'lucide-react';
import type { OutreachLead } from '../../../types/outreach';

export default function PipelineView() {
    const { leads, loading, fetchLeads, updateLead } = useOutreachLeads();
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isDiscoverModalOpen, setIsDiscoverModalOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState<OutreachLead | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    // Filters State
    const [searchTerm, setSearchTerm] = useState('');
    const [tierFilter, setTierFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [scrapeFilter, setScrapeFilter] = useState('all');

    // Filter Logic
    const filteredLeads = useMemo(() => {
        return leads.filter(l => {
            // Text Search
            const textMatch = !searchTerm ||
                l.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                l.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                l.title?.toLowerCase().includes(searchTerm.toLowerCase());
            if (!textMatch) return false;

            // Tier
            if (tierFilter !== 'all' && l.tier !== tierFilter) return false;

            // Status
            if (statusFilter !== 'all' && l.status !== statusFilter) return false;

            // Scrape Status
            if (scrapeFilter !== 'all') {
                if (scrapeFilter === 'queued' && l.scrape_status !== null) return false;
                if (scrapeFilter === 'success' && l.scrape_status !== 'success') return false;
                if (scrapeFilter === 'failed_scrape' && l.scrape_status !== 'failed_scrape') return false;
            }

            return true;
        })
            .sort((a, b) => {
                // Sort by tier first (tier_1 first), then created_at DESC
                const tierMap: Record<string, number> = { 'tier_1': 1, 'tier_2': 2, 'tier_3': 3, 'unassigned': 4 };
                const tA = tierMap[a.tier] || 4;
                const tB = tierMap[b.tier] || 4;
                if (tA !== tB) return tA - tB;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });
    }, [leads, searchTerm, tierFilter, statusFilter, scrapeFilter]);

    // Selection Handlers
    const handleSelectAll = (all: boolean) => {
        if (all) {
            setSelectedIds(filteredLeads.map(l => l.id));
        } else {
            setSelectedIds([]);
        }
    };

    const handleSelect = (id: string, selected: boolean) => {
        if (selected) {
            setSelectedIds(prev => [...prev, id]);
        } else {
            setSelectedIds(prev => prev.filter(i => i !== id));
        }
    };

    // Bulk Action Handlers
    const handleAssignTier = async (tier: string) => {
        for (const id of selectedIds) {
            await updateLead(id, { tier: tier as any });
        }
    };

    const handleChangeStatus = async (status: string) => {
        for (const id of selectedIds) {
            await updateLead(id, { status: status as any });
        }
    };

    const handleDelete = async () => {
        if (confirm(`Are you sure you want to delete ${selectedIds.length} leads?`)) {
            // Need a hook method for this, for now just marking them dead
            for (const id of selectedIds) {
                await updateLead(id, { status: 'dead' });
            }
            setSelectedIds([]);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div style={{ padding: '32px 40px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div>
                    <h1 style={{ fontSize: '28px', color: '#fff', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: '8px', fontFamily: '"Cabinet Grotesk", "Satoshi", sans-serif' }}>
                        Pipeline
                    </h1>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={() => setIsDiscoverModalOpen(true)}
                        style={{
                            background: '#059669', color: '#fff', border: 'none',
                            padding: '10px 16px', borderRadius: '8px', fontSize: '13px',
                            fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}
                        onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                        onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                        <Search size={16} />
                        Discover Leads AI
                    </button>
                    <button
                        onClick={() => setIsImportModalOpen(true)}
                        style={{
                            background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)',
                            padding: '10px 16px', borderRadius: '8px', fontSize: '13px',
                            fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'}
                        onMouseOut={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                    >
                        Import CSV
                    </button>
                    {/* Note: Export to Closely moved to dedicated Export tab per spec */}
                </div>
            </div>

            {/* Main Content Area */}
            <div style={{ padding: '0 40px 40px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{
                    background: '#1c1c1f',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    overflow: 'hidden',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                }}>
                    <FilterBar
                        searchTerm={searchTerm} setSearchTerm={setSearchTerm}
                        tierFilter={tierFilter} setTierFilter={setTierFilter}
                        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                        scrapeFilter={scrapeFilter} setScrapeFilter={setScrapeFilter}
                    />

                    <BulkActions
                        totalLeads={filteredLeads.length}
                        selectedCount={selectedIds.length}
                        onAssignTier={handleAssignTier}
                        onChangeStatus={handleChangeStatus}
                        onDelete={handleDelete}
                    />

                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        <LeadTable
                            leads={filteredLeads}
                            loading={loading}
                            selectedIds={selectedIds}
                            onSelectAll={handleSelectAll}
                            onSelect={handleSelect}
                            onRowClick={setSelectedLead}
                        />
                    </div>
                </div>
            </div>

            <LeadImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImportSuccess={fetchLeads}
            />

            <LeadDiscoverModal
                isOpen={isDiscoverModalOpen}
                onClose={() => setIsDiscoverModalOpen(false)}
                onDiscoverSuccess={fetchLeads}
            />

            <LeadDetailDrawer
                lead={selectedLead}
                isOpen={!!selectedLead}
                onClose={() => setSelectedLead(null)}
            />
        </div>
    );
}
