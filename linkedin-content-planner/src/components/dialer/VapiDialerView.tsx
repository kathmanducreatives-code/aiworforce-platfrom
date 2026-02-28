import { Bot, RefreshCw, Settings2, Key } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function VapiDialerView() {
    const [iframeKey, setIframeKey] = useState(0);
    const [apiKey, setApiKey] = useState(localStorage.getItem('vapi_api_key') || "13393178-bd64-46b4-9d3c-3e5b48f7cb01");
    const [assistantId, setAssistantId] = useState(localStorage.getItem('vapi_assistant_id') || "b2632999-d59c-4b00-ab98-68ccbfda2f4c");
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        localStorage.setItem('vapi_api_key', apiKey);
        localStorage.setItem('vapi_assistant_id', assistantId);
    }, [apiKey, assistantId]);

    const VAPI_HTML = `<!DOCTYPE html>
<html>
  <head>
    <script
      src="https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js"
      defer
      async
    ></script>
    <style>
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d0d0d; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; overflow: hidden; }
      .vapi-container { text-align: center; }
      h1 { color: #00e5a0; font-size: 24px; margin-bottom: 8px; }
      p { color: #888; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="vapi-container">
        <h1>Vapi AI Voice Assistant</h1>
        <p>Click the button in the bottom right to start the call</p>
    </div>

    <script>
      window.addEventListener("load", () => {
        window.vapiSDK.run({
          apiKey: "${apiKey}",
          assistant: "${assistantId}"
        });
      });
    </script>
  </body>
</html>`;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>

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
                    <div style={{ background: 'rgba(0, 229, 160, 0.1)', padding: '8px', borderRadius: '8px' }}>
                        <Bot size={20} color="#00e5a0" />
                    </div>
                    <div>
                        <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 600 }}>AI Voice Agent</h2>
                        <p style={{ color: '#888', fontSize: '13px' }}>Powered by Vapi.ai (Configured for Telnyx/Twilio)</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        style={{
                            background: showSettings ? '#222' : 'transparent', color: showSettings ? '#00e5a0' : '#888', border: '1px solid #333',
                            padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
                            fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px',
                            cursor: 'pointer', transition: 'all 0.2s'
                        }}
                    >
                        <Settings2 size={14} /> Configure
                    </button>
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
                        <RefreshCw size={14} /> Restart Agent
                    </button>
                </div>
            </div>

            {/* Settings Panel */}
            {showSettings && (
                <div style={{
                    padding: '16px 24px',
                    background: '#0a0a0a',
                    borderBottom: '1px solid #2a2a2a',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Vapi Public API Key</label>
                            <div style={{ display: 'flex', alignItems: 'center', background: '#141414', border: '1px solid #333', borderRadius: '8px', padding: '0 12px' }}>
                                <Key size={14} color="#666" />
                                <input
                                    type="text"
                                    value={apiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                    placeholder="Your Public API Key"
                                    style={{
                                        background: 'transparent', border: 'none', color: '#fff',
                                        padding: '12px 12px', fontSize: '13px', outline: 'none', flex: 1
                                    }}
                                />
                            </div>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Assistant ID</label>
                            <div style={{ display: 'flex', alignItems: 'center', background: '#141414', border: '1px solid #333', borderRadius: '8px', padding: '0 12px' }}>
                                <Bot size={14} color="#666" />
                                <input
                                    type="text"
                                    value={assistantId}
                                    onChange={e => setAssistantId(e.target.value)}
                                    placeholder="Your Assistant ID"
                                    style={{
                                        background: 'transparent', border: 'none', color: '#fff',
                                        padding: '12px 12px', fontSize: '13px', outline: 'none', flex: 1
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Embedded Iframe */}
            <div style={{ flex: 1, backgroundColor: '#0d0d0d', position: 'relative' }}>
                <iframe
                    key={iframeKey}
                    srcDoc={VAPI_HTML}
                    allow="microphone; camera; display-capture" // Essential for VoIP/Vapi integration
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        position: 'absolute',
                        top: 0,
                        left: 0
                    }}
                    title="Vapi Dialer"
                />
            </div>

        </div>
    );
}
