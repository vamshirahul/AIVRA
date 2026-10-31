# AIVRA
M&amp;A / Divestiture Activity Helper

## Local development

Use Node.js 24.22.1 (supported engine: 24.22.1 or newer within major 24) and npm 11.19.1.
The verified environment is Node.js 24.22.1 and npm 11.19.1;
`.nvmrc` records the tested Node version. Install from the repository root:

```sh
npm ci
npm run dev
```

Open <http://localhost:3000> to see **AIVRA Public Preview**. No sign-in,
environment variables, API keys, or external services are required.
Stop the server with Ctrl+C.

Run the shared offline checks (includes TypeScript and one production build):

```sh
npm run check:ci
npm start
```

On Windows PowerShell, use `npm.cmd` in place of `npm` if execution policy
blocks `npm.ps1`. Development and production servers use the same default
port, so stop one before starting the other.

The current A1 Coastal Navy workspace includes shared synthetic session data and
offline AI foundations. Lint is not configured. Dependency versions are pinned in
`package.json` and `package-lock.json`; use `npm ci` to reproduce them.
The PR/main Foundation CI job runs the same checks without browser tooling,
credentials, AISFA, live AI or deployment. For telemetry settings, fresh-clone
setup, optional independent browser checks, troubleshooting and CI logs, see
[Local development and CI](docs/development/U00.09_Local_Development_and_CI.md).

## Shared synthetic data (U00.02)

Run `npm run validate:fixture` to check the shared Zod contracts, fictional
Northstar/Meridian dataset, record links, and deliberately invalid cases.
See [the shared demo data contract](docs/contracts/U00.02_Shared_Demo_Data_Contract.md)
for field definitions, versions, null handling, and future module import paths.

## Responsive workspace (U00.03)

The current UI uses the founder-approved **A1 Coastal Navy** theme (ADR-011).
Home shows counts from the shared fictional session. Data Mapper now offers a
read-only Buyer/Target application inventory preview; the other eight module
pages retain explicit **not yet implemented** introductions. AI remains disabled.

| Group | Page | Route |
| --- | --- | --- |
| Overview | Home | `/` |
| Overview | Integration Health Dashboard | `/integration-health` |
| Prepare | Data Mapper Engine | `/data-mapper` |
| Analyze | Application Rationalization | `/application-rationalization` |
| Analyze | License Optimizer | `/license-optimizer` |
| Model | Cost Synergy Estimator | `/cost-synergy` |
| Model | Scenario / What-if Modeling | `/scenario-modeling` |
| Execute | Playbook Generator | `/playbook-generator` |
| Execute | TSA Tracker | `/tsa-tracker` |
| Ask AIVRA | AI M&A Assistant | `/ai-assistant` |

Below 1024px, **Open menu** expands the same navigation in the page flow.
Enter/Space toggles it; Escape closes it and returns focus to the toggle.
Selecting a destination closes it. The first keyboard stop skips to main content.

See [U00.03 validation and screenshots](U00.03_VALIDATION.md) for design tokens,
focused browser checks, evidence, and manual review steps.

The sidebar also displays seven **Future Features**, each marked **Planned**.
These are static icons and labels, with no links, keyboard stops or functionality.

Data Mapper tabs show current session source fields and stable IDs, with a
keyboard-accessible scrollable table. Independent Buyer/Target CSV drafts now
parse locally for preview only: UTF-8 `.csv`, at most 500,000 bytes and 50 data rows.
Select synthetic/test data only; no confidential transaction information. Drafts
are not uploaded or saved, do not change the shared deal, and disappear on leaving
the module/refresh. Manual column mapping, schema validation and **Confirm Mapping**
now produce a **Mapping confirmed (draft only)** state. **Not imported/published**:
shared inventory publication remains exclusively U01.04. Source IDs/name/function
are required; optional blanks become null; no IDs or mappings are guessed.
Run `npm run check:data-mapper`, `npm run check:csv-preview` and
`npm run check:column-mapping` (all in `check:ci`).
See the [inventory contract](docs/contracts/U01.01_Sample_Inventory_View_Contract.md),
[CSV draft contract](docs/contracts/U01.02_CSV_Selection_Preview_Contract.md) and
[mapping contract](docs/contracts/U01.03_Column_Mapping_Validation_Contract.md) and
[U01.03 validation](U01.03_VALIDATION.md).

## Browser demo session (U00.05)

The current synthetic deal is shared across routes and saved in this tab's
`sessionStorage`. Same-tab refresh restores validated edits. A normal new tab has
its own session; duplicated/opener tabs may start with a copied snapshot under
browser rules. This is temporary browser storage, not secure confidential-data
storage. Use fictional data only.

**Reset demo session** asks for inline confirmation. **Cancel** keeps the current
data; **Confirm reset** restores the original example and clears analysis metadata.
If browser storage is unavailable, the session continues in memory with a notice
that changes may be lost on refresh. Invalid saved data recovers to the original
example with a recovery notice. Home names/counts now follow the current session.

Run `node scripts/check-demo-session.mts` for focused state/persistence checks.
See [the session contract](docs/contracts/U00.05_Browser_Session_Contract.md) for
typed update/freshness APIs and [validation evidence](U00.05_VALIDATION.md) for
browser commands and limitations.

## Internal AI adapter (U00.06)

The server-only AI SDK adapter is an offline-testable foundation, not an enabled
AI feature. There are no public AI endpoints; live OpenAI dispatch remains
hard-blocked pending all model, durable-store, budget, ingress and release gates
in the U00.07 contract; the offline controls alone do not authorize live inference.
No API key is needed to run `npm run check:ai-adapter`.
See [the adapter contract](docs/contracts/U00.06_Server_AI_Adapter_Contract.md)
and [validation results](U00.06_VALIDATION.md).

## AI budget and fallback foundation (U00.07 — in review)

The internal router now supports independently capped paid/fallback paths,
atomic reservation/settlement contracts, anonymous/global rate windows and
concurrency leases. Live dispatch remains disabled, and no public AI API exists.
The in-memory store is a deterministic test fake, not a production budget store.

Run `npm run check:ai-controls` and `npm run check:ai-adapter` for offline tests.
See [the control/routing contract](docs/contracts/U00.07_AI_Budget_Routing_Contract.md)
and [U00.07 validation](U00.07_VALIDATION.md) for remaining activation gates.

## Shared AI feedback (U00.08 — in review)

The four AI-intended introductions show “AI not enabled.” A reusable read-only
notice supports loading, validated paid/fallback provenance, safe errors and
owner-supplied stale status for future modules. No AI action or endpoint is enabled.
Run `npm run check:ai-ui` for offline presentation checks. See the
[UI state contract](docs/contracts/U00.08_AI_UI_State_Contract.md) and
[U00.08 validation](U00.08_VALIDATION.md).
