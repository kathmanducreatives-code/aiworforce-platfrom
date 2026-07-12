// Env-gated LinkedIn provider adapters for posts / comments / people. The actor
// IDs are NEVER hardcoded — they come from env vars. When an env var is absent the
// adapter is `not_configured`: no provider call, no fabricated data. The status +
// normalizers are pure/testable; the fetch functions are only reached when
// configured (never in dev/tests).

export interface AdapterStatus {
  configured: boolean;
  actor: string | null;   // never invented — read from env
  env_var: string;
  reason: string;
}

export const POSTS_ACTOR_ENV = "RADAR_APIFY_LINKEDIN_POSTS_ACTOR";
export const COMMENTS_ACTOR_ENV = "RADAR_APIFY_LINKEDIN_COMMENTS_ACTOR";
export const PEOPLE_ACTOR_ENV = "RADAR_APIFY_LINKEDIN_PEOPLE_ACTOR";

type EnvGetter = (name: string) => string | undefined;

function adapterStatus(envVar: string, getEnv: EnvGetter, apifyTokenPresent: boolean): AdapterStatus {
  const actor = (getEnv(envVar) ?? "").trim();
  if (!actor) return { configured: false, actor: null, env_var: envVar, reason: `${envVar} is not set — source not configured.` };
  if (!apifyTokenPresent) return { configured: false, actor, env_var: envVar, reason: "APIFY_API_TOKEN is not set." };
  return { configured: true, actor, env_var: envVar, reason: "configured" };
}

export function postsAdapterStatus(getEnv: EnvGetter, apifyTokenPresent: boolean): AdapterStatus {
  return adapterStatus(POSTS_ACTOR_ENV, getEnv, apifyTokenPresent);
}
export function commentsAdapterStatus(getEnv: EnvGetter, apifyTokenPresent: boolean): AdapterStatus {
  return adapterStatus(COMMENTS_ACTOR_ENV, getEnv, apifyTokenPresent);
}
export function peopleAdapterStatus(getEnv: EnvGetter, apifyTokenPresent: boolean): AdapterStatus {
  return adapterStatus(PEOPLE_ACTOR_ENV, getEnv, apifyTokenPresent);
}

// ---- normalized contracts (pure) ------------------------------------------
export interface NormalizedPost {
  author: string | null; author_role: string | null; author_company: string | null;
  text: string | null; post_url: string | null; published_at: string | null;
  reactions: number | null; comments: number | null; reposts: number | null;
  provider: string;
}
export interface NormalizedComment {
  commenter: string | null; commenter_role: string | null; commenter_company: string | null;
  commenter_profile_url: string | null; comment_text: string | null; comment_url: string | null;
  parent_post_text: string | null; parent_post_url: string | null; parent_author: string | null;
  published_at: string | null; provider: string;
}
export interface NormalizedPerson {
  name: string | null; role: string | null; company: string | null; profile_url: string | null; provider: string;
}

function s(v: unknown): string | null { const t = typeof v === "string" ? v.trim() : ""; return t || null; }
function n(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/** Normalize a raw actor post row. Engagement stays null unless the actor supplied
 * a real number — the UI must never call a post "viral" on a fabricated count. */
export function normalizePostRow(raw: Record<string, unknown>): NormalizedPost {
  return {
    author: s(raw["authorName"] ?? raw["author"] ?? raw["authorFullName"]),
    author_role: s(raw["authorHeadline"] ?? raw["authorTitle"] ?? raw["author_role"]),
    author_company: s(raw["authorCompany"] ?? raw["companyName"] ?? raw["author_company"]),
    text: s(raw["text"] ?? raw["postText"] ?? raw["content"]),
    post_url: s(raw["postUrl"] ?? raw["url"] ?? raw["postLink"]),
    published_at: s(raw["publishedAt"] ?? raw["postedAt"] ?? raw["date"]),
    reactions: n(raw["reactions"] ?? raw["numLikes"] ?? raw["likesCount"]),
    comments: n(raw["comments"] ?? raw["numComments"] ?? raw["commentsCount"]),
    reposts: n(raw["reposts"] ?? raw["numShares"] ?? raw["repostsCount"]),
    provider: "apify",
  };
}

export function normalizeCommentRow(raw: Record<string, unknown>): NormalizedComment {
  return {
    commenter: s(raw["commenterName"] ?? raw["authorName"] ?? raw["name"]),
    commenter_role: s(raw["commenterHeadline"] ?? raw["headline"]),
    commenter_company: s(raw["commenterCompany"] ?? raw["company"]),
    commenter_profile_url: s(raw["commenterProfileUrl"] ?? raw["profileUrl"] ?? raw["authorProfileUrl"]),
    comment_text: s(raw["commentText"] ?? raw["text"]),
    comment_url: s(raw["commentUrl"] ?? raw["url"]),
    parent_post_text: s(raw["parentPostText"] ?? raw["postText"]),
    parent_post_url: s(raw["parentPostUrl"] ?? raw["postUrl"]),
    parent_author: s(raw["parentAuthor"] ?? raw["postAuthor"]),
    published_at: s(raw["publishedAt"] ?? raw["date"]),
    provider: "apify",
  };
}

export function normalizePersonRow(raw: Record<string, unknown>): NormalizedPerson {
  return {
    name: s(raw["name"] ?? raw["fullName"]),
    role: s(raw["headline"] ?? raw["title"] ?? raw["role"]),
    company: s(raw["company"] ?? raw["companyName"]),
    profile_url: s(raw["profileUrl"] ?? raw["publicProfileUrl"] ?? raw["url"]),
    provider: "apify",
  };
}

// ---- fetch (only reachable when configured) --------------------------------
export interface ApifyRunInput { [k: string]: unknown; }

/** Generic Apify run-sync call. Callers MUST check adapterStatus.configured first;
 * this throws if actor/token are missing so a misconfigured call can't silently
 * fabricate. Never invoked in dev/tests. */
export async function runApifyActor(actor: string, token: string, input: ApifyRunInput, maxItems: number): Promise<Record<string, unknown>[]> {
  if (!actor || !token) throw new Error("adapter not configured");
  const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&limit=${Math.max(1, Math.min(maxItems, 50))}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`apify ${actor} ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
