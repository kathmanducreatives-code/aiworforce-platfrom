import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Users, Mail, MessageSquare, ArrowUpRight } from 'lucide-react';
import { useOutreachMetrics } from '../../../hooks/useOutreachMetrics';
import { SkeletonCard } from '../../ui/Skeleton';

const WEEKLY_DATA = [
    { name: 'Mon', sent: 45, replied: 4, meetings: 1 },
    { name: 'Tue', sent: 52, replied: 6, meetings: 2 },
    { name: 'Wed', sent: 38, replied: 3, meetings: 0 },
    { name: 'Thu', sent: 65, replied: 8, meetings: 3 },
    { name: 'Fri', sent: 48, replied: 5, meetings: 1 },
    { name: 'Sat', sent: 12, replied: 1, meetings: 0 },
    { name: 'Sun', sent: 10, replied: 2, meetings: 0 },
];

const SEQUENCE_DATA = [
    { name: 'Tier 1 Outbound', enrolled: 120, replied: 18, meetings: 5 },
    { name: 'LinkedIn Follow-up', enrolled: 85, replied: 22, meetings: 8 },
    { name: 'Cold Email Nurture', enrolled: 210, replied: 12, meetings: 2 },
];

const FUNNEL_STEPS = [
    { label: 'Exported', value: 1284, pct: 100, color: '#3f3f3f' },
    { label: 'Accepted', value: 580, pct: 45.2, color: '#3b82f6' },
    { label: 'Replied', value: 52, pct: 4.1, color: '#f59e0b' },
    { label: 'Meetings Booked', value: 15, pct: 1.2, color: '#10b981' },
];

const TIME_RANGES = [
    { id: '7d', label: '7 Days' },
    { id: '30d', label: '30 Days' },
    { id: '90d', label: '3 Months' },
];

function StatCard({ title, value, trend, icon: Icon }: { title: string; value: string | number; trend?: string; icon: any }) {
    return (
        <div className="rounded-2xl border border-white/[0.07] p-5 flex flex-col gap-4" style={{ background: '#111113' }}>
            <div className="flex justify-between items-start">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <Icon size={18} className="text-slate-400" />
                </div>
                {trend && (
                    <div className="flex items-center gap-1 text-[12px] font-semibold text-emerald-400 px-2 py-1 rounded-full" style={{ background: 'rgba(16,185,129,0.1)' }}>
                        <ArrowUpRight size={12} />
                        {trend}
                    </div>
                )}
            </div>
            <div>
                <p className="text-xs font-medium text-slate-500 mb-1">{title}</p>
                <p className="text-3xl font-extrabold text-white tabular-nums tracking-tight">{value}</p>
            </div>
        </div>
    );
}

export default function PerformanceDashboard() {
    const [timeRange, setTimeRange] = useState('7d');
    const { metrics, loading } = useOutreachMetrics();

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="page-content">
                {/* Header */}
                <div className="flex items-end justify-between animate-fade-in">
                    <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">Performance</h2>
                        <p className="text-sm text-slate-500 mt-1">Monitor outreach metrics and sequence conversions.</p>
                    </div>
                    {/* Time range picker */}
                    <div className="flex items-center gap-1 p-1 rounded-lg border border-white/[0.07]" style={{ background: '#111113' }}>
                        {TIME_RANGES.map(r => (
                            <button
                                key={r.id}
                                onClick={() => setTimeRange(r.id)}
                                className={[
                                    'px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all',
                                    timeRange === r.id
                                        ? 'text-white'
                                        : 'text-slate-500 hover:text-slate-300',
                                ].join(' ')}
                                style={timeRange === r.id ? { background: 'rgba(255,255,255,0.08)' } : {}}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up delay-1">
                    {loading ? (
                        Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                    ) : (
                        <>
                            <StatCard title="Total Leads Enrolled" value={metrics.totalLeads.toLocaleString()} icon={Users} />
                            <StatCard title="Messages Sent" value={metrics.messagesSent.toLocaleString()} icon={Mail} />
                            <StatCard title="Replies Received" value={metrics.repliesReceived.toLocaleString()} icon={MessageSquare} />
                            <StatCard title="Meetings Booked" value={metrics.meetingsBooked.toLocaleString()} trend="+12%" icon={TrendingUp} />
                        </>
                    )}
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3 animate-fade-in-up delay-2">
                    {/* Area chart */}
                    <div className="rounded-2xl border border-white/[0.07] p-5" style={{ background: '#111113' }}>
                        <h3 className="text-[14px] font-bold text-white mb-5">Outbound Activity</h3>
                        {/* CRITICAL: explicit height avoids ResponsiveContainer clipping */}
                        <div style={{ width: '100%', height: 280 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={WEEKLY_DATA} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="grad-sent" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="name" stroke="transparent" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis stroke="transparent" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, fontSize: 12 }}
                                        itemStyle={{ color: '#e2e8f0' }}
                                        cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                    />
                                    <Area type="monotone" dataKey="sent" stroke="#3b82f6" strokeWidth={2} fill="url(#grad-sent)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Funnel */}
                    <div className="rounded-2xl border border-white/[0.07] p-5 flex flex-col gap-5" style={{ background: '#111113' }}>
                        <h3 className="text-[14px] font-bold text-white">Global Funnel</h3>
                        {FUNNEL_STEPS.map((step, i) => (
                            <div key={i} className="flex flex-col gap-2">
                                <div className="flex justify-between text-[13px] font-medium text-white">
                                    <span className="text-slate-300">{step.label}</span>
                                    <span className="tabular-nums">
                                        {step.value}
                                        <span className="text-slate-600 font-normal ml-1">({step.pct}%)</span>
                                    </span>
                                </div>
                                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                    <div
                                        className="h-full rounded-full animate-bar"
                                        style={{ width: `${step.pct}%`, background: step.color }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Sequences table */}
                <div className="rounded-2xl border border-white/[0.07] overflow-hidden animate-fade-in-up delay-3" style={{ background: '#111113' }}>
                    <div className="px-5 py-4 border-b border-white/[0.06]">
                        <h3 className="text-[14px] font-bold text-white">Top Performing Sequences</h3>
                    </div>
                    {/* Scrollable table wrapper */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[500px]">
                            <thead>
                                <tr className="border-b border-white/[0.06]">
                                    {['Sequence', 'Enrolled', 'Replies', 'Meetings', 'Conv. Rate'].map(h => (
                                        <th key={h} className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {SEQUENCE_DATA.map((row, i) => (
                                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                                        <td className="px-5 py-3.5 text-[13px] font-medium text-slate-200">{row.name}</td>
                                        <td className="px-5 py-3.5 text-[13px] text-slate-400 tabular-nums">{row.enrolled}</td>
                                        <td className="px-5 py-3.5 text-[13px] text-slate-400 tabular-nums">{row.replied}</td>
                                        <td className="px-5 py-3.5 text-[13px] text-slate-400 tabular-nums">{row.meetings}</td>
                                        <td className="px-5 py-3.5 text-[13px] font-bold text-emerald-400 tabular-nums">
                                            {((row.meetings / row.enrolled) * 100).toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
