import { useState } from 'react';
import { X, Linkedin, Briefcase, MessageSquare, Edit2, Loader2, Save } from 'lucide-react';
import type { OutreachLead } from '../../../types/outreach';
import StatusBadge from '../shared/StatusBadge';
import TierDot from '../shared/TierDot';
import CharCounter from '../shared/CharCounter';
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

    // Message inline editing state
    const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null);
    const [editableMsgText, setEditableMsgText] = useState('');

    if (!isOpen || !lead) return null;

    const handleNotesSave = async () => {
        await updateLead(lead.id, { notes: editableNotes });
        setIsEditingNotes(false);
        toast.success("Notes saved");
    };

    const handleResearchSignals = async () => {
        if (!lead.company) {
            toast.error("Company name is required for research");
            return;
        }

        setIsResearching(true);
        try {
            const newSignals = await researchLeadSignals(
                lead.company, lead.industry, lead.company_size,
                lead.contact_name, lead.title, lead.notes
            );
            await updateLead(lead.id, { signals: newSignals });
            toast.success("AI Signals generated mapped correctly!");
        } catch (err: any) {
            toast.error(err.message || "Failed to research signals");
        } finally {
            setIsResearching(false);
        }
    };

    const startEditingMsg = (index: number, text: string) => {
        setEditingMsgIndex(index);
        setEditableMsgText(text);
    };

    const saveMsg = async () => {
        if (editingMsgIndex === null || !lead.generated_sequence) return;
        const newSeq = [...lead.generated_sequence];
        newSeq[editingMsgIndex] = { ...newSeq[editingMsgIndex], content: editableMsgText };

        await updateLead(lead.id, { generated_sequence: newSeq });
        setEditingMsgIndex(null);
        toast.success("Message updated");
    };

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 40,
                    opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? 'auto' : 'none',
                    transition: 'all 0.3s ease'
                }}
            />

            {/* Drawer */}
            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: '560px',
                backgroundColor: '#0a0a0b', borderLeft: '1px solid rgba(255,255,255,0.06)',
                zIndex: 50, transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex', flexDirection: 'column',
                boxShadow: '-12px 0 48px rgba(0,0,0,0.5)',
                color: '#e0e0e0'
            }}>
                {/* Header */}
                <div style={{
                    padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    background: '#141416'
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 600, fontFamily: '"Cabinet Grotesk", "Satoshi", sans-serif' }}>
                                {lead.contact_name}
                            </h2>
                            {lead.linkedin_url && (
                                <a href={lead.linkedin_url} target="_blank" rel="noreferrer" style={{ color: '#00D4AA', display: 'flex' }}>
                                    <Linkedin size={18} />
                                </a>
                            )}
                            <TierDot tier={lead.tier} />
                        </div>
                        <p style={{ color: '#888', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Briefcase size={14} /> {lead.title || 'Unknown Title'} at {lead.company}
                        </p>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                        color: '#aaa', cursor: 'pointer', padding: '8px', borderRadius: '50%',
                        transition: 'all 0.2s'
                    }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}>
                        <X size={16} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>

                    {/* Status Strip */}
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '32px', alignItems: 'center' }}>
                        <StatusBadge status={lead.status} />
                        <span style={{ color: '#666' }}>•</span>
                        <div style={{ fontSize: '13px', color: '#888' }}>
                            Added {new Date(lead.created_at).toLocaleDateString()}
                        </div>
                    </div>

                    {/* Sequence Messages */}
                    {lead.generated_sequence && lead.generated_sequence.length > 0 && (
                        <div style={{ marginBottom: '40px' }}>
                            <h3 style={{ fontSize: '15px', color: '#fff', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <MessageSquare size={16} color="#00D4AA" /> AI Sequence
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {lead.generated_sequence.map((msg, idx) => {
                                    const isEditing = editingMsgIndex === idx;
                                    return (
                                        <div key={idx} style={{
                                            background: '#141416', border: '1px solid rgba(255,255,255,0.06)',
                                            borderRadius: '12px', padding: '16px', position: 'relative'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
                                                <div style={{ fontSize: '12px', fontWeight: 600, color: '#00D4AA', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    Step {msg.step} • Day {msg.dayOffset}
                                                </div>
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                                    {!isEditing && <CharCounter current={msg.content.length} max={300} />}
                                                    {isEditing ? (
                                                        <button onClick={saveMsg} style={{ background: '#00D4AA', color: '#000', border: 'none', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <Save size={12} /> Save
                                                        </button>
                                                    ) : (
                                                        <button onClick={() => startEditingMsg(idx, msg.content)} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', transition: 'color 0.2s' }} onMouseOver={e => e.currentTarget.style.color = '#fff'} onMouseOut={e => e.currentTarget.style.color = '#888'}>
                                                            <Edit2 size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            {isEditing ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    <textarea
                                                        value={editableMsgText}
                                                        onChange={e => setEditableMsgText(e.target.value)}
                                                        style={{
                                                            width: '100%', background: '#0a0a0b', border: '1px solid #333',
                                                            color: '#e0e0e0', padding: '12px', borderRadius: '8px',
                                                            fontSize: '13px', lineHeight: '1.5', minHeight: '100px',
                                                            outline: 'none', resize: 'vertical'
                                                        }}
                                                    />
                                                    <div style={{ alignSelf: 'flex-end' }}>
                                                        <CharCounter current={editableMsgText.length} max={300} />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ color: '#ccc', fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                                                    {msg.content}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* AI Signals */}
                    <div style={{ marginBottom: '40px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '15px', color: '#fff', fontWeight: 600 }}>AI Signals & Research</h3>
                            <button
                                onClick={handleResearchSignals}
                                disabled={isResearching}
                                style={{
                                    background: 'transparent', border: '1px solid rgba(0, 212, 170, 0.3)',
                                    color: '#00D4AA', padding: '6px 12px', borderRadius: '6px',
                                    fontSize: '12px', cursor: isResearching ? 'not-allowed' : 'pointer',
                                    fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={e => { if (!isResearching) { e.currentTarget.style.background = 'rgba(0, 212, 170, 0.1)'; } }}
                                onMouseOut={e => { if (!isResearching) { e.currentTarget.style.background = 'transparent'; } }}
                            >
                                {isResearching ? <Loader2 size={14} className="animate-spin" /> : null}
                                {isResearching ? "Searching..." : "Run Deep Search"}
                            </button>
                        </div>

                        {(!lead.signals || lead.signals.length === 0) ? (
                            <div style={{ background: '#141416', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '12px', padding: '32px', textAlign: 'center' }}>
                                <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>No intelligence gathered yet. Run a deep search to parse standard company data and recent news.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '12px' }}>
                                {lead.signals.map((sig, i) => (
                                    <div key={i} style={{ background: '#141416', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <span style={{ fontSize: '11px', color: '#F5A623', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sig.type}</span>
                                            <span style={{ fontSize: '11px', color: '#666', background: '#222', padding: '2px 6px', borderRadius: '4px' }}>{sig.confidence} Match</span>
                                        </div>
                                        <div style={{ color: '#e0e0e0', fontSize: '13px', marginBottom: '8px', lineHeight: '1.5' }}>{sig.summary}</div>
                                        <div style={{ color: '#888', fontSize: '13px', fontStyle: 'italic', borderLeft: '2px solid rgba(255,255,255,0.1)', paddingLeft: '12px' }}>"{sig.hook}"</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Notes Section */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <h3 style={{ fontSize: '15px', color: '#fff', fontWeight: 600 }}>Internal Notes</h3>
                            {!isEditingNotes && (
                                <button onClick={() => { setIsEditingNotes(true); setEditableNotes(lead.notes || ''); }} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}>
                                    <Edit2 size={14} />
                                </button>
                            )}
                        </div>

                        {isEditingNotes ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <textarea
                                    value={editableNotes}
                                    onChange={(e) => setEditableNotes(e.target.value)}
                                    rows={4}
                                    style={{
                                        width: '100%', background: '#141416', border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px', padding: '12px', color: '#fff', fontSize: '13px',
                                        resize: 'vertical', outline: 'none'
                                    }}
                                    placeholder="Add context or notes..."
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button onClick={() => setIsEditingNotes(false)} style={{ background: 'transparent', color: '#888', border: 'none', fontSize: '12px', cursor: 'pointer', padding: '6px 12px' }}>Cancel</button>
                                    <button onClick={handleNotesSave} style={{ background: '#fff', color: '#000', border: 'none', borderRadius: '6px', padding: '6px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Save Note</button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ background: '#141416', borderRadius: '8px', padding: '16px', border: '1px solid rgba(255,255,255,0.06)', color: lead.notes ? '#ccc' : '#666', fontSize: '13px', minHeight: '80px', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                                {lead.notes || "No internal notes yet."}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </>
    );
}
