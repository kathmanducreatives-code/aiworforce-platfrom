import { Search, SlidersHorizontal, ChevronDown } from 'lucide-react';

interface FilterBarProps {
    searchTerm: string;
    setSearchTerm: (val: string) => void;
    tierFilter: string;
    setTierFilter: (val: string) => void;
    statusFilter: string;
    setStatusFilter: (val: string) => void;
    scrapeFilter: string;
    setScrapeFilter: (val: string) => void;
}

export default function FilterBar({
    searchTerm, setSearchTerm,
    tierFilter, setTierFilter,
    statusFilter, setStatusFilter,
    scrapeFilter, setScrapeFilter
}: FilterBarProps) {

    const filterStyle = {
        background: '#141416',
        border: '1px solid rgba(255,255,255,0.06)',
        color: '#e0e0e0',
        fontSize: '13px',
        padding: '8px 12px',
        borderRadius: '6px',
        outline: 'none',
        cursor: 'pointer',
        appearance: 'none' as const,
        WebkitAppearance: 'none' as const,
        paddingRight: '32px'
    };

    const wrapperStyle = { position: 'relative' as const, display: 'inline-block' };

    return (
        <div style={{
            display: 'flex', gap: '16px', alignItems: 'center',
            padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: '#0a0a0b'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#666' }}>
                <SlidersHorizontal size={16} /> <span style={{ fontSize: '13px', fontWeight: 600 }}>Filters:</span>
            </div>

            <div style={wrapperStyle}>
                <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} style={filterStyle}>
                    <option value="all">All Tiers</option>
                    <option value="tier_1">Tier 1</option>
                    <option value="tier_2">Tier 2</option>
                    <option value="tier_3">Tier 3</option>
                    <option value="unassigned">Unassigned</option>
                </select>
                <ChevronDown size={14} color="#666" style={{ position: 'absolute', right: '10px', top: '10px', pointerEvents: 'none' }} />
            </div>

            <div style={wrapperStyle}>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={filterStyle}>
                    <option value="all">All Status</option>
                    <option value="not_started">Not Started</option>
                    <option value="in_sequence">In Sequence</option>
                    <option value="replied">Replied</option>
                    <option value="meeting_booked">Meeting Booked</option>
                    <option value="closed">Closed / Dead</option>
                </select>
                <ChevronDown size={14} color="#666" style={{ position: 'absolute', right: '10px', top: '10px', pointerEvents: 'none' }} />
            </div>

            <div style={wrapperStyle}>
                <select value={scrapeFilter} onChange={e => setScrapeFilter(e.target.value)} style={filterStyle}>
                    <option value="all">Scrape Status</option>
                    <option value="queued">Queued (Null)</option>
                    <option value="success">Scraped</option>
                    <option value="failed_scrape">Failed</option>
                </select>
                <ChevronDown size={14} color="#666" style={{ position: 'absolute', right: '10px', top: '10px', pointerEvents: 'none' }} />
            </div>

            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: '#141416', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '6px', padding: '0 12px', flex: 1, maxWidth: '300px', marginLeft: 'auto'
            }}>
                <Search size={14} color="#666" />
                <input
                    type="text"
                    placeholder="Search leads..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{
                        background: 'transparent', border: 'none', color: '#fff',
                        fontSize: '13px', outline: 'none', width: '100%', padding: '8px 0'
                    }}
                />
            </div>
        </div>
    );
}
