// IMAGE GENERATION, BEHIND AN INTERFACE.
//
// ── WHY AN INTERFACE FOR ONE IMPLEMENTATION ─────────────────────────────────
//
// Content depends on `ImageGenerationProvider`, not on OpenAI. The same rule
// `aiProvider` already follows for text, where `generateText` hides two
// transports behind one call and the caller never names either. Hard-coding
// `api.openai.com` through the Content path would mean a second provider is a
// Content rewrite rather than one more implementation of this.
//
// ── ACCOUNTING IS NOT OPTIONAL ──────────────────────────────────────────────
//
// `onImageCall` is the same seam shape as `onModelCall`. Four separate times a
// provider call in this codebase reported nothing because the seam existed and
// nothing was passed to it — aiProvider, leadStrategy, chat-respond, and
// run-agent's generic path. An image is the most expensive single call Content
// can make, so it reports before it is allowed to be convenient.
//
// ── AND THE PRICE IS NOT INVENTED ───────────────────────────────────────────
//
// GPT image models bill by token, and the images response reports the tokens.
// So an image is priced the way a text call is: the provider's own counts times
// OpenAI's published per-class rates (`IMAGE_MODEL_PRICES`, sourced and dated),
// recorded as `event_priced`. That is what makes it count toward the spend
// ceiling — which sums `estimated_cost_usd` — instead of sitting in the ledger
// as `unknown` while the most expensive call Content makes went uncounted.
// (Production, 2026-09-11: two gpt-image-1 calls, both `null / unknown`.)
//
// Order of evidence, never a guess:
//   1. reported usage x published rate           -> event_priced
//   2. no usage, `OPENAI_IMAGE_USD_PER_IMAGE` set -> event_priced at that rate
//   3. neither                                    -> unknown — never free

import type { ModelCallTelemetry } from "./modelCostModel.ts";
import {
  MODEL_COST_MODEL_VERSION, priceImageCall, readImageUsage, type ImageModelUsage,
} from "./modelCostModel.ts";

export const IMAGE_PROVIDER_VERSION = "image-provider-v1" as const;

export const OPENAI_IMAGE_MODEL_ENV = "OPENAI_IMAGE_MODEL";
export const OPENAI_IMAGE_PRICE_ENV = "OPENAI_IMAGE_USD_PER_IMAGE";

/** OpenAI's current image model. Overridable, because model names move. */
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

export interface ImageGenerationRequest {
  prompt: string;
  size?: ImageSize;
  /** Attribution for the ledger. Never sent to the provider. */
  workspaceId: string;
  taskId?: string | null;
}

export interface ImageCallTelemetry {
  provider: string;
  model: string;
  images: number;
  latency_ms: number;
  size: string;
  /** As the provider reported them. Null when it reported none — NOT zero. */
  input_tokens: number | null;
  output_tokens: number | null;
  /** From usage x published rate, else a configured per-image price, else null. NOT zero. */
  estimated_cost_usd: number | null;
  cost_source: "event_priced" | "unknown";
  failure_code: string | null;
}

export interface ImageGenerationResult {
  ok: boolean;
  /** Raw bytes. The caller persists them; this never touches storage. */
  bytes: Uint8Array | null;
  contentType: string;
  width: number | null;
  height: number | null;
  provider: string;
  model: string;
  /** The provider's own URL, kept as provenance only — these expire. */
  sourceUrl: string | null;
  error: string | null;
  errorCode: string | null;
}

export interface ImageProviderDeps {
  /** Reports every attempt, success or failure. A failed call was still paid for. */
  onImageCall?: (telemetry: ImageCallTelemetry, ok: boolean) => void;
  fetchImpl?: typeof fetch;
  readEnv?: (key: string) => string | undefined;
}

export interface ImageGenerationProvider {
  readonly name: string;
  available(): boolean;
  generate(req: ImageGenerationRequest, deps?: ImageProviderDeps): Promise<ImageGenerationResult>;
}

function env(deps: ImageProviderDeps | undefined, key: string): string | undefined {
  const read = deps?.readEnv
    ?? ((k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
      .Deno?.env.get(k));
  return read(key);
}

/** A finite positive price, or null. Zero is not a price — it is a claim of free. */
export function resolveImagePrice(read?: (k: string) => string | undefined): number | null {
  const r = read ?? ((k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(k));
  const n = Number(String(r(OPENAI_IMAGE_PRICE_ENV) ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const OPENAI_IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";

/**
 * OpenAI's own message and code out of its error envelope — "You have no
 * credits remaining… (credit_balance_exhausted)" rather than a JSON blob. The
 * raw text, trimmed, when the body is not that envelope.
 */
export function providerErrorMessage(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { message?: unknown; code?: unknown; type?: unknown } }).error;
    const msg = typeof e?.message === "string" ? e.message.trim() : "";
    const code = typeof e?.code === "string" ? e.code : typeof e?.type === "string" ? e.type : "";
    if (msg) return code ? `${msg} (${code})` : msg;
  } catch { /* not JSON */ }
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * OpenAI images. The first implementation, not the contract.
 *
 * Returns BYTES, never a URL, because the provider's URLs expire and a Content
 * asset that pointed at one would become a dead link on its own schedule.
 * `b64_json` is requested for exactly that reason.
 */
export function createOpenAIImageProvider(): ImageGenerationProvider {
  return {
    name: "openai",

    available(): boolean {
      return !!env(undefined, "OPENAI_API_KEY");
    },

    async generate(
      req: ImageGenerationRequest,
      deps: ImageProviderDeps = {},
    ): Promise<ImageGenerationResult> {
      const key = env(deps, "OPENAI_API_KEY");
      const model = env(deps, OPENAI_IMAGE_MODEL_ENV) || DEFAULT_IMAGE_MODEL;
      const size: ImageSize = req.size ?? "1024x1024";
      const started = Date.now();
      const price = resolveImagePrice(deps.readEnv);

      const report = (ok: boolean, failure: string | null, usage?: ImageModelUsage) => {
        // A FAILED CALL IS NOT A FREE CALL when it reached the provider — but
        // it produced no image and no counts, so there is nothing to price.
        // Unknown, never zero: the distinction `priceModelCall` and
        // `priceFirecrawlCall` both draw, for the same reason.
        const byUsage = ok && usage ? priceImageCall({ model, usage }) : null;
        const cost: number | null = byUsage && byUsage.source === "event_priced"
          ? byUsage.estimated_usd ?? null
          : ok && price !== null ? Number(price.toFixed(6)) : null;
        deps.onImageCall?.({
          provider: "openai",
          model,
          images: ok ? 1 : 0,
          latency_ms: Date.now() - started,
          size,
          input_tokens: usage?.input_tokens ?? null,
          output_tokens: usage?.output_tokens ?? null,
          estimated_cost_usd: cost,
          cost_source: cost !== null ? "event_priced" : "unknown",
          failure_code: failure,
        }, ok);
      };

      if (!key) {
        report(false, "not_configured");
        return {
          ok: false, bytes: null, contentType: "image/png", width: null, height: null,
          provider: "openai", model, sourceUrl: null,
          error: "OPENAI_API_KEY is not configured", errorCode: "not_configured",
        };
      }

      const doFetch = deps.fetchImpl ?? fetch;
      try {
        const res = await doFetch(OPENAI_IMAGES_ENDPOINT, {
          method: "POST",
          headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: req.prompt, size, n: 1 }),
        });

        if (!res.ok) {
          const body = (await res.text()).slice(0, 600);
          report(false, `http_${res.status}`);
          return {
            ok: false, bytes: null, contentType: "image/png", width: null, height: null,
            provider: "openai", model, sourceUrl: null,
            // The provider's message is kept: an image model refuses for
            // content-policy reasons often enough that "it failed" is useless.
            // Its OWN words, not its JSON envelope — this reaches a person.
            error: `OpenAI images ${res.status}: ${providerErrorMessage(body)}`, errorCode: `http_${res.status}`,
          };
        }

        const json = await res.json() as {
          data?: Array<{ b64_json?: string; url?: string }>;
          usage?: Record<string, unknown>;
        };
        // THE PROVIDER'S OWN COUNTS — read before anything else can fail, so a
        // call that returned usage but no image is still accounted for.
        const usage = readImageUsage(json);
        const first = json?.data?.[0];
        const b64 = first?.b64_json;
        if (!b64) {
          report(false, "no_image_returned", usage);
          return {
            ok: false, bytes: null, contentType: "image/png", width: null, height: null,
            provider: "openai", model, sourceUrl: first?.url ?? null,
            error: "provider returned no image data", errorCode: "no_image_returned",
          };
        }

        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const [w, h] = size.split("x").map((n) => Number(n));
        report(true, null, usage);
        return {
          ok: true, bytes: bin, contentType: "image/png",
          width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null,
          provider: "openai", model, sourceUrl: first?.url ?? null,
          error: null, errorCode: null,
        };
      } catch (e) {
        report(false, "network_error");
        return {
          ok: false, bytes: null, contentType: "image/png", width: null, height: null,
          provider: "openai", model, sourceUrl: null,
          error: `image fetch failed: ${String(e).slice(0, 200)}`, errorCode: "network_error",
        };
      }
    },
  };
}

/**
 * The configured provider.
 *
 * One place decides, server-side. The frontend asks for an image; it never
 * names a provider, a model or a size, and no key is ever within its reach.
 */
export function resolveImageProvider(): ImageGenerationProvider {
  return createOpenAIImageProvider();
}

// ── AN IMAGE CALL IS A MODEL CALL ───────────────────────────────────────────
//
// The first version of `generate-content-image` wrote its own `insert` into
// `lead_execution_calls`. It omitted `reason`, which is NOT NULL with no
// default, so both production canary rows were rejected and the failure was
// visible only as a `console.warn`. The ledger had a canonical writer the whole
// time; going around it is what lost the rows.
//
// Routing through `recordModelCall` puts image spend in `lead_model_calls` —
// the view every model-spend query and the USD ceiling already read — instead
// of a second, private accounting of the most expensive call Content can make.
//
// TOKEN COUNTS ARE WHAT THE PROVIDER REPORTED. GPT image models bill by token
// and return the counts, so they go on the row like any model call's. A
// response without usage leaves them null — `ExecutionCounts`' rule: null
// means unknown, and zero would claim a call that consumed nothing.

/** The routing role images occupy. Never the model's name. */
export const IMAGE_MODEL_ROLE = "content_visual" as const;

export function imageTelemetryToModelTelemetry(t: ImageCallTelemetry): ModelCallTelemetry {
  return {
    version: MODEL_COST_MODEL_VERSION,
    role: IMAGE_MODEL_ROLE,
    model: t.model,
    // Images take no effort parameter, and `size` is not one — it is recorded
    // on the ledger row's own metadata instead of being disguised as one.
    reasoning_effort: null,
    input_tokens: t.input_tokens,
    cached_input_tokens: null,
    output_tokens: t.output_tokens,
    estimated_cost_usd: t.estimated_cost_usd,
    // Never set: OpenAI reports no charge on the images endpoint, and the
    // database refuses `actual_cost_usd` from anything but `provider_reported`.
    actual_cost_usd: null,
    cost_source: t.cost_source,
    latency_ms: t.latency_ms,
    fallback_reason: null,
  };
}
