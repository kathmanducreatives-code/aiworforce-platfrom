import React, { useState } from "react";

// LOCAL BRAND MARKS for every provider in the table.
//
// These were hotlinked to worldvectorlogo, webflow and GitHub avatar URLs.
// Several had rotted: the Apify entry pointed at github user 38267582, which
// is an unrelated person, so the orbit rendered a stranger's profile photo.
// Everything is bundled now, and the avatar ids that remain are the real
// organisation accounts.
import claudeMark from "@/assets/ai-logos/claude.png";
import openaiMark from "@/assets/ai-logos/openai.png";
// NB: `gemini.png` in this folder is mislabelled — it is Apify's mark, not
// Gemini's. Use the real Gemini logo here.
import geminiMark from "@/assets/ai-logos/gemini-mark.svg";
import perplexityMark from "@/assets/ai-logos/perplexity.svg";
import firecrawlMark from "@/assets/ai-logos/firecrawl.png";
import apifyMark from "@/assets/ai-logos/apify.png";
import resendMark from "@/assets/ai-logos/resend.svg";

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
}

// Brand colors and metadata exported for reuse
// THE PROVIDERS AGENTORY ACTUALLY CALLS.
//
// This table used to list seventeen tools. Ten of them — Notion, Linear,
// GitHub, Cal.com, Canva, Gamma, ElevenLabs, Replicate, Instantly, Hunter.io —
// appear nowhere in the backend, so the ecosystem orbit was advertising
// integrations that do not exist. The seven below are the providers the edge
// functions genuinely invoke.
export const TOOL_BRANDS: Record<string, { bg: string; color: string; label: string; sublabel: string; logo: string }> = {
  claude:      { bg: "#CC785C", color: "#fff", label: "Claude",      sublabel: "Reasoning & Writing",   logo: claudeMark },
  gpt4:        { bg: "#10A37F", color: "#fff", label: "OpenAI",      sublabel: "Specialized Tasks",     logo: openaiMark },
  gemini:      { bg: "#4285F4", color: "#fff", label: "Gemini",      sublabel: "Analysis & Screening",  logo: geminiMark },
  perplexity:  { bg: "#20808D", color: "#fff", label: "Perplexity",  sublabel: "Live Research",         logo: perplexityMark },
  firecrawl:   { bg: "#FF4500", color: "#fff", label: "Firecrawl",   sublabel: "Web Intelligence",      logo: firecrawlMark },
  apify:       { bg: "#97D700", color: "#fff", label: "Apify",       sublabel: "Data Extraction",       logo: apifyMark },
  resend:      { bg: "#1F1F1F", color: "#fff", label: "Resend",      sublabel: "Email Delivery",        logo: resendMark },
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

// Legacy SVG components kept for backward compatibility
const svgBase = (props: LogoProps) => ({
  viewBox: "0 0 32 32",
  width: props.width || 32,
  height: props.height || 32,
  className: props.className,
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
});

export const ClaudeLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#CC785C" />
    <path d="M20.5 12C20.5 12 18 10 16 10C12.5 10 10 13 10 16C10 19 12.5 22 16 22C18 22 20.5 20 20.5 20" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
  </svg>
);

export const GeminiLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <defs>
      <linearGradient id="gemini-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#4285F4" />
        <stop offset="100%" stopColor="#EA4335" />
      </linearGradient>
    </defs>
    <path d="M16 2L20 12L30 16L20 20L16 30L12 20L2 16L12 12Z" fill="url(#gemini-grad)" />
  </svg>
);

export const GPT4Logo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#10A37F" />
    <path d="M16 8C16 8 11 11 11 16C11 18.5 12.5 20 14 20.5C14 20.5 13 18 14.5 15.5C16 13 18 12 18 12" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <path d="M16 8C16 8 21 11 21 16C21 18.5 19.5 20 18 20.5C18 20.5 19 18 17.5 15.5C16 13 14 12 14 12" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <circle cx="16" cy="22" r="1.5" fill="white" />
  </svg>
);

export const PerplexityLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#20808D" />
    <path d="M16 6V26M6 16H26M10 10L22 22M22 10L10 22" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
    <circle cx="16" cy="16" r="4" fill="#20808D" stroke="white" strokeWidth="1.8" />
  </svg>
);

export const FirecrawlLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#FF4500" />
    <path d="M16 5C16 5 11 12 11 17C11 21 13 24 16 25C19 24 21 21 21 17C21 12 16 5 16 5Z" fill="#FFA07A" />
    <path d="M16 11C16 11 13.5 15 13.5 18C13.5 20 14.5 22 16 22.5C17.5 22 18.5 20 18.5 18C18.5 15 16 11 16 11Z" fill="white" opacity="0.8" />
  </svg>
);

export const ApifyLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="6" fill="#97D700" />
    <path d="M16 9L10 23H14L16 18L18 23H22L16 9Z" fill="white" />
  </svg>
);

export const HunterLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#F5A623" />
    <circle cx="16" cy="16" r="8" stroke="white" strokeWidth="2" fill="none" />
    <circle cx="16" cy="16" r="3" stroke="white" strokeWidth="2" fill="none" />
    <line x1="16" y1="4" x2="16" y2="8" stroke="white" strokeWidth="2" />
    <line x1="16" y1="24" x2="16" y2="28" stroke="white" strokeWidth="2" />
    <line x1="4" y1="16" x2="8" y2="16" stroke="white" strokeWidth="2" />
    <line x1="24" y1="16" x2="28" y2="16" stroke="white" strokeWidth="2" />
  </svg>
);

export const InstantlyLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#6366F1" />
    <path d="M18 6L11 18H16L14 26L23 14H17L18 6Z" fill="white" />
  </svg>
);

export const ElevenLabsLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="6" fill="#1A1A2E" stroke="#6366F1" strokeWidth="1" />
    <rect x="8" y="14" width="2.5" height="5" rx="1" fill="white" />
    <rect x="12" y="10" width="2.5" height="13" rx="1" fill="white" />
    <rect x="16" y="12" width="2.5" height="9" rx="1" fill="white" />
    <rect x="20" y="8" width="2.5" height="17" rx="1" fill="white" />
  </svg>
);

export const ReplicateLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="6" fill="#393939" stroke="#555" strokeWidth="0.5" />
    <circle cx="16" cy="16" r="8" stroke="white" strokeWidth="2" fill="none" />
    <path d="M14 12L22 16L14 20V12Z" fill="white" />
  </svg>
);

export const NotionLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="5" y="4" width="22" height="24" rx="3" fill="white" />
    <path d="M10 9H22V11H10V9ZM10 14H20V16H10V14ZM10 19H18V21H10V19Z" fill="#333" />
  </svg>
);

export const LinearLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#5E6AD2" />
    <path d="M8 24C8 24 8 8 24 8" stroke="white" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M8 18C8 18 8 14 14 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6" />
  </svg>
);

export const GitHubLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#24292E" />
    <path d="M16 6C10.5 6 6 10.5 6 16C6 20.5 9 24.2 13 25.5C13.5 25.6 13.7 25.3 13.7 25C13.7 24.7 13.7 24 13.7 23C10.7 23.6 10.1 21.5 10.1 21.5C9.6 20.4 8.9 20.1 8.9 20.1C8 19.5 9 19.5 9 19.5C10 19.6 10.5 20.5 10.5 20.5C11.4 22 12.9 21.6 13.7 21.3C13.8 20.6 14.1 20.2 14.4 19.9C12 19.6 9.5 18.7 9.5 14.9C9.5 13.8 9.9 13 10.5 12.3C10.4 12 10 11.1 10.6 9.8C10.6 9.8 11.5 9.5 13.7 10.7C14.5 10.5 15.3 10.4 16 10.4C16.7 10.4 17.5 10.5 18.3 10.7C20.5 9.5 21.4 9.8 21.4 9.8C22 11.1 21.6 12 21.5 12.3C22.1 13 22.5 13.9 22.5 14.9C22.5 18.7 20 19.6 17.6 19.9C18 20.3 18.3 20.9 18.3 21.8C18.3 23.2 18.3 24.3 18.3 25C18.3 25.3 18.5 25.6 19 25.5C23 24.2 26 20.5 26 16C26 10.5 21.5 6 16 6Z" fill="white" />
  </svg>
);

export const CalLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="6" width="24" height="22" rx="3" fill="#111827" />
    <rect x="4" y="6" width="24" height="7" rx="3" fill="#374151" />
    <rect x="9" y="8" width="2" height="3" rx="1" fill="#9CA3AF" />
    <rect x="21" y="8" width="2" height="3" rx="1" fill="#9CA3AF" />
    <rect x="9" y="17" width="4" height="3" rx="0.5" fill="#3B82F6" />
    <rect x="14" y="17" width="4" height="3" rx="0.5" fill="#4B5563" />
    <rect x="19" y="17" width="4" height="3" rx="0.5" fill="#4B5563" />
    <rect x="9" y="22" width="4" height="3" rx="0.5" fill="#4B5563" />
    <rect x="14" y="22" width="4" height="3" rx="0.5" fill="#4B5563" />
  </svg>
);

export const CanvaLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#00C4CC" />
    <path d="M20 12C20 12 18 10 16 10C13 10 11 13 11 16C11 19 13 22 16 22C18 22 20 20 20 20" stroke="white" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
);

export const GammaLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="6" fill="#6C47FF" />
    <path d="M20 10H12C12 10 10 10 10 12V14C10 14 10 16 12 16H18C18 16 20 16 20 18V20C20 20 20 22 18 22H10" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
  </svg>
);

// Logo lookup map for easy access by tool ID
export const TOOL_LOGO_MAP: Record<string, React.FC<LogoProps>> = {
  claude: ClaudeLogo,
  gemini: GeminiLogo,
  gpt4: GPT4Logo,
  perplexity: PerplexityLogo,
  firecrawl: FirecrawlLogo,
  apify: ApifyLogo,
};
