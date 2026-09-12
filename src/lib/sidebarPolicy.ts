// ONE SIDEBAR RULE FOR THE WHOLE APP.
//
// Home is where you orient yourself, so the sidebar is open there. Every other
// page is where you work, so it starts compact and gives the width to the work.
// Decided HERE, once, from the route — no page carries its own collapse logic.
//
// A person's choice still wins for the rest of the session: expanding the
// sidebar on Content keeps it expanded on Signals too, and collapsing it on the
// Dashboard keeps the Dashboard compact. The preference is per KIND of page
// (home vs work), because "I want room to work" is not a statement about the
// home page and vice versa.
//
// PURE apart from the injected storage. Deno-testable.

export type RouteKind = "home" | "work";

/** The routes that are "home". The Dashboard is the app's home; `/` is the marketing site. */
const HOME_ROUTES: ReadonlySet<string> = new Set(["/dashboard"]);

export function routeKind(pathname: string): RouteKind {
  const p = (pathname || "/").replace(/\/+$/, "") || "/";
  return HOME_ROUTES.has(p) ? "home" : "work";
}

/** The default before anyone has touched the toggle. */
export function defaultCollapsed(kind: RouteKind): boolean {
  return kind === "work";
}

export type SidebarPrefs = Partial<Record<RouteKind, boolean>>;

export const SIDEBAR_PREFS_KEY = "agentory.sidebar.collapsed.v1";

export interface PrefsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Tolerant: storage blocked, missing or corrupt reads as "no preference". */
export function readPrefs(store: PrefsStore | null | undefined): SidebarPrefs {
  try {
    const raw = store?.getItem(SIDEBAR_PREFS_KEY);
    const v = raw ? JSON.parse(raw) : {};
    const out: SidebarPrefs = {};
    if (typeof v?.home === "boolean") out.home = v.home;
    if (typeof v?.work === "boolean") out.work = v.work;
    return out;
  } catch {
    return {};
  }
}

export function writePrefs(store: PrefsStore | null | undefined, prefs: SidebarPrefs): void {
  try { store?.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked: session-less is fine */ }
}

/** Collapsed or not, for this route, honouring the session's manual choice for its kind. */
export function collapsedFor(pathname: string, prefs: SidebarPrefs): boolean {
  const kind = routeKind(pathname);
  return prefs[kind] ?? defaultCollapsed(kind);
}

/** Record a manual toggle as the preference for the current kind of page. */
export function withToggle(pathname: string, prefs: SidebarPrefs, collapsed: boolean): SidebarPrefs {
  return { ...prefs, [routeKind(pathname)]: collapsed };
}
