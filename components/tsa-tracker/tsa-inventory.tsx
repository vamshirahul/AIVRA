"use client";

import { useId } from "react";
import { useDemoSession } from "../demo-session-provider";
import type { DemoSession } from "../../lib/session/session";
import { TSA_COLUMNS, tsaInventoryRows, tsaInventoryCells } from "../../lib/tsa-tracker/tsa-inventory-view";

export function TSAInventory() {
  const { session, ready } = useDemoSession();
  return <TSAInventoryView session={session} ready={ready} />;
}

/** Stateless presentation; shared provider remains the only inventory owner. */
export function TSAInventoryView({ session, ready }: { session: DemoSession | null; ready: boolean }) {
  const id = useId();
  if (!ready) return <p className="inventory-loading" role="status">Preparing the shared TSA inventory...</p>;
  if (!session) return <p className="inventory-empty" role="status">The shared TSA inventory is unavailable. Reload the sample session to view services.</p>;
  const { rows, issues } = tsaInventoryRows(session.current_deal.tsa_services, session.current_deal.applications);
  return <section className="inventory-preview tsa-inventory" aria-label="TSA inventory">
    <p className="badge">Synthetic TSA inventory</p>
    <h2 className="section-title">Transition service inventory</h2>
    <p className="inventory-disclosure">Fictional transition services and dates — not contracted obligations, approved milestones or verified risk assessments. Status is supplied by the source; dates do not determine status.</p>
    <p className="inventory-boundary">Read-only view of the current shared session.</p>
    <p className="inventory-disclosure tsa-source-summary">{rows.length} TSA services displayed · Fixture dataset {session.fixture.dataset_version} · TSA source revision {session.input_revisions.tsa} · Application source revision {session.input_revisions.applications}</p>
    {issues.length > 0 && <div role="status" className="inventory-empty"><p>Some source records or application links could not be validated.</p><ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.row === null ? "Inventory" : `Source row ${issue.row}`}: {issue.message}</li>)}</ul></div>}
    {rows.length === 0 ? <p className="inventory-empty" role="status">{issues.length ? "No validated TSA services are available to display." : "No TSA services are present in the current session."}</p> : <>
      <p className="inventory-scroll-hint" id={`${id}-scroll`}>Scroll horizontally to view every source field. Focus the table region and use arrow keys to scroll. Unknown dates and values remain unknown.</p>
      <div className="inventory-scroll" role="region" aria-label="TSA inventory source fields" aria-describedby={`${id}-scroll`} tabIndex={0}>
        <table className="inventory-table tsa-inventory-table">
          <caption>Current shared TSA services · Source dates in YYYY-MM-DD · Source statuses · Synthetic data</caption>
          <thead><tr>{TSA_COLUMNS.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.service.tsa_id}>{tsaInventoryCells(row).map((value, index) => index === 0 ? <th key={TSA_COLUMNS[index]} scope="row">{value}</th> : <td key={TSA_COLUMNS[index]}>{value}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
