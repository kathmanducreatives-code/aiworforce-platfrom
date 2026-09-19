// A PROVIDER THE MISSION CANNOT USE IS REFUSED ONCE, NOT ONCE PER SLICE.
//
// Canaries c584fd77, d7012ba5 and c0aa06be each asked the tool layer for the
// company-employees actor on every continuation slice and were refused every
// time (`apify_actor_disabled_by_default`, $0). The refusal is deterministic —
// the actor is opt-in and this deployment has not opted in — so asking again
// learns nothing. The engine forgot because the "unavailable" flag was a local
// variable that died with the slice.
//
// The refusal is now recorded on the execution state, which every checkpoint
// carries, so later slices know the capability is unavailable FOR THIS MISSION
// and do not call it. The evidence gap stays explicit ("first-hire proof
// unavailable"); a refusal never becomes a fake success.
//
// WHEN IT MAY BE TRIED AGAIN. Only when something that could change the answer
// changed:
//   - the actor's Actor Intelligence readiness is no longer what it was at the
//     refusal (the code-owned record of what a provider can do was updated), or
//   - an operator explicitly asks, via LEAD_V2_RETRY_UNAVAILABLE_PROVIDERS
//     ("1"/"all", or a comma-separated list of provider keys).
//
// Pure.

export const RETRY_UNAVAILABLE_PROVIDERS_ENV = "LEAD_V2_RETRY_UNAVAILABLE_PROVIDERS";

export interface UnavailableProvider {
  provider: string;
  capability: string;
  /** The refusal as the tool layer stated it. */
  reason: string;
  refused_at: string;
  /** Actor Intelligence readiness when refused — a change re-opens the question. */
  readiness_at_refusal: string;
}

/** Record a deterministic refusal. One entry per provider; the first refusal is kept. */
export function markProviderUnavailable(
  list: readonly UnavailableProvider[] | undefined, rec: UnavailableProvider,
): UnavailableProvider[] {
  const current = [...(list ?? [])];
  return current.some((x) => x.provider === rec.provider) ? current : [...current, rec];
}

/**
 * The recorded refusal, when it still stands for this mission. Null means the
 * provider may be called.
 */
export function unavailableProvider(
  list: readonly UnavailableProvider[] | undefined, provider: string, currentReadiness: string,
  readEnv: (k: string) => string | undefined = () => undefined,
): UnavailableProvider | null {
  const rec = (list ?? []).find((x) => x.provider === provider);
  if (!rec) return null;
  if (rec.readiness_at_refusal !== currentReadiness) return null;
  const retry = String(readEnv(RETRY_UNAVAILABLE_PROVIDERS_ENV) ?? "").trim().toLowerCase();
  if (retry === "1" || retry === "all" || retry.split(",").map((s) => s.trim()).includes(provider.toLowerCase())) {
    return null;
  }
  return rec;
}
