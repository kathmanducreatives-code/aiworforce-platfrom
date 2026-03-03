import { useState } from "react";
import { Toaster } from "sonner";
import ContentPlanner from "./ContentPlanner";
import OutreachLayout from "./components/outreach/OutreachLayout";
import CommandCenter from "./components/dashboard/CommandCenter";
import DialerView from "./components/dialer/DialerView";
import VapiDialerView from "./components/dialer/VapiDialerView";

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'content' | 'outreach' | 'dialer' | 'ai-agent'>('dashboard');

  return (
    <div style={{ background: "#0a0a0b", minHeight: "100vh", display: "flex", flexDirection: "column", color: "#ffffff" }}>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: "'Inter', sans-serif",
            borderRadius: "12px",
            background: "#141416",
            color: "#ffffff",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          },
        }}
      />
      {/* Global Navigation Bar */}
      <nav style={{
        background: "#0a0a0b",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        padding: "0 24px",
        height: "48px",
        display: "flex",
        alignItems: "center",
        gap: "24px",
        position: "sticky",
        top: 0,
        zIndex: 40,
        boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
      }}>
        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === 'dashboard' ? "#3b82f6" : "#64748b",
            fontWeight: activeTab === 'dashboard' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'dashboard' ? "2px solid #3b82f6" : "2px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s",
            padding: "0 4px",
          }}
        >
          Command Center
        </button>
        <button
          onClick={() => setActiveTab('content')}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === 'content' ? "#059669" : "#64748b",
            fontWeight: activeTab === 'content' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'content' ? "2px solid #059669" : "2px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s",
            padding: "0 4px",
          }}
        >
          Content Planner
        </button>
        <button
          onClick={() => setActiveTab('outreach')}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === 'outreach' ? "#7c3aed" : "#64748b",
            fontWeight: activeTab === 'outreach' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'outreach' ? "2px solid #7c3aed" : "2px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s",
            padding: "0 4px",
          }}
        >
          Outreach Engine
        </button>
        <button
          onClick={() => setActiveTab('dialer')}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === 'dialer' ? "#d97706" : "#64748b",
            fontWeight: activeTab === 'dialer' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'dialer' ? "2px solid #d97706" : "2px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s",
            padding: "0 4px",
          }}
        >
          Power Dialer
        </button>
        <button
          onClick={() => setActiveTab('ai-agent')}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === 'ai-agent' ? "#059669" : "#64748b", // emerald green for AI
            fontWeight: activeTab === 'ai-agent' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'ai-agent' ? "2px solid #059669" : "2px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s",
            padding: "0 4px",
          }}
        >
          AI Voice Agent
        </button>
      </nav>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeTab === 'dashboard' && <CommandCenter />}
        {activeTab === 'content' && <ContentPlanner />}
        {activeTab === 'outreach' && <OutreachLayout />}
        {activeTab === 'dialer' && <DialerView />}
        {activeTab === 'ai-agent' && <VapiDialerView />}
      </div>
    </div>
  );
}

export default App;
