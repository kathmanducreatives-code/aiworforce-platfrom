import { useState } from "react";
import { Toaster } from "sonner";
import { Bell, User, Search, ChevronDown } from "lucide-react";
import Sidebar from "./components/layout/Sidebar";
import type { TabId } from "./components/layout/Sidebar";
import PageTransition from "./components/layout/PageTransition";
import ContentPlanner from "./ContentPlanner";
import OutreachLayout from "./components/outreach/OutreachLayout";
import DialerView from "./components/dialer/DialerView";
import VapiDialerView from "./components/dialer/VapiDialerView";
import DashboardOverview from "./components/dashboard/DashboardOverview";
import InterceptorPipeline from "./components/outreach/PostInterceptor/InterceptorPipeline";
import LeadCRMView from "./components/outreach/LeadCRM/LeadCRMView";
import SettingsView from "./components/settings/SettingsView";
import OutreachEngine from "./components/outreach/OutreachEngine";

const SIDEBAR_FULL = 230;
const SIDEBAR_COLLAPSED = 68;

const tabMeta: Record<TabId, { title: string; subtitle: string }> = {
    'dashboard': { title: 'Dashboard', subtitle: 'Live pipeline overview' },
    'content-planner': { title: 'Content Planner', subtitle: 'Schedule and draft your LinkedIn posts' },
    'content-generator': { title: 'Post Generator', subtitle: 'AI-assisted LinkedIn post creation' },
    'post-interceptor': { title: 'Post Interceptor', subtitle: 'Capture leads from competitor posts' },
    'lead-crm': { title: 'Lead CRM', subtitle: 'Your full outreach pipeline' },
    'outreach': { title: 'Message Studio', subtitle: 'Craft and send personalised DMs' },
    'outreach-engine': { title: 'Outreach Engine', subtitle: 'Unified content + job outbound hub' },
    'dialer': { title: 'Power Dialer', subtitle: 'Automate your call sequences' },
    'settings': { title: 'Settings', subtitle: 'Workspace configuration' },
};

function App() {
    const [activeTab, setActiveTab] = useState<TabId>('dashboard');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    const meta = tabMeta[activeTab];
    const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_FULL;

    return (
        <div
            className="flex h-screen overflow-hidden font-sans"
            style={{ background: '#08080a', color: '#f1f5f9' }}
        >
            <Toaster
                position="top-right"
                toastOptions={{
                    style: {
                        fontFamily: "'Inter', sans-serif",
                        borderRadius: "10px",
                        background: "#18181b",
                        color: "#f1f5f9",
                        border: "1px solid rgba(255,255,255,0.09)",
                        fontSize: "13px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    },
                }}
            />

            <Sidebar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                collapsed={sidebarCollapsed}
                setCollapsed={setSidebarCollapsed}
            />

            {/* Main area */}
            <main
                className="flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                style={{ marginLeft: `${sidebarWidth}px` }}
            >
                {/* ── Topbar ── */}
                <header className="topbar shrink-0 flex items-center justify-between px-6 h-[60px]">
                    <div>
                        <h1 className="text-[15px] font-semibold text-white tracking-tight leading-none">
                            {meta.title}
                        </h1>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-none">{meta.subtitle}</p>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Search hint */}
                        <button
                            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-500 border border-white/[0.07] text-[12px] hover:border-white/[0.12] hover:text-slate-300 transition-all"
                            style={{ background: 'rgba(255,255,255,0.03)' }}
                        >
                            <Search size={13} />
                            <span>Search…</span>
                            <kbd className="ml-2 text-[10px] text-slate-600 font-mono border border-white/[0.08] rounded px-1">⌘K</kbd>
                        </button>

                        {/* Separator */}
                        <div className="w-px h-4 bg-white/[0.08]" />

                        {/* Status dot */}
                        <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            <span className="text-[11px] font-semibold text-emerald-500/80 tracking-wide">Live</span>
                        </div>

                        {/* Bell */}
                        <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-all">
                            <Bell size={15} />
                        </button>

                        {/* User avatar */}
                        <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-white/[0.05] transition-all group">
                            <div
                                className="w-7 h-7 rounded-md flex items-center justify-center text-blue-400 shrink-0"
                                style={{ background: 'rgba(59,130,246,0.15)' }}
                            >
                                <User size={14} />
                            </div>
                            <ChevronDown size={12} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                        </button>
                    </div>
                </header>

                {/* ── Page content — full height, each page handles its own scroll ── */}
                <div className="flex-1 min-h-0 flex flex-col">
                    <PageTransition key={activeTab} tabKey={activeTab}>
                        {activeTab === 'dashboard' && <DashboardOverview />}
                        {activeTab === 'content-planner' && <ContentPlanner />}
                        {activeTab === 'content-generator' && <ContentGeneratorPlaceholder />}
                        {activeTab === 'post-interceptor' && <InterceptorPipeline />}
                        {activeTab === 'lead-crm' && <LeadCRMView />}
                        {activeTab === 'outreach' && <OutreachLayout />}
                        {activeTab === 'outreach-engine' && <OutreachEngine />}
                        {activeTab === 'dialer' && <DialerPage />}
                        {activeTab === 'settings' && <SettingsView />}
                    </PageTransition>
                </div>
            </main>
        </div>
    );
}

function ContentGeneratorPlaceholder() {
    return (
        <div className="flex flex-col items-center justify-center flex-1 gap-5 p-16 animate-fade-in">
            <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.2)' }}
            >
                ✍️
            </div>
            <div className="text-center">
                <p className="text-white font-semibold text-lg">Post Generator</p>
                <p className="text-sm text-slate-500 mt-1 max-w-xs">AI-powered LinkedIn post generator — coming soon.</p>
            </div>
        </div>
    );
}

function DialerPage() {
    return (
        <div className="flex-1 overflow-y-auto">
            <div className="page-content">
                <DialerView />
                <div className="border-t border-white/[0.06] pt-6">
                    <VapiDialerView />
                </div>
            </div>
        </div>
    );
}

export default App;
