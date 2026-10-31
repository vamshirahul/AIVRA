# AIVRA
M&amp;A / Divestiture Activity Helper

## Local development (U00.01)

Use Node.js 24 LTS (24.22.1 or newer within major 24) and npm 11.
The verified environment is Node.js 24.22.1 and npm 11.19.1;
`.nvmrc` records the tested Node version. Install from the repository root:

```sh
npm ci
npm run dev
```

Open <http://localhost:3000> to see **AIVRA Public Preview**. No sign-in,
environment variables, API keys, or external services are required.
Stop the server with Ctrl+C.

Validate and run the production build locally:

```sh
npm run build
npm run typecheck
npm start
```

On Windows PowerShell, use `npm.cmd` in place of `npm` if execution policy
blocks `npm.ps1`. Development and production servers use the same default
port, so stop one before starting the other.

This unit supplies only Next.js, React, TypeScript, and a plain public index
route. Browser-default styling is temporary; the visual system and workspace
shell belong to later approved units. Lint is not configured in this minimal
foundation. Dependency versions are pinned in `package.json` and
`package-lock.json`; use `npm ci` to reproduce them.

## Shared synthetic data (U00.02)

Run `npm run validate:fixture` to check the shared Zod contracts, fictional
Northstar/Meridian dataset, record links, and deliberately invalid cases.
See [the shared demo data contract](docs/contracts/U00.02_Shared_Demo_Data_Contract.md)
for field definitions, versions, null handling, and future module import paths.

## Responsive workspace (U00.03)

The current UI uses the founder-approved **A1 Coastal Navy** theme (ADR-011).
Home shows counts from the bundled fictional dataset. The nine module pages
provide introductions and explicit **not yet implemented** states. No module
actions or AI integration are available yet.

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
hard-blocked until U00.07 supplies budget/rate/concurrency authorization.
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
