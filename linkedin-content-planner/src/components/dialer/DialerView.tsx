import { Phone, ExternalLink, RefreshCw, Activity, User, PhoneCall } from 'lucide-react';
import { useState } from 'react';
import { useDialerStatus } from '../../hooks/useDialerStatus';

export default function DialerView() {
    const [iframeKey, setIframeKey] = useState(0);
    const { status, loading: _loading } = useDialerStatus();
    const DIALER_URL = "https://n8n.prasidha.me/dialer";

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>

            {/* Dialer Live Monitor Bar */}
            <div style={{
                padding: '12px 24px',
                background: '#0a0a0a',
                borderBottom: '1px solid #1a1a1a',
                display: 'flex',
                alignItems: 'center',
                gap: '40px',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: status?.is_active ? '#00e5a0' : '#444',
                        boxShadow: status?.is_active ? '0 0 10px #00e5a0' : 'none'
                    }} />
                    <span style={{ color: '#fff', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {status?.is_active ? 'System Live' : 'System Idle'}
                    </span>
                </div>

                {status?.is_active && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px', animation: 'fadeIn 0.5s ease' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <User size={14} color="#888" />
                            <span style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 500 }}>
                                {status.current_lead_name || 'Calling...'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Activity size={14} color="#888" />
                            <span style={{
                                color: status.last_call_status === 'Answered' ? '#00e5a0' : '#888',
                                fontSize: '13px',
                                fontWeight: 600
                            }}>
                                {status.last_call_status || 'Waiting'}
                            </span>
                        </div>
                    </div>
                )}

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <PhoneCall size={14} color="#666" />
                    <span style={{ color: '#666', fontSize: '12px', fontWeight: 500 }}>
                        {status?.total_called_today || 0} Calls Today
                    </span>
                </div>
            </div>

            {/* Dialer Header Bar */}
            <div style={{
                padding: '16px 24px',
                background: '#141414',
                borderBottom: '1px solid #2a2a2a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Phone size={20} color="#00e5a0" />
                    <div>
                        <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 600 }}>Power Dialer</h2>
                        <p style={{ color: '#888', fontSize: '13px' }}>Automated cold calling workflows</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setIframeKey(prev => prev + 1)}
                        style={{
                            background: '#222', color: '#e0e0e0', border: '1px solid #333',
                            padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
                            fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px',
                            cursor: 'pointer', transition: 'background 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = '#2a2a2a'}
                        onMouseOut={(e) => e.currentTarget.style.background = '#222'}
                    >
                        <RefreshCw size={14} /> Refresh
                    </button>

                    <button
                        onClick={() => window.open(DIALER_URL, '_blank')}
                        style={{
                            background: '#222', color: '#e0e0e0', border: '1px solid #333',
                            padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
                            fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px',
                            cursor: 'pointer', transition: 'background 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = '#2a2a2a'}
                        onMouseOut={(e) => e.currentTarget.style.background = '#222'}
                    >
                        <ExternalLink size={14} /> Open in Browser
                    </button>
                </div>
            </div>

            {/* Embedded Iframe */}
            <div style={{ flex: 1, backgroundColor: '#0d0d0d', position: 'relative' }}>
                <iframe
                    key={iframeKey}
                    src={DIALER_URL}
                    allow="microphone; camera; display-capture" // Essential for VoIP/Twilio integration
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        position: 'absolute',
                        top: 0,
                        left: 0
                    }}
                    title="Power Dialer"
                />
            </div>

        </div>
    );
}
