import { useState } from 'react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import { Download, FileDown, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ExportView() {
    const { leads, loading, updateLead } = useOutreachLeads();
    const [isExporting, setIsExporting] = useState(false);

    // Leads ready for export: Scraped, generated sequence, and approved (closely_connection_status === 'pending')
    const readyLeads = leads.filter(l =>
        l.scrape_status === 'success' &&
        l.closely_connection_status === 'pending'
    );

    if (loading) {
        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>Loading Export Queue...</div>;
    }

    const handleExport = async () => {
        if (readyLeads.length === 0) return;
        setIsExporting(true);

        try {
            // Closely CSV format: LinkedIn URL, First Name, Last Name, Company, Title, Connection Note, Tags
            const headers = ['LinkedIn URL', 'First Name', 'Last Name', 'Company', 'Title', 'Connection Note', 'Tags'];
            const rows = readyLeads.map(lead => {
                const names = (lead.contact_name || '').split(' ');
                const firstName = names[0] || '';
                const lastName = names.slice(1).join(' ') || '';

                // Get the approved connection message (Step 1 usually)
                const connStep = lead.generated_sequence?.find(s => s.step === 1);
                const connNote = connStep ? connStep.content : `Hi ${firstName}, saw you're at ${lead.company}. Would love to connect.`;

                // Tag formatting for closely campaigns
                const tag = `sp-linkedin-auto,tier-${lead.tier || 'unassigned'}`;

                return [
                    lead.linkedin_url || '',
                    firstName,
                    lastName,
                    lead.company || '',
                    lead.title || '',
                    `"${connNote.replace(/"/g, '""')}"`, // Escape quotes for CSV
                    tag,
                ].join(',');
            });

            const csv = [headers.join(','), ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `closely-export-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Post-export actions: Mark leads as in_sequence and closely_synced
            for (const lead of readyLeads) {
                await updateLead(lead.id, {
                    status: 'in_sequence',
                    closely_connection_status: 'none' // reset or set to accepted later via webhook
                });
            }

            toast.success(`Successfully exported ${readyLeads.length} leads to CSV!`);
        } catch (error: any) {
            toast.error(error.message || "Failed to generate CSV export");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
            <div style={{ padding: '32px 40px 60px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>

                {/* Header */}
                <div style={{ marginBottom: '40px' }}>
                    <h1 style={{ fontSize: '28px', color: '#fff', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: '8px', fontFamily: '"Cabinet Grotesk", "Satoshi", sans-serif' }}>
                        Closely Export
                    </h1>
                    <p style={{ color: '#888', fontSize: '14px' }}>
                        Generate CSV files perfectly formatted for your Closely LinkedIn campaigns.
                    </p>
                </div>

                <div style={{
                    background: '#141416', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '24px', padding: '40px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                }}>
                    <div style={{
                        width: '80px', height: '80px', borderRadius: '50%',
                        background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: '24px'
                    }}>
                        <FileDown size={40} strokeWidth={2} />
                    </div>

                    <h2 style={{ fontSize: '24px', color: '#fff', fontWeight: 600, marginBottom: '12px' }}>
                        {readyLeads.length} Leads Ready for Export
                    </h2>

                    <p style={{ color: '#888', fontSize: '15px', lineHeight: '1.6', maxWidth: '600px', marginBottom: '32px' }}>
                        These leads have been fully enriched and have approved AI sequences. Exporting them will generate a Closely-compatible CSV containing the connection request notes, tags, and profile URLs.
                    </p>

                    <div style={{ display: 'flex', gap: '16px', marginBottom: '40px' }}>
                        <button
                            onClick={handleExport}
                            disabled={readyLeads.length === 0 || isExporting}
                            style={{
                                background: readyLeads.length === 0 ? '#222' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                color: readyLeads.length === 0 ? '#666' : '#fff',
                                border: 'none', padding: '14px 28px', borderRadius: '12px',
                                fontSize: '15px', fontWeight: 600, cursor: readyLeads.length === 0 ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: '10px',
                                transition: 'all 0.2s', boxShadow: readyLeads.length > 0 ? '0 8px 20px rgba(59, 130, 246, 0.3)' : 'none'
                            }}
                        >
                            {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                            {isExporting ? 'Generating CSV...' : 'Download Closely CSV'}
                        </button>
                    </div>

                    <div style={{ background: '#0a0a0b', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px', padding: '24px', width: '100%', textAlign: 'left' }}>
                        <h4 style={{ color: '#fff', fontSize: '14px', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CheckCircle2 size={16} color="#00D4AA" /> What happens next?
                        </h4>
                        <ul style={{ margin: 0, paddingLeft: '20px', color: '#888', fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '12px', lineHeight: '1.5' }}>
                            <li>The generated CSV maps perfectly to Closely's import fields (LinkedIn URL, Name, Company, Connection Note, Tags).</li>
                            <li>The leads in this export will be automatically moved to <strong style={{ color: '#e0e0e0' }}>'In Sequence'</strong> status in your Pipeline.</li>
                            <li>Once imported into Closely, your campaign will begin sending connection requests automatically.</li>
                        </ul>
                    </div>
                </div>

            </div>
        </div>
    );
}
