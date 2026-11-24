// DEVELOPMENT ONLY: the latest `npm run dev:atlas -- <scenario> --preview` output
// (dev-sim/preview.json, git-ignored), if a developer generated one. The Workbench lead panel
// uses it instead of the committed simulation while VITE_STRATEGY_DISCOVERY_MOCK is on, so a
// scenario you just ran in the terminal is what you see in the browser. Absent file → empty.
// Never active in a production build (the panel's mock mode requires import.meta.env.DEV).

const found: Record<string, unknown> = import.meta.env.DEV
  ? import.meta.glob('/dev-sim/preview.json', { eager: true, import: 'default' })
  : {};

export interface LocalSimulationMeta { query?: string; scenario?: string }

/** The generated simulation, or null when none was generated. */
export const localSimulation: (LocalSimulationMeta & Record<string, unknown>) | null =
  (Object.values(found)[0] as (LocalSimulationMeta & Record<string, unknown>) | undefined) ?? null;
