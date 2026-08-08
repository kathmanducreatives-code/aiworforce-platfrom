// THE ONE MODEL ID EVERY LEAD-INTELLIGENCE BINDING DEFAULTS TO.
//
// ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────
// Five bindings (mission compiler, grounded brain, semantic classification,
// pool evaluation, multi-round) each pinned their own literal `"gpt-5.6-luna"`.
// That is the OpenAI *wire* id. The strategist adapters gate on the CANONICAL
// id — `allowedModels()` reads the configured `LEAD_STRATEGIST_*` models, which
// are vendor-prefixed (`openai/gpt-5.6-luna`). Every one of those bindings was
// therefore rejected with `model_not_allowed` inside
// `LovableAIStrategistProvider.complete` BEFORE any request was sent, and each
// binding's fail-closed wrapper reported that as "no proposal". The features
// looked enabled — flag on, allow-list matched, credential present, diagnostics
// saying `enabled` — and silently never called a model at all.
//
// ── THE INVARIANT ────────────────────────────────────────────────────────────
// This is deliberately NOT another literal. It resolves to the SAME configured
// primary model the adapter builds its allow-list from, so
//
//     allowedModels(CONFIG).includes(DEFAULT_LEAD_INTELLIGENCE_MODEL)
//
// holds BY CONSTRUCTION — including when `LEAD_STRATEGIST_PRIMARY_MODEL` is
// overridden, which a copied literal would silently fail to follow. Prefix
// drift cannot come back without changing the adapter's own source of truth.
//
// A binding may still override via its own `*_MODEL` env var. That is a
// deliberate operator choice, and `leadIntelligenceModelIds.test.ts` asserts an
// operator cannot pick something the adapter would reject either.

import { LEAD_STRATEGY_PRIMARY_MODEL } from "./leadStrategyModels.ts";

/**
 * Default model for every lead-intelligence binding.
 *
 * Canonical (vendor-prefixed) by construction. Never hardcode a model id in a
 * binding — import this instead.
 */
export const DEFAULT_LEAD_INTELLIGENCE_MODEL: string = LEAD_STRATEGY_PRIMARY_MODEL;
