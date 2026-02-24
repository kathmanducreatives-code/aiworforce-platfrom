import { useState } from 'react';
import { Mail, Linkedin, Play, CheckCircle2, ChevronDown, ChevronRight, X, Loader2 } from 'lucide-react';
import { executeOutreachAction } from '../../../services/outreachN8n';
import { toast } from 'sonner';

import { useOutreachActivities } from '../../../hooks/useOutreachActivities';

export default function TodaysActions() {
    const { activities, loading, updateActivityStatus, updateActivity } = useOutreachActivities();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const pendingCount = activities.filter(a => a.status === 'pending').length;

    if (loading) return <div style={{ padding: '20px', color: '#888', textAlign: 'center' }}>Loading today's actions...</div>;
    if (pendingCount === 0) return null;

    const handleExecute = async (activity: any) => {
        setProcessingId(activity.id);
        const contactName = activity.outreach_leads?.contact_name || 'Unknown Contact';
        const companyName = activity.outreach_leads?.company || 'Unknown Company';

        try {
            await executeOutreachAction(activity, { name: contactName, company: companyName });
            await updateActivityStatus(activity.id, 'sent');
            toast.success(`Sent via ${activity.channel.includes('linkedin') ? 'LinkedIn' : 'Email'}!`);
            if (expandedId === activity.id) setExpandedId(null);

        } catch (error: any) {
            toast.error(error.message || "Failed to execute action.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleSkip = async (id: string) => {
        await updateActivityStatus(id, 'skipped');
    };

    const getIcon = (channel: string) => {
        if (channel.includes('email')) return <Mail size={16} color="#3b82f6" />;
        if (channel.includes('linkedin')) return <Linkedin size={16} color="#0077b5" />;
        return <CheckCircle2 size={16} color="#888" />;
    };

    return (
        <div style={{ marginBottom: '24px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: '#141414', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ background: '#3b82f622', color: '#3b82f6', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                        {pendingCount} Pending
                    </div>
                    <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 600 }}>Today's Automated Actions</h2>
                </div>
                {pendingCount > 1 && (
                    <button style={{ background: '#222', border: '1px solid #333', color: '#fff', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
                        Execute All
                    </button>
                )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {activities.filter(a => a.status === 'pending').map((activity, index) => (
                    <div key={activity.id} style={{ borderBottom: index === pendingCount - 1 ? 'none' : '1px solid #2a2a2a' }}>

                        {/* Compact Row View */}
                        <div
                            style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: expandedId === activity.id ? '#1a1a1a' : 'transparent', transition: 'background 0.2s' }}
                            onClick={() => setExpandedId(expandedId === activity.id ? null : activity.id)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <div style={{ color: '#666' }}>
                                    {expandedId === activity.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    {getIcon(activity.channel)}
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 500 }}>
                                            {activity.action_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} to {activity.outreach_leads?.contact_name || 'Unknown'}
                                        </span>
                                        <span style={{ color: '#888', fontSize: '12px' }}>
                                            {activity.outreach_leads?.company || 'Unknown Company'} • Seq Step {activity.step_number || '?'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={e => e.stopPropagation()}>
                                <button
                                    onClick={() => handleSkip(activity.id)}
                                    style={{ background: 'transparent', border: 'none', color: '#666', padding: '6px', borderRadius: '4px', cursor: 'pointer' }}
                                    title="Skip Action"
                                >
                                    <X size={16} />
                                </button>
                                <button
                                    onClick={() => handleExecute(activity)}
                                    disabled={processingId === activity.id}
                                    style={{
                                        background: '#3b82f6', color: '#fff', border: 'none',
                                        padding: '6px 16px', borderRadius: '6px', fontSize: '12px',
                                        fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', cursor: processingId === activity.id ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {processingId === activity.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                    Send Now
                                </button>
                            </div>
                        </div>

                        {/* Expanded Payload View */}
                        {expandedId === activity.id && (
                            <div style={{ padding: '16px 20px 20px 52px', background: '#1a1a1a', borderTop: '1px solid #2a2a2a' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '800px' }}>
                                    {activity.subject && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <span style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Subject</span>
                                            <input
                                                value={activity.subject}
                                                onChange={(e) => updateActivity(activity.id, { subject: e.target.value })}
                                                style={{ background: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', outline: 'none' }}
                                            />
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Message Body</span>
                                        <textarea
                                            value={activity.body || ''}
                                            onChange={(e) => updateActivity(activity.id, { body: e.target.value })}
                                            rows={5}
                                            style={{ background: '#0d0d0d', border: '1px solid #333', color: '#e0e0e0', padding: '12px', borderRadius: '6px', fontSize: '13px', outline: 'none', resize: 'vertical', lineHeight: '1.5' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
