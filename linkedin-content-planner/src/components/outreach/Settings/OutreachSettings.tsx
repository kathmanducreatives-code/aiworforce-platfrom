import { useState } from 'react';
import { Save, Settings2, Globe, Link } from 'lucide-react';
import type { OutreachSettings as OutreachSettingsType } from '../../../types/outreach';
import { toast } from 'sonner';

export default function OutreachSettings() {
    // Initial state with dummy values
    const [settings, setSettings] = useState<OutreachSettingsType>({
        id: '1',
        product_context: 'Content Command Center - an AI-powered desktop app that helps B2B SaaS teams create organic content and automate outbound sales through LinkedIn and Email.',
        email_signature: 'Cheers,\nFounder & CEO\nContent Command Center',
        default_cta: 'Open to a quick 10m chat next week?',
        linkedin_daily_connect_limit: 20,
        linkedin_daily_dm_limit: 40,
    });

    const [envSettings] = useState({
        genai_key: import.meta.env.VITE_GEMINI_API_KEY || '',
        n8n_email: import.meta.env.VITE_N8N_OUTREACH_EMAIL_WEBHOOK_URL || '',
        n8n_linkedin: import.meta.env.VITE_N8N_OUTREACH_LINKEDIN_WEBHOOK_URL || '',
        n8n_email_bulk: import.meta.env.VITE_N8N_OUTREACH_EMAIL_BULK_WEBHOOK_URL || '',
        n8n_closely_callback: import.meta.env.VITE_N8N_OUTREACH_CLOSELY_CALLBACK_URL || '',
        n8n_closely_export: import.meta.env.VITE_N8N_OUTREACH_CLOSELY_EXPORT_URL || '',
        n8n_reply: import.meta.env.VITE_N8N_OUTREACH_REPLY_WEBHOOK_URL || '',
        n8n_sync: import.meta.env.VITE_N8N_OUTREACH_SYNC_WEBHOOK_URL || '',
        n8n_track_open: import.meta.env.VITE_N8N_OUTREACH_TRACK_OPEN_URL || '',
    });

    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Simulate saving to Supabase
            await new Promise(resolve => setTimeout(resolve, 800));
            toast.success("Settings saved successfully.");
        } catch (error: any) {
            toast.error(error.message || "Failed to save settings.");
        } finally {
            setIsSaving(false);
        }
    };

    const Section = ({ title, icon: Icon, description, children }: any) => (
        <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '16px', overflow: 'hidden', marginBottom: '24px' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '8px', color: '#a855f7' }}>
                    <Icon size={18} />
                </div>
                <div>
                    <h3 style={{ color: '#fff', fontSize: '15px', fontWeight: 600 }}>{title}</h3>
                    <p style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>{description}</p>
                </div>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {children}
            </div>
        </div>
    );

    const InputGroup = ({ label, children }: any) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 500 }}>{label}</label>
            {children}
        </div>
    );

    return (
        <div style={{ padding: "24px 24px 60px", maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "32px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", color: "#f0f0f0", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "4px" }}>
                        Outreach Settings
                    </h1>
                    <p style={{ color: "#888", fontSize: "14px" }}>
                        Configure AI context, channel limits, and webhook integrations.
                    </p>
                </div>

                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                        background: "#00e5a0", color: "#000", border: "none",
                        padding: "10px 20px", borderRadius: "8px", fontSize: "14px",
                        fontWeight: 600, display: "flex", alignItems: "center", gap: "8px",
                        cursor: isSaving ? 'not-allowed' : 'pointer', transition: "all 0.2s"
                    }}
                >
                    <Save size={16} /> {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>

            <Section title="AI Product Context" icon={Globe} description="This context is injected into all AI prompts to generate highly personalized, value-driven messages.">
                <InputGroup label="Product Definition & Value Prop">
                    <textarea
                        value={settings.product_context}
                        onChange={(e) => setSettings({ ...settings, product_context: e.target.value })}
                        rows={4}
                        placeholder="What does your product do? What is the main value proposition?"
                        style={{ width: '100%', background: '#0d0d0d', border: '1px solid #333', color: '#e0e0e0', padding: '16px', borderRadius: '8px', fontSize: '14px', outline: 'none', resize: 'vertical', lineHeight: '1.5', transition: 'border-color 0.2s', fontFamily: "'Inter', sans-serif" }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#333'}
                    />
                </InputGroup>

                <InputGroup label="Default Call to Action (CTA)">
                    <input
                        value={settings.default_cta}
                        onChange={(e) => setSettings({ ...settings, default_cta: e.target.value })}
                        placeholder="e.g. Open to exploring if this makes sense for you?"
                        style={{ width: '100%', background: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '12px 16px', borderRadius: '8px', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s' }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#333'}
                    />
                </InputGroup>
            </Section>

            <Section title="Channel Limits & Defaults" icon={Settings2} description="Protect your sender reputation by enforcing maximum daily actions per account.">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <InputGroup label="LinkedIn Daily Connections">
                        <input
                            type="number"
                            value={settings.linkedin_daily_connect_limit}
                            onChange={(e) => setSettings({ ...settings, linkedin_daily_connect_limit: parseInt(e.target.value) || 0 })}
                            style={{ width: '100%', background: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '12px 16px', borderRadius: '8px', fontSize: '14px', outline: 'none' }}
                        />
                        <span style={{ fontSize: '11px', color: '#666' }}>Recommended: &lt; 25 / day</span>
                    </InputGroup>
                    <InputGroup label="LinkedIn Daily Messages (DMs)">
                        <input
                            type="number"
                            value={settings.linkedin_daily_dm_limit}
                            onChange={(e) => setSettings({ ...settings, linkedin_daily_dm_limit: parseInt(e.target.value) || 0 })}
                            style={{ width: '100%', background: '#0d0d0d', border: '1px solid #333', color: '#fff', padding: '12px 16px', borderRadius: '8px', fontSize: '14px', outline: 'none' }}
                        />
                        <span style={{ fontSize: '11px', color: '#666' }}>Recommended: &lt; 50 / day</span>
                    </InputGroup>
                </div>

                <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: '20px', marginTop: '8px' }}>
                    <InputGroup label="Default Email Signature">
                        <textarea
                            value={settings.email_signature}
                            onChange={(e) => setSettings({ ...settings, email_signature: e.target.value })}
                            rows={3}
                            style={{ width: '100%', background: '#0d0d0d', border: '1px solid #333', color: '#e0e0e0', padding: '16px', borderRadius: '8px', fontSize: '14px', outline: 'none', resize: 'vertical', lineHeight: '1.5', fontFamily: "'Inter', sans-serif" }}
                        />
                    </InputGroup>
                </div>
            </Section>

            <Section title="Integrations & Environment" icon={Link} description="Configure the n8n webhooks and API keys required for automation. These values are read from your .env file.">

                <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid #3b82f644', borderRadius: '8px', padding: '16px', marginBottom: '8px' }}>
                    <span style={{ color: '#3b82f6', fontSize: '13px', fontWeight: 600 }}>Note:</span>
                    <p style={{ color: '#ccc', fontSize: '12px', marginTop: '4px', lineHeight: '1.5' }}>
                        To update these values permanently, please modify the <code>.env</code> file in your project root and restart the application.
                    </p>
                </div>

                <InputGroup label="Google Gemini API Key">
                    <input
                        value={envSettings.genai_key}
                        readOnly
                        type="password"
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n Email Webhook URL (Single)">
                    <input
                        value={envSettings.n8n_email}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n Bulk Email Webhook URL">
                    <input
                        value={envSettings.n8n_email_bulk}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n LinkedIn Webhook URL">
                    <input
                        value={envSettings.n8n_linkedin}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n Closely Callback URL">
                    <input
                        value={envSettings.n8n_closely_callback}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n Closely Export URL">
                    <input
                        value={envSettings.n8n_closely_export}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n Reply Detection URL">
                    <input
                        value={envSettings.n8n_reply}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n Dashboard Data Sync URL">
                    <input
                        value={envSettings.n8n_sync}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>

                <InputGroup label="n8n Open Tracking URL">
                    <input
                        value={envSettings.n8n_track_open}
                        readOnly
                        style={{ width: '100%', background: '#0d0d0d', border: '1px dashed #333', color: '#888', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', outline: 'none', cursor: 'not-allowed' }}
                    />
                </InputGroup>
            </Section>

        </div>
    );
}
