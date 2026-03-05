import { useState } from "react";
import { Toaster } from "sonner";
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
        <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-2xl">✍️</div>
        <p className="text-white font-semibold">Content Generator</p>
        <p className="text-sm text-center max-w-xs">AI-powered LinkedIn post generator coming soon.</p>
    </div>
);

function App() {
    const [activeTab, setActiveTab] = useState<TabId>('dashboard');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    return (
        <div className="flex min-h-screen bg-[#0a0a0b] text-white">
            <Toaster
                position="top-right"
                toastOptions={{
                    style: {
                        fontFamily: "'Inter', sans-serif",
                        borderRadius: "12px",
                        background: "#1c1c1f",
                        color: "#ffffff",
                        border: "1px solid rgba(255,255,255,0.10)",
                        fontSize: "13px",
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
                className="flex flex-col flex-1 min-w-0 transition-[margin] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                style={{ marginLeft: sidebarCollapsed ? '72px' : '240px' }}
            >
                {activeTab === 'dashboard'          && <DashboardOverview />}
                {activeTab === 'content-planner'    && <ContentPlanner />}
                {activeTab === 'content-generator'  && <ContentGenerator />}
                {activeTab === 'post-interceptor'   && <InterceptorPipeline />}
                {activeTab === 'lead-crm'           && <LeadCRMView />}
                {activeTab === 'outreach'           && <OutreachLayout />}
                {activeTab === 'dialer'             && (
                    <div className="flex flex-col flex-1">
                        <DialerView />
                        <div className="border-t border-white/[0.08] mt-5">
                            <VapiDialerView />
                        </div>
                    </div>
                )}
                {activeTab === 'settings' && <SettingsView />}
            </main>
        </div>
    );
}

export default App;
