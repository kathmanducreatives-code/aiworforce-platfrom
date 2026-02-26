import { useState } from 'react';
import { Upload, Plus, Search as ResearchIcon, Loader2, Download } from 'lucide-react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import LeadTable from './LeadTable';
import LeadImportModal from './LeadImportModal';
import LeadDetailDrawer from './LeadDetailDrawer';
import TodaysActions from './TodaysActions';
import type { OutreachLead } from '../../../types/outreach';
import { researchLeadSignals } from '../../../services/outreachGemini';
import { toast } from 'sonner';

export default function PipelineView() {
    const { leads, loading, fetchLeads, updateLead } = useOutreachLeads();
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState<OutreachLead | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isBatchResearching, setIsBatchResearching] = useState(false);
    const [researchProgress, setResearchProgress] = useState({ current: 0, total: 0 });

    const handleSelectAll = (all: boolean) => {
        if (all) {
            setSelectedIds(leads.map(l => l.id));
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

    const handleBatchResearch = async () => {
        if (selectedIds.length === 0) return;

        setIsBatchResearching(true);
        setResearchProgress({ current: 0, total: selectedIds.length });

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < selectedIds.length; i++) {
            const id = selectedIds[i];
            const lead = leads.find(l => l.id === id);

            if (lead && lead.company) {
                setResearchProgress({ current: i + 1, total: selectedIds.length });
                try {
                    const newSignals = await researchLeadSignals(
                        lead.company, lead.industry, lead.company_size,
                        lead.contact_name, lead.title, lead.notes
                    );
                    await updateLead(lead.id, { signals: newSignals });
                    successCount++;
                } catch (error) {
                    failCount++;
                }

                // Rate limiting delay (2 seconds per call as per plan)
                if (i < selectedIds.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } else {
                failCount++;
            }
        }

        setIsBatchResearching(false);
        setSelectedIds([]);
        toast.success(`Research complete: ${successCount} successful, ${failCount} failed.`);
    };

    const handleCloselyExport = () => {
        const selected = selectedIds.length > 0
            ? leads.filter(l => selectedIds.includes(l.id))
            : leads;

        if (selected.length === 0) {
            toast.error('No leads to export!');
            return;
        }

        // Closely CSV format: LinkedIn URL, First Name, Last Name, Company, Title, Connection Note, Tags
        const headers = ['LinkedIn URL', 'First Name', 'Last Name', 'Company', 'Title', 'Connection Note', 'Tags'];
        const rows = selected.map(lead => {
            const names = (lead.contact_name || '').split(' ');
            const firstName = names[0] || '';
            const lastName = names.slice(1).join(' ') || '';
            const tag = `tier-${lead.tier || 2},sp-${lead.id.slice(0, 8)}`;
            const connNote = `Hi ${firstName} — saw ${lead.company || 'your company'} is growing. Always interesting to connect with founders in the ${lead.industry || 'tech'} space. Would love to connect.`;
            return [
                lead.linkedin_url || '',
                firstName,
                lastName,
                lead.company || '',
                lead.title || '',
                `"${connNote.replace(/"/g, '""')}"`,
                tag,
            ].join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `closely-export-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        toast.success(`Exported ${selected.length} leads to Closely CSV!`);
    };

    return (
        <div style={{ padding: "24px 24px 60px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", color: "#f0f0f0", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "4px" }}>
                        Pipeline
                    </h1>
                    <p style={{ color: "#888", fontSize: "14px" }}>
                        Manage outbound leads, view active sequences, and research signals.
                    </p>
                </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    {selectedIds.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#1a1a1a", padding: "6px 12px", borderRadius: "8px", border: "1px solid #3b82f644" }}>
                            <span style={{ color: "#a855f7", fontSize: "13px", fontWeight: 600 }}>
                                {selectedIds.length} selected
                            </span>
                            <button
                                onClick={handleBatchResearch}
                                disabled={isBatchResearching}
                                style={{
                                    background: "#3b82f6", color: "#fff", border: "none",
                                    padding: "6px 12px", borderRadius: "6px", fontSize: "12px",
                                    fontWeight: 600, display: "flex", alignItems: "center", gap: "6px",
                                    cursor: isBatchResearching ? "not-allowed" : "pointer"
                                }}
                            >
                                {isBatchResearching ? <Loader2 size={14} className="animate-spin" /> : <ResearchIcon size={14} />}
                                {isBatchResearching ? `Researching ${researchProgress.current}/${researchProgress.total}...` : "Research All"}
                            </button>
                        </div>
                    )}
                    <button
                        onClick={() => setIsImportModalOpen(true)}
                        style={{
                            background: "#222", color: "#e0e0e0", border: "1px solid #333",
                            padding: "10px 16px", borderRadius: "8px", fontSize: "13px",
                            fontWeight: 600, display: "flex", alignItems: "center", gap: "8px",
                            cursor: "pointer", transition: "all 0.2s"
                        }}
                    >
                        <Upload size={16} /> Import CSV
                    </button>
                    <button
                        onClick={handleCloselyExport}
                        style={{
                            background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                            color: "#fff", border: "none",
                            padding: "10px 16px", borderRadius: "8px", fontSize: "13px",
                            fontWeight: 600, display: "flex", alignItems: "center", gap: "8px",
                            cursor: "pointer", transition: "all 0.2s"
                        }}
                    >
                        <Download size={16} /> Export to Closely
                    </button>
                    <button
                        style={{
                            background: "#00e5a0", color: "#000", border: "none",
                            padding: "10px 16px", borderRadius: "8px", fontSize: "13px",
                            fontWeight: 600, display: "flex", alignItems: "center", gap: "8px",
                            cursor: "pointer", transition: "all 0.2s"
                        }}
                    >
                        <Plus size={16} /> Add Lead
                    </button>
                </div>
            </div>

            <TodaysActions />

            <LeadTable
                leads={leads}
                loading={loading}
                selectedIds={selectedIds}
                onSelectAll={handleSelectAll}
                onSelect={handleSelect}
                onUpdateTier={(id, tier) => updateLead(id, { tier })}
                onRowClick={setSelectedLead}
            />

            <LeadImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImportSuccess={fetchLeads}
            />

            <LeadDetailDrawer
                lead={selectedLead}
                isOpen={!!selectedLead}
                onClose={() => setSelectedLead(null)}
            />
        </div>
    );
}
