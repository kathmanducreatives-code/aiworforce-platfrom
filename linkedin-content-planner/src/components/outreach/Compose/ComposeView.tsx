import { useState, useEffect } from 'react';
import { useOutreachLeads } from '../../../hooks/useOutreachLeads';
import { generateEmailDraft } from '../../../services/outreachGemini';
import { Bot, User, Building, Copy, Check, Send, Loader2, Sparkles, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { OutreachLead } from '../../../types/outreach';

export default function ComposeView() {
    const { leads } = useOutreachLeads();
    const [selectedLeadId, setSelectedLeadId] = useState<string>('');
    const [selectedLead, setSelectedLead] = useState<OutreachLead | null>(null);

    // AI Context Settings
    const [context, setContext] = useState({
        product_name: 'Content Command Center',
        value_prop: 'We help B2B teams accelerate revenue with an AI-powered outbound engine natively in an electron desktop app.',
        sender_name: 'SaaS Founder',
    });

    const [isGenerating, setIsGenerating] = useState(false);
    const [draft, setDraft] = useState({ subject: '', body: '' });
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (selectedLeadId) {
            setSelectedLead(leads.find(l => l.id === selectedLeadId) || null);
        } else {
            setSelectedLead(null);
        }
    }, [selectedLeadId, leads]);

    const handleGenerate = async () => {
        if (!selectedLead) {
            toast.error("Please select a lead first.");
            return;
        }

        setIsGenerating(true);
        try {
            const result = await generateEmailDraft(selectedLead, context);
            setDraft(result);
            toast.success("Draft generated!");
        } catch (error: any) {
            toast.error(error.message || "Failed to generate draft.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = () => {
        const fullText = `Subject: ${draft.subject}\n\n${draft.body}`;
        navigator.clipboard.writeText(fullText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("Copied to clipboard");
    };

    return (
        <div style={{ padding: '24px', display: 'flex', gap: '24px', height: '100%', alignItems: 'stretch' }}>

            {/* Left Panel: Context & Lead Selection */}
            <div style={{ flex: 1, backgroundColor: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid #2a2a2a' }}>
                    <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 600 }}>Message Context</h2>
                    <p style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>Select a lead and define your product pitch.</p>
                </div>

                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Lead Select */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 500 }}>Target Lead</label>
                        <select
                            value={selectedLeadId}
                            onChange={(e) => setSelectedLeadId(e.target.value)}
                            style={{
                                backgroundColor: '#0d0d0d', border: '1px solid #333', color: '#fff',
                                padding: '10px 12px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'pointer'
                            }}
                        >
                            <option value="">-- Select a Lead --</option>
                            {leads.map(lead => (
                                <option key={lead.id} value={lead.id}>
                                    {lead.contact_name} ({lead.company})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Lead Preview Summary */}
                    {selectedLead && (
                        <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', border: '1px solid #3b82f644', borderRadius: '8px', padding: '16px' }}>
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', color: '#ccc', fontSize: '13px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><User size={14} color="#3b82f6" /> {selectedLead.title || 'No Title'}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Building size={14} color="#a855f7" /> {selectedLead.industry || 'No Industry'}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                <strong style={{ color: '#e0e0e0' }}>Known Signals:</strong> {selectedLead.signals?.length ? selectedLead.signals.map(s => s.type).join(', ') : 'None researched'}
                            </div>
                        </div>
                    )}

                    {/* Context Editor */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px dashed #333', paddingTop: '24px' }}>
                        <h3 style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: 600 }}>Your Context</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ color: '#888', fontSize: '12px' }}>Sender Name</label>
                            <input
                                value={context.sender_name} onChange={e => setContext({ ...context, sender_name: e.target.value })}
                                style={{ backgroundColor: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '10px', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
                            />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ color: '#888', fontSize: '12px' }}>Product Name</label>
                            <input
                                value={context.product_name} onChange={e => setContext({ ...context, product_name: e.target.value })}
                                style={{ backgroundColor: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '10px', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
                            />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ color: '#888', fontSize: '12px' }}>Value Proposition</label>
                            <textarea
                                value={context.value_prop} onChange={e => setContext({ ...context, value_prop: e.target.value })}
                                rows={3}
                                style={{ backgroundColor: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '10px', borderRadius: '8px', fontSize: '13px', outline: 'none', resize: 'vertical' }}
                            />
                        </div>
                    </div>

                </div>
            </div>

            {/* Right Panel: AI Draft Output */}
            <div style={{ flex: 1.5, backgroundColor: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ background: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)', padding: '8px', borderRadius: '8px' }}>
                            <Bot size={18} color="#fff" />
                        </div>
                        <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 600 }}>AI Creative Canvas</h2>
                    </div>
                    <button
                        onClick={handleGenerate}
                        disabled={!selectedLead || isGenerating}
                        style={{
                            backgroundColor: !selectedLead ? '#222' : '#3b82f6',
                            color: !selectedLead ? '#666' : '#fff',
                            border: 'none', padding: '8px 16px', borderRadius: '8px',
                            fontSize: '13px', fontWeight: 600, cursor: (!selectedLead || isGenerating) ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            transition: 'all 0.2s', boxShadow: selectedLead && !isGenerating ? '0 0 15px rgba(59, 130, 246, 0.4)' : 'none'
                        }}
                    >
                        {isGenerating ? <Loader2 size={16} className="animate-spin" /> : (draft.body ? <RefreshCcw size={16} /> : <Sparkles size={16} />)}
                        {isGenerating ? 'Writing...' : (draft.body ? 'Regenerate Draft' : 'Generate Draft')}
                    </button>
                </div>

                <div style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Subject Line */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Subject</label>
                        <input
                            value={draft.subject}
                            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                            placeholder="AI will generate a catchy subject line here..."
                            style={{
                                backgroundColor: '#0d0d0d', border: '1px solid #333', color: '#fff',
                                padding: '14px 16px', borderRadius: '8px', fontSize: '15px', outline: 'none',
                                fontWeight: 500, transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = '#333'}
                        />
                    </div>

                    {/* Email Body */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                        <label style={{ color: '#888', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Message Body</label>
                        <textarea
                            value={draft.body}
                            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                            placeholder="Your personalized, highly-converting cold email will appear here..."
                            style={{
                                backgroundColor: '#0d0d0d', border: '1px solid #333', color: '#e0e0e0',
                                padding: '16px', borderRadius: '8px', fontSize: '14px', outline: 'none',
                                flex: 1, resize: 'none', lineHeight: '1.6', transition: 'border-color 0.2s',
                                fontFamily: "'Inter', sans-serif"
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = '#333'}
                        />
                    </div>
                </div>

                {/* Footer Actions */}
                <div style={{ padding: '16px 24px', borderTop: '1px solid #2a2a2a', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={handleCopy}
                        disabled={!draft.body}
                        style={{
                            background: 'transparent', color: !draft.body ? '#555' : '#ccc', border: '1px solid #333',
                            padding: '10px 16px', borderRadius: '8px', fontSize: '13px',
                            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
                            cursor: !draft.body ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
                        }}
                    >
                        {copied ? <Check size={16} color="#00e5a0" /> : <Copy size={16} />}
                        {copied ? 'Copied!' : 'Copy to Clipboard'}
                    </button>
                    <button
                        disabled={!draft.body}
                        style={{
                            background: !draft.body ? '#222' : '#00e5a0', color: !draft.body ? '#555' : '#000', border: 'none',
                            padding: '10px 20px', borderRadius: '8px', fontSize: '13px',
                            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
                            cursor: !draft.body ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
                        }}
                    >
                        <Send size={16} /> Send via n8n
                    </button>
                </div>

            </div>
        </div>
    );
}
