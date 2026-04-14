import React, { useState } from "react";

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
}

// Brand colors and metadata exported for reuse
export const TOOL_BRANDS: Record<string, { bg: string; color: string; label: string; sublabel: string; logo: string; agents: string[] }> = {
  claude:      { bg: "#CC785C", color: "#fff", label: "Claude",      sublabel: "Reasoning & Writing",   logo: "/tool-logos/8891273522918_30c38bf627ac73075db6_512.png", agents: ["Scout", "Aria", "Radar", "Codex"] },
  gemini:      { bg: "#4285F4", color: "#fff", label: "Gemini",      sublabel: "Screening & Analysis",  logo: "/tool-logos/7cf51e188450701.65b6d6991d38d.png.webp", agents: ["Scout"] },
  gpt4:        { bg: "#10A37F", color: "#fff", label: "GPT-4",       sublabel: "Specialized Tasks",     logo: "/tool-logos/chatgpt-icon-filled-256.png", agents: ["Radar"] },
  perplexity:  { bg: "#20808D", color: "#fff", label: "Perplexity",  sublabel: "Real-time Research",    logo: "https://logo.clearbit.com/perplexity.ai?size=128", agents: ["Radar", "Codex"] },
  firecrawl:   { bg: "#FF4500", color: "#fff", label: "Firecrawl",   sublabel: "Web Intelligence",      logo: "/tool-logos/fircrawl.png", agents: ["Radar", "Scout", "Codex"] },
  apify:       { bg: "#97D700", color: "#fff", label: "Apify",       sublabel: "LinkedIn Scraping",     logo: "/tool-logos/4I3J0G11AI3M.png", agents: ["Scout", "Codex"] },
  hunter:      { bg: "#F5A623", color: "#fff", label: "Hunter.io",   sublabel: "Email Discovery",       logo: "https://logo.clearbit.com/hunter.io?size=128", agents: ["Codex"] },
  instantly:   { bg: "#6366F1", color: "#fff", label: "Instantly",    sublabel: "Email Sequences",       logo: "/tool-logos/instantly.svg", agents: ["Codex"] },
  elevenlabs:  { bg: "#1A1A2E", color: "#fff", label: "ElevenLabs",  sublabel: "Voice Generation",      logo: "/tool-logos/11labs.png", agents: ["Aria"] },
  replicate:   { bg: "#393939", color: "#fff", label: "Replicate",   sublabel: "Image Generation",      logo: "https://logo.clearbit.com/replicate.com?size=128", agents: ["Aria"] },
  notion:      { bg: "#FFFFFF", color: "#000", label: "Notion",      sublabel: "Documentation",         logo: "/tool-logos/notion.svg", agents: ["Radar"] },
  linear:      { bg: "#5E6AD2", color: "#fff", label: "Linear",      sublabel: "Task Management",       logo: "/tool-logos/linear.svg", agents: ["Radar"] },
  github:      { bg: "#24292E", color: "#fff", label: "GitHub",      sublabel: "Code Management",       logo: "/tool-logos/github.svg", agents: [] },
  cal:         { bg: "#111827", color: "#fff", label: "Cal.com",      sublabel: "Scheduling",           logo: "https://logo.clearbit.com/cal.com?size=128", agents: ["Scout"] },
  canva:       { bg: "#00C4CC", color: "#fff", label: "Canva",       sublabel: "Design Handoff",        logo: "https://logo.clearbit.com/canva.com?size=128", agents: ["Aria"] },
  gamma:       { bg: "#6C47FF", color: "#fff", label: "Gamma",       sublabel: "Presentations",         logo: "https://logo.clearbit.com/gamma.app?size=128", agents: ["Aria"] },
  nanobanana:  { bg: "#FFE135", color: "#000", label: "Nano Banana", sublabel: "Image Generation",      logo: "/tool-logos/nanobanana.svg", agents: ["Canvas", "Quill"] },
  midjourney:  { bg: "#FFFFFF", color: "#000", label: "Midjourney",  sublabel: "AI Art",                logo: "", agents: ["Canvas"] },
};

// Reusable ToolLogoImage component with fallback
export const ToolLogoImage: React.FC<{ toolId: string; size?: number; className?: string }> = ({ toolId, size = 32, className = "" }) => {
  const [failed, setFailed] = useState(false);
  const brand = TOOL_BRANDS[toolId];
  if (!brand) return null;

  if (failed) {
    return (
      <div className={`flex items-center justify-center font-bold ${className}`}
        style={{ width: size, height: size, color: brand.color, fontSize: size * 0.4 }}>
        {brand.label.charAt(0)}
      </div>
    );
  }

  return (
    <div 
      className={`rounded-full overflow-hidden flex items-center justify-center border border-white/5 bg-black/40 ${className}`} 
      style={{ width: size, height: size }}
    >
      <img
        src={brand.logo}
        alt={brand.label}
        loading="lazy"
        className="w-full h-full object-cover scale-110"
        onError={() => setFailed(true)}
      />
    </div>
  );
};

// Logo lookup map kept for backward compatibility
export const TOOL_LOGO_MAP: Record<string, React.FC<LogoProps>> = {};
