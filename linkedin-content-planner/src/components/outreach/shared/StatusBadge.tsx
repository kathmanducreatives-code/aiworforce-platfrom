type LeadStatus = 'not_started' | 'in_sequence' | 'replied' | 'meeting_booked' | 'closed' | 'dead';

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string }> = {
    'not_started': { label: 'Not Started', color: '#888', bg: '#222' },
    'in_sequence': { label: 'In Sequence', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
    'replied': { label: 'Replied', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
    'meeting_booked': { label: 'Meeting', color: '#00e5a0', bg: 'rgba(0, 229, 160, 0.15)' },
    'closed': { label: 'Closed', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
    'dead': { label: 'Dead', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
};

export default function StatusBadge({ status }: { status: string }) {
    const config = STATUS_CONFIG[status as LeadStatus] || STATUS_CONFIG['not_started'];
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", padding: "4px 8px",
            background: config.bg, color: config.color, borderRadius: "6px",
            fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em",
            border: `1px solid ${config.color}33`, whiteSpace: "nowrap"
        }}>
            {config.label}
        </span>
    );
}
