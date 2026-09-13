// Draft delivery survives a closed composer. This bus never submits work.
let pending: string | null = null;
let listener: ((text: string) => void) | null = null;
export function prepareChatDraft(text: string) {
  if (listener) listener(text);
  else pending = text;
}
export function subscribeChatDraft(fn: (text: string) => void) {
  listener = fn;
  if (pending !== null) { const text = pending; pending = null; fn(text); }
  return () => { if (listener === fn) listener = null; };
}
