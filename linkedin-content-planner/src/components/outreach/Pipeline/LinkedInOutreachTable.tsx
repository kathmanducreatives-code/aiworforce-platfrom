import { ExternalLink, Play, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { OutreachLead } from '../../../types/outreach';

interface LinkedInOutreachTableProps {
    leads: OutreachLead[];
    loading: boolean;
    selectedIds: string[];
    onSelectAll: (all: boolean) => void;
    onSelect: (id: string, selected: boolean) => void;
    onProcessLead?: (id: string) => void;
}

export default function LinkedInOutreachTable({ leads, loading, selectedIds, onSelectAll, onSelect, onProcessLead }: LinkedInOutreachTableProps) {
    if (loading) {
        return (
            <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
                <div className="animate-spin" style={{ marginBottom: '12px' }}>Loading...</div>
                <span>Syncing personalized outreach data...</span>
            </div>
        );
    }

    const allSelected = leads.length > 0 && selectedIds.length === leads.length;

    return (
        <div style={{
            overflowX: "auto",
            background: "#1c1c1f",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
        }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px", tableLayout: 'fixed' }}>
                <thead>
                    <tr style={{
                        background: "rgba(255,255,255,0.02)",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        color: "#a1a1aa",
                        fontSize: "11px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em"
                    }}>
                        <th style={{ padding: "12px 0px 12px 16px", width: "40px", borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={(e) => onSelectAll(e.target.checked)}
                                style={{ cursor: "pointer", accentColor: "#059669" }}
                            />
                        </th>
                        <th style={{ padding: "12px 8px 12px 12px", width: "15%", borderRight: '1px solid rgba(255,255,255,0.06)' }}>Contact / Company</th>
                        <th style={{ padding: "12px 8px 12px 12px", width: "10%", borderRight: '1px solid rgba(255,255,255,0.06)' }}>Status</th>
                        <th style={{ padding: "12px 8px 12px 12px", width: "15%", borderRight: '1px solid rgba(255,255,255,0.06)' }}>LinkedIn URL</th>
                        <th style={{ padding: "12px 8px 12px 12px", width: "25%", borderRight: '1px solid rgba(255,255,255,0.06)' }}>Generated DM (300 char)</th>
                        <th style={{ padding: "12px 8px 12px 12px", width: "15%", borderRight: '1px solid rgba(255,255,255,0.06)' }}>Scraped Homepage</th>
                        <th style={{ padding: "12px 8px 12px 12px", width: "15%", borderRight: '1px solid rgba(255,255,255,0.06)' }}>Scraped Careers</th>
                        <th style={{ padding: "12px 12px", width: "80px" }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {leads.length === 0 ? (
                        <tr>
                            <td colSpan={8} style={{ padding: "60px", textAlign: "center", color: "#a1a1aa" }}>
                                No leads currently in the personalized outreach queue.
                            </td>
                        </tr>
                    ) : (
                        leads.map(lead => {
                            const isSelected = selectedIds.includes(lead.id);
                            return (
                                <tr key={lead.id} style={{
                                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                                    transition: "background 0.2s ease-in-out",
                                    height: "64px",
                                    background: isSelected ? "rgba(5, 150, 105, 0.1)" : "transparent"
                                }} onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.02)" }}
                                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent" }}>

                                    <td style={{ padding: "12px 0px 12px 16px", borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => onSelect(lead.id, e.target.checked)}
                                            style={{ cursor: "pointer", accentColor: "#059669" }}
                                        />
                                    </td>

                                    <td style={{ padding: "12px 8px 12px 12px", borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{ fontWeight: 600, color: "#fff", marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.contact_name}</div>
                                        <div style={{ fontSize: '11px', color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.company}</div>
                                    </td>

                                    <td style={{ padding: "12px 8px 12px 12px", borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                                        {renderScrapeStatus(lead.scrape_status)}
                                    </td>

                                    <td style={{ padding: "12px 8px 12px 12px", borderRight: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {lead.linkedin_url ? (
                                            <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer"
                                                style={{ color: '#60a5fa', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <ExternalLink size={12} style={{ flexShrink: 0 }} />
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.linkedin_url.replace('https://', '')}</span>
                                            </a>
                                        ) : (
                                            <span style={{ color: '#71717a' }}>Not provided</span>
                                        )}
                                    </td>

                                    <td style={{ padding: "12px 8px 12px 12px", borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{
                                            maxHeight: '40px',
                                            overflow: 'hidden',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                            color: lead.generated_connection_note ? '#e0e0e0' : '#71717a',
                                            fontSize: '12px',
                                            lineHeight: '1.4'
                                        }}>
                                            {lead.generated_connection_note || "No message generated yet..."}
                                        </div>
                                    </td>

                                    <td style={{ padding: "12px 8px 12px 12px", borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{
                                            fontSize: '11px',
                                            color: lead.scraped_homepage ? '#a1a1aa' : '#71717a',
                                            maxHeight: '40px',
                                            overflow: 'hidden'
                                        }}>
                                            {lead.scraped_homepage ? lead.scraped_homepage.substring(0, 100) + '...' : 'Waiting for scrape...'}
                                        </div>
                                    </td>

                                    <td style={{ padding: "12px 8px 12px 12px", borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{
                                            fontSize: '11px',
                                            color: lead.scraped_careers ? '#a1a1aa' : '#71717a',
                                            maxHeight: '40px',
                                            overflow: 'hidden'
                                        }}>
                                            {lead.scraped_careers ? lead.scraped_careers.substring(0, 100) + '...' : 'Waiting for careers data...'}
                                        </div>
                                    </td>

                                    <td style={{ padding: "12px 16px" }}>
                                        <button
                                            onClick={() => onProcessLead?.(lead.id)}
                                            style={{
                                                background: '#059669',
                                                color: 'white',
                                                border: 'none',
                                                padding: '6px 12px',
                                                borderRadius: '6px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseOver={e => e.currentTarget.style.background = '#047857'}
                                            onMouseOut={e => e.currentTarget.style.background = '#059669'}
                                        >
                                            <Play size={10} fill="currentColor" />
                                            Trigger
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

function renderScrapeStatus(status?: string | null) {
    switch (status) {
        case 'success':
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#059669', fontSize: '11px', fontWeight: 600 }}>
                    <CheckCircle2 size={14} />
                    Ready
                </div>
            );
        case 'failed_scrape':
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f87171', fontSize: '11px', fontWeight: 600 }}>
                    <XCircle size={14} />
                    Failed
                </div>
            );
        case 'in_progress':
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#60a5fa', fontSize: '11px', fontWeight: 600 }}>
                    <Clock size={14} className="animate-spin" />
                    Processing
                </div>
            );
        default:
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a1a1aa', fontSize: '11px', fontWeight: 600 }}>
                    <Clock size={14} />
                    Queued
                </div>
            );
    }
}
