import { useState } from 'react';
import StatusBadge from '../shared/StatusBadge';
import TierSelector from '../shared/TierSelector';
import { Search, Briefcase, Linkedin, Search as ResearchIcon, MessageSquare, Clock } from 'lucide-react';
import type { OutreachLead } from '../../../types/outreach';

interface LeadTableProps {
    leads: OutreachLead[];
    loading: boolean;
    selectedIds: string[];
    onSelectAll: (all: boolean) => void;
    onSelect: (id: string, selected: boolean) => void;
    onUpdateTier: (id: string, tier: any) => void;
    onRowClick: (lead: OutreachLead) => void;
}

export default function LeadTable({ leads, loading, selectedIds, onSelectAll, onSelect, onUpdateTier, onRowClick }: LeadTableProps) {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredLeads = leads.filter(l =>
        l.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.title?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>Loading leads...</div>;
    }

    const allFilteredSelected = filteredLeads.length > 0 && filteredLeads.every(l => selectedIds.includes(l.id));

    return (
        <div style={{ background: "#141414", borderRadius: "16px", border: "1px solid #2a2a2a", overflow: "hidden" }}>
            {/* Search Bar & Filters */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2a2a", display: "flex", gap: "16px", alignItems: "center" }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: "8px", background: "#0d0d0d",
                    border: "1px solid #333", borderRadius: "8px", padding: "8px 12px", flex: 1, maxWidth: "400px"
                }}>
                    <Search size={16} color="#666" />
                    <input
                        type="text"
                        placeholder="Search leads by name, company, or title..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ background: "transparent", border: "none", color: "#e0e0e0", fontSize: "13px", outline: "none", width: "100%" }}
                    />
                </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid #2a2a2a", color: "#888", background: "rgba(0,0,0,0.2)" }}>
                            <th style={{ padding: "12px 20px", width: "40px" }}>
                                <input
                                    type="checkbox"
                                    checked={allFilteredSelected}
                                    onChange={(e) => onSelectAll(e.target.checked)}
                                    style={{ cursor: "pointer", accentColor: "#a855f7" }}
                                />
                            </th>
                            <th style={{ padding: "12px 20px", fontWeight: 500, width: "30%" }}>Contact</th>
                            <th style={{ padding: "12px 20px", fontWeight: 500, width: "25%" }}>Company</th>
                            <th style={{ padding: "12px 20px", fontWeight: 500 }}>Tier</th>
                            <th style={{ padding: "12px 20px", fontWeight: 500 }}>Status</th>
                            <th style={{ padding: "12px 20px", fontWeight: 500 }}>Signals</th>
                            <th style={{ padding: "12px 20px", fontWeight: 500, textAlign: "right" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredLeads.length === 0 ? (
                            <tr>
                                <td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#666" }}>
                                    No leads found. Drop a CSV to get started.
                                </td>
                            </tr>
                        ) : (
                            filteredLeads.map(lead => (
                                <tr
                                    key={lead.id}
                                    style={{ borderBottom: "1px solid #1e1e1e", transition: "background 0.2s", cursor: "pointer", background: selectedIds.includes(lead.id) ? "rgba(168, 85, 247, 0.05)" : "transparent" }}
                                    onMouseEnter={e => e.currentTarget.style.background = selectedIds.includes(lead.id) ? "rgba(168, 85, 247, 0.08)" : "rgba(40,40,40,0.5)"}
                                    onMouseLeave={e => e.currentTarget.style.background = selectedIds.includes(lead.id) ? "rgba(168, 85, 247, 0.05)" : "transparent"}
                                    onClick={() => onRowClick(lead)}
                                >
                                    <td style={{ padding: "12px 20px" }} onClick={e => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(lead.id)}
                                            onChange={(e) => onSelect(lead.id, e.target.checked)}
                                            style={{ cursor: "pointer", accentColor: "#a855f7" }}
                                        />
                                    </td>
                                    <td style={{ padding: "12px 20px" }}>
                                        <div style={{ fontWeight: 600, color: "#e0e0e0", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                                            {lead.contact_name}
                                            {lead.linkedin_url && (
                                                <a href={lead.linkedin_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "#3b82f6", display: "flex" }}>
                                                    <Linkedin size={12} />
                                                </a>
                                            )}
                                        </div>
                                        <div style={{ color: "#888", fontSize: "12px" }}>{lead.title || "No title provided"}</div>
                                    </td>
                                    <td style={{ padding: "12px 20px", color: "#ccc" }}>
                                        <div style={{ fontWeight: 500, marginBottom: "4px" }}>{lead.company}</div>
                                        <div style={{ color: "#888", fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
                                            {lead.industry && <span><Briefcase size={10} style={{ display: "inline", marginRight: "2px" }} /> {lead.industry}</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: "12px 20px" }} onClick={e => e.stopPropagation()}>
                                        <TierSelector tier={lead.tier} onChange={(tier) => onUpdateTier(lead.id, tier)} />
                                    </td>
                                    <td style={{ padding: "12px 20px" }}>
                                        <StatusBadge status={lead.status} />
                                    </td>
                                    <td style={{ padding: "12px 20px" }}>
                                        <div style={{
                                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                                            background: lead.signals?.length > 0 ? "rgba(0, 229, 160, 0.15)" : "#222",
                                            color: lead.signals?.length > 0 ? "#00e5a0" : "#666",
                                            padding: "2px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 600
                                        }}>
                                            {lead.signals?.length || 0} signals
                                        </div>
                                    </td>
                                    <td style={{ padding: "12px 20px", textAlign: "right" }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                                            <button
                                                title="Research Signals"
                                                onClick={(e) => { e.stopPropagation(); /* TODO */ }}
                                                style={{ background: "#222", border: "1px solid #333", padding: "6px", borderRadius: "6px", color: "#a855f7", cursor: "pointer" }}
                                            ><ResearchIcon size={14} /></button>
                                            <button
                                                title="Compose Message"
                                                onClick={(e) => { e.stopPropagation(); /* TODO */ }}
                                                style={{ background: "#222", border: "1px solid #333", padding: "6px", borderRadius: "6px", color: "#3b82f6", cursor: "pointer" }}
                                            ><MessageSquare size={14} /></button>
                                            <button
                                                title="Add to Sequence"
                                                onClick={(e) => { e.stopPropagation(); /* TODO */ }}
                                                style={{ background: "#222", border: "1px solid #333", padding: "6px", borderRadius: "6px", color: "#00e5a0", cursor: "pointer" }}
                                            ><Clock size={14} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
