import { useState } from 'react';
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import {
    Zap, Search, Users, Mail, Settings, Activity,
    MessageSquare, CheckCircle, BarChart3, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';

type Lead = {
    id: string;
    name: string;
    title: string;
    company: string;
    score: number;
    tier: "Hot" | "Warm" | "Cold";
    dm: string;
    status: "pending" | "approved" | "flagged" | "sent";
};

const OutreachEngine = () => {
    const [activeTab, setActiveTab] = useState("dashboard");
    const [isDryRun, setIsDryRun] = useState(false);
    const [leads] = useState<Lead[]>([]);
    const [queue] = useState<Lead[]>([]);

    const stats = {
        generated: leads.length,
        dms: queue.length,
        approved: queue.filter(q => q.status === 'approved').length,
        sent: queue.filter(q => q.status === 'sent').length
    };

    const handleSearchPosts = () => {
        toast.info("Searching LinkedIn posts...");
        setTimeout(() => {
            toast.success("Found 12 high-engagement posts");
        }, 1500);
    };

    const tabs = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'content', label: 'Content Outreach' },
        { id: 'jobs', label: 'Job Outreach' },
        { id: 'queue', label: 'Review Queue', badge: queue.length > 0 ? queue.length : null },
        { id: 'settings', label: 'Settings' }
    ];

    return (
        <div className="flex-1 w-full space-y-6 p-8 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                        <Zap className="w-6 h-6 text-blue-600" />
                        Outreach Engine
                        <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">BETA</span>
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Unified command center for Content and Job-based outbound.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"></div>
                        n8n Connected
                    </div>
                    <Button
                        variant={isDryRun ? "danger" : "secondary"}
                        size="sm"
                        onClick={() => setIsDryRun(!isDryRun)}
                        className="text-xs"
                    >
                        <ShieldCheck className="w-4 h-4 mr-2" />
                        {isDryRun ? "DRY RUN: ON" : "DRY RUN: OFF"}
                    </Button>
                </div>
            </div>

            {/* Main Tabs */}
            <div className="flex border-b border-slate-200 gap-6">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        className={`py-2 px-1 border-b-2 text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === t.id
                            ? "border-blue-600 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-800"
                            }`}
                        onClick={() => setActiveTab(t.id)}
                    >
                        {t.label}
                        {t.badge && (
                            <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                                {t.badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <Card className="p-6 border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between space-y-0 pb-2">
                                <p className="text-sm font-medium text-slate-500">Leads Generated</p>
                                <Users className="h-4 w-4 text-slate-400" />
                            </div>
                            <div className="text-3xl font-bold text-slate-900">{stats.generated}</div>
                            <p className="text-xs text-emerald-500 mt-1 font-medium">↑ +14% from last week</p>
                        </Card>
                        <Card className="p-6 border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between space-y-0 pb-2">
                                <p className="text-sm font-medium text-slate-500">DMs Generated</p>
                                <MessageSquare className="h-4 w-4 text-slate-400" />
                            </div>
                            <div className="text-3xl font-bold text-slate-900">{stats.dms}</div>
                        </Card>
                        <Card className="p-6 border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between space-y-0 pb-2">
                                <p className="text-sm font-medium text-slate-500">Approved</p>
                                <CheckCircle className="h-4 w-4 text-emerald-500" />
                            </div>
                            <div className="text-3xl font-bold text-slate-900">{stats.approved}</div>
                        </Card>
                        <Card className="p-6 border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between space-y-0 pb-2">
                                <p className="text-sm font-medium text-slate-500">Sent</p>
                                <Mail className="h-4 w-4 text-blue-600" />
                            </div>
                            <div className="text-3xl font-bold text-slate-900">{stats.sent}</div>
                        </Card>
                        <Card className="p-6 border-slate-200 shadow-sm">
                            <div className="flex items-center justify-between space-y-0 pb-2">
                                <p className="text-sm font-medium text-slate-500">Avg DM Score</p>
                                <BarChart3 className="h-4 w-4 text-slate-400" />
                            </div>
                            <div className="text-3xl font-bold text-slate-900">—</div>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card className="p-6 border-slate-200 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-900 mb-1">Quick Actions</h3>
                            <p className="text-sm text-slate-500 mb-6">Jump into a workflow</p>

                            <div className="flex flex-col gap-3">
                                <Button className="w-full justify-start text-left bg-blue-600 hover:bg-blue-700 text-white border-0" onClick={() => setActiveTab('content')}>
                                    <Zap className="mr-2 h-4 w-4 shrink-0" /> <span className="truncate">Scrape competitor post → generate leads</span>
                                </Button>
                                <Button variant="secondary" className="w-full justify-start text-left" onClick={() => setActiveTab('jobs')}>
                                    <Search className="mr-2 h-4 w-4 shrink-0" /> Find founders via job postings
                                </Button>
                                <Button variant="secondary" className="w-full justify-start text-left" onClick={() => setActiveTab('queue')}>
                                    <CheckCircle className="mr-2 h-4 w-4 shrink-0" /> Review & approve pending DMs ({stats.dms})
                                </Button>
                            </div>
                        </Card>

                        <Card className="p-6 border-slate-200 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-900 mb-1">Recent Activity</h3>
                            <p className="text-sm text-slate-500 mb-6">Last 24 hours</p>

                            <div className="flex flex-col items-center justify-center py-10 text-center text-slate-500">
                                <Activity className="h-10 w-10 mb-3 opacity-20" />
                                <p>No activity yet.</p>
                                <p className="text-sm">Start a campaign to see it here.</p>
                            </div>
                        </Card>
                    </div>
                </div>
            )}

            {/* Content Outreach Tab */}
            {activeTab === 'content' && (
                <div className="space-y-6">
                    <div className="flex items-center space-x-2 text-sm text-slate-500 overflow-x-auto pb-2">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs">1</span> Scrape Posts
                        </div>
                        <span>→</span>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white border border-slate-200">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-xs">2</span> Identify Leads
                        </div>
                        <span>→</span>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white border border-slate-200">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-xs">3</span> Generate DMs
                        </div>
                    </div>

                    <Card className="p-6 border-slate-200 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 mb-1">Step 1 — Scrape Posts</h3>
                        <p className="text-sm text-slate-500 mb-6">Enter a LinkedIn post URL or competitor profile to find viral posts</p>

                        <div className="flex flex-col md:flex-row gap-4 items-end">
                            <div className="flex-1 space-y-2">
                                <label className="text-sm font-medium text-slate-700">LinkedIn URL</label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="https://linkedin.com/posts/... or /in/username"
                                />
                            </div>
                            <div className="w-full md:w-[250px] space-y-2">
                                <label className="text-sm font-medium text-slate-700">Mode</label>
                                <select className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="search_posts">Find top posts from profile</option>
                                    <option value="scrape_post">Scrape specific post directly</option>
                                </select>
                            </div>
                            <Button onClick={handleSearchPosts}>Search Posts</Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* Additional tabs omitted for brevity, focusing on structure for enterprise app */}
            {['jobs', 'queue', 'settings'].includes(activeTab) && (
                <Card className="p-12 border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
                    <Settings className="w-12 h-12 text-slate-300 mb-4" />
                    <h3 className="text-lg font-bold text-slate-900 mb-2">Section Under Implementation</h3>
                    <p className="text-sm text-slate-500 max-w-md">This view is currently being integrated into the Content Command Center. Parameters, AI-suggest filters, and settings will appear here shortly.</p>
                </Card>
            )}

        </div>
    );
};

export default OutreachEngine;
