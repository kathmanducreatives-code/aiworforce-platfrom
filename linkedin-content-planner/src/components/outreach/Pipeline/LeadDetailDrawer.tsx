import { useState } from 'react';
import { X, Linkedin, Building, Mail, Users, Briefcase, MessageSquare, Clock, Edit2, Loader2 } from 'lucide-react';
import type { OutreachLead } from '../../../types/outreach';
import StatusBadge from '../shared/StatusBadge';
import TierSelector from '../shared/TierSelector';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import { researchLeadSignals } from '../../../services/outreachGemini';
import { toast } from 'sonner';

interface LeadDetailDrawerProps {
    lead: OutreachLead | null;
    isOpen: boolean;
    onClose: () => void;
}

export default function LeadDetailDrawer({ lead, isOpen, onClose }: LeadDetailDrawerProps) {
    const { updateLead } = useOutreachLeads();
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [editableNotes, setEditableNotes] = useState('');
    const [isResearching, setIsResearching] = useState(false);

    if (!isOpen || !lead) return null;

    const handleNotesSave = () => {
        updateLead(lead.id, { notes: editableNotes });
        setIsEditingNotes(false);
    };

    const handleTierChange = (tier: any) => {
        updateLead(lead.id, { tier });
    };

    const handleResearchSignals = async () => {
        if (!lead.company) {
            toast.error("Company name is required for research");
            return;
        }

        setIsResearching(true);
        try {
            const newSignals = await researchLeadSignals(
                lead.company,
                lead.industry,
                lead.company_size,
                lead.contact_name,
                lead.title,
                lead.notes
            );

            await updateLead(lead.id, { signals: newSignals });
            toast.success("Signals updated");
        } catch (err: any) {
            toast.error(err.message || "Failed to research signals");
        } finally {
            setIsResearching(false);
        }
    };

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 40,
                    opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? 'auto' : 'none',
                    transition: 'opacity 0.3s'
                }}
            />

            {/* Drawer */}
            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: '450px',
                backgroundColor: '#141414', borderLeft: '1px solid #2a2a2a',
                zIndex: 50, transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex', flexDirection: 'column',
                boxShadow: '-8px 0 24px rgba(0,0,0,0.4)'
            }}>
                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {lead.contact_name}
                            {lead.linkedin_url && (
                                <a href={lead.linkedin_url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', display: 'flex' }}>
                                    <Linkedin size={16} />
                                </a>
                            )}
                        </h2>
                        <p style={{ color: '#aaa', fontSize: '13px', marginTop: '4px' }}>{lead.title}</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

                    {/* Key Info Strip */}
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', fontWeight: 600 }}>Status</span>
                            <StatusBadge status={lead.status} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', fontWeight: 600 }}>Tier</span>
                            <TierSelector tier={lead.tier} onChange={handleTierChange} />
                        </div>
                    </div>

                    {/* Company Card */}
                    <div style={{ backgroundColor: '#0d0d0d', borderRadius: '12px', padding: '16px', border: '1px solid #222', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#e0e0e0', fontWeight: 500 }}>
                            <Building size={16} color="#888" /> {lead.company}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px', color: '#aaa' }}>
                            {lead.industry && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Briefcase size={12} /> {lead.industry}</div>}
                            {lead.company_size && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={12} /> {lead.company_size}</div>}
                            {lead.email && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', gridColumn: '1 / -1' }}><Mail size={12} /> {lead.email}</div>}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
                        <button style={{ flex: 1, backgroundColor: '#00e5a0', color: '#000', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <MessageSquare size={16} /> Compose
                        </button>
                        <button style={{ flex: 1, backgroundColor: '#222', color: '#e0e0e0', border: '1px solid #333', padding: '10px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <Clock size={16} /> Sequence
                        </button>
                    </div>

                    {/* Signals Section */}
                    <div style={{ marginBottom: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '14px', color: '#fff', fontWeight: 600 }}>AI Signals</h3>
                            <button
                                onClick={handleResearchSignals}
                                disabled={isResearching}
                                style={{ backgroundColor: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', cursor: isResearching ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                {isResearching ? <Loader2 size={12} className="animate-spin" /> : null}
                                {isResearching ? "Searching..." : "Research Signals"}
                            </button>
                        </div>

                        {(!lead.signals || lead.signals.length === 0) ? (
                            <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', border: '1px dashed #3b82f644', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
                                <p style={{ color: '#aaa', fontSize: '13px', marginBottom: '12px' }}>No signals researched yet.</p>
                                <button
                                    onClick={handleResearchSignals}
                                    disabled={isResearching}
                                    style={{ backgroundColor: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: isResearching ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 auto' }}
                                >
                                    {isResearching ? <><Loader2 size={14} className="animate-spin" /> Deep Searching...</> : "Run Deep Search"}
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {lead.signals.map((sig, i) => (
                                    <div key={i} style={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '12px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ fontSize: '11px', color: '#a855f7', fontWeight: 600, textTransform: 'uppercase' }}>{sig.type}</span>
                                            <span style={{ fontSize: '11px', color: '#666' }}>{sig.confidence}</span>
                                        </div>
                                        <div style={{ color: '#e0e0e0', fontSize: '13px', marginBottom: '6px' }}>{sig.summary}</div>
                                        <div style={{ color: '#aaa', fontSize: '12px', fontStyle: 'italic', borderLeft: '2px solid #333', paddingLeft: '8px' }}>"{sig.hook}"</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Notes Section */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <h3 style={{ fontSize: '14px', color: '#fff', fontWeight: 600 }}>Notes</h3>
                            {!isEditingNotes && (
                                <button onClick={() => { setIsEditingNotes(true); setEditableNotes(lead.notes || ''); }} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}>
                                    <Edit2 size={14} />
                                </button>
                            )}
                        </div>

                        {isEditingNotes ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <textarea
                                    value={editableNotes}
                                    onChange={(e) => setEditableNotes(e.target.value)}
                                    rows={4}
                                    style={{ width: '100%', backgroundColor: '#0d0d0d', border: '1px solid #333', borderRadius: '8px', padding: '10px', color: '#fff', fontSize: '13px', resize: 'vertical', outline: 'none' }}
                                    placeholder="Add notes here..."
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button onClick={() => setIsEditingNotes(false)} style={{ background: 'transparent', color: '#888', border: 'none', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={handleNotesSave} style={{ backgroundColor: '#00e5a0', color: '#000', border: 'none', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Save Notes</button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ backgroundColor: '#0d0d0d', borderRadius: '8px', padding: '12px', border: '1px solid #222', color: lead.notes ? '#ccc' : '#666', fontSize: '13px', minHeight: '80px', whiteSpace: 'pre-wrap' }}>
                                {lead.notes || "No notes added yet."}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </>
    );
}
