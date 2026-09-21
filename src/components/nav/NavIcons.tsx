// THE AGENTORY NAVIGATION ICON FAMILY.
//
// One family, one geometry. Every mark is drawn on the same 24×24 grid with a
// 1.7 stroke, round caps and round joins, and inherits `currentColor` so the
// nav row — not the icon — decides its colour. No fills, no two-tone marks, no
// borrowed glyphs: a sidebar that mixes icon families is the single loudest
// "template" tell, and these are drawn to the product's own concepts instead.
//
// Optical sizing: marks sit inside a 24-box but the ink is kept within roughly
// 3…21 so every row's icon reads at the same visual weight, whatever its shape.
//
// PURE presentation. No state, no routing, no product logic.

import type { ReactNode, SVGProps } from 'react';

export interface NavIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Rendered box in px. The sidebar uses 20; dense surfaces may pass less. */
  size?: number;
}

/** The shared chassis. Every icon below is this plus its own paths. */
function Glyph({ size = 20, strokeWidth = 1.7, children, ...rest }: NavIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// ── product concepts ───────────────────────────────────────────────────────

/** Dashboard — command modules on an asymmetric grid. */
export const IconDashboard = (p: NavIconProps) => (
  <Glyph {...p}>
    <rect x="3.25" y="3.25" width="7" height="17.5" rx="2" />
    <rect x="13.75" y="3.25" width="7" height="7" rx="2" />
    <rect x="13.75" y="13.75" width="7" height="7" rx="2" />
  </Glyph>
);

/** Pilot — a navigator's mark: heading, not a chat bubble. */
export const IconPilot = (p: NavIconProps) => (
  <Glyph {...p}>
    <path d="M12 3.2 20 20.3l-8-3.9-8 3.9z" />
  </Glyph>
);

/** Awaiting You — an inbox tray: work that has arrived and is held for you. */
export const IconAwaiting = (p: NavIconProps) => (
  <Glyph {...p}>
    <path d="M3.2 13.4 5 5.9a2 2 0 0 1 1.95-1.55h10.1A2 2 0 0 1 19 5.9l1.8 7.5v4.25a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2z" />
    <path d="M3.2 13.4h4.6l1.4 2.4h5.6l1.4-2.4h4.6" />
  </Glyph>
);

/** Workflows — connected execution nodes, branching then rejoining. */
export const IconWorkflows = (p: NavIconProps) => (
  <Glyph {...p}>
    <circle cx="5.75" cy="5.75" r="2.55" />
    <circle cx="5.75" cy="18.25" r="2.55" />
    <circle cx="18.25" cy="12" r="2.55" />
    <path d="M8.3 5.75h3.45a3 3 0 0 1 3 3v.7" />
    <path d="M8.3 18.25h3.45a3 3 0 0 0 3-3v-.7" />
  </Glyph>
);

/** Signals — a pulse leaving a source: the buying moment being detected. */
export const IconSignals = (p: NavIconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="1.85" />
    <path d="M7.9 16.1a5.8 5.8 0 0 1 0-8.2" />
    <path d="M16.1 7.9a5.8 5.8 0 0 1 0 8.2" />
    <path d="M5 19a9.9 9.9 0 0 1 0-14" />
    <path d="M19 5a9.9 9.9 0 0 1 0 14" />
  </Glyph>
);

/** Leads — a person who has been qualified. */
export const IconLeads = (p: NavIconProps) => (
  <Glyph {...p}>
    <circle cx="9.6" cy="8.1" r="3.35" />
    <path d="M3.3 19.7a6.3 6.3 0 0 1 12.6 0" />
    <path d="M16.7 12.6 18.45 14.35 21.7 11.1" />
  </Glyph>
);

/** Content — a document with the spark that made it. */
export const IconContent = (p: NavIconProps) => (
  <Glyph {...p}>
    <path d="M13.4 3.4H6.9a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h10.2a2 2 0 0 0 2-2v-7.4" />
    <path d="M8.7 12.4h5.1" />
    <path d="M8.7 16.2h6.6" />
    <path d="m18.1 2.8 1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" />
  </Glyph>
);

/** Email Sequences — a send that is one of several, stacked behind it. */
export const IconSequences = (p: NavIconProps) => (
  <Glyph {...p}>
    <path d="M7.4 5.1h11.1a2 2 0 0 1 2 2v7.3" />
    <rect x="3.2" y="8.4" width="14" height="10.9" rx="2" />
    <path d="m3.7 9.6 5.35 3.85a2 2 0 0 0 2.3 0l5.35-3.85" />
  </Glyph>
);

/** Agents — an AI employee: a person carried on a badge. */
export const IconAgents = (p: NavIconProps) => (
  <Glyph {...p}>
    <path d="M12 2.7 19.6 7v10L12 21.3 4.4 17V7z" />
    <circle cx="12" cy="10.35" r="2.2" />
    <path d="M8.45 16.1a3.9 3.9 0 0 1 7.1 0" />
  </Glyph>
);

/** Company Brain — what the workforce knows, held as a connected network. */
export const IconCompanyBrain = (p: NavIconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="5.5" cy="6.4" r="1.85" />
    <circle cx="18.5" cy="6.4" r="1.85" />
    <circle cx="5.5" cy="17.6" r="1.85" />
    <circle cx="18.5" cy="17.6" r="1.85" />
    <path d="m6.95 7.6 3.2 2.75" />
    <path d="m17.05 7.6-3.2 2.75" />
    <path d="m6.95 16.4 3.2-2.75" />
    <path d="m17.05 16.4-3.2-2.75" />
  </Glyph>
);

/** Integrations — two systems linked into one. */
export const IconIntegrations = (p: NavIconProps) => (
  <Glyph {...p}>
    <rect x="3.3" y="3.3" width="7.6" height="7.6" rx="2" />
    <rect x="13.1" y="13.1" width="7.6" height="7.6" rx="2" />
    <path d="M10.9 7.1h3a3 3 0 0 1 3 3v3" />
  </Glyph>
);

// ── sidebar utility marks (same family, so the rail never mixes styles) ────

/** Credits — a token carrying a spark. */
export const IconCredits = (p: NavIconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="m12 7.7 1.35 2.95L16.3 12l-2.95 1.35L12 16.3l-1.35-2.95L7.7 12l2.95-1.35z" />
  </Glyph>
);

export const IconHelp = (p: NavIconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.7" />
    <path d="M9.6 9.5a2.5 2.5 0 0 1 4.9.7c0 1.65-2.45 2.1-2.45 3.6" />
    <path d="M12 17.15v.01" />
  </Glyph>
);

export const IconCollapse = (p: NavIconProps) => (
  <Glyph {...p}>
    <rect x="3.3" y="4.3" width="17.4" height="15.4" rx="2.6" />
    <path d="M9.7 4.3v15.4" />
    <path d="m16.2 10 -2 2 2 2" />
  </Glyph>
);

export const IconExpand = (p: NavIconProps) => (
  <Glyph {...p}>
    <rect x="3.3" y="4.3" width="17.4" height="15.4" rx="2.6" />
    <path d="M9.7 4.3v15.4" />
    <path d="m14.2 10 2 2-2 2" />
  </Glyph>
);

export const IconChevronDown = (p: NavIconProps) => (
  <Glyph {...p}>
    <path d="m6.5 9.75 5.5 5.5 5.5-5.5" />
  </Glyph>
);
