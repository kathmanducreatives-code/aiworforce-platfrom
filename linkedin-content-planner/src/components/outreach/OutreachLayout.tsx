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
        { id: "command_center" as const, label: "Command Center", icon: LayoutDashboard },
        { id: "pipeline" as const, label: "Pipeline", icon: Users },
        { id: "message_studio" as const, label: "Message Studio", icon: FileEdit },
        { id: "export" as const, label: "Export", icon: Download },
        { id: "performance" as const, label: "Performance", icon: LineChart },
        { id: "settings" as const, label: "Settings", icon: Settings },
    ];

    return (
        <div className="flex flex-col flex-1 min-h-0 animate-fade-in overflow-hidden" style={{ background: '#08080a' }}>
            {/* Sub-Navigation */}
            <header
                className="shrink-0 border-b border-white/[0.07] px-6 h-[52px] flex items-center overflow-x-auto"
                style={{ background: 'rgba(14,14,16,0.9)', backdropFilter: 'blur(20px)' }}
            >
                <div className="flex items-center gap-0.5 h-full">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={[
                                    'flex items-center gap-1.5 h-full px-3 border-b-2 transition-all duration-150 cursor-pointer text-[12.5px] font-medium whitespace-nowrap',
                                    isActive
                                        ? 'border-blue-500 text-blue-400'
                                        : 'border-transparent text-slate-500 hover:text-slate-300',
                                ].join(' ')}
                            >
                                <Icon size={14} strokeWidth={isActive ? 2.5 : 1.9} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </header>

            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                {activeTab === "command_center" && <CommandCenterView />}
                {activeTab === "pipeline" && <PipelineView />}
                {activeTab === "message_studio" && <MessageStudioView />}
                {activeTab === "export" && <ExportView />}
                {activeTab === "performance" && <PerformanceDashboard />}
                {activeTab === "settings" && <OutreachSettings />}
            </div>
        </div>
    );
}
