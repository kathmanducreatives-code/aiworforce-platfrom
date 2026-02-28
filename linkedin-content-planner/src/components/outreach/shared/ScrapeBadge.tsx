import { Check, Clock, X } from 'lucide-react';

interface ScrapeBadgeProps {
    status: 'success' | 'failed_scrape' | null | string;
}

export default function ScrapeBadge({ status }: ScrapeBadgeProps) {
    if (status === 'success') {
        return (
            <span style={{ color: '#00e5a0', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 500 }} title="Scraped successfully">
                <Check size={14} strokeWidth={2.5} />
            </span>
        );
    }

    if (status === 'failed_scrape') {
        return (
            <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 500 }} title="Scrape failed">
                <X size={14} strokeWidth={2.5} />
            </span>
        );
    }

    // NULL or unknown
    return (
        <span style={{ color: '#f5a623', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 500 }} title="Queued for scraping">
            <Clock size={14} className="animate-pulse" />
        </span>
    );
}
