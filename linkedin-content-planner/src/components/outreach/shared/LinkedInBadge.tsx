import { Link, Clock, Minus } from 'lucide-react';

interface LinkedInBadgeProps {
    status: 'accepted' | 'pending' | 'none' | string | null;
}

export default function LinkedInBadge({ status }: LinkedInBadgeProps) {
    if (status === 'accepted') {
        return (
            <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500 }} title="Connection Accepted">
                <Link size={14} strokeWidth={2.5} /> Acc.
            </span>
        );
    }

    if (status === 'pending') {
        return (
            <span style={{ color: '#f5a623', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500 }} title="Connection Pending">
                <Clock size={14} strokeWidth={2.5} /> Pend.
            </span>
        );
    }

    return (
        <span style={{ color: '#555', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500 }} title="No Connection Sent">
            <Minus size={14} strokeWidth={2.5} /> None
        </span>
    );
}
