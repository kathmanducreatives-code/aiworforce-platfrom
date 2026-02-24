import { useState } from 'react';
import { Plus, Clock, Search, MoreVertical, Play, Pause, Users } from 'lucide-react';

import { useOutreachSequences } from '../../../hooks/useOutreachSequences';
interface SequenceManagerProps {
    onSelectSequence: (id: string | null) => void;
}

export default function SequenceManager({ onSelectSequence }: SequenceManagerProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const { sequences, loading, updateSequenceStatus } = useOutreachSequences();

    const filteredSequences = sequences.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.description?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );

    return (
        <div style={{ padding: "24px 24px 60px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", color: "#f0f0f0", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "4px" }}>
                        Sequences
                    </h1>
                    <p style={{ color: "#888", fontSize: "14px" }}>
                        Build and manage multi-channel automated outreach campaigns.
                    </p>
                </div>

                <button
                    onClick={() => onSelectSequence('new')}
                    style={{
                        background: "#00e5a0", color: "#000", border: "none",
                        padding: "10px 16px", borderRadius: "8px", fontSize: "13px",
                        fontWeight: 600, display: "flex", alignItems: "center", gap: "8px",
                        cursor: "pointer", transition: "all 0.2s"
                    }}
                >
                    <Plus size={16} /> Create Sequence
                </button>
            </div>

            {/* Search Bar */}
            <div style={{ marginBottom: "24px", display: "flex", gap: "16px", alignItems: "center" }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: "8px", background: "#141414",
                    border: "1px solid #2a2a2a", borderRadius: "8px", padding: "10px 16px", flex: 1, maxWidth: "400px"
                }}>
                    <Search size={16} color="#666" />
                    <input
                        type="text"
                        placeholder="Search sequences..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ background: "transparent", border: "none", color: "#e0e0e0", fontSize: "13px", outline: "none", width: "100%" }}
                    />
                </div>
            </div>

            {/* Sequences Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "20px" }}>
                {loading ? (
                    <div style={{ padding: "40px", textAlign: "center", color: "#666", gridColumn: "1 / -1" }}>
                        Loading sequences...
                    </div>
                ) : filteredSequences.length === 0 ? (
                    <div style={{ padding: "40px", textAlign: "center", color: "#666", gridColumn: "1 / -1", backgroundColor: "#141414", borderRadius: "16px", border: "1px dashed #2a2a2a" }}>
                        No sequences found. Create one to get started.
                    </div>
                ) : (
                    filteredSequences.map(sequence => (
                        <div key={sequence.id}
                            onClick={() => onSelectSequence(sequence.id)}
                            style={{
                                background: "#141414", border: "1px solid #2a2a2a", borderRadius: "16px",
                                padding: "20px", display: "flex", flexDirection: "column", gap: "16px",
                                transition: "all 0.2s", cursor: "pointer"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.transform = 'translateY(0)'; }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{
                                        width: '40px', height: '40px', borderRadius: '10px',
                                        backgroundColor: sequence.status === 'active' ? 'rgba(0, 229, 160, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: sequence.status === 'active' ? '#00e5a0' : '#888'
                                    }}>
                                        <Clock size={20} />
                                    </div>
                                    <div>
                                        <h3 style={{ color: "#fff", fontSize: "15px", fontWeight: 600, marginBottom: "4px" }}>{sequence.name}</h3>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{
                                                display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                                                backgroundColor: sequence.status === 'active' ? '#00e5a0' : '#888'
                                            }} />
                                            <span style={{ color: "#888", fontSize: "12px", textTransform: 'capitalize' }}>
                                                {sequence.status}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer", padding: "4px" }}>
                                    <MoreVertical size={16} />
                                </button>
                            </div>

                            <p style={{ color: "#aaa", fontSize: "13px", lineHeight: "1.5", flex: 1 }}>
                                {sequence.description || "No description provided."}
                            </p>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #2a2a2a', paddingTop: '16px', marginTop: 'auto' }}>
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Active Leads</span>
                                        <span style={{ color: '#fff', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={12} color="#888" /> 0</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }}>Steps</span>
                                        <span style={{ color: '#fff', fontSize: '13px', fontWeight: 500 }}>{sequence.steps.length}</span>
                                    </div>
                                </div>

                                <button
                                    onClick={(e) => { e.stopPropagation(); updateSequenceStatus(sequence.id, sequence.status === 'active' ? 'paused' : 'active'); }}
                                    style={{
                                        background: "rgba(255,255,255,0.05)", border: "1px solid #333", color: "#e0e0e0",
                                        padding: "6px 12px", borderRadius: "6px", fontSize: "12px",
                                        fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", transition: "all 0.2s"
                                    }}>
                                    {sequence.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                                    {sequence.status === 'active' ? 'Pause' : 'Start'}
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
