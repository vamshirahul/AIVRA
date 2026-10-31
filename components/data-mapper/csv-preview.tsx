"use client";

import { useEffect, useId, useReducer, useRef } from "react";
import { CSV_ERRORS, readCSVFile } from "../../lib/data-mapper/parse-csv";
import type { CSVSide } from "../../lib/data-mapper/parse-csv";
import { columnMappingReducer, initialMappingState } from "../../lib/data-mapper/column-mapping";
import { ColumnMapping } from "./column-mapping";

export function CSVPreview({ selected, currency }: { selected: CSVSide; currency: string }) {
  const [state, dispatch] = useReducer(columnMappingReducer, initialMappingState);
  const drafts = state.csv;
  const id = useId();
  const generation = useRef(0);
  const mounted = useRef(false);
  const inputs = useRef<Partial<Record<CSVSide, HTMLInputElement | null>>>({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  async function choose(side: CSVSide, file: File | undefined) {
    if (!file) return; // Canceling the native picker leaves the draft intact.
    const ticket = ++generation.current;
    dispatch({ type: "csv", action: { type: "begin", side, generation: ticket } });
    const result = await readCSVFile(file);
    if (mounted.current) dispatch({ type: "csv", action: { type: "complete", side, generation: ticket, result } });
  }
  function clear(side: CSVSide) {
    dispatch({ type: "csv", action: { type: "clear", side, generation: ++generation.current } });
    if (inputs.current[side]) inputs.current[side]!.value = "";
  }
  return <div className="csv-preview">
    {(["buyer", "target"] as const).map((side) => {
      const title = side === "buyer" ? "Buyer" : "Target";
      const draft = drafts[side];
      const mapping = state.mapping[side];
      return <section key={side} hidden={selected !== side} aria-labelledby={`${id}-${side}-title`}>
        <h3 id={`${id}-${side}-title`} className="section-title">Selected CSV preview (not yet imported) · {title}</h3>
        <p id={`${id}-${side}-privacy`}>For this public preview, select synthetic/test data only. Do not select confidential transaction information. CSV contents are parsed in this browser and are not uploaded to AIVRA servers.</p>
        <p id={`${id}-${side}-limits`}>One .csv file · UTF-8 · Up to 500,000 bytes (500 KB) and 50 data rows. Drafts are temporary and are discarded when you leave this module or refresh.</p>
        <label className="csv-file-label" htmlFor={`${id}-${side}-file`}>Choose {title} CSV</label>
        <input id={`${id}-${side}-file`} type="file" accept=".csv,text/csv" aria-describedby={`${id}-${side}-privacy ${id}-${side}-limits`}
          ref={(node) => { inputs.current[side] = node; }} onChange={(event) => { void choose(side, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        {draft.status !== "not_selected" && <button className="button button-secondary csv-clear" type="button" onClick={() => clear(side)}>Clear {title} CSV</button>}
        {draft.status === "not_selected" && <p>No {title} CSV selected.</p>}
        {draft.status === "reading" && <p role="status" aria-live="polite">Reading CSV...</p>}
        {draft.status === "error" && <p className="csv-error" role="alert">{title} CSV: {draft.error.row === undefined ? "" : draft.error.row === 0 ? "Header: " : `Data row ${draft.error.row}: `}{CSV_ERRORS[draft.error.code]}</p>}
        {draft.status === "ready" && <>
          <p className="csv-metadata">{title} · {draft.preview.file_name} · {draft.preview.file_size_bytes} bytes · {draft.preview.row_count} data rows</p>
          <p id={`${id}-${side}-scroll`}>Scroll horizontally to view all original source columns. Empty cells are preserved.</p>
          <div className="inventory-scroll csv-scroll" role="region" aria-label={`${title} selected CSV source preview`} aria-describedby={`${id}-${side}-scroll`} tabIndex={0}>
            <table className="inventory-table csv-table"><caption>{title} selected CSV · Original headers and values · Not imported</caption>
              <thead><tr>{draft.preview.headers.map((header, index) => <th scope="col" key={index}>{header}</th>)}</tr></thead>
              <tbody>{draft.preview.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {mapping && <ColumnMapping key={`${side}-${draft.generation}`} side={side} source={draft.preview} draft={mapping} currency={currency}
            onMap={(field, index) => dispatch({ type: "map", side, generation: draft.generation, field, index })}
            onConfirm={() => dispatch({ type: "confirm", side, generation: draft.generation, revision: mapping.revision })} />}
        </>}
        <p className="csv-boundary">CSV and mapping drafts only. Not imported/published. Selecting a file or confirming mapping does not update the shared deal or run AI. Dataset publication belongs to U01.04.</p>
      </section>;
    })}
  </div>;
}
