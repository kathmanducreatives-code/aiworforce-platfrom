import { useState } from "react";
import { Toaster } from "sonner";
import { Bell, User } from "lucide-react";
import Sidebar from "./components/layout/Sidebar";
import type { TabId } from "./components/layout/Sidebar";
import ContentPlanner from "./ContentPlanner";
import OutreachLayout from "./components/outreach/OutreachLayout";
import DialerView from "./components/dialer/DialerView";
import VapiDialerView from "./components/dialer/VapiDialerView";
import DashboardOverview from "./components/dashboard/DashboardOverview";
import InterceptorPipeline from "./components/outreach/PostInterceptor/InterceptorPipeline";
import LeadCRMView from "./components/outreach/LeadCRM/LeadCRMView";
import SettingsView from "./components/settings/SettingsView";

const ContentGenerator = () => (
    <div className="flex flex-col items-center justify-center flex-1 text-slate-500 gap-4 p-16">
        <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm text-2xl">✍️</div>
        <p className="text-slate-900 font-semibold">Post Generator</p>
        <p className="text-sm text-center max-w-xs text-slate-500">AI-powered LinkedIn post generator coming soon.</p>
    </div>
);

function App() {
    const [activeTab, setActiveTab] = useState<TabId>('dashboard');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    // Map active tab to a readable title
    const getPageTitle = (tab: TabId) => {
        const titles: Record<TabId, string> = {
            'dashboard': 'Dashboard Overview',
            'content-planner': 'Content Planner',
            'content-generator': 'Post Generator',
            'post-interceptor': 'Post Interceptor',
            'lead-crm': 'Lead CRM',
            'outreach': 'Message Studio',
            'dialer': 'Power Dialer',
            'settings': 'Global Settings',
        };
        return titles[tab] || 'Command Center';
    };

    return (
        <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
            <Toaster
                position="top-right"
                toastOptions={{
                    style: {
                        fontFamily: "'Inter', sans-serif",
                        borderRadius: "8px",
                        background: "#ffffff",
                        color: "#0f172a",
                        border: "1px solid #e2e8f0",
                        fontSize: "13px",
                        boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                    },
                }}
            />

            <Sidebar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                collapsed={sidebarCollapsed}
                setCollapsed={setSidebarCollapsed}
            />

            <main
                className="flex flex-col flex-1 min-w-0 overflow-y-auto overflow-x-hidden transition-[margin] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                style={{ marginLeft: sidebarCollapsed ? '72px' : '240px' }}
            >
                {/* Unified Top Bar */}
                <header className="sticky top-0 z-30 flex items-center justify-between px-8 py-4 bg-white border-b border-slate-200 shrink-0 shadow-sm">
                    <h1 className="text-lg font-semibold text-slate-900 tracking-tight">{getPageTitle(activeTab)}</h1>
                    <div className="flex items-center gap-5">
                        <div className="flex items-center gap-2">
                            <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Online</span>
                        </div>
                        <div className="h-4 w-px bg-slate-200"></div>
                        <button className="text-slate-400 hover:text-slate-600 transition-colors">
                            <Bell size={18} />
                        </button>
                        <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                            <User size={16} />
                        </div>
                    </div>
                </header>

                <div className="flex-1 relative">
                    {activeTab === 'dashboard' && <DashboardOverview />}
                    {activeTab === 'content-planner' && <ContentPlanner />}
                    {activeTab === 'content-generator' && <ContentGenerator />}
                    {activeTab === 'post-interceptor' && <InterceptorPipeline />}
                    {activeTab === 'lead-crm' && <LeadCRMView />}
                    {activeTab === 'outreach' && <OutreachLayout />}
                    {activeTab === 'dialer' && (
                        <div className="flex flex-col flex-1 p-6 gap-6">
                            <DialerView />
                            <div className="border-t border-slate-200 pt-6">
                                <VapiDialerView />
                            </div>
                        </div>
                    )}
                    {activeTab === 'settings' && <SettingsView />}
                </div>
            </main>
        </div>
    );
}

export default App;
