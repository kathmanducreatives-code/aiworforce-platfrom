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
        <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 48px)", backgroundColor: "#0a0a0b" }}>

            {/* Outreach Sub-Navigation */}
            <header style={{
                position: "sticky", top: "48px", zIndex: 30, // Stacked below App.tsx nav
                backgroundColor: "#141416",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.3)",
                padding: "0 24px", height: "56px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "32px", height: "100%" }}>
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as Tab)}
                                style={{
                                    display: "flex", alignItems: "center", gap: "8px",
                                    height: "100%", background: "transparent", border: "none",
                                    borderBottom: isActive ? "2px solid #059669" : "2px solid transparent",
                                    color: isActive ? "#059669" : "#a1a1aa",
                                    fontWeight: isActive ? 600 : 500,
                                    fontSize: "13px", cursor: "pointer", transition: "all 0.2s ease",
                                    position: "relative"
                                }}
                            >
                                <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </header>

            <main style={{ flex: 1, width: "100%", height: "100%" }}>
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
