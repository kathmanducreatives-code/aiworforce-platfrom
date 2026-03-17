import { parseJsonFromText } from "./http.js";

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
}

export async function askClaudeJson<T>(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  if (!params.apiKey) {
    throw new Error("ANTHROPIC_API_KEY missing: required for Claude-powered extraction/generation.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 1200,
      system: `${params.system}\nReturn only valid JSON. No prose.`,
      messages: [{ role: "user", content: params.user }]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic error ${response.status}: ${text.slice(0, 500)}`);
  }

  const json = JSON.parse(text) as AnthropicMessageResponse;
  const contentText = json.content?.map(c => c.text || "").join("\n") || "";
  return parseJsonFromText<T>(contentText);
}

export async function askClaudeText(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  if (!params.apiKey) {
    throw new Error("ANTHROPIC_API_KEY missing: required for message generation.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 700,
      system: params.system,
      messages: [{ role: "user", content: params.user }]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic error ${response.status}: ${text.slice(0, 500)}`);
  }

  const parsed = JSON.parse(text) as AnthropicMessageResponse;
  return (parsed.content || []).map(c => c.text || "").join("\n").trim();
}
