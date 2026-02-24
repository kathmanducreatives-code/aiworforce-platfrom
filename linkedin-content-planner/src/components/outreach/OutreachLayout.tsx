import { useState } from "react";
import { LayoutDashboard, GitMerge, FileEdit, LineChart, Settings } from "lucide-react";

import PipelineView from "./Pipeline/PipelineView";
import SequenceManager from "./Sequences/SequenceManager";
import SequenceEditor from "./Sequences/SequenceEditor";
import ComposeView from "./Compose/ComposeView";
import PerformanceDashboard from "./Performance/PerformanceDashboard";
import OutreachSettings from "./Settings/OutreachSettings";

type Tab = "pipeline" | "sequences" | "compose" | "performance" | "settings";

export default function OutreachLayout() {
    const [activeTab, setActiveTab] = useState<Tab>("pipeline");
    const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);

    const tabs = [
        { id: "pipeline", label: "Pipeline", icon: LayoutDashboard },
        { id: "sequences", label: "Sequences", icon: GitMerge },
        { id: "compose", label: "Compose", icon: FileEdit },
        { id: "performance", label: "Performance", icon: LineChart },
        { id: "settings", label: "Settings", icon: Settings },
    ] as const;

    const handleTabChange = (tabId: Tab) => {
        setActiveTab(tabId);
        if (tabId !== 'sequences') {
            setSelectedSequenceId(null);
        }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 48px)", background: "#0d0d0d" }}>
            {/* Outreach Sub-Navigation - Do not show if editing sequence */}
            {!selectedSequenceId && (
                <header style={{
                    position: "sticky", top: "48px", zIndex: 30, // Stacked below App.tsx nav
                    background: "rgba(13,13,13,0.92)",
                    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                    borderBottom: "1px solid #1e1e1e",
                    padding: "0 24px", height: "64px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: "14px",
                }}>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "24px" }}>
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => handleTabChange(tab.id as Tab)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: "8px",
                                        height: "64px", background: "transparent", border: "none",
                                        borderBottom: isActive ? "2px solid #a855f7" : "2px solid transparent",
                                        color: isActive ? "#a855f7" : "#888",
                                        fontWeight: isActive ? 600 : 500,
                                        fontSize: "13px", cursor: "pointer", transition: "all 0.2s"
                                    }}
                                >
                                    <Icon size={16} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </header>
            )}

            <main style={{ flex: 1, maxWidth: selectedSequenceId ? "100%" : "1400px", margin: "0 auto", width: "100%", paddingBottom: selectedSequenceId ? "0" : "60px" }}>
                {activeTab === "pipeline" && <PipelineView />}
                {activeTab === "sequences" && !selectedSequenceId && <SequenceManager onSelectSequence={setSelectedSequenceId} />}
                {activeTab === "sequences" && selectedSequenceId && <SequenceEditor sequenceId={selectedSequenceId} onClose={() => setSelectedSequenceId(null)} />}
                {activeTab === "compose" && <ComposeView />}
                {activeTab === "performance" && <PerformanceDashboard />}
                {activeTab === "settings" && <OutreachSettings />}
            </main>
        </div>
    );
}
