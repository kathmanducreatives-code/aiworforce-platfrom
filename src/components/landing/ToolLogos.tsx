import React, { useState } from "react";

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
}

// Brand colors and metadata exported for reuse
// Using Clearbit (logo.clearbit.com) for reliable, crisp logos + verified CDNs
export const TOOL_BRANDS: Record<string, { bg: string; color: string; label: string; sublabel: string; logo: string; agents: string[] }> = {
  claude:      { bg: "#CC785C", color: "#fff", label: "Claude",      sublabel: "Reasoning & Writing",   logo: "https://logo.clearbit.com/anthropic.com?size=128", agents: ["Scout", "Aria", "Radar", "Codex"] },
  gemini:      { bg: "#4285F4", color: "#fff", label: "Gemini",      sublabel: "Screening & Analysis",  logo: "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg", agents: ["Scout"] },
  gpt4:        { bg: "#10A37F", color: "#fff", label: "GPT-4",       sublabel: "Specialized Tasks",     logo: "https://logo.clearbit.com/openai.com?size=128", agents: ["Radar"] },
  perplexity:  { bg: "#20808D", color: "#fff", label: "Perplexity",  sublabel: "Real-time Research",    logo: "https://logo.clearbit.com/perplexity.ai?size=128", agents: ["Radar", "Codex"] },
  firecrawl:   { bg: "#FF4500", color: "#fff", label: "Firecrawl",   sublabel: "Web Intelligence",      logo: "https://logo.clearbit.com/firecrawl.dev?size=128", agents: ["Radar", "Scout", "Codex"] },
  apify:       { bg: "#97D700", color: "#fff", label: "Apify",       sublabel: "LinkedIn Scraping",     logo: "https://logo.clearbit.com/apify.com?size=128", agents: ["Scout", "Codex"] },
  hunter:      { bg: "#F5A623", color: "#fff", label: "Hunter.io",   sublabel: "Email Discovery",       logo: "https://logo.clearbit.com/hunter.io?size=128", agents: ["Codex"] },
  instantly:   { bg: "#6366F1", color: "#fff", label: "Instantly",    sublabel: "Email Sequences",       logo: "https://logo.clearbit.com/instantly.ai?size=128", agents: ["Codex"] },
  elevenlabs:  { bg: "#1A1A2E", color: "#fff", label: "ElevenLabs",  sublabel: "Voice Generation",      logo: "https://logo.clearbit.com/elevenlabs.io?size=128", agents: ["Aria"] },
  replicate:   { bg: "#393939", color: "#fff", label: "Replicate",   sublabel: "Image Generation",      logo: "https://logo.clearbit.com/replicate.com?size=128", agents: ["Aria"] },
  notion:      { bg: "#FFFFFF", color: "#000", label: "Notion",      sublabel: "Documentation",         logo: "https://logo.clearbit.com/notion.so?size=128", agents: ["Radar"] },
  linear:      { bg: "#5E6AD2", color: "#fff", label: "Linear",      sublabel: "Task Management",       logo: "https://logo.clearbit.com/linear.app?size=128", agents: ["Radar"] },
  github:      { bg: "#24292E", color: "#fff", label: "GitHub",      sublabel: "Code Management",       logo: "https://logo.clearbit.com/github.com?size=128", agents: [] },
  cal:         { bg: "#111827", color: "#fff", label: "Cal.com",      sublabel: "Scheduling",           logo: "https://logo.clearbit.com/cal.com?size=128", agents: ["Scout"] },
  canva:       { bg: "#00C4CC", color: "#fff", label: "Canva",       sublabel: "Design Handoff",        logo: "https://logo.clearbit.com/canva.com?size=128", agents: ["Aria"] },
  gamma:       { bg: "#6C47FF", color: "#fff", label: "Gamma",       sublabel: "Presentations",         logo: "https://logo.clearbit.com/gamma.app?size=128", agents: ["Aria"] },
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
    <img
      src={brand.logo}
      alt={brand.label}
      width={size}
      height={size}
      loading="lazy"
      className={`object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
};

// Logo lookup map kept for backward compatibility
export const TOOL_LOGO_MAP: Record<string, React.FC<LogoProps>> = {};
