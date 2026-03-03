import { useState, useMemo } from 'react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import { Sparkles, Download, Loader2, Database, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import LinkedInOutreachTable from '../Pipeline/LinkedInOutreachTable';

export default function ComposeView() {
    const { leads, loading, updateLead, deleteLeads } = useOutreachLeads();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Filter leads for the spreadsheet view (Workflow A queue)
    const displayLeads = useMemo(() => {
        let filtered = leads;

        if (!searchQuery.trim()) return filtered;

        const lowerQuery = searchQuery.toLowerCase();
        return filtered.filter(l =>
            (l.contact_name && l.contact_name.toLowerCase().includes(lowerQuery)) ||
            (l.company && l.company.toLowerCase().includes(lowerQuery))
        );
    }, [leads, searchQuery]);

    const handleSelectAll = (all: boolean) => {
        if (all) {
            setSelectedIds(displayLeads.map(l => l.id));
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

    const handleDeleteSelected = async () => {
        if (selectedIds.length === 0) {
            toast.error("Please select leads to delete.");
            return;
        }

        const confirmDelete = window.confirm(`Are you sure you want to delete ${selectedIds.length} lead(s)? This cannot be undone.`);
        if (!confirmDelete) return;

        setIsDeleting(true);
        try {
            await deleteLeads(selectedIds);
            setSelectedIds([]); // Clear selection after deletion
        } catch (error) {
            console.error("Delete error:", error);
            // toast is handled in the hook
        } finally {
            setIsDeleting(false);
        }
    };

    const handleGenerateMassDMs = async () => {
        if (selectedIds.length === 0) {
            toast.error("Please select at least one lead.");
            return;
        }

        setIsGenerating(true);
        toast.info(`Triggering mass generation for ${selectedIds.length} leads...`);

        const selectedLeads = displayLeads.filter(l => selectedIds.includes(l.id));

        try {
            // Hit the n8n webhook
            const response = await fetch('https://n8n.prasidha.me/webhook/8763f04c-764a-41aa-944d-c0782a26f3db', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    leads: selectedLeads,
                    timestamp: new Date().toISOString(),
                    trigger_mode: 'manual_mass_generation'
                }),
            });

            if (!response.ok) throw new Error('Webhook failed');

            // Update local state to show processing
            for (const id of selectedIds) {
                await updateLead(id, { scrape_status: 'in_progress' });
            }

            toast.success("Workflow triggered! DMs will appear as they are generated.");
        } catch (error) {
            console.error("Webhook error:", error);
            toast.error("Failed to trigger generation workflow.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleExportCSV = () => {
        if (selectedIds.length === 0) {
            toast.error("Please select leads to export.");
            return;
        }

        const selectedLeads = displayLeads.filter(l => selectedIds.includes(l.id));

        // CSV Header
        const headers = ["Contact Name", "Company", "LinkedIn URL", "Generated DM", "Scraped Homepage", "Scraped Careers"];

        // CSV Rows
        const rows = selectedLeads.map(l => [
            l.contact_name,
            l.company,
            l.linkedin_url || "",
            (l.generated_connection_note || "").replace(/\n/g, " "),
            (l.scraped_homepage || "").replace(/\n/g, " ").substring(0, 500),
            (l.scraped_careers || "").replace(/\n/g, " ").substring(0, 500)
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(r => r.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `personalized_dms_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success("CSV Export starting...");
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: '#0a0a0b' }}>
            <div style={{ padding: '32px 40px', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>

                {/* Header Section */}
                <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                        <h1 style={{
                            fontSize: '28px',
                            color: '#ffffff',
                            fontWeight: 600,
                            letterSpacing: '-0.02em',
                            marginBottom: '8px',
                            fontFamily: '"Cabinet Grotesk", "Satoshi", sans-serif'
                        }}>
                            Compose & Personalize
                        </h1>
                        <p style={{ color: '#a1a1aa', fontSize: '14px' }}>
                            Generate hyper-personalized LinkedIn connection notes in mass using Workflow A.
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={handleDeleteSelected}
                            disabled={selectedIds.length === 0 || isDeleting}
                            style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                padding: '10px 18px',
                                borderRadius: '10px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: (selectedIds.length === 0 || isDeleting) ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s',
                            }}
                            onMouseOver={e => { if (selectedIds.length > 0 && !isDeleting) e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)' }}
                            onMouseOut={e => { if (selectedIds.length > 0 && !isDeleting) e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)' }}
                        >
                            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            {isDeleting ? 'Deleting...' : 'Delete'}
                        </button>
                        <button
                            onClick={handleExportCSV}
                            disabled={selectedIds.length === 0}
                            style={{
                                background: 'rgba(255,255,255,0.05)',
                                color: '#ffffff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                padding: '10px 18px',
                                borderRadius: '10px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: selectedIds.length === 0 ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Download size={16} />
                            Export CSV
                        </button>
                        <button
                            onClick={handleGenerateMassDMs}
                            disabled={selectedIds.length === 0 || isGenerating}
                            style={{
                                background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                                color: '#ffffff',
                                border: 'none',
                                padding: '10px 20px',
                                borderRadius: '10px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: (selectedIds.length === 0 || isGenerating) ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)'
                            }}
                        >
                            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            {isGenerating ? 'Triggering...' : `Generate ${selectedIds.length > 0 ? selectedIds.length : ''} Personalized DMs`}
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
                    <div style={{ position: 'relative', width: '320px' }}>
                        <Search size={16} color="#a1a1aa" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                            type="text"
                            placeholder="Search leads by name or company..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                width: '100%',
                                background: '#141416',
                                border: '1px solid rgba(255,255,255,0.06)',
                                color: '#ffffff',
                                padding: '10px 16px 10px 36px',
                                borderRadius: '8px',
                                fontSize: '13px',
                                outline: 'none',
                                transition: 'all 0.2s',
                            }}
                            onFocus={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.2)'}
                            onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.06)'}
                        />
                    </div>
                </div>

                {/* Main Table */}
                <LinkedInOutreachTable
                    leads={displayLeads}
                    loading={loading}
                    selectedIds={selectedIds}
                    onSelectAll={handleSelectAll}
                    onSelect={handleSelect}
                />

                {/* Workflow Card */}
                <div style={{
                    marginTop: '32px',
                    padding: '24px',
                    background: '#141416',
                    borderRadius: '16px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    gap: '24px',
                    alignItems: 'flex-start'
                }}>
                    <div style={{ background: 'rgba(5, 150, 105, 0.1)', padding: '12px', borderRadius: '12px', color: '#059669' }}>
                        <Database size={24} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#ffffff', marginBottom: '8px' }}>Workflow A Intelligence</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginTop: '16px' }}>
                            <div>
                                <h4 style={{ fontSize: '12px', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Real-time Scrape</h4>
                                <p style={{ fontSize: '13px', color: '#a1a1aa', lineHeight: '1.5' }}>Firecrawl format: markdown. Extracts only main content for high-density AI processing.</p>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '12px', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Smart Extraction</h4>
                                <p style={{ fontSize: '13px', color: '#a1a1aa', lineHeight: '1.5' }}>Scans Company Homepage + Careers page to identify core business and hiring intent.</p>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '12px', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>AI Personalization</h4>
                                <p style={{ fontSize: '13px', color: '#a1a1aa', lineHeight: '1.5' }}>Generates a unique 300-character Hard-Capped connection note per lead.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
