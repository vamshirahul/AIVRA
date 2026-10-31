"use client";

import { useId, useMemo } from "react";
import { INVENTORY_COLUMNS, inventoryValue } from "../../lib/data-mapper/inventory-view";
import { MAPPING_MESSAGES, REQUIRED_MAPPING_FIELDS, validateColumnMapping } from "../../lib/data-mapper/column-mapping";
import type { CSVSource, MappingDraft, MappingField } from "../../lib/data-mapper/column-mapping";
import type { CSVSide } from "../../lib/data-mapper/parse-csv";

const fieldHelp: Partial<Record<MappingField, string>> = {
  app_id: "Required source ID; no whitespace, trimming or generated IDs.",
  annual_cost: "Plain nonnegative decimal only; blank means unknown, zero remains zero. No symbols or grouping.",
  criticality: "low, medium, high, critical", deployment: "cloud, on_premise, hybrid", lifecycle: "active, legacy, retiring",
  notes: "Optional text; maximum 500 characters after trimming.",
};
export function ColumnMapping({ side, source, draft, currency, onMap, onConfirm }: {
  side: CSVSide; source: CSVSource; draft: MappingDraft; currency: string;
  onMap: (field: MappingField, index: number | null) => void; onConfirm: () => void;
}) {
  const id = useId();
  const validation = useMemo(() => validateColumnMapping(source, side, draft.mappings), [source, side, draft.mappings]);
  const title = side === "buyer" ? "Buyer" : "Target";
  return <div className="column-mapping">
    <h4 className="section-title">Map CSV columns to application fields</h4>
    <p id={`${id}-help`}>Map {title} columns manually by position. Each source column can be used once. Optional unmapped fields become null. Not imported/published.</p>
    <div className="mapping-fields">
      {INVENTORY_COLUMNS.map(([field, label]) => {
        const issues = validation.issues.filter((issue) => issue.field === field);
        return <div key={field} className="mapping-field">
          <label htmlFor={`${id}-${field}`}>{label} ({field}) · {REQUIRED_MAPPING_FIELDS.includes(field) ? "Required" : "Optional"}</label>
          <select id={`${id}-${field}`} data-mapping-field={field} value={draft.mappings[field] ?? ""}
            aria-describedby={`${id}-help ${id}-${field}-help ${id}-issues`} aria-invalid={issues.length > 0}
            onChange={(event) => onMap(field, event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}>
            <option value="">Not mapped</option>
            {source.headers.map((header, index) => <option key={index} value={index}
              disabled={INVENTORY_COLUMNS.some(([other]) => other !== field && draft.mappings[other] === index)}>
              Column {index + 1}: {header}
            </option>)}
          </select>
          <p id={`${id}-${field}-help`}>{fieldHelp[field] ?? "Text is trimmed; optional blank values become null."}</p>
        </div>;
      })}
    </div>
    <div id={`${id}-issues`} className="mapping-validation">
      <p role="status" aria-live="polite">{validation.valid ? `${validation.rows.length} candidate rows pass mapping validation. Not imported/published.` : `${validation.total_issues} mapping or row issues prevent confirmation.`}</p>
      {validation.issues.length > 0 && <ul>{validation.issues.map((issue, index) => <li key={index}>
        {issue.row === null ? "Mapping" : `Data row ${issue.row}`} · {issue.field}: {MAPPING_MESSAGES[issue.code]}
      </li>)}</ul>}
      {validation.total_issues > validation.issues.length && <p>Showing the first {validation.issues.length} of {validation.total_issues} issues.</p>}
    </div>
    {validation.valid && <div className="inventory-scroll mapping-scroll" role="region" aria-label={`${title} proposed normalized data`} tabIndex={0}>
      <table className="inventory-table"><caption>Proposed normalized data — not imported · {title} · Annual costs in {currency}</caption>
        <thead><tr>{INVENTORY_COLUMNS.map(([field, label]) => <th key={field} scope="col">{label}</th>)}</tr></thead>
        <tbody>{validation.rows.map((row) => <tr key={row.app_id}>{INVENTORY_COLUMNS.map(([field]) => field === "app_id"
          ? <th key={field} scope="row">{row.app_id}</th> : <td key={field}>{inventoryValue(row, field, currency)}</td>)}</tr>)}</tbody>
      </table>
    </div>}
    <button type="button" className="button button-primary mapping-confirm" disabled={!validation.valid} aria-describedby={`${id}-issues ${id}-boundary`} onClick={onConfirm}>Confirm Mapping</button>
    {draft.confirmed && <p className="mapping-confirmed" role="status">Mapping confirmed (draft only) · {title}. Not imported/published.</p>}
    <p id={`${id}-boundary`}>Confirmation is temporary mapping/row validation only. It does not update the shared inventory or enable AI. Publication and linked-record integrity checks belong to U01.04. Changing a mapping or file clears this side's confirmation.</p>
  </div>;
}
