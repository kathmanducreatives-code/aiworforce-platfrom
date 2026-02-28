import { useState } from 'react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import { Edit3, CheckCircle2, Save } from 'lucide-react';
import CharCounter from '../shared/CharCounter';
import TierDot from '../shared/TierDot';
import { toast } from 'sonner';

export default function MessageStudioView() {
    const { leads, loading, updateLead } = useOutreachLeads();
    const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
    const [editableMsgText, setEditableMsgText] = useState('');

    // Only show leads that have been successfully scraped and Have a generated sequence but haven't been synced to closely yet
    const reviewQueue = leads.filter(l =>
        l.scrape_status === 'success' &&
        l.status === 'not_started' &&
        l.generated_sequence &&
        l.generated_sequence.length > 0 &&
        (!l.closely_connection_status || l.closely_connection_status === 'none')
    );

    if (loading) {
        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>Loading Review Queue...</div>;
    }

    const startEditing = (leadId: string, stepIdx: number, text: string) => {
        setEditingMsgId(`${leadId}-${stepIdx}`);
        setEditableMsgText(text);
    };

    const saveEdit = async (leadId: string, stepIdx: number) => {
        const lead = leads.find(l => l.id === leadId);
        if (!lead || !lead.generated_sequence) return;

        const newSeq = [...lead.generated_sequence];
        newSeq[stepIdx] = { ...newSeq[stepIdx], content: editableMsgText };

        await updateLead(leadId, { generated_sequence: newSeq });
        setEditingMsgId(null);
        toast.success("Message Edit Saved");
    };

    const toggleApproveStep = async (leadId: string, stepIdx: number) => {
        const lead = leads.find(l => l.id === leadId);
        if (!lead || !lead.generated_sequence) return;

        const newSeq = [...lead.generated_sequence];
        newSeq[stepIdx] = { ...newSeq[stepIdx], approved: !newSeq[stepIdx].approved };

        await updateLead(leadId, { generated_sequence: newSeq });
    };

    const approveAllForLead = async (leadId: string) => {
        const lead = leads.find(l => l.id === leadId);
        if (!lead || !lead.generated_sequence) return;

        const newSeq = lead.generated_sequence.map(s => ({ ...s, approved: true }));
        // Also advance their closely connection status so they move to the Export tab
        await updateLead(leadId, {
            generated_sequence: newSeq,
            closely_connection_status: 'pending'
        });
        toast.success(`${lead.contact_name}'s sequence approved and ready for export!`);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
            <div style={{ padding: '32px 40px 60px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>

                {/* Header */}
                <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ fontSize: '28px', color: '#fff', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: '8px', fontFamily: '"Cabinet Grotesk", "Satoshi", sans-serif' }}>
                            Message Studio
                        </h1>
                        <p style={{ color: '#888', fontSize: '14px' }}>
                            Review, polish, and approve AI-generated DM sequences before launching campaigns.
                        </p>
                    </div>
                    <div style={{
                        background: 'rgba(0, 212, 170, 0.1)', border: '1px solid rgba(0, 212, 170, 0.2)',
                        color: '#00D4AA', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600
                    }}>
                        {reviewQueue.length} DMs in Queue
                    </div>
                </div>

                {reviewQueue.length === 0 ? (
                    <div style={{
                        background: '#141416', border: '1px dashed rgba(255,255,255,0.1)',
                        borderRadius: '16px', padding: '80px 40px', textAlign: 'center',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px'
                    }}>
                        <CheckCircle2 size={48} color="#00D4AA" style={{ opacity: 0.8 }} />
                        <div>
                            <h3 style={{ fontSize: '18px', color: '#fff', fontWeight: 600, marginBottom: '8px' }}>You're all caught up!</h3>
                            <p style={{ color: '#888', fontSize: '14px' }}>There are no messages currently waiting for your review.</p>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                        {reviewQueue.map(lead => {
                            const sequence = lead.generated_sequence || [];
                            const allApproved = sequence.every(s => s.approved);

                            return (
                                <div key={lead.id} style={{
                                    background: '#141416', border: '1px solid rgba(255,255,255,0.06)',
                                    borderRadius: '16px', overflow: 'hidden',
                                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
                                }}>
                                    {/* Lead Strip */}
                                    <div style={{
                                        padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        background: '#18181A'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: '18px', fontWeight: 600 }}>
                                                {lead.contact_name.charAt(0)}
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                                                    <h3 style={{ fontSize: '16px', color: '#fff', fontWeight: 600 }}>{lead.contact_name}</h3>
                                                    <TierDot tier={lead.tier} />
                                                </div>
                                                <div style={{ fontSize: '13px', color: '#888' }}>
                                                    {lead.title || 'Unknown Role'} at <span style={{ color: '#e0e0e0', fontWeight: 500 }}>{lead.company}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <button
                                                onClick={() => approveAllForLead(lead.id)}
                                                disabled={allApproved}
                                                style={{
                                                    background: allApproved ? '#222' : '#00D4AA',
                                                    color: allApproved ? '#666' : '#000',
                                                    border: 'none', padding: '10px 20px', borderRadius: '8px',
                                                    fontSize: '13px', fontWeight: 600, cursor: allApproved ? 'not-allowed' : 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    transition: 'all 0.2s',
                                                    boxShadow: allApproved ? 'none' : '0 4px 12px rgba(0, 212, 170, 0.3)'
                                                }}
                                            >
                                                <CheckCircle2 size={16} />
                                                {allApproved ? 'Approved & Ready' : 'Approve All & Mark Ready'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* 4-Step Sequence Grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
                                        {sequence.map((msg, idx) => {
                                            const stepKey = `${lead.id}-${idx}`;
                                            const isEditing = editingMsgId === stepKey;
                                            const isApproved = msg.approved;

                                            // Determine max chars based on typical LinkedIn limits
                                            const maxChars = idx === 0 ? 300 : 1500; // First message usually shorter (conn request)

                                            return (
                                                <div key={idx} style={{
                                                    background: '#141416', padding: '24px',
                                                    position: 'relative', display: 'flex', flexDirection: 'column'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{
                                                                width: '24px', height: '24px', borderRadius: '6px',
                                                                background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                fontSize: '11px', fontWeight: 600, color: '#aaa'
                                                            }}>
                                                                {idx + 1}
                                                            </div>
                                                            <span style={{ fontSize: '13px', color: '#888', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                                                                Day {msg.dayOffset}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                            {!isEditing && <CharCounter current={msg.content.length} max={maxChars} />}

                                                            <button
                                                                onClick={() => toggleApproveStep(lead.id, idx)}
                                                                style={{
                                                                    background: isApproved ? 'rgba(0, 212, 170, 0.1)' : 'transparent',
                                                                    border: isApproved ? '1px solid rgba(0, 212, 170, 0.3)' : '1px solid rgba(255,255,255,0.1)',
                                                                    color: isApproved ? '#00D4AA' : '#888',
                                                                    padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                                                                    transition: 'all 0.2s'
                                                                }}
                                                            >
                                                                <CheckCircle2 size={12} /> {isApproved ? 'Approved' : 'Approve'}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div style={{ flex: 1, position: 'relative' }}>
                                                        {isEditing ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                                                                <textarea
                                                                    value={editableMsgText}
                                                                    onChange={e => setEditableMsgText(e.target.value)}
                                                                    style={{
                                                                        width: '100%', flex: 1, minHeight: '120px',
                                                                        background: '#0a0a0b', border: '1px solid rgba(255,255,255,0.15)',
                                                                        color: '#e0e0e0', padding: '16px', borderRadius: '8px',
                                                                        fontSize: '14px', lineHeight: '1.6', outline: 'none', resize: 'none'
                                                                    }}
                                                                />
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <CharCounter current={editableMsgText.length} max={maxChars} />
                                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                                        <button onClick={() => setEditingMsgId(null)} style={{ background: 'transparent', color: '#888', border: 'none', fontSize: '13px', cursor: 'pointer', padding: '6px 12px' }}>Cancel</button>
                                                                        <button onClick={() => saveEdit(lead.id, idx)} style={{ background: '#00D4AA', color: '#000', border: 'none', borderRadius: '6px', padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><Save size={14} /> Save changes</button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div
                                                                onClick={() => !isApproved && startEditing(lead.id, idx, msg.content)}
                                                                style={{
                                                                    color: isApproved ? '#888' : '#e0e0e0', fontSize: '14px', lineHeight: '1.6',
                                                                    whiteSpace: 'pre-wrap', padding: '16px', borderRadius: '8px',
                                                                    background: isApproved ? 'transparent' : 'rgba(255,255,255,0.02)',
                                                                    border: '1px solid transparent',
                                                                    cursor: isApproved ? 'default' : 'text',
                                                                    minHeight: '120px',
                                                                    transition: 'all 0.2s'
                                                                }}
                                                                onMouseOver={e => { if (!isApproved) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
                                                                onMouseOut={e => { if (!isApproved) e.currentTarget.style.borderColor = 'transparent' }}
                                                            >
                                                                {msg.content}

                                                                {!isApproved && (
                                                                    <div style={{ position: 'absolute', bottom: '16px', right: '16px', opacity: 0.5, pointerEvents: 'none' }}>
                                                                        <Edit3 size={14} color="#888" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
