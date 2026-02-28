import React from 'react';
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
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        color: "#666",
                        fontSize: "12px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em"
                    }}>
                        <th style={{ padding: "16px 20px", width: "40px" }}>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={(e) => onSelectAll(e.target.checked)}
                                style={{ cursor: "pointer", accentColor: "#00D4AA" }}
                            />
                        </th>
                        <th style={{ padding: "16px 20px", width: "25%" }}>Company</th>
                        <th style={{ padding: "16px 20px", width: "20%" }}>Contact</th>
                        <th style={{ padding: "16px 20px", width: "15%" }}>Title</th>
                        <th style={{ padding: "16px 20px" }}>Tier</th>
                        <th style={{ padding: "16px 20px" }}>Status</th>
                        <th style={{ padding: "16px 20px", textAlign: "center" }}>Scrape</th>
                        <th style={{ padding: "16px 20px", textAlign: "center" }}>LinkedIn</th>
                    </tr>
                </thead>
                <tbody>
                    {leads.length === 0 ? (
                        <tr>
                            <td colSpan={8} style={{ padding: "60px", textAlign: "center", color: "#666" }}>
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
                                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                                        transition: "background 150ms ease-out",
                                        cursor: "pointer",
                                        background: isSelected ? "rgba(0, 212, 170, 0.04)" : "transparent",
                                        borderLeft: isSelected ? "3px solid #00D4AA" : "3px solid transparent",
                                        height: "52px"
                                    }}
                                    onMouseEnter={e => {
                                        if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                                    }}
                                    onMouseLeave={e => {
                                        if (!isSelected) e.currentTarget.style.background = "transparent";
                                    }}
                                    onClick={() => onRowClick(lead)}
                                >
                                    <td style={{ padding: "0 20px" }} onClick={e => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => onSelect(lead.id, e.target.checked)}
                                            style={{ cursor: "pointer", accentColor: "#00D4AA" }}
                                        />
                                    </td>
                                    <td style={{ padding: "0 20px" }}>
                                        <div style={{ fontWeight: 600, color: "#fff" }}>{lead.company}</div>
                                    </td>
                                    <td style={{ padding: "0 20px", color: "#e0e0e0" }}>
                                        {lead.contact_name}
                                    </td>
                                    <td style={{ padding: "0 20px", color: "#888" }}>
                                        {lead.title || "—"}
                                    </td>
                                    <td style={{ padding: "0 20px" }}>
                                        <TierDot tier={lead.tier} />
                                    </td>
                                    <td style={{ padding: "0 20px" }}>
                                        <StatusBadge status={lead.status} />
                                    </td>
                                    <td style={{ padding: "0 20px", textAlign: "center" }}>
                                        <div style={{ display: 'inline-block' }}>
                                            <ScrapeBadge status={lead.scrape_status} />
                                        </div>
                                    </td>
                                    <td style={{ padding: "0 20px", textAlign: "center" }}>
                                        <div style={{ display: 'inline-block' }}>
                                            <LinkedInBadge status={lead.closely_connection_status} />
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
