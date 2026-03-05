import React, { useState } from 'react';
import { Key, Webhook, Database, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react';
import { Card, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { Badge } from '../ui/Badge';

interface EnvEntry { key: string; label: string; value: string; hint?: string; sensitive?: boolean; }

// Read from Vite env — read-only display (can't write to .env at runtime)
const envValues: Record<string, string> = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL ?? '',
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
    VITE_INTERCEPTOR_WEBHOOK_URL: import.meta.env.VITE_INTERCEPTOR_WEBHOOK_URL ?? '',
    VITE_N8N_OUTREACH_LINKEDIN_WEBHOOK_URL: import.meta.env.VITE_N8N_OUTREACH_LINKEDIN_WEBHOOK_URL ?? '',
    VITE_N8N_OUTREACH_DISCOVER_WEBHOOK: import.meta.env.VITE_N8N_OUTREACH_DISCOVER_WEBHOOK ?? '',
    VITE_N8N_OUTREACH_EMAIL_WEBHOOK_URL: import.meta.env.VITE_N8N_OUTREACH_EMAIL_WEBHOOK_URL ?? '',
    VITE_N8N_CONTENT_GENERATE_WEBHOOK: import.meta.env.VITE_N8N_CONTENT_GENERATE_WEBHOOK ?? '',
    VITE_N8N_CONTENT_GENERATE_MONTHLY_WEBHOOK: import.meta.env.VITE_N8N_CONTENT_GENERATE_MONTHLY_WEBHOOK ?? '',
    VITE_N8N_CONTENT_SCHEDULE_WEBHOOK: import.meta.env.VITE_N8N_CONTENT_SCHEDULE_WEBHOOK ?? '',
    VITE_DIALER_URL: import.meta.env.VITE_DIALER_URL ?? '',
    VITE_GEMINI_API_KEY: import.meta.env.VITE_GEMINI_API_KEY ?? '',
    VITE_CAL_BOOKING_LINK: import.meta.env.VITE_CAL_BOOKING_LINK ?? '',
};

const sections: { title: string; subtitle: string; icon: React.ReactNode; entries: EnvEntry[] }[] = [
    {
        title: 'Supabase', subtitle: 'Database connection', icon: <Database size={16} />,
        entries: [
            { key: 'VITE_SUPABASE_URL', label: 'Project URL', value: envValues.VITE_SUPABASE_URL },
            { key: 'VITE_SUPABASE_ANON_KEY', label: 'Anon Key', value: envValues.VITE_SUPABASE_ANON_KEY, sensitive: true },
        ],
    },
    {
        title: 'n8n Webhooks', subtitle: 'Automation triggers', icon: <Webhook size={16} />,
        entries: [
            { key: 'VITE_INTERCEPTOR_WEBHOOK_URL', label: 'Post Interceptor', value: envValues.VITE_INTERCEPTOR_WEBHOOK_URL },
            { key: 'VITE_N8N_OUTREACH_LINKEDIN_WEBHOOK_URL', label: 'Batch Scrape + DM', value: envValues.VITE_N8N_OUTREACH_LINKEDIN_WEBHOOK_URL },
            { key: 'VITE_N8N_OUTREACH_DISCOVER_WEBHOOK', label: 'AI Lead Discovery', value: envValues.VITE_N8N_OUTREACH_DISCOVER_WEBHOOK },
            { key: 'VITE_N8N_OUTREACH_EMAIL_WEBHOOK_URL', label: 'Outreach Email', value: envValues.VITE_N8N_OUTREACH_EMAIL_WEBHOOK_URL },
            { key: 'VITE_N8N_CONTENT_GENERATE_WEBHOOK', label: 'Single Post Generator', value: envValues.VITE_N8N_CONTENT_GENERATE_WEBHOOK },
            { key: 'VITE_N8N_CONTENT_GENERATE_MONTHLY_WEBHOOK', label: 'Monthly Planner', value: envValues.VITE_N8N_CONTENT_GENERATE_MONTHLY_WEBHOOK },
            { key: 'VITE_N8N_CONTENT_SCHEDULE_WEBHOOK', label: 'Content Scheduler', value: envValues.VITE_N8N_CONTENT_SCHEDULE_WEBHOOK },
            { key: 'VITE_DIALER_URL', label: 'Power Dialer iFrame', value: envValues.VITE_DIALER_URL },
        ],
    },
    {
        title: 'API Keys', subtitle: 'External services', icon: <Key size={16} />,
        entries: [
            { key: 'VITE_GEMINI_API_KEY', label: 'Gemini API Key', value: envValues.VITE_GEMINI_API_KEY, sensitive: true },
            { key: 'VITE_CAL_BOOKING_LINK', label: 'Cal.com Link', value: envValues.VITE_CAL_BOOKING_LINK, hint: 'Used in outreach email CTAs' },
        ],
    },
];

const SettingsView: React.FC = () => {
    const [copied, setCopied] = useState<string | null>(null);

    const copyKey = (key: string, value: string) => {
        navigator.clipboard.writeText(value);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const allConfigured = Object.values(envValues).every(v => v.length > 0);

    return (
        <div className="flex flex-col min-h-full animate-fade-in">
            <PageHeader
                title="Settings"
                subtitle="Environment configuration and integration status"
                badge={
                    allConfigured
                        ? <Badge variant="emerald"><CheckCircle size={10} /> All configured</Badge>
                        : <Badge variant="amber"><AlertCircle size={10} /> Some vars missing</Badge>
                }
            />

            <div className="flex flex-col gap-6 px-6 pb-6 max-w-3xl">
                {/* Status banner */}
                <div className={[
                    'flex items-start gap-4 p-4 rounded-xl border text-sm',
                    allConfigured
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/5 border-amber-500/20 text-amber-400',
                ].join(' ')}>
                    {allConfigured
                        ? <CheckCircle size={16} className="mt-0.5 shrink-0" />
                        : <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    }
                    <div>
                        <p className="font-semibold mb-0.5">
                            {allConfigured ? 'All environment variables are set' : 'Some environment variables are missing'}
                        </p>
                        <p className="text-xs opacity-80">
                            Edit <code className="font-mono bg-black/20 px-1.5 py-0.5 rounded">.env</code> in the project root to update these values. Restart the dev server after changes.
                        </p>
                    </div>
                </div>

                {sections.map(section => (
                    <Card key={section.title}>
                        <CardHeader
                            title={section.title}
                            subtitle={section.subtitle}
                            action={<span className="text-slate-600">{section.icon}</span>}
                        />
                        <div className="flex flex-col gap-3">
                            {section.entries.map(entry => {
                                const isSet = entry.value.length > 0;
                                const displayVal = entry.sensitive && isSet
                                    ? entry.value.slice(0, 8) + '••••••••' + entry.value.slice(-4)
                                    : entry.value;

                                return (
                                    <div key={entry.key} className="flex items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="text-xs font-semibold text-slate-300">{entry.label}</p>
                                                <Badge variant={isSet ? 'emerald' : 'red'}>
                                                    {isSet ? 'Set' : 'Missing'}
                                                </Badge>
                                            </div>
                                            <p className="text-[11px] font-mono text-slate-600 mb-1">{entry.key}</p>
                                            {isSet && (
                                                <p className="text-xs text-slate-500 font-mono truncate bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5">
                                                    {displayVal}
                                                </p>
                                            )}
                                            {entry.hint && <p className="text-[11px] text-slate-600 mt-1">{entry.hint}</p>}
                                        </div>

                                        {isSet && (
                                            <button
                                                onClick={() => copyKey(entry.key, entry.value)}
                                                className="mt-5 p-2 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-all shrink-0"
                                                title="Copy value"
                                            >
                                                {copied === entry.key
                                                    ? <CheckCircle size={14} className="text-emerald-400" />
                                                    : <ExternalLink size={14} />
                                                }
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                ))}

                {/* Quick links */}
                <Card>
                    <CardHeader title="Quick Links" subtitle="Open in browser" />
                    <div className="flex flex-wrap gap-3">
                        {[
                            { label: 'n8n Dashboard', url: 'https://n8n.prasidha.me' },
                            { label: 'Supabase Console', url: `https://supabase.com/dashboard/project/${envValues.VITE_SUPABASE_URL.split('.')[0].replace('https://', '')}` },
                        ].map(link => (
                            <a
                                key={link.label}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-slate-300 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.14] transition-all"
                            >
                                <ExternalLink size={13} />
                                {link.label}
                            </a>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default SettingsView;
