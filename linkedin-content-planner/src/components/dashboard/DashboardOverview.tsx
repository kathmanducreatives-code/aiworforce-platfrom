import React from 'react';
import { Users, Flame, MessageSquare, Target, Zap, CheckCircle, Crosshair, Mail, Calendar, ArrowRight } from 'lucide-react';
import { useOutreachMetrics } from '../../hooks/useOutreachMetrics';
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';

const DashboardOverview: React.FC = () => {
    const { metrics, loading } = useOutreachMetrics();

    const statCards = [
        { label: 'Total Leads', value: metrics.totalLeads, icon: Users, accent: 'from-blue-500/20 to-blue-600/5', iconBg: 'bg-blue-500/15', iconColor: 'text-blue-400', border: 'hover:border-blue-500/25', sub: 'Pipeline + intercepted' },
        { label: 'Tier 1 Hot', value: metrics.hotLeads, icon: Flame, accent: 'from-red-500/20 to-red-600/5', iconBg: 'bg-red-500/15', iconColor: 'text-red-400', border: 'hover:border-red-500/25', sub: 'Highest priority' },
        { label: 'Intercepted', value: metrics.interceptedLeads, icon: Target, accent: 'from-violet-500/20 to-violet-600/5', iconBg: 'bg-violet-500/15', iconColor: 'text-violet-400', border: 'hover:border-violet-500/25', sub: 'Competitor posts' },
        { label: 'DMs Ready', value: metrics.dmsGenerated, icon: MessageSquare, accent: 'from-emerald-500/20 to-emerald-600/5', iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-400', border: 'hover:border-emerald-500/25', sub: 'Connection notes' },
        { label: 'In Sequence', value: metrics.inSequence, icon: Zap, accent: 'from-amber-500/20 to-amber-600/5', iconBg: 'bg-amber-500/15', iconColor: 'text-amber-400', border: 'hover:border-amber-500/25', sub: 'Active outreach' },
        { label: 'Accepted', value: metrics.acceptedConnections, icon: CheckCircle, accent: 'from-cyan-500/20 to-cyan-600/5', iconBg: 'bg-cyan-500/15', iconColor: 'text-cyan-400', border: 'hover:border-cyan-500/25', sub: 'Connections' },
    ];

    const quickActions = [
        { label: 'Intercept Posts', icon: Crosshair, desc: 'Find competitor posts' },
        { label: 'View Leads', icon: Users, desc: 'Manage pipeline' },
        { label: 'Outreach', icon: Mail, desc: 'Send DMs & emails' },
        { label: 'Content', icon: Calendar, desc: 'Plan LinkedIn posts' },
    ];

    const pipelineRows = [
        { label: 'Tier 1 (Hot)', value: metrics.hotLeads, color: 'bg-gradient-to-r from-red-500 to-rose-500', dot: 'bg-red-400' },
        { label: 'In Sequence', value: metrics.inSequence, color: 'bg-gradient-to-r from-amber-500 to-orange-500', dot: 'bg-amber-400' },
        { label: 'Intercepted', value: metrics.interceptedLeads, color: 'bg-gradient-to-r from-violet-500 to-purple-500', dot: 'bg-violet-400' },
        { label: 'Accepted', value: metrics.acceptedConnections, color: 'bg-gradient-to-r from-emerald-500 to-teal-500', dot: 'bg-emerald-400' },
    ];

    return (
        <div className="flex flex-col gap-6 p-6 lg:p-8 animate-fade-in">
            {/* Header */}
            <div className="flex items-start justify-between shrink-0">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
                        {metrics.totalLeads > 0 && <Badge variant="blue">{metrics.totalLeads} leads</Badge>}
                    </div>
                    <p className="text-sm text-slate-400 mt-1">Live data from your outreach pipeline</p>
                </div>
            </div>

            {/* ── Stat cards — 3 columns on xl, 2 on smaller ── */}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                {statCards.map((card, i) => (
                    <div
                        key={i}
                        className={[
                            'relative overflow-hidden rounded-2xl border border-white/[0.08] p-5',
                            'transition-all duration-300 hover:-translate-y-0.5 cursor-default group',
                            card.border,
                            `animate-fade-in-up delay-${i + 1}`,
                        ].join(' ')}
                    >
                        {/* Gradient hover glow */}
                        <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                        <div className="absolute inset-0 bg-white/[0.02]" />

                        <div className="relative z-10">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${card.iconBg} mb-3 transition-transform duration-300 group-hover:scale-110`}>
                                <card.icon size={18} className={card.iconColor} />
                            </div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{card.label}</p>
                            {loading
                                ? <div className="animate-pulse bg-white/10 rounded-lg h-8 w-16" />
                                : <p className="text-3xl font-extrabold text-white tracking-tighter tabular-nums">{card.value.toLocaleString()}</p>
                            }
                            <p className="text-[11px] text-slate-600 mt-1">{card.sub}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Pipeline + Activity row ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
                {/* Pipeline breakdown */}
                <Card>
                    <CardHeader
                        title="Pipeline Breakdown"
                        subtitle={loading ? undefined : `${metrics.totalLeads} leads total`}
                    />
                    <div className="flex flex-col gap-5">
                        {pipelineRows.map((row, i) => {
                            const pct = metrics.totalLeads > 0 ? (row.value / metrics.totalLeads) * 100 : 0;
                            return (
                                <div key={i}>
                                    <div className="flex justify-between items-center mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-2 h-2 rounded-full ${row.dot}`} />
                                            <span className="text-sm text-slate-300">{row.label}</span>
                                        </div>
                                        <div className="flex items-center gap-2 tabular-nums text-sm">
                                            {!loading && <span className="text-slate-600 text-xs">{Math.round(pct)}%</span>}
                                            <span className="font-bold text-white w-6 text-right">{loading ? '—' : row.value}</span>
                                        </div>
                                    </div>
                                    <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                                        {!loading && (
                                            <div
                                                className={`h-full rounded-full ${row.color} animate-bar`}
                                                style={{ width: `${Math.max(pct, 1)}%` }}
                                            />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>

                {/* Recent Activity */}
                <Card>
                    <CardHeader title="Recent Activity" />
                    {loading ? (
                        <div className="flex flex-col gap-4">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="animate-pulse h-3.5 bg-white/5 rounded w-full" />
                            ))}
                        </div>
                    ) : metrics.recentActivity.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                            <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-3">
                                <Zap size={16} className="text-slate-600" />
                            </div>
                            <p className="text-slate-500 text-sm font-medium">No activity yet</p>
                            <p className="text-slate-600 text-xs mt-1">Activity appears as you use outreach tools</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {metrics.recentActivity.map((a, i) => (
                                <div key={i} className="flex items-start gap-3 group/item">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-[7px] shrink-0 group-hover/item:ring-4 group-hover/item:ring-blue-500/10 transition-all" />
                                    <p className="text-[13px] text-slate-300 flex-1 min-w-0 truncate">
                                        <span className="font-semibold text-white">{a.type}</span> — {a.name}
                                    </p>
                                    <span className="text-[11px] text-slate-600 shrink-0 tabular-nums">{a.time}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* ── Quick Actions ── */}
            <div>
                <h3 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3">Quick Actions</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {quickActions.map((action, i) => (
                        <button
                            key={i}
                            className={[
                                'group flex items-center gap-3 p-4 rounded-xl text-left',
                                'bg-white/[0.02] border border-white/[0.06]',
                                'hover:bg-white/[0.05] hover:border-white/[0.12]',
                                'transition-all duration-200 cursor-pointer',
                            ].join(' ')}
                        >
                            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:bg-blue-500/15 transition-colors">
                                <action.icon size={16} className="text-blue-400" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-white flex items-center gap-1">
                                    {action.label}
                                    <ArrowRight size={11} className="text-slate-600 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">{action.desc}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DashboardOverview;
