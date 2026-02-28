import { ChevronDown, Trash2 } from 'lucide-react';

interface BulkActionsProps {
    totalLeads: number;
    selectedCount: number;
    onAssignTier: (tier: string) => void;
    onChangeStatus: (status: string) => void;
    onDelete: () => void;
}

export default function BulkActions({ totalLeads, selectedCount, onAssignTier, onChangeStatus, onDelete }: BulkActionsProps) {
    const actionStyle = {
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.06)',
        color: '#e0e0e0',
        fontSize: '12px',
        fontWeight: 600,
        padding: '6px 10px',
        borderRadius: '6px',
        outline: 'none',
        cursor: 'pointer',
        appearance: 'none' as const,
        WebkitAppearance: 'none' as const,
        paddingRight: '28px'
    };

    const wrapperStyle = { position: 'relative' as const, display: 'inline-block' };

    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 20px', background: '#0a0a0b', borderTop: '1px solid rgba(255,255,255,0.04)',
            fontSize: '13px', color: '#888'
        }}>
            <div>
                Showing {totalLeads} leads · <span style={{ color: selectedCount > 0 ? '#00D4AA' : '#888', fontWeight: selectedCount > 0 ? 600 : 400 }}>{selectedCount} selected</span>
            </div>

            {selectedCount > 0 && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={wrapperStyle}>
                        <select onChange={e => { onAssignTier(e.target.value); e.target.value = ""; }} value="" style={actionStyle}>
                            <option value="" disabled>Assign Tier ▾</option>
                            <option value="tier_1">Set: Tier 1</option>
                            <option value="tier_2">Set: Tier 2</option>
                            <option value="tier_3">Set: Tier 3</option>
                            <option value="unassigned">Set: Unassigned</option>
                        </select>
                        <ChevronDown size={12} color="#666" style={{ position: 'absolute', right: '8px', top: '8px', pointerEvents: 'none' }} />
                    </div>

                    <div style={wrapperStyle}>
                        <select onChange={e => { onChangeStatus(e.target.value); e.target.value = ""; }} value="" style={actionStyle}>
                            <option value="" disabled>Change Status ▾</option>
                            <option value="not_started">Set: Not Started</option>
                            <option value="in_sequence">Set: In Sequence</option>
                            <option value="replied">Set: Replied</option>
                            <option value="meeting_booked">Set: Meeting Booked</option>
                            <option value="closed">Set: Closed</option>
                            <option value="dead">Set: Dead</option>
                        </select>
                        <ChevronDown size={12} color="#666" style={{ position: 'absolute', right: '8px', top: '8px', pointerEvents: 'none' }} />
                    </div>

                    <button
                        onClick={onDelete}
                        style={{
                            background: 'transparent', color: '#ef4444', border: 'none',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                            fontSize: '12px', fontWeight: 600, padding: '6px',
                            transition: 'color 0.2s'
                        }}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            )}
        </div>
    );
}
