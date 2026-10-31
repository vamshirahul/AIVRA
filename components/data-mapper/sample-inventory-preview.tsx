"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useDemoSession } from "../demo-session-provider";
import { INVENTORY_COLUMNS, inventoryForSide, inventoryValue } from "../../lib/data-mapper/inventory-view";
import type { InventorySide } from "../../lib/data-mapper/inventory-view";
import { CSVPreview } from "./csv-preview";

const sides = ["buyer", "target"] as const;
export function SampleInventoryPreview() {
  const { session, ready } = useDemoSession();
  const [selected, setSelected] = useState<InventorySide>("buyer");
  const id = useId();
  const tabs = useRef<Partial<Record<InventorySide, HTMLButtonElement | null>>>({});
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, side: InventorySide) {
    const next = event.key === "Home" ? "buyer" : event.key === "End" ? "target"
      : event.key === "ArrowLeft" || event.key === "ArrowRight" ? (side === "buyer" ? "target" : "buyer") : null;
    if (next) { event.preventDefault(); setSelected(next); tabs.current[next]?.focus(); }
  }
  if (!ready || !session) return <p className="inventory-loading" role="status">Preparing the shared sample inventory...</p>;
  const deal = session.current_deal;
  return (
    <section className="inventory-preview" aria-label="Sample application inventories">
      <p className="badge">Sample inventory preview available</p>
      <h2 className="section-title">Buyer and Target applications</h2>
      <p className="inventory-disclosure">Synthetic example data · Dataset {deal.dataset_version} · Read-only source preview</p>
      <p className="inventory-boundary">Preview and map local CSV drafts below. Mapping confirmation is draft only; dataset publication is coming later. No import or AI analysis has been run.</p>
      <div className="inventory-tabs" role="tablist" aria-label="Application inventory side">
        {sides.map((side) => <button key={side} type="button" role="tab" id={`${id}-${side}-tab`} aria-controls={`${id}-${side}-panel`}
          aria-selected={selected === side} tabIndex={selected === side ? 0 : -1}
          ref={(node) => { tabs.current[side] = node; }} onClick={() => setSelected(side)} onKeyDown={(event) => onTabKey(event, side)}>
          <span>{side === "buyer" ? "Buyer" : "Target"}: {side === "buyer" ? deal.buyer_name : deal.target_name}</span>
          <span>{inventoryForSide(deal.applications, side).length} applications{selected === side ? " · Selected" : ""}</span>
        </button>)}
      </div>
      <h3 className="section-title">Sample inventory (current shared session)</h3>
      {sides.map((side) => {
        const applications = inventoryForSide(deal.applications, side);
        const title = side === "buyer" ? "Buyer" : "Target";
        return <div key={side} role="tabpanel" id={`${id}-${side}-panel`} aria-labelledby={`${id}-${side}-tab`} hidden={selected !== side}>
          {selected === side && (applications.length === 0 ? <p className="inventory-empty">No {title} applications are available in the current session.</p> : <>
            <p id={`${id}-scroll-hint`} className="inventory-scroll-hint">Scroll horizontally to view all source fields. The table can be focused and scrolled with the arrow keys.</p>
            <div className="inventory-scroll" role="region" aria-label={`${title} application source fields`} aria-describedby={`${id}-scroll-hint`} tabIndex={0}>
              <table className="inventory-table">
                <caption>{title} applications · {side === "buyer" ? deal.buyer_name : deal.target_name} · Annual costs in {deal.currency}</caption>
                <thead><tr>{INVENTORY_COLUMNS.map(([field, label]) => <th key={field} scope="col">{label}</th>)}</tr></thead>
                <tbody>{applications.map((app) => <tr key={app.app_id}>
                  {INVENTORY_COLUMNS.map(([field]) => field === "app_id" ? <th key={field} scope="row">{app.app_id}</th>
                    : <td key={field}>{inventoryValue(app, field, deal.currency)}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
          </>)}
        </div>;
      })}
      <CSVPreview selected={selected} currency={deal.currency} />
    </section>
  );
}
