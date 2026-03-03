import StatusBadge from '../shared/StatusBadge';
import TierDot from '../shared/TierDot';
import ScrapeBadge from '../shared/ScrapeBadge';
import LinkedInBadge from '../shared/LinkedInBadge';
import type { OutreachLead } from '../../../types/outreach';

interface LeadTableProps {
    leads: OutreachLead[];
    loading: boolean;
    selectedIds: string[];
    onSelectAll: (all: boolean) => void;
    onSelect: (id: string, selected: boolean) => void;
    onRowClick: (lead: OutreachLead) => void;
}

export default function LeadTable({ leads, loading, selectedIds, onSelectAll, onSelect, onRowClick }: LeadTableProps) {
    if (loading) {
        return <div style={{ padding: "60px", textAlign: "center", color: "#666", fontSize: "14px" }}>Loading leads...</div>;
    }

    const allSelected = leads.length > 0 && selectedIds.length === leads.length;

    return (
        <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                <thead>
                    <tr style={{
                        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                        color: "#a1a1aa",
                        fontSize: "12px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        background: "rgba(255, 255, 255, 0.02)"
                    }}>
                        <th style={{ padding: "12px 16px", width: "40px" }}>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={(e) => onSelectAll(e.target.checked)}
                                style={{ cursor: "pointer", accentColor: "#059669" }}
                            />
                        </th>
                        <th style={{ padding: "12px 16px", width: "25%" }}>Company</th>
                        <th style={{ padding: "12px 16px", width: "20%" }}>Contact</th>
                        <th style={{ padding: "12px 16px", width: "15%" }}>Title</th>
                        <th style={{ padding: "12px 16px" }}>Tier</th>
                        <th style={{ padding: "12px 16px" }}>Status</th>
                        <th style={{ padding: "12px 16px", textAlign: "center" }}>Scrape</th>
                        <th style={{ padding: "12px 16px", textAlign: "center" }}>LinkedIn</th>
                    </tr>
                </thead>
                <tbody>
                    {leads.length === 0 ? (
                        <tr>
                            <td colSpan={8} style={{ padding: "60px", textAlign: "center", color: "#a1a1aa" }}>
                                No leads match your filters.
                            </td>
                        </tr>
                    ) : (
                        leads.map(lead => {
                            const isSelected = selectedIds.includes(lead.id);
                            return (
                                <tr
                                    key={lead.id}
                                    style={{
                                        borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                                        transition: "background 150ms ease-out",
                                        cursor: "pointer",
                                        background: isSelected ? "rgba(5, 150, 105, 0.1)" : "transparent",
                                        borderLeft: isSelected ? "3px solid #059669" : "3px solid transparent",
                                        height: "48px"
                                    }}
                                    onMouseEnter={e => {
                                        if (!isSelected) e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                                    }}
                                    onMouseLeave={e => {
                                        if (!isSelected) e.currentTarget.style.background = "transparent";
                                    }}
                                    onClick={() => onRowClick(lead)}
                                >
                                    <td style={{ padding: "0 16px" }} onClick={e => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => onSelect(lead.id, e.target.checked)}
                                            style={{ cursor: "pointer", accentColor: "#059669" }}
                                        />
                                    </td>
                                    <td style={{ padding: "0 16px" }}>
                                        <div style={{ fontWeight: 500, color: "#ffffff" }}>{lead.company}</div>
                                    </td>
                                    <td style={{ padding: "0 16px", color: "#a1a1aa" }}>
                                        {lead.contact_name}
                                    </td>
                                    <td style={{ padding: "0 16px", color: "#71717a" }}>
                                        {lead.title || "—"}
                                    </td>
                                    <td style={{ padding: "0 16px" }}>
                                        <TierDot tier={lead.tier} />
                                    </td>
                                    <td style={{ padding: "0 16px" }}>
                                        <StatusBadge status={lead.status} />
                                    </td>
                                    <td style={{ padding: "0 16px", textAlign: "center" }}>
                                        <div style={{ display: 'inline-block' }}>
                                            <ScrapeBadge status={lead.scrape_status || null} />
                                        </div>
                                    </td>
                                    <td style={{ padding: "0 16px", textAlign: "center" }}>
                                        <div style={{ display: 'inline-block' }}>
                                            <LinkedInBadge status={lead.closely_connection_status || null} />
                                        </div>
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
