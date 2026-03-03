import { Edit3, Download, MessageCircle, ArrowRight } from 'lucide-react';
import type { OutreachLead } from '../../../types/outreach';

interface TodaysActionsProps {
    leads: OutreachLead[];
}

export default function TodaysActions({ leads }: TodaysActionsProps) {
    // 1. DMs to Review: Needs personalization review
    const dmsToReview = leads.filter(l => l.scrape_status === 'success' && l.status === 'not_started' && l.generated_connection_note && (!l.closely_connection_status || l.closely_connection_status === 'none'));

    // 2. Ready to Export: Sequence completed and ready for Closely
    const readyToExport = leads.filter(l => l.scrape_status === 'success' && l.status === 'not_started' && l.closely_connection_status === 'pending');

    // 3. Recent Replies: Status is 'replied'
    const recentReplies = leads.filter(l => l.status === 'replied');

    const ActionCard = ({ title, count, description, icon: Icon, color, actionText }: any) => (
        <div style={{
            background: '#141416', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px',
            padding: '24px', display: 'flex', flexDirection: 'column', height: '100%',
            transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'pointer'
        }}
            onMouseOver={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
            }}
            onMouseOut={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div style={{ background: `rgba(${color}, 0.1)`, color: `rgb(${color})`, padding: '10px', borderRadius: '10px' }}>
                    <Icon size={20} strokeWidth={2.5} />
                </div>
                <span style={{ fontSize: '28px', fontWeight: 600, color: '#ffffff', fontFamily: '"SF Mono", "SFMono-Regular", ui-monospace, monospace' }}>
                    {count}
                </span>
            </div>
            <h3 style={{ fontSize: '16px', color: '#ffffff', fontWeight: 600, marginBottom: '8px' }}>{title}</h3>
            <p style={{ color: '#a1a1aa', fontSize: '13px', lineHeight: '1.5', flex: 1, marginBottom: '20px' }}>
                {description}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: `rgb(${color})`, fontSize: '13px', fontWeight: 600, marginTop: 'auto' }}>
                {actionText} <ArrowRight size={14} />
            </div>
        </div>
    );

    return (
        <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', color: '#ffffff', fontWeight: 600, letterSpacing: '-0.01em', marginBottom: '16px' }}>
                Action Items
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                <ActionCard
                    title="DMs to Review"
                    count={dmsToReview.length}
                    description={`${dmsToReview.length} leads are waiting in the Message Studio for final AI connection note approval.`}
                    icon={Edit3}
                    color="5, 150, 105" // #059669 (Emerald)
                    actionText="Go to Message Studio"
                />
                <ActionCard
                    title="Ready to Export"
                    count={readyToExport.length}
                    description={`${readyToExport.length} leads are fully verified and ready to be exported as a CSV for Closely campaign import.`}
                    icon={Download}
                    color="59, 130, 246" // #3b82f6
                    actionText="Export CSV"
                />
                <ActionCard
                    title="Recent Replies"
                    count={recentReplies.length}
                    description={`You have ${recentReplies.length} leads sitting in the replied status that require your manual follow-up or booking.`}
                    icon={MessageCircle}
                    color="245, 166, 35" // #F5A623
                    actionText="View Pipeline"
                />
            </div>
        </div>
    );
}
