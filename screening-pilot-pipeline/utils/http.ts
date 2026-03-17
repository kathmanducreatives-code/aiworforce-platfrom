export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${bodyText.slice(0, 500)}`);
  }

  if (!bodyText) {
    return {} as T;
  }

  return JSON.parse(bodyText) as T;
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function parseJsonFromText<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("[") >= 0 ? trimmed.indexOf("[") : trimmed.indexOf("{");
    const endBracket = trimmed.lastIndexOf("]");
    const endBrace = trimmed.lastIndexOf("}");
    const end = Math.max(endBracket, endBrace);

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }

    throw new Error("Could not parse JSON from model response");
  }
}
