import { useState } from 'react';
import { LayoutDashboard, CheckCircle2, Circle, Mail, Linkedin, PhoneCall, Calendar, Play, Loader2, Sparkles, User, Activity, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';

import { useOutreachMetrics } from '../../hooks/useOutreachMetrics';
import { useOutreachActivities } from '../../hooks/useOutreachActivities';
import { useMarketingTasks } from '../../hooks/useMarketingTasks';
import { useDialerStatus } from '../../hooks/useDialerStatus';
import { executeOutreachAction } from '../../services/outreachN8n';
import MarketingAgent from './MarketingAgent';

export default function CommandCenter() {
    const { metrics, loading: _metricsLoading } = useOutreachMetrics();
    const { activities, loading: _activitiesLoading, updateActivityStatus } = useOutreachActivities();
    const { tasks: mTasks, loading: _mTasksLoading, updateTaskStatus, refreshTasks } = useMarketingTasks();
    const { status: dialerStatus } = useDialerStatus();
    const [executingId, setExecutingId] = useState<string | null>(null);

    // Map OutreachActivities
    const outreachTasks = activities.map(a => ({
        id: a.id,
        isMarketing: false,
        type: a.channel === 'call' ? 'call' : 'outreach',
        title: a.action_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) + ' to ' + (a.outreach_leads?.contact_name || 'Contact'),
        context: a.outreach_leads?.company || 'Unknown Company',
        status: a.status === 'sent' ? 'completed' : 'pending',
        channel: a.channel,
        date: a.scheduled_date || a.created_at,
        time: undefined,
        count: undefined,
        originalActivity: a
    }));

    // Map AI Marketing Tasks
    const aiTasks = mTasks.map(t => ({
        id: t.id,
        isMarketing: true,
        type: t.type,
        title: t.title,
        context: t.description || 'AI Generated Plan',
        status: t.status,
        channel: undefined,
        date: t.scheduled_date || t.created_at,
        time: undefined,
        count: undefined,
        originalActivity: t
    }));

    // Combine them
    const allTasks = [...outreachTasks, ...aiTasks];

    const handleExecute = async (taskId: string, isMarketing: boolean, e: React.MouseEvent) => {
        e.stopPropagation();
        setExecutingId(taskId);

        try {
            if (isMarketing) {
                // For AI tasks, just mark as completed directly
                await updateTaskStatus(taskId, 'completed');
                toast.success('Task checked off!');
            } else {
                const task = outreachTasks.find(t => t.id === taskId);
                if (!task || !task.originalActivity) return;

                const activity = task.originalActivity;
                const contactName = activity.outreach_leads?.contact_name || 'Unknown Contact';
                const companyName = activity.outreach_leads?.company || 'Unknown Company';

                await executeOutreachAction(activity, { name: contactName, company: companyName });
                await updateActivityStatus(activity.id, 'sent');
                toast.success('Task marked as complete!');
            }
        } catch (error: any) {
            toast.error(error.message || "Failed to execute action.");
        } finally {
            setExecutingId(null);
        }
    };

    const getTaskIcon = (type: string, channel?: string, isMarketing?: boolean) => {
        if (isMarketing) return <Sparkles size={18} color="#ec4899" />;
        if (type === 'call') return <PhoneCall size={18} color="#00e5a0" />;
        if (type === 'content') return <Calendar size={18} color="#f59e0b" />;
        if (channel === 'linkedin') return <Linkedin size={18} color="#0077b5" />;
        return <Mail size={18} color="#3b82f6" />;
    };

    const ProgressBar = ({ label, current, total, color }: any) => (
        <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 600 }}>{label}</span>
                <span style={{ color: '#888', fontSize: '12px', fontWeight: 500 }}>{current} / {total}</span>
            </div>
            <div style={{ height: '8px', background: '#222', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min((current / total) * 100, 100)}%`, background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
            </div>
        </div>
    );

    return (
        <div style={{ padding: '32px 40px', maxWidth: '1600px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <LayoutDashboard size={28} color="#a855f7" />
                    <div>
                        <h1 style={{ color: '#fff', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px' }}>Command Center</h1>
                        <p style={{ color: '#888', fontSize: '14px', marginTop: '4px' }}>Your daily marketing and sales operations.</p>
                    </div>
                </div>

                {/* Real-time Dialer Status Widget */}
                <div style={{
                    background: '#111',
                    border: '1px solid #2a2a2a',
                    borderRadius: '12px',
                    padding: '12px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '24px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: dialerStatus?.is_active ? '#00e5a0' : '#444',
                            boxShadow: dialerStatus?.is_active ? '0 0 10px #00e5a0' : 'none'
                        }} />
                        <span style={{ color: '#fff', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Dialer {dialerStatus?.is_active ? 'Live' : 'Idle'}
                        </span>
                    </div>

                    {dialerStatus?.is_active && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '1px solid #222', paddingLeft: '24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <User size={14} color="#888" />
                                <span style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 500 }}>
                                    {dialerStatus.current_lead_name || 'Calling...'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Activity size={14} color="#888" />
                                <span style={{ color: dialerStatus.last_call_status === 'Answered' ? '#00e5a0' : '#888', fontSize: '12px', fontWeight: 600 }}>
                                    {dialerStatus.last_call_status}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '40px', flexShrink: 0 }}>
                <ProgressBar label="Outreach Messages" current={metrics.completedOutreach} total={metrics.pendingOutreach + metrics.completedOutreach || 1} color="#3b82f6" />
                <ProgressBar label="Calls Made" current={metrics.completedCalls} total={metrics.pendingCalls + metrics.completedCalls || 1} color="#00e5a0" />
                <ProgressBar label="Content Published" current={metrics.completedContent} total={metrics.pendingContent + metrics.completedContent || 1} color="#f59e0b" />
                <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <CalendarCheck size={14} color="#a855f7" /> Meetings Booked
                        </span>
                        <span style={{ color: '#a855f7', fontSize: '24px', fontWeight: 800 }}>{metrics.meetingsBooked}</span>
                    </div>
                    <div style={{ height: '8px', background: '#222', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: metrics.meetingsBooked > 0 ? '100%' : '0%', background: 'linear-gradient(90deg, #a855f7, #7c3aed)', borderRadius: '4px', transition: 'width 0.5s ease' }} />
                    </div>
                </div>
            </div>

            {/* Morning Briefing */}
            <div style={{
                background: 'linear-gradient(135deg, #141414, #1a1020)',
                border: '1px solid #2a2a2a',
                borderRadius: '16px',
                padding: '20px 24px',
                marginBottom: '24px',
                flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                    <Sparkles size={18} color="#f59e0b" />
                    <h3 style={{ color: '#fff', fontSize: '15px', fontWeight: 700, margin: 0 }}>Today's Briefing</h3>
                    <span style={{ fontSize: '10px', color: '#555', marginLeft: 'auto' }}>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                    {[
                        {
                            icon: <Linkedin size={16} color="#0077b5" />,
                            label: 'DMs to Send',
                            value: allTasks.filter(t => !t.isMarketing && t.status === 'pending' && (t.channel === 'linkedin_dm' || t.channel === 'linkedin_connect')).length,
                            color: '#0077b5',
                        },
                        {
                            icon: <Calendar size={16} color="#a855f7" />,
                            label: 'Content Going Live',
                            value: metrics.pendingContent,
                            color: '#a855f7',
                        },
                        {
                            icon: <PhoneCall size={16} color="#00e5a0" />,
                            label: 'Calls Queued',
                            value: metrics.pendingCalls,
                            color: '#00e5a0',
                        },
                        {
                            icon: <CalendarCheck size={16} color="#f59e0b" />,
                            label: 'Meetings Booked',
                            value: metrics.meetingsBooked,
                            color: '#f59e0b',
                        },
                    ].map((item, i) => (
                        <div key={i} style={{
                            background: '#111',
                            border: '1px solid #222',
                            borderRadius: '12px',
                            padding: '14px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <div style={{
                                width: '36px', height: '36px', borderRadius: '10px',
                                background: `${item.color}15`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                                {item.icon}
                            </div>
                            <div>
                                <div style={{ color: item.color, fontSize: '22px', fontWeight: 800, lineHeight: 1 }}>
                                    {item.value}
                                </div>
                                <div style={{ color: '#666', fontSize: '10px', fontWeight: 600, marginTop: '2px' }}>
                                    {item.label}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ display: 'flex', gap: '32px', flex: 1, minHeight: 0 }}>
                {/* Left Column: Today's Queue */}
                <div style={{ flex: 2, background: '#111', border: '1px solid #2a2a2a', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '20px 24px', background: '#141414', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
                        <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 600 }}>Today's Queue</h2>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1 }}>
                        {allTasks.sort((a, b) => {
                            if (a.status === 'completed' && b.status !== 'completed') return 1;
                            if (a.status !== 'completed' && b.status === 'completed') return -1;
                            return new Date(b.date).getTime() - new Date(a.date).getTime();
                        }).map((task, i) => (
                            <div
                                key={task.id}
                                style={{
                                    padding: '16px 24px',
                                    borderBottom: i === allTasks.length - 1 ? 'none' : '1px solid #2a2a2a',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    opacity: task.status === 'completed' ? 0.6 : 1,
                                    transition: 'all 0.2s'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div onClick={(e) => handleExecute(task.id, task.isMarketing, e)} style={{ cursor: 'pointer', color: task.status === 'completed' ? '#00e5a0' : '#444' }}>
                                        {task.status === 'completed' ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '8px' }}>
                                        {getTaskIcon(task.type, task.channel, task.isMarketing)}
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ color: task.status === 'completed' ? '#888' : '#e0e0e0', fontSize: '14px', fontWeight: 500, textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>
                                            {task.title}
                                        </span>
                                        {(task.time || task.context || task.count) && (
                                            <span style={{ color: '#666', fontSize: '13px' }}>
                                                {task.time || task.context || `${task.count} Scheduled Leads`}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {task.status === 'pending' && (
                                    <button
                                        onClick={(e) => handleExecute(task.id, task.isMarketing, e)}
                                        disabled={executingId === task.id}
                                        style={{
                                            background: '#222', color: '#fff', border: '1px solid #333',
                                            padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
                                            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px',
                                            cursor: executingId === task.id ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        {executingId === task.id ? <Loader2 size={16} className="animate-spin" /> : (task.isMarketing ? <CheckCircle2 size={16} /> : <Play size={16} />)}
                                        {task.isMarketing ? 'Complete' : task.type === 'call' ? 'Open Dialer' : task.type === 'content' ? 'Publish Now' : 'Send All'}
                                    </button>
                                )}
                            </div>
                        ))}

                        {allTasks.filter(t => t.status === 'pending').length === 0 && (
                            <div style={{ padding: '40px', textAlign: 'center', color: '#888', fontSize: '14px' }}>
                                All caught up for today! 🎉
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: AI Agent Assistant */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <MarketingAgent onTasksCreated={refreshTasks} />
                </div>
            </div>
        </div>
    );
}
