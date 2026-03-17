import React from 'react';
import { Users, Flame, MessageSquare, Target, Zap, CheckCircle, Crosshair, Mail, Calendar, ArrowRight } from 'lucide-react';
import { useOutreachMetrics } from '../../hooks/useOutreachMetrics';
import { SkeletonCard } from '../ui/Skeleton';

const ACCENTS = [
    { accent: 'rgba(59,130,246,0.18)', icon: 'text-blue-400', glow: '#3b82f6', hover: 'rgba(59,130,246,0.08)' },
    { accent: 'rgba(239,68,68,0.18)', icon: 'text-red-400', glow: '#ef4444', hover: 'rgba(239,68,68,0.08)' },
    { accent: 'rgba(139,92,246,0.18)', icon: 'text-violet-400', glow: '#8b5cf6', hover: 'rgba(139,92,246,0.08)' },
    { accent: 'rgba(16,185,129,0.18)', icon: 'text-emerald-400', glow: '#10b981', hover: 'rgba(16,185,129,0.08)' },
    { accent: 'rgba(245,158,11,0.18)', icon: 'text-amber-400', glow: '#f59e0b', hover: 'rgba(245,158,11,0.08)' },
    { accent: 'rgba(6,182,212,0.18)', icon: 'text-cyan-400', glow: '#06b6d4', hover: 'rgba(6,182,212,0.08)' },
];

const DashboardOverview: React.FC = () => {
    const { metrics, loading } = useOutreachMetrics();

    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    const statCards = [
        { label: 'Total Leads', value: metrics.totalLeads, icon: Users, sub: 'In pipeline' },
        { label: 'Tier 1 Hot', value: metrics.hotLeads, icon: Flame, sub: 'Highest priority' },
        { label: 'Intercepted', value: metrics.interceptedLeads, icon: Target, sub: 'Competitor posts' },
        { label: 'DMs Ready', value: metrics.dmsGenerated, icon: MessageSquare, sub: 'Connection notes' },
        { label: 'In Sequence', value: metrics.inSequence, icon: Zap, sub: 'Active outreach' },
        { label: 'Accepted', value: metrics.acceptedConnections, icon: CheckCircle, sub: 'Connections' },
    ];

    const quickActions = [
        { label: 'Intercept Posts', icon: Crosshair, desc: 'Find competitor posts' },
        { label: 'View Leads', icon: Users, desc: 'Manage pipeline' },
        { label: 'Outreach', icon: Mail, desc: 'Send DMs & emails' },
        { label: 'Content', icon: Calendar, desc: 'Plan LinkedIn posts' },
    ];

    const pipelineRows = [
        { label: 'Tier 1 (Hot)', value: metrics.hotLeads, color: '#ef4444', bg: 'from-red-500 to-rose-500' },
        { label: 'In Sequence', value: metrics.inSequence, color: '#f59e0b', bg: 'from-amber-500 to-orange-500' },
        { label: 'Intercepted', value: metrics.interceptedLeads, color: '#8b5cf6', bg: 'from-violet-500 to-purple-500' },
        { label: 'Accepted', value: metrics.acceptedConnections, color: '#10b981', bg: 'from-emerald-500 to-teal-500' },
    ];

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="page-content">
                {/* Hero greeting */}
                <div
                    className="rounded-2xl border border-white/[0.07] p-6 animate-fade-in relative overflow-hidden"
                    style={{ background: 'linear-gradient(135deg, #111113 60%, #12101e)' }}
                >
                    {/* Decorative glow */}
                    <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full opacity-20 blur-3xl" style={{ background: '#3b82f6' }} />
                    <div>
                        <p className="text-sm text-slate-500 font-medium">
                            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </p>
                        <h2 className="text-2xl font-bold text-white mt-1">{greeting} 👋</h2>
                        <p className="text-sm text-slate-400 mt-1">
                            You have <span className="text-white font-semibold">{metrics.hotLeads}</span> hot leads and{' '}
                            <span className="text-white font-semibold">{metrics.inSequence}</span> contacts in sequence today.
                        </p>
                    </div>
                </div>

                {/* Stat cards — stagger entrance */}
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                    {loading
                        ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
                        : statCards.map((card, i) => {
                            const a = ACCENTS[i];
                            const staggerClass = `stagger-child stagger-${i + 1}`;
                            return (
                                <div
                                    key={i}
                                    className={`relative overflow-hidden rounded-2xl p-5 group cursor-default transition-all duration-300 hover:-translate-y-0.5 glass-card ${staggerClass}`}
                                    onMouseEnter={e => (e.currentTarget.style.background = a.hover)}
                                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                                >
                                    {/* Subtle radial glow behind icon on hover */}
                                    <div className="absolute -top-6 -left-6 w-20 h-20 rounded-full opacity-0 group-hover:opacity-30 transition-opacity duration-500 blur-2xl" style={{ background: a.glow }} />
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 relative z-10" style={{ background: a.accent }}>
                                        <card.icon size={18} className={a.icon} />
                                    </div>
                                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1 relative z-10">{card.label}</p>
                                    <p className="text-3xl font-extrabold text-white tracking-tighter tabular-nums animate-count-up relative z-10">
                                        {card.value.toLocaleString()}
                                    </p>
                                    <p className="text-[11px] text-slate-600 mt-1 relative z-10">{card.sub}</p>
                                </div>
                            );
                        })
                    }
                </div>

                {/* Pipeline + Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
                    {/* Pipeline with neon glow bars */}
                    <div className="glass-card rounded-2xl p-5">
                        <div className="mb-5">
                            <h3 className="text-[14px] font-bold text-white">Pipeline Breakdown</h3>
                            {!loading && <p className="text-xs text-slate-500 mt-0.5">{metrics.totalLeads} leads total</p>}
                        </div>
                        <div className="flex flex-col gap-5">
                            {pipelineRows.map((row, i) => {
                                const pct = metrics.totalLeads > 0 ? (row.value / metrics.totalLeads) * 100 : 0;
                                return (
                                    <div key={i}>
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ background: row.color }} />
                                                <span className="text-sm text-slate-300">{row.label}</span>
                                            </div>
                                            <div className="flex items-center gap-2 tabular-nums text-sm">
                                                {!loading && <span className="text-slate-600 text-xs">{Math.round(pct)}%</span>}
                                                <span className="font-bold text-white w-6 text-right">{loading ? '—' : row.value}</span>
                                            </div>
                                        </div>
                                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                            {!loading && (
                                                <div
                                                    className={`h-full rounded-full bg-gradient-to-r ${row.bg} animate-bar`}
                                                    style={{
                                                        width: `${Math.max(pct, 2)}%`,
                                                        boxShadow: `0 0 14px ${row.color}55`,
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="glass-card rounded-2xl p-5">
                        <h3 className="text-[14px] font-bold text-white mb-5">Recent Activity</h3>
                        {loading ? (
                            <div className="flex flex-col gap-3">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="skeleton h-3 w-full" />
                                ))}
                            </div>
                        ) : metrics.recentActivity.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                    <Zap size={16} className="text-slate-600" />
                                </div>
                                <p className="text-slate-500 text-sm font-medium">No activity yet</p>
                                <p className="text-slate-700 text-xs">Appears as you use the outreach tools</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                {metrics.recentActivity.map((a, i) => (
                                    <div key={i} className="flex items-start gap-3 group">
                                        <div className="w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 bg-blue-500 group-hover:ring-4 group-hover:ring-blue-500/10 transition-all" />
                                        <p className="text-[13px] text-slate-300 flex-1 min-w-0 truncate">
                                            <span className="font-semibold text-white">{a.type}</span> — {a.name}
                                        </p>
                                        <span className="text-[11px] text-slate-600 shrink-0 tabular-nums">{a.time}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>


                {/* Quick Actions */}
                <div>
                    <h3 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3">Quick Actions</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {quickActions.map((action, i) => (
                            <button
                                key={i}
                                className="group flex items-center gap-3 p-4 rounded-xl text-left border border-white/[0.06] transition-all duration-200 hover:border-white/[0.12]"
                                style={{ background: 'rgba(255,255,255,0.02)' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                            >
                                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors group-hover:bg-blue-500/15" style={{ background: 'rgba(59,130,246,0.1)' }}>
                                    <action.icon size={15} className="text-blue-400" />
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
        </div>
    );
};

export default DashboardOverview;
