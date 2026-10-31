// Browser-safe draft parsing only: no normalization, application IDs or session writes.
export const MAX_CSV_BYTES = 500_000;
export const MAX_CSV_ROWS = 50;
export type CSVSide = "buyer" | "target";
export const CSV_ERRORS = {
  invalid_file: "Select one file with a .csv filename extension.",
  too_large: "The file exceeds 500,000 bytes (500 KB).",
  empty_file: "The CSV file is empty.",
  read_failed: "The selected file could not be read safely. Select it again.",
  invalid_utf8: "Use valid UTF-8 CSV text without NUL characters; other encodings are unsupported.",
  missing_header: "Provide a header row with a nonblank name for every column.",
  malformed_quotes: "CSV quoting is invalid. Quote whole fields and escape quotes by doubling them.",
  wrong_width: "The number of fields differs from the header row.",
  too_many_rows: "The CSV exceeds 50 data rows. No rows were imported.",
} as const;
export type CSVError = { code: keyof typeof CSV_ERRORS; row?: number };
export type CSVResult =
  | { ok: true; file_name: string; file_size_bytes: number; headers: string[]; rows: string[][]; row_count: number }
  | { ok: false; error: CSVError };
const failure = (code: CSVError["code"], row?: number): CSVResult => ({ ok: false, error: { code, ...(row === undefined ? {} : { row }) } });
function fileGuard(name: string, size: number): CSVResult | null {
  if (!/^[^\\/\0\r\n]+\.csv$/i.test(name)) return failure("invalid_file");
  if (!Number.isSafeInteger(size) || size < 0) return failure("read_failed");
  if (size > MAX_CSV_BYTES) return failure("too_large");
  if (size === 0) return failure("empty_file");
  return null;
}

export function parseCSVBytes(name: string, bytes: Uint8Array): CSVResult {
  const guarded = fileGuard(name, bytes.byteLength); if (guarded) return guarded;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return failure("invalid_utf8"); }
  if (text.includes("\0")) return failure("invalid_utf8");
  let headers: string[] | undefined;
  const rows: string[][] = [];
  let fields: string[] = [], cell = "", state: "start" | "plain" | "quoted" | "closed" = "start", touched = false;
  const rowNumber = () => headers ? rows.length + 1 : 0;
  function finish(): CSVResult | null {
    // Ignore only truly empty, unquoted physical lines. Delimiters, spaces and "" count.
    if (!touched && fields.length === 0 && cell === "") return null;
    fields.push(cell);
    if (!headers) {
      if (fields.some((header) => header.trim() === "")) return failure("missing_header", 0);
      headers = fields;
    } else {
      if (rows.length >= MAX_CSV_ROWS) return failure("too_many_rows", rows.length + 1);
      if (fields.length !== headers.length) return failure("wrong_width", rows.length + 1);
      rows.push(fields);
    }
    fields = []; cell = ""; state = "start"; touched = false;
    return null;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else state = "closed";
      } else cell += char;
      continue;
    }
    if (char === ",") { fields.push(cell); cell = ""; state = "start"; touched = true; continue; }
    if (char === "\n" || char === "\r") {
      const error = finish(); if (error) return error;
      if (char === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    if (state === "closed") return failure("malformed_quotes", rowNumber());
    if (char === '"') {
      if (state !== "start") return failure("malformed_quotes", rowNumber());
      state = "quoted"; touched = true;
    } else { cell += char; state = "plain"; touched = true; }
  }
  if (state === "quoted") return failure("malformed_quotes", rowNumber());
  const error = finish(); if (error) return error;
  if (!headers) return failure("missing_header", 0);
  return { ok: true, file_name: name.length > 120 ? `${name.slice(0, 117)}...` : name,
    file_size_bytes: bytes.byteLength, headers, rows, row_count: rows.length };
}

export async function readCSVFile(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<CSVResult> {
  const guarded = fileGuard(file.name, file.size); if (guarded) return guarded;
  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_CSV_BYTES) return failure("too_large");
    if (buffer.byteLength !== file.size) return failure("read_failed");
    return parseCSVBytes(file.name, new Uint8Array(buffer));
  } catch { return failure("read_failed"); }
}

export type CSVDraft = { side: CSVSide; generation: number } & (
  | { status: "not_selected" | "reading" }
  | { status: "ready"; preview: Extract<CSVResult, { ok: true }> }
  | { status: "error"; error: CSVError }
);
export type CSVDrafts = Record<CSVSide, CSVDraft>;
export const initialCSVDrafts: CSVDrafts = {
  buyer: { side: "buyer", generation: 0, status: "not_selected" },
  target: { side: "target", generation: 0, status: "not_selected" },
};
export type CSVDraftAction = { side: CSVSide; generation: number } & (
  | { type: "begin" | "clear" }
  | { type: "complete"; result: CSVResult }
);
export function csvDraftReducer(state: CSVDrafts, action: CSVDraftAction): CSVDrafts {
  const previous = state[action.side];
  if (action.type === "complete") {
    if (previous.generation !== action.generation || previous.status !== "reading") return state;
    const next: CSVDraft = action.result.ok
      ? { side: action.side, generation: action.generation, status: "ready", preview: action.result }
      : { side: action.side, generation: action.generation, status: "error", error: action.result.error };
    return { ...state, [action.side]: next };
  }
  if (action.generation <= previous.generation) return state;
  return { ...state, [action.side]: { side: action.side, generation: action.generation, status: action.type === "begin" ? "reading" : "not_selected" } };
}
