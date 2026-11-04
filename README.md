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
license inventory, TSA Tracker shows current linked synthetic services, and Cost
Synergy and Scenario Modeling have readiness workspaces.
Integration Health shows current TSA source counts; its other sections and the
Playbook/Assistant pages remain introductions. Live AI
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
[validation](U05.01_VALIDATION.md). Server-only findings and the advisory CSE
handoff are described below; public license analysis remains disabled.

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

## Provisional license review (U05.03 — in review)

A server-only projection revalidates license findings, captured evidence,
coverage, provenance and current source identity before temporary visitor review.
The isolated review component supports **Selected for further review — unapproved**,
**Not selected**, and **Clear selection / restore unreviewed**. Choices live only
in mounted component memory, separately from unchanged original AI findings.
Shared license references and overlapping selections remain explicit; no financial
totals, automatic conflict resolution, exports or CSE integration are provided.
The public page continues to show only the real inventory and AI-disabled notice:
there is no trusted populated-result delivery or live AI path yet.
Run `npm run check:license-review` (also in `check:ci`). See the
[review contract](docs/contracts/U05.03_License_Review_Selection_Contract.md) and
[validation](U05.03_VALIDATION.md) for state/identity rules, SSR versus public-browser
evidence, and remaining live-delivery/quality gates. Numeric license aggregation
remains gated separately.

## Cost Synergy calculation foundation (U03.01 — in review)

The separate [Cost Synergy calculation contract](docs/contracts/U03.01_CSE_Calculation_Contract.md)
provides `cse/calculation/v1` pure arithmetic from explicit included assumptions:
annual savings, once-only migration/transition costs and an undiscounted whole-year
net benefit. It uses exact integer CAD cents, preserves unknowns and original AI
recommendations, and withholds overlapping whole-application spend claims.
Run `npm run check:cse-calculation` (also in `check:ci`); see
[U03.01 validation](U03.01_VALIDATION.md). The public CSE screen remains an
honest no-analysis state. Editable estimates are supported only with a protected
current reviewed context (see U03.02 below); guarded downloads are described in U03.03.
Selected-license advisory
data uses the separate handoff below. Numeric license contributions remain disabled.

## Editable Cost Synergy workspace (U03.02 — in review)

Cost Synergy now has an A1 Coastal Navy readiness screen and an internal editor
for a protected, current reviewed ALA context. Visitors can explicitly include
actions and enter exact CAD assumptions/basis notes and a whole-year horizon;
Calculate/Recalculate uses unchanged `cse/calculation/v1`, retaining unknowns,
coverage warnings and double-count safeguards. Inputs, previous/current estimates
and original AI/visitor layers stay separate; financial drafts exist only in memory
and clear on source/review change, navigation or refresh. No automatic savings.
The public page still has **no validated ALA analysis** and shows no populated
editor or simulated result. Live AI and numeric license aggregation remain disabled.
Run `npm run check:cse-editor` (also in `check:ci`). See the
[editor contract](docs/contracts/U03.02_CSE_Editable_Estimate_Contract.md) and
[validation/browser evidence](U03.02_VALIDATION.md). Saved scenarios remain future.

## Cost Synergy estimate downloads (U03.03 — in review)

For a protected current calculated estimate, secondary **Download estimate JSON**
and **Download estimate CSV** actions preserve exact CAD cents, assumptions,
inclusions/exclusions, source/review identity, original AI versus visitor layers,
coverage, warnings and nulls. The versioned `cse/estimate-export/v1` artifact uses
unchanged `cse/calculation/v1` arithmetic. Incomplete estimates stay explicitly
incomplete; invalid/not-computable estimates have no download. Every edit revokes
export until recalculation; stale/reset results and previous snapshots cannot export.
Files are bounded to 1,500,000 UTF-8 bytes; CSV includes formula protection.
The public page still has no trusted result or download buttons. No live AI, saved
scenarios, database or new dependencies. Run `npm run check:cse-export` (also in
`check:ci`). See the [export contract](docs/contracts/U03.03_CSE_Estimate_Export_Contract.md)
and [validation evidence](U03.03_VALIDATION.md).

## One alternative scenario (U11.01 — in review)

An internal protected workspace can explicitly clone current reviewed ALA actions
and validated CSE assumptions into an immutable baseline and exactly one editable
alternative. Scenario-only disposition/destination hypotheses and financial inputs,
notes, inclusion and horizon stay separate from original AI advice, existing visitor
overrides and baseline data. Existing ALA/CSE validation is reused; source/review/
baseline changes clear the transient scenario. Nothing persists or calls AI.
The real public page has **no validated reviewed ALA/CSE baseline** and shows only
readiness links. Protected live-result/current-draft delivery remains unavailable.
The comparison below uses explicit visitor financial inputs; U11.03 adds protected
provenance and exports. Run `npm run check:scenario-baseline` (also in `check:ci`).
See the [scenario contract](docs/contracts/U11.01_Scenario_Baseline_Alternative_Contract.md)
and [validation/browser evidence](U11.01_VALIDATION.md).

## Scenario financial comparison (U11.02 — in review)

For a protected current scenario, **Compare scenarios** calculates both sides with
the unchanged CSE engine and shows exact signed CAD-cent differences. Disposition
hypotheses remain separate: changing a label never generates savings. Missing values
stay unknown and mismatched/unknown horizons withhold period savings/net differences.
Edits hide old comparisons; unsaved forms must be saved/restored before comparing.
The actual public page still has no trusted baseline or populated comparison.
No new AI, persistence or dependency. Run `npm run check:scenario-comparison`
(also in `check:ci`). See the [comparison contract](docs/contracts/U11.02_Scenario_Comparison_Contract.md)
and [validation evidence](U11.02_VALIDATION.md).

## Scenario provenance and export (U11.03 — in review)

A protected, explicitly compared current scenario shows original model/source/review
provenance and evidence separately from baseline visitor overrides and alternative
hypotheses. Download **JSON or CSV** preserves both scenarios, original CSE results,
exact cents, assumptions, nulls, coverage, conflicts, exclusions and limitations.
Every raw edit, failed/successful Save, restore/reset, failed Compare or source change
revokes download until a new successful Compare. Invalid/not-computable/unauthorized
results cannot download. Files are bounded to 1,500,000 UTF-8 bytes; CSV protects
formula-like text and retains detailed evidence in typed JSON-bearing rows.
The public page remains readiness-only with no trusted baseline, simulated result
or export controls. No new AI, dependency, persistence or deployment. Run
`npm run check:scenario-export` (also in `check:ci`). See the
[export contract](docs/contracts/U11.03_Scenario_Provenance_Export_Contract.md) and
[validation evidence](U11.03_VALIDATION.md).

## TSA service inventory (U07.01 — in review)

`/tsa-tracker` displays the current shared synthetic TSA records with stable IDs,
service/provider/recipient/owner, exact ISO dates, source statuses, exit milestones,
risk notes and linked application IDs, Buyer/Target sides and current names.
Unknown fields stay unknown; omitted relationship information differs from an empty
link list. The accessible table scrolls within its region on smaller screens.
U07.02 below adds session interactions; U07.03 adds source exports and TSA counts.
No date-derived risk, AI, new dependencies or new persistence. Run `npm run check:tsa-inventory`
(also in `check:ci`). Optional Chromium: `node scripts/check-demo-session-browser.mjs
--tsa-browser` with `AIVRA_CHROMIUM_PATH` and local `AIVRA_BASE_URL`.
See the [view contract](docs/contracts/U07.01_TSA_Inventory_View_Contract.md) and
[validation evidence](U07.01_VALIDATION.md).

## TSA session creation, editing and filtering (U07.02 — in review)

Add TSA implements approved **TSA-CREATE-001**: a generated `tsa-${crypto.randomUUID()}`
identity, required title/provider/recipient/explicit status, optional source fields
and current application references, complete source/session validation and one atomic
append/revision advance. Unknown relationship information differs from recorded empty
links. Existing-record editing covers status, owner, dates, milestone and risk notes;
IDs, title/provider/recipient and existing relationships remain read-only.
Save checks the latest source and rejects stale drafts; Cancel/no-op Save preserve
source/revisions. Reset discards drafts and restores the sample. Status filters are
temporary and do not mutate records. Date/milestone attention compares known ISO
dates to the displayed UTC reference, without thresholds, risk inference or status
transitions. Existing browser storage failures retain memory-only work with a notice.
U07.03 below adds exports and TSA dashboard counts. No deletion, live AI or new dependencies. Run
`npm run check:tsa-edit` (also in `check:ci`), and optional Chromium
`node scripts/check-demo-session-browser.mjs --tsa-edit-browser`.
See the [U07.02 contract](docs/contracts/U07.02_TSA_Edit_Status_Filter_Contract.md)
and [validation evidence](U07.02_VALIDATION.md).

## TSA summary exports and Integration Health counts (U07.03 — in review)

Download the **entire saved TSA inventory as CSV or JSON**, independent of the status
filter. Exact source fields/IDs/statuses/dates/nulls/relationship distinctions and
current linked app names/sides are retained, with session/source revisions and a
synthetic/unapproved disclosure. Open Add/Edit drafts disable downloads. Every click
reads and validates the latest controller snapshot and rechecks it before dispatch;
invalid, changed or over-limit sources produce no partial file. Both complete files
are bounded to 512,000 UTF-8 bytes; CSV protects formula-like text.
`/integration-health` displays Total, Planned, Active, At Risk and Completed from all
current saved records. Counts follow creation/status changes and Reset; unavailable
source is not zero. Broader health metrics remain planned, with no derived-result
registration, score, predicted risk, live AI or new persistence/dependencies.
Run `npm run check:tsa-export-health` (also in `check:ci`); optional Chromium:
`node scripts/check-demo-session-browser.mjs --tsa-export-browser`.
See the [U07.03 contract](docs/contracts/U07.03_TSA_Export_Integration_Health_Contract.md)
and [validation evidence](U07.03_VALIDATION.md).

## Selected license advisory handoff (U05.04 — in review)

`licenses/cse-handoff/v1` carries only explicitly selected provisional findings,
unchanged original AI content, the separate visitor selection snapshot, exact
source cost evidence and application spend ownership. Optional current CSE ALA
claims can be compared through the existing whole-spend guard. Repeated license
or application ownership remains visible and withheld; no savings are inferred,
summed or inserted into `cse/calculation/v1`. Unknown and zero remain distinct.
The current-source consumer gate rechecks result/review/source and comparison;
the structural reader alone is not authentication or freshness verification.
No public result delivery, UI, API, export or storage is added. Run
`npm run check:license-cse-handoff` (also in `check:ci`). See the
[handoff contract](docs/contracts/U05.04_License_CSE_Handoff_Contract.md) and
[validation](U05.04_VALIDATION.md). Financial assumptions/allocation and enabling
license aggregation require separate approval; existing CSE arithmetic is unchanged.

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
