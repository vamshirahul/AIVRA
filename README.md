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
