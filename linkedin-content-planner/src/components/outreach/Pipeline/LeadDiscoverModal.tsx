import { useState } from 'react';
import { Search, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface LeadDiscoverModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDiscoverSuccess: () => void;
}

export default function LeadDiscoverModal({ isOpen, onClose, onDiscoverSuccess }: LeadDiscoverModalProps) {
    const [jobTitles, setJobTitles] = useState('Software Engineer, Product Manager');
    const [locations, setLocations] = useState('Germany, Netherlands');
    const [datePosted, setDatePosted] = useState('past_week');
    const [maxItems, setMaxItems] = useState(500);

    const [isDiscovering, setIsDiscovering] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<any | null>(null);

    if (!isOpen) return null;

    const handleDiscover = async () => {
        setIsDiscovering(true);
        setError(null);
        setResult(null);

        try {
            const body = {
                jobTitles: jobTitles.split(',').map(t => t.trim()).filter(Boolean),
                locations: locations.split(',').map(l => l.trim()).filter(Boolean),
                datePosted,
                maxItems
            };

            const response = await fetch('https://n8n.prasidha.me/webhook/outreach-discover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                throw new Error(`Failed to discover leads: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success) {
                setResult({
                    total_leads: data.total_leads,
                    agency_leads: data.agency_leads,
                    dms_generated: data.dms_generated,
                    message: data.message || `Discovery completed successfully.`
                });
                toast.success('Leads discovered successfully!');
                onDiscoverSuccess();
                // Optionally auto-close after a delay
                // setTimeout(() => onClose(), 3000);
            } else {
                throw new Error(data.message || 'Discovery failed.');
            }

        } catch (err: any) {
            setError(err.message || 'An error occurred during discovery.');
        } finally {
            setIsDiscovering(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
            <div style={{
                background: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px',
                width: '100%', maxWidth: '500px', padding: '24px', position: 'relative'
            }}>
                <button
                    onClick={() => {
                        setResult(null);
                        setError(null);
                        onClose();
                    }}
                    style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}
                >
                    <X size={20} />
                </button>

                <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>AI Lead Discovery</h2>
                <p style={{ color: '#888', fontSize: '13px', marginBottom: '24px' }}>Automatically scrape LinkedIn jobs to find companies actively hiring, find decision makers, and draft DMs.</p>

                {result ? (
                    <div style={{
                        border: '1px solid #059669', borderRadius: '12px', padding: '24px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'rgba(5, 150, 105, 0.05)',
                        marginBottom: '20px', textAlign: 'center'
                    }}>
                        <CheckCircle2 size={40} color="#059669" style={{ marginBottom: '16px' }} />
                        <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Discovery Complete!</h3>
                        <p style={{ color: '#e0e0e0', fontSize: '14px', marginBottom: '16px' }}>{result.message}</p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', width: '100%', marginTop: '8px' }}>
                            <div style={{ background: '#1c1c1f', padding: '12px', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                                <div style={{ fontSize: '20px', fontWeight: 600, color: '#fff' }}>{result.total_leads}</div>
                                <div style={{ fontSize: '12px', color: '#888' }}>Total Leads</div>
                            </div>
                            <div style={{ background: '#1c1c1f', padding: '12px', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                                <div style={{ fontSize: '20px', fontWeight: 600, color: '#059669' }}>{result.agency_leads}</div>
                                <div style={{ fontSize: '12px', color: '#888' }}>Using Agencies</div>
                            </div>
                            <div style={{ background: '#1c1c1f', padding: '12px', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                                <div style={{ fontSize: '20px', fontWeight: 600, color: '#3b82f6' }}>{result.dms_generated}</div>
                                <div style={{ fontSize: '12px', color: '#888' }}>DMs Ready</div>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                setResult(null);
                                onClose();
                            }}
                            style={{
                                marginTop: '24px', background: '#059669', color: '#fff',
                                border: 'none', padding: '10px 24px', borderRadius: '8px',
                                fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: '100%'
                            }}
                        >
                            View Pipeline
                        </button>
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                            <div>
                                <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                    Job Titles (comma separated)
                                </label>
                                <input
                                    type="text"
                                    value={jobTitles}
                                    onChange={(e) => setJobTitles(e.target.value)}
                                    placeholder="e.g. Software Engineer, Product Manager"
                                    style={{
                                        width: '100%', background: '#0a0a0b', border: '1px solid #333',
                                        color: '#fff', padding: '10px 12px', borderRadius: '8px', fontSize: '14px',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                    Locations (comma separated)
                                </label>
                                <input
                                    type="text"
                                    value={locations}
                                    onChange={(e) => setLocations(e.target.value)}
                                    placeholder="e.g. Germany, Netherlands"
                                    style={{
                                        width: '100%', background: '#0a0a0b', border: '1px solid #333',
                                        color: '#fff', padding: '10px 12px', borderRadius: '8px', fontSize: '14px',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                        Date Posted
                                    </label>
                                    <select
                                        value={datePosted}
                                        onChange={(e) => setDatePosted(e.target.value)}
                                        style={{
                                            width: '100%', background: '#0a0a0b', border: '1px solid #333',
                                            color: '#fff', padding: '10px 12px', borderRadius: '8px', fontSize: '14px',
                                            cursor: 'pointer', boxSizing: 'border-box'
                                        }}
                                    >
                                        <option value="past_24h">Past 24 Hours</option>
                                        <option value="past_week">Past Week</option>
                                        <option value="past_month">Past Month</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                        Max Items
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="1000"
                                        value={maxItems}
                                        onChange={(e) => setMaxItems(parseInt(e.target.value))}
                                        style={{
                                            width: '100%', background: '#0a0a0b', border: '1px solid #333',
                                            color: '#fff', padding: '10px 12px', borderRadius: '8px', fontSize: '14px',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontSize: '13px', marginBottom: '20px', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: '8px' }}>
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button
                                onClick={onClose}
                                style={{ background: 'transparent', border: '1px solid #333', color: '#ccc', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDiscover}
                                disabled={isDiscovering}
                                style={{
                                    background: isDiscovering ? '#333' : '#00e5a0',
                                    color: isDiscovering ? '#888' : '#000',
                                    border: 'none', padding: '10px 16px', borderRadius: '8px',
                                    fontSize: '13px', fontWeight: 600, cursor: isDiscovering ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '8px'
                                }}
                            >
                                {isDiscovering ? <><Loader2 size={16} className="animate-spin" /> Discovering Leads...</> : <><Search size={16} /> Start Discovery</>}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
