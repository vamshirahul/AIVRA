"use client";

import { useId } from "react";
import { useDemoSession } from "../demo-session-provider";
import { LICENSE_COLUMNS, licenseInventoryCells, licenseInventoryRows } from "../../lib/license-optimizer/license-inventory-view";

export function LicenseInventory() {
  const { session, ready } = useDemoSession();
  const id = useId();
  if (!ready) return <p className="inventory-loading" role="status">Preparing the shared license inventory...</p>;
  if (!session) return <p className="inventory-empty" role="status">The shared license inventory is unavailable.</p>;
  const deal = session.current_deal;
  const rows = licenseInventoryRows(deal.license_positions, deal.applications);
  return <section className="inventory-preview license-inventory" aria-label="License inventory">
    <p className="badge">Synthetic license inventory available</p>
    <h2 className="section-title">License inventory</h2>
    <p className="inventory-disclosure">Synthetic/fictional quantities and amounts only — not contract evidence or verified entitlements. Estimated usage is a source observation, not independently verified utilization.</p>
    <p className="inventory-boundary">No AI license analysis has run. AI-based license opportunity analysis is planned for a later release. This inventory is read-only; no savings or legal conclusions are calculated.</p>
    <p className="inventory-disclosure license-source-summary">{rows.length} license positions · Currency {deal.currency} · Fixture dataset {session.fixture.dataset_version} · License source revision {session.input_revisions.licenses} · Application source revision {session.input_revisions.applications}</p>
    {rows.length === 0 ? <p className="inventory-empty">No license positions are available in the current session.</p> : <>
      <p className="inventory-scroll-hint" id={`${id}-scroll-hint`}>Scroll horizontally to view all license source fields. Focus the table region and use arrow keys to scroll. Unknown values are not zero.</p>
      <div className="inventory-scroll" role="region" aria-label="License inventory source fields" aria-describedby={`${id}-scroll-hint`} tabIndex={0}>
        <table className="inventory-table license-inventory-table">
          <caption>Current shared license positions · Annual license spend in {deal.currency} · Synthetic data</caption>
          <thead><tr>{LICENSE_COLUMNS.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.license.license_id}>
            {licenseInventoryCells(row, deal.currency).map((value, index) => index === 0 ? <th key={LICENSE_COLUMNS[index]} scope="row">{value}</th> : <td key={LICENSE_COLUMNS[index]}>{value}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
