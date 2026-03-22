import React from "react";

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
}

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
    <circle cx="16" cy="16" r="14" fill="#D97757" />
    <text x="16" y="21" textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="sans-serif">C</text>
  </svg>
);

export const GeminiLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <path d="M16 2L20 12L30 16L20 20L16 30L12 20L2 16L12 12Z" fill="#4285F4" />
  </svg>
);

export const FirecrawlLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <path d="M16 3C16 3 10 12 10 18C10 22 12.5 27 16 29C19.5 27 22 22 22 18C22 12 16 3 16 3Z" fill="#F97316" />
    <path d="M16 10C16 10 13 15 13 19C13 21.5 14.5 24 16 25C17.5 24 19 21.5 19 19C19 15 16 10 16 10Z" fill="#FDBA74" />
  </svg>
);

export const ApifyLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="4" fill="#00D68F" />
    <text x="16" y="22" textAnchor="middle" fill="white" fontSize="18" fontWeight="800" fontFamily="sans-serif">A</text>
  </svg>
);

export const InstantlyLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#3B82F6" />
    <path d="M18 7L12 17H16L14 25L22 15H17L18 7Z" fill="white" />
  </svg>
);

export const PerplexityLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#20B2AA" />
    <circle cx="16" cy="14" r="5" stroke="white" strokeWidth="2.5" fill="none" />
    <line x1="20" y1="18" x2="25" y2="23" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const ElevenLabsLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="4" fill="#1A1A2E" stroke="#555" strokeWidth="0.5" />
    <rect x="8" y="13" width="2.5" height="6" rx="1" fill="white" />
    <rect x="12" y="9" width="2.5" height="14" rx="1" fill="white" />
    <rect x="16" y="11" width="2.5" height="10" rx="1" fill="white" />
    <rect x="20" y="7" width="2.5" height="18" rx="1" fill="white" />
  </svg>
);

export const ReplicateLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="4" fill="#262626" stroke="#555" strokeWidth="0.5" />
    {[0, 1, 2].map(r => [0, 1, 2].map(c => (
      <circle key={`${r}-${c}`} cx={10 + c * 6} cy={10 + r * 6} r="2" fill="white" />
    )))}
  </svg>
);

export const GPT4Logo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#10A37F" />
    <text x="16" y="21" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="sans-serif">G</text>
  </svg>
);

export const NotionLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="5" y="4" width="22" height="24" rx="3" fill="white" />
    <text x="16" y="22" textAnchor="middle" fill="black" fontSize="18" fontWeight="700" fontFamily="serif">N</text>
  </svg>
);

export const LinearLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#5E6AD2" />
    <path d="M10 22L22 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
    <path d="M10 16L16 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const GitHubLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#24292E" stroke="#555" strokeWidth="0.5" />
    <path d="M16 6C10.5 6 6 10.5 6 16C6 20.5 9 24.2 13 25.5C13.5 25.6 13.7 25.3 13.7 25C13.7 24.7 13.7 24 13.7 23C10.7 23.6 10.1 21.5 10.1 21.5C9.6 20.4 8.9 20.1 8.9 20.1C8 19.5 9 19.5 9 19.5C10 19.6 10.5 20.5 10.5 20.5C11.4 22 12.9 21.6 13.7 21.3C13.8 20.6 14.1 20.2 14.4 19.9C12 19.6 9.5 18.7 9.5 14.9C9.5 13.8 9.9 13 10.5 12.3C10.4 12 10 11.1 10.6 9.8C10.6 9.8 11.5 9.5 13.7 10.7C14.5 10.5 15.3 10.4 16 10.4C16.7 10.4 17.5 10.5 18.3 10.7C20.5 9.5 21.4 9.8 21.4 9.8C22 11.1 21.6 12 21.5 12.3C22.1 13 22.5 13.9 22.5 14.9C22.5 18.7 20 19.6 17.6 19.9C18 20.3 18.3 20.9 18.3 21.8C18.3 23.2 18.3 24.3 18.3 25C18.3 25.3 18.5 25.6 19 25.5C23 24.2 26 20.5 26 16C26 10.5 21.5 6 16 6Z" fill="white" />
  </svg>
);

export const HunterLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="4" fill="#F97316" />
    <text x="16" y="22" textAnchor="middle" fill="white" fontSize="18" fontWeight="800" fontFamily="sans-serif">H</text>
  </svg>
);

export const CalLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="6" width="24" height="22" rx="3" fill="white" />
    <rect x="4" y="6" width="24" height="7" rx="3" fill="#111" />
    <rect x="9" y="8" width="2" height="3" rx="1" fill="white" />
    <rect x="21" y="8" width="2" height="3" rx="1" fill="white" />
    <rect x="9" y="17" width="4" height="3" rx="0.5" fill="#3B82F6" />
    <rect x="14" y="17" width="4" height="3" rx="0.5" fill="#ddd" />
    <rect x="19" y="17" width="4" height="3" rx="0.5" fill="#ddd" />
    <rect x="9" y="22" width="4" height="3" rx="0.5" fill="#ddd" />
    <rect x="14" y="22" width="4" height="3" rx="0.5" fill="#ddd" />
  </svg>
);

export const CanvaLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <circle cx="16" cy="16" r="14" fill="#00C4CC" />
    <text x="16" y="21" textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="sans-serif">C</text>
  </svg>
);

export const GammaLogo: React.FC<LogoProps> = (props) => (
  <svg {...svgBase(props)}>
    <rect x="4" y="4" width="24" height="24" rx="6" fill="#8B5CF6" />
    <text x="16" y="22" textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="sans-serif">G</text>
  </svg>
);
