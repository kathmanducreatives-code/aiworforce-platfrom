import { useOutreachActivities } from '../../../hooks/useOutreachActivities';
import { Activity, Clock, CheckCircle2, PlayCircle, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function ActivityTimeline() {
    const { activities, loading } = useOutreachActivities();

    if (loading) {
        return <div style={{ padding: '40px', textAlign: 'center', color: '#666', fontSize: '14px' }}>Loading timeline...</div>;
    }

    if (activities.length === 0) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: '#666', border: '1px dashed rgba(255,255,255,0.06)', borderRadius: '12px' }}>
                <Activity size={24} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                <p style={{ fontSize: '14px' }}>No recent activities found.</p>
                <p style={{ fontSize: '13px', marginTop: '4px' }}>Actions taken by the AI will appear here in chronological order.</p>
            </div>
        );
    }

    // Sort by newest first
    const sortedActivities = [...activities].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 50);

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'pending': return <Clock size={16} color="#F5A623" />;
            case 'completed':
            case 'sent': return <CheckCircle2 size={16} color="#00D4AA" />;
            case 'in_progress': return <PlayCircle size={16} color="#3b82f6" />;
            case 'failed':
            case 'skipped': return <XCircle size={16} color="#ef4444" />;
            default: return <Activity size={16} color="#888" />;
        }
    };

    return (
        <div style={{ background: '#141416', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#fff', fontWeight: 600, letterSpacing: '-0.01em', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={18} color="#00D4AA" /> 48-Hour Activity Feed
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {sortedActivities.map((activity, index) => {
                    const isLast = index === sortedActivities.length - 1;
                    const leadName = activity.outreach_leads?.contact_name || 'Unknown Contact';
                    const companyName = activity.outreach_leads?.company || 'Unknown Company';
                    const actionName = activity.action_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                    return (
                        <div key={activity.id} style={{ display: 'flex', gap: '16px', position: 'relative' }}>
                            {/* Timeline line */}
                            {!isLast && (
                                <div style={{
                                    position: 'absolute', left: '15px', top: '32px', bottom: '-16px',
                                    width: '1px', background: 'rgba(255,255,255,0.06)'
                                }} />
                            )}

                            {/* Icon Circle */}
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '50%',
                                background: '#1a1a1c', border: '1px solid rgba(255,255,255,0.08)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, zIndex: 2
                            }}>
                                {getStatusIcon(activity.status)}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, paddingBottom: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                    <div style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 500 }}>
                                        <span style={{ color: '#fff' }}>{actionName}</span> to {leadName} ({companyName})
                                    </div>
                                    <div style={{ color: '#666', fontSize: '12px', whiteSpace: 'nowrap', marginLeft: '12px' }}>
                                        {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                                    </div>
                                </div>
                                <div style={{ color: '#888', fontSize: '13px', lineHeight: '1.5' }}>
                                    {activity.status === 'pending' && `Queued for step ${activity.step_number} via ${activity.channel}.`}
                                    {activity.status === 'sent' && `Successfully delivered sequence step ${activity.step_number}.`}
                                    {activity.status === 'failed' && <span style={{ color: '#ef4444' }}>Delivery failed. Needs attention.</span>}
                                    {activity.status === 'skipped' && `Manually skipped step ${activity.step_number}.`}
                                    {activity.channel === 'linkedin_scrape' && `Completed background data enrichment.`}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
