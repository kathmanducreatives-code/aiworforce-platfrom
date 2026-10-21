// Strict, bounded UTF-8 CSV syntax only. No inference, I/O, or executable cells.
export const CSV_LIMITS = {
  bytes: 250_000,
  rows: 25,
  columns: 40,
  cell: 2048,
} as const;
export class CsvRefusal extends Error {}
export function parsePilotCsv(
  input: string,
): { headers: string[]; rows: string[][] } {
  const fail = (code: string): never => {
    throw new CsvRefusal(code);
  };
  if (new TextEncoder().encode(input).length > CSV_LIMITS.bytes) {
    fail("csv_too_large");
  }
  const text = input.replace(/^\uFEFF/, "");
  const invalidControl = [...text].some((c) => {
    const n = c.codePointAt(0)!;
    return (n < 32 && ![9, 10, 13].includes(n)) || (n >= 127 && n <= 159);
  });
  if (
    !text || invalidControl ||
    /[\u202a-\u202e\u2066-\u2069\ufffd\uFEFF\ud800-\udfff]/u.test(text)
  ) fail("csv_invalid_characters");
  const records: string[][] = [];
  let record: string[] = [], value = "";
  let quoted = false, closed = false, started = false;
  const cell = () => {
    if (value.length > CSV_LIMITS.cell) fail("csv_cell_too_large");
    // Apply even to ignored columns: a later export must not execute a formula.
    if (/^[\s]*[=+\-@]/u.test(value)) fail("csv_unsafe_cell");
    record.push(value);
    value = "";
    closed = false;
    started = false;
    if (record.length > CSV_LIMITS.columns) fail("csv_too_many_columns");
  };
  const row = () => {
    cell();
    records.push(record);
    record = [];
    if (records.length > CSV_LIMITS.rows + 1) fail("csv_too_many_rows");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
    } else if (c === '"') {
      if (started || closed) fail("csv_invalid_quote");
      quoted = true;
      started = true;
    } else if (c === ",") cell();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[++i] !== "\n") fail("csv_invalid_newline");
      row();
    } else {
      if (closed) fail("csv_after_quote");
      value += c;
      started = true;
    }
    if (value.length > CSV_LIMITS.cell) fail("csv_cell_too_large");
  }
  if (quoted) fail("csv_unclosed_quote");
  if (started || closed || record.length) row();
  if (records.length < 2) fail("csv_no_records");
  const headers = records.shift()!.map((h) => h.trim());
  if (
    headers.some((h) => !h || h.length > 128 || /[\r\n\t]/.test(h)) ||
    new Set(headers.map((h) => h.toLowerCase())).size !== headers.length
  ) fail("csv_invalid_headers");
  // Client/workspace/internal ownership cannot come from an export, even ignored.
  if (
    headers.some((h) =>
      /(^|[^a-z])(workspace|client|tenant|user|owner|task|credential|destination|binding|internal)([^a-z]|$)/i
        .test(h.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    )
  ) fail("csv_ownership_column");
  const compactScope =
    /^(workspace|client|tenant|user|owner|task|credential|destination|binding|internal)(id|name|key|scope|ref)$/i;
  if (headers.some((h) => compactScope.test(h.replace(/[^a-z0-9]/gi, "")))) {
    fail("csv_ownership_column");
  }
  if (
    records.some((r) =>
      r.length !== headers.length || r.every((v) => !v.trim())
    )
  ) fail("csv_invalid_row");
  return { headers, rows: records };
}
