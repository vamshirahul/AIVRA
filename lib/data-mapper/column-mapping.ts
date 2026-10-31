import { ApplicationSchema } from "../contracts/demo.ts";
import type { Application } from "../contracts/demo.ts";
import { INVENTORY_COLUMNS } from "./inventory-view.ts";
import { csvDraftReducer, initialCSVDrafts, MAX_CSV_ROWS } from "./parse-csv.ts";
import type { CSVDrafts, CSVDraftAction, CSVSide, CSVResult } from "./parse-csv.ts";

export type MappingField = typeof INVENTORY_COLUMNS[number][0];
export type ColumnSelections = Record<MappingField, number | null>;
export type CSVSource = Extract<CSVResult, { ok: true }>;
export const REQUIRED_MAPPING_FIELDS: readonly MappingField[] = ["app_id", "app_name", "function"];
export const MAPPING_VERSION = "u01.03/v1" as const;
export const MAPPING_MESSAGES = {
  invalid_source: "Select a valid bounded CSV before mapping.", empty_rows: "At least one data row is required to confirm mapping.",
  required_mapping: "Select a source column for this required field.", invalid_column: "Select an existing source column by its position.",
  reused_column: "A source column can be assigned to only one application field.", unknown_field: "Only the listed application fields can be mapped.",
  required_value: "A nonblank value is required.", invalid_id: "Provide a nonempty opaque ID without whitespace; IDs are not trimmed or generated.",
  duplicate_id: "This application ID repeats an earlier data row in this candidate.",
  invalid_cost: "Use a finite, losslessly representable plain nonnegative decimal amount, without currency symbols or separators.",
  invalid_enum: "Use one of the canonical values listed for this field.", text_too_long: "Notes must contain at most 500 characters after trimming.",
  invalid_value: "The value does not meet the application field contract.",
} as const;
export type MappingIssue = { row: number | null; field: MappingField | "mapping"; code: keyof typeof MAPPING_MESSAGES };
export type MappingValidation = { valid: boolean; rows: Application[]; issues: MappingIssue[]; total_issues: number };
export const emptySelections = (): ColumnSelections => Object.fromEntries(INVENTORY_COLUMNS.map(([field]) => [field, null])) as ColumnSelections;

function canonicalDecimal(text: string) { return text.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); }
function expandedNumber(value: number): string {
  const [mantissa, exponent] = String(value).split("e");
  if (!exponent) return mantissa;
  const digits = mantissa.replace(".", "");
  const point = (mantissa.includes(".") ? mantissa.indexOf(".") : mantissa.length) + Number(exponent);
  return point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
}
function costValue(raw: string): number | string {
  const amount = Number(raw);
  return /^\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(amount) && canonicalDecimal(raw) === canonicalDecimal(expandedNumber(amount)) ? amount : raw;
}
export function validateColumnMapping(source: CSVSource, side: CSVSide, mappings: ColumnSelections): MappingValidation {
  const issues: MappingIssue[] = []; let total_issues = 0;
  const add = (field: MappingIssue["field"], code: MappingIssue["code"], row: number | null = null) => { total_issues++; if (issues.length < 40) issues.push({ field, code, row }); };
  const result = (rows: Application[] = []): MappingValidation => ({ valid: total_issues === 0, rows: total_issues === 0 ? rows : [], issues, total_issues });
  if (!source?.ok || !source.headers.length || source.rows.length > MAX_CSV_ROWS || source.rows.length !== source.row_count || source.rows.some((row) => row.length !== source.headers.length)) { add("mapping", "invalid_source"); return result(); }
  if (source.rows.length === 0) add("mapping", "empty_rows");
  const known = new Set(INVENTORY_COLUMNS.map(([field]) => field));
  if (Object.keys(mappings).some((field) => !known.has(field as MappingField))) add("mapping", "unknown_field");
  const used = new Set<number>();
  for (const [field] of INVENTORY_COLUMNS) {
    const index = mappings[field];
    if (index === null) { if (REQUIRED_MAPPING_FIELDS.includes(field)) add(field, "required_mapping"); continue; }
    if (!Number.isInteger(index) || index < 0 || index >= source.headers.length) { add(field, "invalid_column"); continue; }
    if (used.has(index)) add(field, "reused_column");
    used.add(index);
  }
  if (total_issues) return result();
  const ids = new Set<string>(); const rows: Application[] = [];
  source.rows.forEach((raw, rowIndex) => {
    const candidate: Record<string, unknown> = { company_side: side };
    for (const [field] of INVENTORY_COLUMNS) {
      const index = mappings[field];
      const cell = index === null ? "" : raw[index];
      if (field === "app_id") candidate[field] = cell;
      else {
        const trimmed = cell.trim();
        if (!trimmed && !REQUIRED_MAPPING_FIELDS.includes(field)) candidate[field] = null;
        else if (field === "annual_cost") candidate[field] = costValue(trimmed);
        else if (["criticality", "deployment", "lifecycle"].includes(field)) candidate[field] = trimmed.toLowerCase();
        else candidate[field] = trimmed;
      }
    }
    if (ApplicationSchema.shape.app_id.safeParse(candidate.app_id).success) {
      const id = candidate.app_id as string;
      if (ids.has(id)) add("app_id", "duplicate_id", rowIndex + 1); ids.add(id);
    }
    const checked = ApplicationSchema.safeParse(candidate);
    if (checked.success) rows.push(checked.data);
    else {
    const reported = new Set<string>();
    for (const issue of checked.error.issues) {
      const field = issue.path[0] as MappingField;
      if (reported.has(field)) continue;
      reported.add(field);
      const code = field === "app_id" ? "invalid_id" : field === "annual_cost" ? "invalid_cost"
        : ["criticality", "deployment", "lifecycle"].includes(field) ? "invalid_enum"
        : field === "notes" && issue.code === "too_big" ? "text_too_long" : REQUIRED_MAPPING_FIELDS.includes(field) ? "required_value" : "invalid_value";
      add(known.has(field) ? field : "mapping", code, rowIndex + 1);
    }
    }
  });
  return result(rows);
}

export type ConfirmedMapping = { status: "confirmed_draft"; validation_version: typeof MAPPING_VERSION; side: CSVSide;
  source_generation: number; mapping_revision: number; file_name: string; file_size_bytes: number; mappings: ColumnSelections; rows: Application[] };
export type MappingDraft = { source_generation: number; revision: number; mappings: ColumnSelections; confirmed: ConfirmedMapping | null };
export type MappingState = { csv: CSVDrafts; mapping: Record<CSVSide, MappingDraft | null> };
export const initialMappingState: MappingState = { csv: initialCSVDrafts, mapping: { buyer: null, target: null } };
export type MappingAction = { type: "csv"; action: CSVDraftAction }
  | { type: "map"; side: CSVSide; generation: number; field: MappingField; index: number | null }
  | { type: "confirm"; side: CSVSide; generation: number; revision: number };
export function columnMappingReducer(state: MappingState, action: MappingAction): MappingState {
  if (action.type === "csv") {
    const csv = csvDraftReducer(state.csv, action.action);
    if (csv === state.csv) return state;
    const side = action.action.side, source = csv[side];
    return { csv, mapping: { ...state.mapping, [side]: source.status === "ready"
      ? { source_generation: source.generation, revision: 0, mappings: emptySelections(), confirmed: null } : null } };
  }
  const source = state.csv[action.side], draft = state.mapping[action.side];
  if (source.status !== "ready" || !draft || source.generation !== action.generation || draft.source_generation !== source.generation) return state;
  if (action.type === "map") {
    if (!INVENTORY_COLUMNS.some(([field]) => field === action.field) || draft.mappings[action.field] === action.index) return state;
    return { ...state, mapping: { ...state.mapping, [action.side]: { ...draft, revision: draft.revision + 1, mappings: { ...draft.mappings, [action.field]: action.index }, confirmed: null } } };
  }
  if (draft.revision !== action.revision) return state;
  const validation = validateColumnMapping(source.preview, action.side, draft.mappings);
  const confirmed: ConfirmedMapping | null = validation.valid ? { status: "confirmed_draft", validation_version: MAPPING_VERSION,
    side: action.side, source_generation: source.generation, mapping_revision: draft.revision, file_name: source.preview.file_name,
    file_size_bytes: source.preview.file_size_bytes, mappings: { ...draft.mappings }, rows: validation.rows } : null;
  return { ...state, mapping: { ...state.mapping, [action.side]: { ...draft, confirmed } } };
}
