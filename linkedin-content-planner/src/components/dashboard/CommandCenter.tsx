import { useState } from 'react';
import { LayoutDashboard, CheckCircle2, Circle, Mail, Linkedin, PhoneCall, Calendar, Play, Loader2, Sparkles, User, Activity, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';

import { useOutreachMetrics } from '../../hooks/useOutreachMetrics';
import { useOutreachActivities } from '../../hooks/useOutreachActivities';
import { useMarketingTasks } from '../../hooks/useMarketingTasks';
import { useDialerStatus } from '../../hooks/useDialerStatus';
import { executeOutreachAction } from '../../services/outreachN8n';
import MarketingAgent from './MarketingAgent';

// ── Tiny primitives ────────────────────────────────────────────────
function ProgressBar({ label, current, total, color }: { label: string; current: number; total: number; color: string }) {
    const pct = Math.min(100, total > 0 ? (current / total) * 100 : 0);
    return (
        <div className="rounded-xl border border-white/[0.07] p-4 flex flex-col gap-3" style={{ background: '#111113' }}>
            <div className="flex justify-between items-center">
                <span className="text-[13px] font-semibold text-slate-200">{label}</span>
                <span className="text-xs text-slate-500 tabular-nums">{current} / {total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                    className="h-full rounded-full transition-[width] duration-700 animate-bar"
                    style={{ width: `${pct}%`, background: color }}
                />
            </div>
        </div>
    );
}

function MeetingsStat({ value }: { value: number }) {
    return (
        <div className="rounded-xl border border-white/[0.07] p-4 flex flex-col gap-3" style={{ background: '#111113' }}>
            <div className="flex justify-between items-center">
                <span className="text-[13px] font-semibold text-slate-200 flex items-center gap-1.5">
                    <CalendarCheck size={13} className="text-violet-400" />
                    Meetings Booked
                </span>
                <span className="text-2xl font-extrabold text-violet-400 tabular-nums">{value}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#222' }}>
                <div
                    className="h-full rounded-full animate-bar"
                    style={{
                        width: value > 0 ? '100%' : '0%',
                        background: 'linear-gradient(90deg,#a855f7,#7c3aed)',
                    }}
                />
            </div>
        </div>
    );
}

// ── Main ─────────────────────────────────────────────────────────────
export default function CommandCenter() {
    const { metrics } = useOutreachMetrics();
    const { activities, updateActivityStatus } = useOutreachActivities();
    const { tasks: mTasks, updateTaskStatus, refreshTasks } = useMarketingTasks();
    const { status: dialerStatus } = useDialerStatus();
    const [executingId, setExecutingId] = useState<string | null>(null);

    // Map outreach activities to unified task shape
    const outreachTasks = activities.map(a => ({
        id: a.id,
        isMarketing: false,
        type: a.channel === 'call' ? 'call' : 'outreach',
        title: a.action_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) + ' to ' + (a.outreach_leads?.contact_name || 'Contact'),
        context: a.outreach_leads?.company || 'Unknown Company',
        status: a.status === 'sent' ? 'completed' : 'pending',
        channel: a.channel,
        date: a.scheduled_date || a.created_at,
        originalActivity: a,
    }));

    // Map AI marketing tasks
    const aiTasks = mTasks.map(t => ({
        id: t.id,
        isMarketing: true,
        type: t.type,
        title: t.title,
        context: t.description || 'AI Generated Plan',
        status: t.status,
        channel: undefined as string | undefined,
        date: t.scheduled_date || t.created_at,
        originalActivity: t,
    }));

    const allTasks = [...outreachTasks, ...aiTasks];
    const pendingTasks = allTasks.filter(t => t.status === 'pending');
    const completedTasks = allTasks.filter(t => t.status === 'completed');

    const handleExecute = async (taskId: string, isMarketing: boolean, e: React.MouseEvent) => {
        e.stopPropagation();
        setExecutingId(taskId);
        try {
            if (isMarketing) {
                await updateTaskStatus(taskId, 'completed');
                toast.success('Task checked off!');
            } else {
                const task = outreachTasks.find(t => t.id === taskId);
                if (!task?.originalActivity) return;
                const activity = task.originalActivity as any;
                await executeOutreachAction(activity, {
                    name: activity.outreach_leads?.contact_name || 'Unknown',
                    company: activity.outreach_leads?.company || 'Unknown',
                });
                await updateActivityStatus(activity.id, 'sent');
                toast.success('Task marked complete!');
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to execute.');
        } finally {
            setExecutingId(null);
        }
    };

    const TaskIcon = ({ type, channel, isMarketing }: { type: string; channel?: string; isMarketing: boolean }) => {
        if (isMarketing) return <Sparkles size={15} className="text-pink-400" />;
        if (type === 'call') return <PhoneCall size={15} className="text-emerald-400" />;
        if (type === 'content') return <Calendar size={15} className="text-amber-400" />;
        if (channel === 'linkedin' || channel === 'linkedin_dm' || channel === 'linkedin_connect')
            return <Linkedin size={15} className="text-blue-400" />;
        return <Mail size={15} className="text-blue-400" />;
    };

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="page-content">
                {/* Header */}
                <div className="flex items-center justify-between shrink-0 animate-fade-in">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.15)' }}>
                            <LayoutDashboard size={16} className="text-violet-400" />
                        </div>
                        <div>
                            <h2 className="text-[17px] font-bold text-white tracking-tight">Command Center</h2>
                            <p className="text-xs text-slate-500 mt-0.5">Daily marketing & sales operations</p>
                        </div>
                    </div>

                    {/* Dialer status chip */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/[0.07]" style={{ background: '#111113' }}>
                        <div className={`w-2 h-2 rounded-full ${dialerStatus?.is_active ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-white/20'}`} />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Dialer {dialerStatus?.is_active ? 'Live' : 'Idle'}
                        </span>
                        {dialerStatus?.is_active && dialerStatus.current_lead_name && (
                            <>
                                <div className="w-px h-3 bg-white/[0.08]" />
                                <div className="flex items-center gap-1">
                                    <User size={11} className="text-slate-500" />
                                    <span className="text-[12px] text-slate-300">{dialerStatus.current_lead_name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Activity size={11} className="text-slate-500" />
                                    <span className={`text-[11px] font-semibold ${dialerStatus.last_call_status === 'Answered' ? 'text-emerald-400' : 'text-slate-500'}`}>
                                        {dialerStatus.last_call_status}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Progress bars row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up delay-1">
                    <ProgressBar
                        label="Outreach Messages"
                        current={metrics.completedOutreach}
                        total={metrics.pendingOutreach + metrics.completedOutreach || 1}
                        color="#3b82f6"
                    />
                    <ProgressBar
                        label="Calls Made"
                        current={metrics.completedCalls}
                        total={metrics.pendingCalls + metrics.completedCalls || 1}
                        color="#10b981"
                    />
                    <ProgressBar
                        label="Content Published"
                        current={metrics.completedContent}
                        total={metrics.pendingContent + metrics.completedContent || 1}
                        color="#f59e0b"
                    />
                    <MeetingsStat value={metrics.meetingsBooked} />
                </div>

                {/* Today's briefing */}
                <div
                    className="rounded-2xl border border-white/[0.07] p-5 animate-fade-in-up delay-2"
                    style={{ background: 'linear-gradient(135deg,#111113,#14101e)' }}
                >
                    <div className="flex items-center gap-2 mb-4">
                        <Sparkles size={15} className="text-amber-400" />
                        <h3 className="text-[14px] font-bold text-white">Today's Briefing</h3>
                        <span className="text-[10px] text-slate-600 ml-auto">
                            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            { icon: <Linkedin size={14} className="text-blue-400" />, label: 'DMs to Send', value: pendingTasks.filter(t => !t.isMarketing && (t.channel === 'linkedin_dm' || t.channel === 'linkedin_connect')).length, color: '#3b82f6' },
                            { icon: <Calendar size={14} className="text-violet-400" />, label: 'Content Going Live', value: metrics.pendingContent, color: '#8b5cf6' },
                            { icon: <PhoneCall size={14} className="text-emerald-400" />, label: 'Calls Queued', value: metrics.pendingCalls, color: '#10b981' },
                            { icon: <CalendarCheck size={14} className="text-amber-400" />, label: 'Meetings Booked', value: metrics.meetingsBooked, color: '#f59e0b' },
                        ].map((item, i) => (
                            <div
                                key={i}
                                className="flex items-center gap-3 rounded-xl p-3 border border-white/[0.06]"
                                style={{ background: 'rgba(255,255,255,0.02)' }}
                            >
                                <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center" style={{ background: `${item.color}18` }}>
                                    {item.icon}
                                </div>
                                <div>
                                    <p className="text-2xl font-extrabold tabular-nums leading-none" style={{ color: item.color }}>{item.value}</p>
                                    <p className="text-[10px] text-slate-600 mt-0.5 leading-tight">{item.label}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Main grid: task queue + AI agent */}
                <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 animate-fade-in-up delay-3">
                    {/* Today's Queue */}
                    <div className="rounded-2xl border border-white/[0.07] flex flex-col overflow-hidden" style={{ background: '#111113' }}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
                            <h3 className="text-[14px] font-bold text-white">Today's Queue</h3>
                            <span className="text-[10px] font-semibold text-slate-500 bg-white/[0.05] border border-white/[0.08] rounded-full px-2 py-0.5">
                                {pendingTasks.length} pending
                            </span>
                        </div>

                        <div className="flex flex-col overflow-y-auto max-h-[480px]">
                            {pendingTasks.length === 0 && completedTasks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
                                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>🎉</div>
                                    <p className="text-sm font-semibold text-white">All caught up!</p>
                                    <p className="text-xs text-slate-600 max-w-40">No pending tasks for today.</p>
                                </div>
                            ) : (
                                allTasks
                                    .sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0))
                                    .map((task, i, arr) => (
                                        <div
                                            key={task.id}
                                            className={[
                                                'flex items-center justify-between px-5 py-3.5 transition-all',
                                                i < arr.length - 1 ? 'border-b border-white/[0.05]' : '',
                                                task.status === 'completed' ? 'opacity-50' : '',
                                            ].join(' ')}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <button
                                                    onClick={(e) => handleExecute(task.id, task.isMarketing, e)}
                                                    className="shrink-0 transition-colors"
                                                >
                                                    {task.status === 'completed'
                                                        ? <CheckCircle2 size={18} className="text-emerald-400" />
                                                        : <Circle size={18} className="text-slate-600 hover:text-slate-300" />
                                                    }
                                                </button>
                                                <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                                    <TaskIcon type={task.type} channel={task.channel} isMarketing={task.isMarketing} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className={`text-[13px] font-medium truncate ${task.status === 'completed' ? 'line-through text-slate-500' : 'text-white'}`}>
                                                        {task.title}
                                                    </p>
                                                    {task.context && (
                                                        <p className="text-[11px] text-slate-600 truncate mt-0.5">{task.context}</p>
                                                    )}
                                                </div>
                                            </div>

                                            {task.status === 'pending' && (
                                                <button
                                                    onClick={(e) => handleExecute(task.id, task.isMarketing, e)}
                                                    disabled={executingId === task.id}
                                                    className={[
                                                        'shrink-0 ml-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5',
                                                        'text-[12px] font-semibold transition-all',
                                                        'border border-white/[0.08] text-slate-300 hover:text-white hover:border-white/[0.15]',
                                                        executingId === task.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                                                    ].join(' ')}
                                                    style={{ background: 'rgba(255,255,255,0.03)' }}
                                                >
                                                    {executingId === task.id
                                                        ? <Loader2 size={13} className="animate-spin" />
                                                        : (task.isMarketing ? <CheckCircle2 size={13} /> : <Play size={13} />)
                                                    }
                                                    {task.isMarketing ? 'Done' : task.type === 'call' ? 'Dial' : 'Send'}
                                                </button>
                                            )}
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>

                    {/* AI Agent */}
                    <MarketingAgent onTasksCreated={refreshTasks} />
                </div>
            </div>
        </div>
    );
}
