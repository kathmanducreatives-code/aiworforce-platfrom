import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Users, Mail, MessageSquare, ArrowUpRight } from 'lucide-react';

const DUMMY_TIME_DATA = [
    { name: 'Mon', sent: 45, replied: 4, meetings: 1 },
    { name: 'Tue', sent: 52, replied: 6, meetings: 2 },
    { name: 'Wed', sent: 38, replied: 3, meetings: 0 },
    { name: 'Thu', sent: 65, replied: 8, meetings: 3 },
    { name: 'Fri', sent: 48, replied: 5, meetings: 1 },
    { name: 'Sat', sent: 12, replied: 1, meetings: 0 },
    { name: 'Sun', sent: 10, replied: 2, meetings: 0 },
];

const DUMMY_SEQUENCE_DATA = [
    { name: 'Tier 1 Outbound', enrolled: 120, replied: 18, meetings: 5 },
    { name: 'LinkedIn Follow-up', enrolled: 85, replied: 22, meetings: 8 },
    { name: 'Cold Email Nurture', enrolled: 210, replied: 12, meetings: 2 },
];
import { useOutreachMetrics } from '../../../hooks/useOutreachMetrics';

export default function PerformanceDashboard() {
    const [timeRange, setTimeRange] = useState('7d');
    const { metrics, loading } = useOutreachMetrics();

    const StatCard = ({ title, value, trend, icon: Icon }: any) => (
        <div style={{ background: '#141416', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '12px', color: '#888' }}>
                    <Icon size={20} />
                </div>
                {trend && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#00D4AA', fontSize: '13px', fontWeight: 600, background: 'rgba(0, 212, 170, 0.1)', padding: '4px 8px', borderRadius: '20px' }}>
                        <ArrowUpRight size={14} /> {trend}
                    </div>
                )}
            </div>
            <div>
                <h3 style={{ color: '#888', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>{title}</h3>
                <div style={{ color: '#fff', fontSize: '28px', fontWeight: 700, fontFamily: '"SF Mono", "SFMono-Regular", ui-monospace, monospace' }}>{value}</div>
            </div>
        </div>
    );

    return (
        <div style={{ padding: "24px 24px 60px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "32px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", color: "#f0f0f0", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "4px" }}>
                        Performance
                    </h1>
                    <p style={{ color: "#888", fontSize: "14px" }}>
                        Monitor your outreach metrics and sequence conversions.
                    </p>
                </div>

                <div style={{ display: 'flex', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '4px' }}>
                    {[{ id: '7d', label: '7 Days' }, { id: '30d', label: '30 Days' }, { id: '90d', label: '3 Months' }].map(range => (
                        <button
                            key={range.id}
                            onClick={() => setTimeRange(range.id)}
                            style={{
                                background: timeRange === range.id ? '#333' : 'transparent',
                                color: timeRange === range.id ? '#fff' : '#888',
                                border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stat Cards Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
                <StatCard title="Total Leads Enrolled" value={loading ? "..." : metrics.totalLeads.toLocaleString()} trend="" icon={Users} />
                <StatCard title="Messages Sent" value={loading ? "..." : metrics.messagesSent.toLocaleString()} trend="" icon={Mail} />
                <StatCard title="Replies Received" value={loading ? "..." : metrics.repliesReceived.toLocaleString()} trend="" icon={MessageSquare} />
                <StatCard title="Meetings Booked" value={loading ? "..." : metrics.meetingsBooked.toLocaleString()} trend="" icon={TrendingUp} />
            </div>

            {/* Charts Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>

                {/* Outbound Activity Chart */}
                <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px', padding: '24px' }}>
                    <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, marginBottom: '24px' }}>Outbound Activity</h3>
                    <div style={{ height: '300px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={DUMMY_TIME_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                                <XAxis dataKey="name" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px', color: '#fff' }}
                                    itemStyle={{ color: '#e0e0e0', fontSize: '13px' }}
                                    cursor={{ stroke: '#444', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="sent" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorSent)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Conversion Funnel */}
                <div style={{ background: '#141416', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '24px' }}>
                    <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, marginBottom: '24px' }}>Global Funnel</h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {[
                            { label: 'Exported', value: 1284, pct: 100, color: '#444' },
                            { label: 'Accepted', value: 580, pct: 45, color: '#3b82f6' },
                            { label: 'Replied', value: 52, pct: 4, color: '#F5A623' },
                            { label: 'Meetings Booked', value: 15, pct: 1.1, color: '#00D4AA' }
                        ].map((step, i) => (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontSize: '13px', fontWeight: 500 }}>
                                    <span>{step.label}</span>
                                    <span>{step.value} <span style={{ color: '#888', fontWeight: 400 }}>({step.pct}%)</span></span>
                                </div>
                                <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${step.pct}%`, background: step.color, borderRadius: '4px' }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Sequences Table */}
            <div style={{ marginTop: '20px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px', overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid #2a2a2a' }}>
                    <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: 600 }}>Top Performing Sequences</h3>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr>
                            <th style={{ padding: '16px 24px', color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Sequence</th>
                            <th style={{ padding: '16px 24px', color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Enrolled</th>
                            <th style={{ padding: '16px 24px', color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Replies</th>
                            <th style={{ padding: '16px 24px', color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Meetings</th>
                            <th style={{ padding: '16px 24px', color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Conv. Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {DUMMY_SEQUENCE_DATA.map((row, i) => (
                            <tr key={i} style={{ borderTop: '1px solid #2a2a2a' }}>
                                <td style={{ padding: '16px 24px', color: '#e0e0e0', fontSize: '14px', fontWeight: 500 }}>{row.name}</td>
                                <td style={{ padding: '16px 24px', color: '#aaa', fontSize: '14px' }}>{row.enrolled}</td>
                                <td style={{ padding: '16px 24px', color: '#aaa', fontSize: '14px' }}>{row.replied}</td>
                                <td style={{ padding: '16px 24px', color: '#aaa', fontSize: '14px' }}>{row.meetings}</td>
                                <td style={{ padding: '16px 24px', color: '#00e5a0', fontSize: '14px', fontWeight: 600 }}>{((row.meetings / row.enrolled) * 100).toFixed(1)}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

        </div>
    );
}
