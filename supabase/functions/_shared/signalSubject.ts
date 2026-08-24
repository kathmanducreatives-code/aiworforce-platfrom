// WHAT A PIECE OF EVIDENCE IS ABOUT, when it is not about a lead entity.
//
// `signal_events` is shared by Leads, Signals and later Content. A Lead event
// is about a contact, an account or a candidate. A Signals event is often about
// none of those: a competitor's public activity, or a discussion of the problem
// space. Those had no way to be stored, and the available shortcut — attaching
// them to some account — would have fabricated attribution and dropped
// competitor news into prospect signal queries.
//
// ── NOT THE MONITORING SUBJECT ───────────────────────────────────────────────
//
// An EVENT subject is what evidence is about. A MONITORING subject (Phase 3) is
// what a workspace has asked Agentory to watch. They are different things and
// deliberately different tables: a scan can produce evidence about a competitor
// nobody asked to track, and a tracked company can produce no evidence at all.
// Collapsing them would mean a workspace could only ever see evidence about
// things it had already named.

export const SUBJECT_TYPES = [
  /** A named competitor company. */
  "competitor",
  /** A named company that is not a lead entity in this workspace. */
  "company",
  /** A category, topic or problem space rather than an organisation. */
  "market",
] as const;

export type SubjectType = typeof SUBJECT_TYPES[number];

export const SUBJECT_TYPE_SET: ReadonlySet<string> = new Set(SUBJECT_TYPES);

export function isSubjectType(value: unknown): value is SubjectType {
  return typeof value === "string" && SUBJECT_TYPE_SET.has(value);
}

/** Mirrors `signal_events_subject_key_canonical`. */
export const SUBJECT_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Longer than any real company or topic name that carries meaning. */
export const SUBJECT_KEY_MAX_LENGTH = 80;

/**
 * The stable key for a subject name.
 *
 * Canonical because dedupe depends on it: "Outreach", "outreach.io" and
 * "Outreach " must be one subject across scans, not three. Deliberately lossy
 * and deterministic — the display name belongs in `normalized_value`, this is
 * an identity.
 *
 * Returns null when nothing usable survives, which the caller must treat as
 * "no subject" rather than substituting a placeholder: a row keyed on
 * `unknown` would merge every unidentifiable subject into one.
 */
export function canonicalSubjectKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw
    .normalize("NFKD")
    // strip combining marks so accented spellings collapse onto the plain one
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SUBJECT_KEY_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  return SUBJECT_KEY_PATTERN.test(slug) ? slug : null;
}

export interface SignalSubject {
  subject_type: SubjectType;
  subject_key: string;
}

/** A complete subject, or null. Never a half-built one — the pair is all-or-nothing. */
export function buildSignalSubject(
  type: unknown, name: string | null | undefined,
): SignalSubject | null {
  if (!isSubjectType(type)) return null;
  const key = canonicalSubjectKey(name);
  return key ? { subject_type: type, subject_key: key } : null;
}
