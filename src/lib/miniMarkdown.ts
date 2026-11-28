// A small, safe Markdown subset for chat bubbles (Signals recovery, Phase 4): the executive brief
// and LISA's answers are written in Markdown and used to show as raw "##" and "**". Parsed into
// blocks and inline runs; the renderer builds React elements (never HTML strings). Pure.
export type Inline = { text: string; bold: boolean };
export type Block =
  | { type: "h"; level: 1 | 2 | 3; inline: Inline[] }
  | { type: "p"; inline: Inline[] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; items: Inline[][] };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false });
  return out.length ? out : [{ text: "", bold: false }];
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ type: "p", inline: parseInline(para.join(" ")) }); para = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) { flush(); continue; }
    if (h) { flush(); blocks.push({ type: "h", level: h[1].length as 1 | 2 | 3, inline: parseInline(h[2]) }); continue; }
    if (ul || ol) {
      flush();
      const type = ul ? "ul" : "ol";
      const item = parseInline((ul ?? ol)![1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === type) prev.items.push(item); else blocks.push({ type, items: [item] } as Block);
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/** Only text that actually uses Markdown is rendered as Markdown; anything else stays as written. */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)#{1,3}\s|\*\*[^*]+\*\*|(^|\n)\s*([-*•]|\d+[.)])\s+\S/.test(String(text ?? ""));
}
