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
read-only Buyer/Target application inventory preview; Application Rationalization
has a readiness-only Analyze action, License Optimizer shows the shared read-only
license inventory, and the other six business pages remain introductions. Live AI
remains disabled.

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
are not uploaded or saved and disappear on leaving the module/refresh. Manual
mapping and **Confirm Mapping** produce a **Mapping confirmed (draft only)** state.
A separate reviewed **Publish to demo session** action can replace that side's
shared applications in browser-tab session storage. Colliding IDs or orphaned
license/TSA links block publication; linked records are never repaired/deleted.
Source IDs/name/function are required; optional blanks become null; no IDs or
mappings are guessed. Meaningful publication increments the application source
revision; fixture dataset version remains 1.0.0. No-op publication changes nothing.
Run `npm run check:data-mapper`, `npm run check:csv-preview` and
`npm run check:column-mapping` and `npm run check:publish-applications` (all in `check:ci`).
See the [inventory contract](docs/contracts/U01.01_Sample_Inventory_View_Contract.md),
[CSV draft contract](docs/contracts/U01.02_CSV_Selection_Preview_Contract.md) and
[mapping contract](docs/contracts/U01.03_Column_Mapping_Validation_Contract.md) and
[publication contract](docs/contracts/U01.04_Published_Session_Dataset_Contract.md) and
[U01.04 validation](U01.04_VALIDATION.md).

## Read-only license inventory (U05.01 — in review)

License Optimizer displays current shared license positions from both Buyer and
Target, joined by exact application ID to the current application name/side. The
table shows source IDs, vendor/product, entitled quantity, estimated usage, annual
license spend in the deal currency, renewal date and full notes. Zero is known zero;
null/missing values say Unknown. All quantities and amounts are fictional, not
contract evidence or verified entitlements. No AI license analysis has run.
The view follows existing shared session edits, refresh/navigation and Reset; it
adds no editing, selection, analysis, optimization, export or cost-synergy behavior.
Run `npm run check:license-inventory` (also in `check:ci`). See the
[license view contract](docs/contracts/U05.01_License_Inventory_View_Contract.md) and
[validation](U05.01_VALIDATION.md). U05.02 owns future AI findings; U05.04 remains
blocked until U03.01.

## License LLM findings foundation (U05.02 — in review)

The server-only `licenses/v1` contract builds a frozen request from the current
shared session and validates model-authored findings, exact license/app joins,
evidence pointers, coverage, provenance and source freshness. The guarded router
is exercised only with fabricated offline test providers/store. No local license
recommendation or savings rules, public inference endpoint, result display,
review/selection or cost-synergy integration is added. The inventory still says
**No AI license analysis has run** and live AI stays disabled.
Run `npm run check:license-findings` (also in `check:ci`). See the
[license LLM contract](docs/contracts/U05.02_License_LLM_Findings_Contract.md) and
[validation](U05.02_VALIDATION.md), including the unverified 200-license narrative
capacity at the unchanged 2,048-token output cap and remaining activation gates.

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
AI feature. The public ALA readiness endpoint always rejects without invoking it;
live OpenAI dispatch remains
hard-blocked pending all model, durable-store, budget, ingress and release gates
in the U00.07 contract; the offline controls alone do not authorize live inference.
No API key is needed to run `npm run check:ai-adapter`.
See [the adapter contract](docs/contracts/U00.06_Server_AI_Adapter_Contract.md)
and [validation results](U00.06_VALIDATION.md).

## Application Rationalization contract (U02.01 — in review)

The server-only `ala/v1` contract builds requests from the current shared session,
validates structured multi-application findings/action destinations and checks
application references, sides and coverage. All overlap/disposition decisions remain
LLM-owned. The contract itself does not invoke models or store results; the
U02.02 readiness-only action below does not activate inference.
Run `npm run check:ala-contract` for synthetic offline contract/adapter tests
(also in `check:ci`). See [the ALA contract](docs/contracts/U02.01_ALA_LLM_Contract.md)
and [U02.01 validation](U02.01_VALIDATION.md), including current output-cap limits.

## Analyze applications readiness (U02.02 — in review)

Application Rationalization shows current shared counts/revision and one explicit
**Analyze applications** button. Today it checks availability only: a body-free
POST to `/api/ai/ala` always returns 503/no-store without reading a dataset or
invoking router/provider/store. No model label, fake finding or analysis grid is
displayed. Mount/reset/navigation never call AI. Source data is retained on errors.
The separate server-only orchestrator is tested through the guarded router with
fake providers/store only, preserving complete/incomplete coverage and source tokens.
Run `npm run check:ala-action` (also in `check:ci`). See the
[response contract](docs/contracts/U02.02_ALA_Analyze_Response_Contract.md) and
[validation](U02.02_VALIDATION.md). Live activation gates remain outstanding.

## Read-only rationalization results (U02.03 — in review)

A read-only presenter supports validated ALA findings/actions, exact Buyer/Target
IDs, captured evidence, rationales, qualitative uncertainty, coverage and provenance.
Its server boundary rechecks coverage and captured/current source digests; invalid
or outdated input yields no rows. Fabricated results exist only in offline tests.
The public page shows **No AI analysis has been run** and the existing readiness
action still returns 503; populated live result delivery remains blocked integration.
The original presenter stays read-only; temporary visitor overrides use the separate
layer below. Result storage and recommendation rules are not implemented; explicit
reviewed exports are described below.
Run `npm run check:ala-grid` (also in `check:ci`). See the
[grid contract](docs/contracts/U02.03_ALA_Results_Grid_Contract.md) and
[validation](U02.03_VALIDATION.md) for tests, limitations and activation gates.

## Temporary recommendation review (U02.04 — in review)

The isolated review workspace supports visitor disposition/destination overrides,
nonblank change justification, Cancel and Restore AI suggestion for a trusted
current/incomplete result. Original AI actions, evidence and provenance stay intact;
visitor changes are explicitly unapproved drafts. Overrides live only in mounted
component memory and disappear on refresh/navigation or result invalidation.
The public page still receives only an absent result: no populated recommendations
or review controls, no simulated analysis, and no live AI activation.
Run `npm run check:ala-review` (also in `check:ci`). See the
[review contract](docs/contracts/U02.04_ALA_Review_Overrides_Contract.md) and
[validation](U02.04_VALIDATION.md) for exact validation and pending integration/UAT.

## Reviewed results export (U02.05 — in review)

For a genuine trusted current/incomplete result, the review workspace can explicitly
download the latest saved local review draft as **JSON or CSV**. JSON is the lossless
`ala/review-export/v1` contract; CSV is a table view with provenance, coverage and
spreadsheet formula protection. Both preserve original AI recommendations separately
from effective visitor proposals and remain unapproved. Derived files are bounded to
1,000,000 UTF-8 bytes; oversized output fails without truncation.
The strict future-consumer reader retains original evidence/rationale/provenance and
incomplete status while exposing effective actions. No downstream module is wired.
The public page still has no trusted result to export and shows no download buttons.
Run `npm run check:ala-export` (also in `check:ci`). See the
[export contract](docs/contracts/U02.05_ALA_Reviewed_Export_Contract.md) and
[validation](U02.05_VALIDATION.md) for field/version semantics, CSV limitations and gates.

## AI budget and fallback foundation (U00.07 — in review)

The internal router now supports independently capped paid/fallback paths,
atomic reservation/settlement contracts, anonymous/global rate windows and
concurrency leases. Live dispatch remains disabled; the only public AI path is
the unconditional unavailable ALA readiness response.
The in-memory store is a deterministic test fake, not a production budget store.

Run `npm run check:ai-controls` and `npm run check:ai-adapter` for offline tests.
See [the control/routing contract](docs/contracts/U00.07_AI_Budget_Routing_Contract.md)
and [U00.07 validation](U00.07_VALIDATION.md) for remaining activation gates.

## Shared AI feedback (U00.08 — in review)

License Optimizer, Playbook Generator and AI Assistant retain static “AI not enabled”;
Application Rationalization has the readiness-only action above. A reusable read-only
notice supports loading, validated paid/fallback provenance, safe errors and
owner-supplied stale status for future modules. No live inference is enabled.
Run `npm run check:ai-ui` for offline presentation checks. See the
[UI state contract](docs/contracts/U00.08_AI_UI_State_Contract.md) and
[U00.08 validation](U00.08_VALIDATION.md).
