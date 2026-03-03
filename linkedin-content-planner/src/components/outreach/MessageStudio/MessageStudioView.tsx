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

    // Only show leads that have been successfully scraped and Have a generated note but haven't been synced to closely yet
    const reviewQueue = leads.filter(l =>
        l.scrape_status === 'success' &&
        l.status === 'not_started' &&
        l.generated_connection_note &&
        (!l.closely_connection_status || l.closely_connection_status === 'none')
    );

    if (loading) {
        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>Loading Review Queue...</div>;
    }

    const startEditing = (leadId: string, text: string) => {
        setEditingMsgId(leadId);
        setEditableMsgText(text);
    };

    const saveEdit = async (leadId: string) => {
        const lead = leads.find(l => l.id === leadId);
        if (!lead) return;

        await updateLead(leadId, { generated_connection_note: editableMsgText });
        setEditingMsgId(null);
        toast.success("Message Edit Saved");
    };

    const approveForLead = async (leadId: string) => {
        const lead = leads.find(l => l.id === leadId);
        if (!lead) return;

        // Advance their closely connection status so they move to the Export tab
        await updateLead(leadId, {
            closely_connection_status: 'pending'
        });
        toast.success(`${lead.contact_name}'s message approved and ready for export!`);
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
                            const isEditing = editingMsgId === lead.id;
                            const msgContent = lead.generated_connection_note || '';

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
                                                onClick={() => approveForLead(lead.id)}
                                                style={{
                                                    background: '#00D4AA',
                                                    color: '#000',
                                                    border: 'none', padding: '10px 20px', borderRadius: '8px',
                                                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    transition: 'all 0.2s',
                                                    boxShadow: '0 4px 12px rgba(0, 212, 170, 0.3)'
                                                }}
                                            >
                                                <CheckCircle2 size={16} />
                                                Approve & Mark Ready
                                            </button>
                                        </div>
                                    </div>

                                    {/* Content Area */}
                                    <div style={{ display: 'flex' }}>
                                        {/* Context Column */}
                                        <div style={{
                                            width: '300px', borderRight: '1px solid rgba(255,255,255,0.04)',
                                            padding: '24px', background: 'rgba(255,255,255,0.02)'
                                        }}>
                                            <h4 style={{ color: '#fff', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px', fontWeight: 600 }}>AI Context</h4>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                {lead.open_roles && (
                                                    <div>
                                                        <span style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Hiring Identified</span>
                                                        <div style={{ fontSize: '13px', color: '#e0e0e0', lineHeight: 1.4 }}>{lead.open_roles}</div>
                                                    </div>
                                                )}
                                                {lead.uses_agency && (
                                                    <div>
                                                        <span style={{ display: 'block', fontSize: '11px', color: '#059669', marginBottom: '4px', fontWeight: 600 }}>Agency User (Tier 1)</span>
                                                        <div style={{ fontSize: '13px', color: '#e0e0e0', lineHeight: 1.4 }}>Spotted: {lead.agency_name || 'Agency keywords found'}</div>
                                                    </div>
                                                )}
                                                {lead.founder_about && (
                                                    <div>
                                                        <span style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>Founder Intel</span>
                                                        <div style={{ fontSize: '13px', color: '#bbb', fontStyle: 'italic', lineHeight: 1.5 }}>"{lead.founder_about}"</div>
                                                    </div>
                                                )}
                                                {!lead.open_roles && !lead.uses_agency && !lead.founder_about && (
                                                    <div style={{ fontSize: '13px', color: '#666' }}>Standard profile scrape.</div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Editor Column */}
                                        <div style={{ flex: 1, padding: '24px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                                <span style={{ fontSize: '13px', color: '#888', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                                                    Connection Note
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    {!isEditing && <CharCounter current={msgContent.length} max={300} />}
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
                                                                fontSize: '14px', lineHeight: '1.6', outline: 'none', resize: 'none',
                                                                boxSizing: 'border-box'
                                                            }}
                                                        />
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <CharCounter current={editableMsgText.length} max={300} />
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <button onClick={() => setEditingMsgId(null)} style={{ background: 'transparent', color: '#888', border: 'none', fontSize: '13px', cursor: 'pointer', padding: '6px 12px' }}>Cancel</button>
                                                                <button onClick={() => saveEdit(lead.id)} style={{ background: '#00D4AA', color: '#000', border: 'none', borderRadius: '6px', padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><Save size={14} /> Save changes</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div
                                                        onClick={() => startEditing(lead.id, msgContent)}
                                                        style={{
                                                            color: '#e0e0e0', fontSize: '14px', lineHeight: '1.6',
                                                            whiteSpace: 'pre-wrap', padding: '16px', borderRadius: '8px',
                                                            background: 'rgba(255,255,255,0.02)',
                                                            border: '1px solid transparent',
                                                            cursor: 'text',
                                                            minHeight: '120px',
                                                            transition: 'all 0.2s'
                                                        }}
                                                        onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                                                        onMouseOut={e => e.currentTarget.style.borderColor = 'transparent'}
                                                    >
                                                        {msgContent}
                                                        <div style={{ position: 'absolute', bottom: '16px', right: '16px', opacity: 0.5, pointerEvents: 'none' }}>
                                                            <Edit3 size={14} color="#888" />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
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
