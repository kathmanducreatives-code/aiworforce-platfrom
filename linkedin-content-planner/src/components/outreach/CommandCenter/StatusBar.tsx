import { Inbox, FileSignature, CheckCircle, PlayCircle, Clock, Calendar } from 'lucide-react';
import type { OutreachLead } from '../../../types/outreach';

interface StatusBarProps {
    leads: OutreachLead[];
}

export default function StatusBar({ leads }: StatusBarProps) {
    const counts = {
        queued: leads.filter(l => l.status === 'not_started' && !l.scrape_status).length,
        ready: leads.filter(l => l.status === 'not_started' && l.scrape_status === 'success').length,
        inSequence: leads.filter(l => l.status === 'in_sequence').length,
        replied: leads.filter(l => l.status === 'replied').length,
        meetings: leads.filter(l => l.status === 'meeting_booked').length,
        dead: leads.filter(l => l.status === 'dead' || l.scrape_status === 'failed_scrape').length,
    };

    const pills = [
        { label: 'Queued to Scrape', count: counts.queued, icon: Inbox, color: '#888', bg: 'rgba(136,136,136,0.1)' },
        { label: 'Leads Ready', count: counts.ready, icon: CheckCircle, color: '#00D4AA', bg: 'rgba(0, 212, 170, 0.1)' },
        { label: 'In Campaign', count: counts.inSequence, icon: PlayCircle, color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
        { label: 'Replied', count: counts.replied, icon: Clock, color: '#F5A623', bg: 'rgba(245, 166, 35, 0.1)' },
        { label: 'Meetings Booked', count: counts.meetings, icon: Calendar, color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' },
        { label: 'Failed / Dead', count: counts.dead, icon: FileSignature, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' },
    ];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', marginBottom: '32px' }}>
            {pills.map((pill, i) => {
                const Icon = pill.icon;
                return (
                    <div key={i} style={{
                        background: '#141416', border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column',
                        cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden'
                    }}
                        onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
                        onMouseOut={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <div style={{ background: pill.bg, padding: '8px', borderRadius: '8px', color: pill.color }}>
                                <Icon size={18} strokeWidth={2.5} />
                            </div>
                            <span style={{ fontSize: '24px', fontWeight: 600, color: '#ffffff', fontFamily: '"SF Mono", "SFMono-Regular", ui-monospace, monospace' }}>
                                {pill.count}
                            </span>
                        </div>
                        <span style={{ color: '#a1a1aa', fontSize: '13px', fontWeight: 500 }}>{pill.label}</span>
                    </div>
                );
            })}
        </div>
    );
}
