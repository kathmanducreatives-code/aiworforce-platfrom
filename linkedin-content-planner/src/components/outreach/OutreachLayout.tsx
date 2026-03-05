import { useState } from "react";
import { LayoutDashboard, Users, FileEdit, Download, LineChart, Settings } from "lucide-react";

import PipelineView from "./Pipeline/PipelineView";
import CommandCenterView from "./CommandCenter/CommandCenterView";
import MessageStudioView from "./MessageStudio/MessageStudioView";
import ExportView from "./CloselyExport/ExportView";
import PerformanceDashboard from "./Performance/PerformanceDashboard";
import OutreachSettings from "./Settings/OutreachSettings";

type Tab = "command_center" | "pipeline" | "message_studio" | "export" | "performance" | "settings";

export default function OutreachLayout() {
    const [activeTab, setActiveTab] = useState<Tab>("command_center");

    const tabs = [
        { id: "command_center", label: "Command Center", icon: LayoutDashboard },
        { id: "pipeline", label: "Pipeline", icon: Users },
        { id: "message_studio", label: "Message Studio", icon: FileEdit },
        { id: "export", label: "Closely Export", icon: Download },
        { id: "performance", label: "Performance", icon: LineChart },
        { id: "settings", label: "Settings", icon: Settings },
    ] as const;

    return (
        <div className="flex flex-col flex-1 bg-[#0a0a0b] animate-fade-in overflow-hidden">
            {/* Outreach Sub-Navigation */}
            <header className="sticky top-0 z-30 bg-[#141416]/80 backdrop-blur-xl border-b border-white/[0.08] px-6 h-14 flex items-center shrink-0">
                <div className="flex items-center gap-6 h-full">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as Tab)}
                                className={`
                                    flex items-center gap-2 h-full px-1 border-b-2 transition-all duration-200 cursor-pointer text-[13px]
                                    ${isActive
                                        ? "border-emerald-500 text-emerald-400 font-semibold"
                                        : "border-transparent text-slate-500 hover:text-slate-300 font-medium"}
                                `}
                            >
                                <Icon
                                    size={16}
                                    strokeWidth={isActive ? 2.5 : 2}
                                    className={isActive ? "drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]" : ""}
                                />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </header>

            <main className="flex-1 overflow-auto">
                {activeTab === "command_center" && <CommandCenterView />}
                {activeTab === "pipeline" && <PipelineView />}
                {activeTab === "message_studio" && <MessageStudioView />}
                {activeTab === "export" && <ExportView />}
                {activeTab === "performance" && <PerformanceDashboard />}
                {activeTab === "settings" && <OutreachSettings />}
            </main>
        </div>
    );
}
