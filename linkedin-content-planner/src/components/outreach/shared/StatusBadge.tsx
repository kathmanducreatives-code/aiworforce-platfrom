import { CheckCircle2, Clock, XCircle, PlayCircle, Inbox } from 'lucide-react';


export type LeadStatus = 'not_started' | 'in_sequence' | 'replied' | 'meeting_booked' | 'closed' | 'dead';

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string; icon: any }> = {
    'not_started': { label: 'Not Started', color: '#888', bg: '#222', icon: Inbox },
    'in_sequence': { label: 'In Sequence', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', icon: PlayCircle },
    'replied': { label: 'Replied', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)', icon: Clock },
    'meeting_booked': { label: 'Meeting', color: '#00e5a0', bg: 'rgba(0, 229, 160, 0.1)', icon: CheckCircle2 },
    'closed': { label: 'Closed', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', icon: CheckCircle2 },
    'dead': { label: 'Dead', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', icon: XCircle },
};

export default function StatusBadge({ status }: { status: string }) {
    const config = STATUS_CONFIG[status as LeadStatus] || STATUS_CONFIG['not_started'];
    const Icon = config.icon;

    return (
        <span style={{
            display: "inline-flex", alignItems: "center", padding: "4px 10px", gap: "6px",
            background: config.bg, color: config.color, borderRadius: "6px",
            fontSize: "12px", fontWeight: 600, letterSpacing: "0.01em",
            border: `1px solid ${config.color}22`, whiteSpace: "nowrap"
        }}>
            <Icon size={12} strokeWidth={2.5} />
            {config.label}
        </span>
    );
}
