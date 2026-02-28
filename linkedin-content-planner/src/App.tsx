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
    <div style={{ background: "#0d0d0d", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: "'Inter', sans-serif",
            borderRadius: "12px",
          },
        }}
      />
      {/* Global Navigation Bar */}
      <nav style={{
        background: "#141414",
        borderBottom: "1px solid #2a2a2a",
        padding: "0 24px",
        height: "48px",
        display: "flex",
        alignItems: "center",
        gap: "24px",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}>
        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            background: "transparent",
            border: "none",
            color: activeTab === 'dashboard' ? "#3b82f6" : "#888",
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
            color: activeTab === 'content' ? "#00e5a0" : "#888",
            fontWeight: activeTab === 'content' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'content' ? "2px solid #00e5a0" : "2px solid transparent",
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
            color: activeTab === 'outreach' ? "#a855f7" : "#888",
            fontWeight: activeTab === 'outreach' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'outreach' ? "2px solid #a855f7" : "2px solid transparent",
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
            color: activeTab === 'dialer' ? "#f59e0b" : "#888",
            fontWeight: activeTab === 'dialer' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'dialer' ? "2px solid #f59e0b" : "2px solid transparent",
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
            color: activeTab === 'ai-agent' ? "#10b981" : "#888", // emerald green for AI
            fontWeight: activeTab === 'ai-agent' ? 600 : 500,
            fontSize: "13px",
            height: "100%",
            borderBottom: activeTab === 'ai-agent' ? "2px solid #10b981" : "2px solid transparent",
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
